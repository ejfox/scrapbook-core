#!/usr/bin/env node
// Targeted cleanup for the recent scrap backlog.
//   node scripts/cleanup_recent.mjs            -> DRY RUN (shows what would change)
//   node scripts/cleanup_recent.mjs --apply    -> actually apply
//
// Does three things, scoped to the most recent N scraps (default 200):
//   1. DELETE dead rows        (null url OR title "[No content available]" OR scrap_id starting "__")
//   2. CLEAN mastodon titles   (strip "Post Title:", "Current Situation:", "Post Deletion:", etc. preambles)
//   3. BACKFILL screenshots    (rows with a real http url + no screenshot_url)  [--shots to enable]
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const APPLY = process.argv.includes('--apply')
const DO_SHOTS = process.argv.includes('--shots')
const N = parseInt(process.argv.find(a => /^\d+$/.test(a)) || '200', 10)
const tag = APPLY ? '[APPLY]' : '[DRY RUN]'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const { data: scraps, error } = await supabase.from('scraps')
  .select('id, scrap_id, source, type, url, title, summary, screenshot_url')
  .order('created_at', { ascending: false }).limit(N)
if (error) { console.error(error); process.exit(1) }

console.log(`${tag} scanning ${scraps.length} most-recent scraps\n`)

// ---- 1. dead rows ----
const dead = scraps.filter(s =>
  (s.scrap_id || '').startsWith('__') ||
  !s.url ||
  /^\[?no content available\]?$/i.test((s.title || '').trim())
)

// ---- 2. mastodon title preamble leak ----
// Strip a leading "Label:" preamble the summarizer leaked into the title field.
const TITLE_PREAMBLE = /^\s*(post title|post|title|current situation|post deletion|summary|content|overview)\s*:\s*/i
function cleanTitle(t) {
  if (!t) return t
  let out = t
  // strip up to two stacked preambles, then unwrap surrounding quotes
  for (let i = 0; i < 2 && TITLE_PREAMBLE.test(out); i++) out = out.replace(TITLE_PREAMBLE, '')
  out = out.trim().replace(/^["“](.*)["”]$/s, '$1').trim()
  return out
}
const deadIds = new Set(dead.map(s => s.id))
const titleFixes = scraps
  .filter(s => !deadIds.has(s.id) && s.source === 'mastodon')
  .map(s => ({ s, next: cleanTitle(s.title) }))
  .filter(({ s, next }) => next && next !== s.title)

// ---- 3. screenshot backfill candidates ----
const shotCandidates = scraps.filter(s =>
  !deadIds.has(s.id) && !s.screenshot_url && /^https?:\/\//.test(s.url || '') &&
  s.source !== 'mastodon' // mastodon statuses aren't meaningfully screenshottable
)

console.log(`1) DELETE dead rows:        ${dead.length}`)
dead.forEach(s => console.log(`     ${s.scrap_id}  url=${s.url}  title=${JSON.stringify((s.title||'').slice(0,40))}`))
console.log(`\n2) CLEAN mastodon titles:   ${titleFixes.length}`)
titleFixes.forEach(({ s, next }) => {
  console.log(`     ${JSON.stringify(s.title.slice(0,50))}`)
  console.log(`  -> ${JSON.stringify(next.slice(0,50))}`)
})
console.log(`\n3) BACKFILL screenshots:    ${shotCandidates.length}${DO_SHOTS ? '' : '  (add --shots to run)'}`)
shotCandidates.forEach(s => console.log(`     ${s.source} "${(s.title||'').slice(0,40)}" ${s.url}`))

if (!APPLY) {
  console.log(`\n${tag} nothing changed. Re-run with --apply to commit.`)
  process.exit(0)
}

// ================= APPLY =================
console.log(`\n[APPLY] committing...`)

// 1. deletes
if (dead.length) {
  const { error: e } = await supabase.from('scraps').delete().in('id', dead.map(s => s.id))
  console.log(e ? `  delete FAILED: ${e.message}` : `  deleted ${dead.length} dead rows`)
}

// 2. title fixes
let fixed = 0
for (const { s, next } of titleFixes) {
  const { error: e } = await supabase.from('scraps').update({ title: next }).eq('id', s.id)
  if (e) console.log(`  title update FAILED for ${s.scrap_id}: ${e.message}`)
  else fixed++
}
if (titleFixes.length) console.log(`  cleaned ${fixed}/${titleFixes.length} titles`)

// 3. screenshots (opt-in, slow: launches puppeteer per url)
if (DO_SHOTS && shotCandidates.length) {
  const { generateScreenshot } = await import('./generateScreenshot.mjs')
  let ok = 0
  for (const s of shotCandidates) {
    try {
      const shot = await generateScreenshot(s.url, s.scrap_id)
      if (shot?.url) {
        const { error: e } = await supabase.from('scraps').update({ screenshot_url: shot.url }).eq('id', s.id)
        if (!e) { ok++; console.log(`  shot ok: ${s.scrap_id}`) }
        else console.log(`  shot db-update FAILED ${s.scrap_id}: ${e.message}`)
      } else {
        console.log(`  shot none: ${s.scrap_id}`)
      }
    } catch (err) {
      console.log(`  shot FAILED ${s.scrap_id}: ${err.message}`)
    }
  }
  console.log(`  backfilled ${ok}/${shotCandidates.length} screenshots`)
}

console.log(`\n[APPLY] done.`)
