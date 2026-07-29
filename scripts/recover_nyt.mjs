// Recover NYT scraps that were marked dead_link because they hit a bot-detection
// / login wall at capture time. Now that logged-in NYT cookies are in
// data/cookies.json, re-fetch (cookie-aware) + re-screenshot + re-enrich via the
// untangled repair path. Decodes old /glogin?URI=... redirects to the real URL.
//
//   node scripts/recover_nyt.mjs [--dry] [--limit N]
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { repairScrapWithAI } from './scrap_doctor_ai.mjs'
import { generateScreenshot } from './generateScreenshot.mjs'

const DRY = process.argv.includes('--dry')
const limIdx = process.argv.indexOf('--limit')
const LIMIT = limIdx > -1 ? parseInt(process.argv[limIdx + 1], 10) : 100
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// A NYT /glogin redirect carries the real article URL in the ?URI= param.
function resolveNytUrl(url) {
  if (!url) return url
  const m = url.match(/[?&]URI=([^&]+)/i)
  if (m) { try { return decodeURIComponent(m[1]) } catch { /* keep original */ } }
  return url
}

const { data: scraps } = await db
  .from('scraps')
  .select('*')
  .eq('content_type', 'dead_link')
  .ilike('url', '%nytimes.com%')

const targets = (scraps || []).slice(0, LIMIT)
console.log(`${DRY ? '[DRY] ' : ''}Recovering ${targets.length} NYT dead_link scrap(s)\n`)

let recovered = 0
let stillDead = 0

for (const scrap of targets) {
  const realUrl = resolveNytUrl(scrap.url)
  console.log(`— ${scrap.scrap_id}  ${realUrl.slice(0, 70)}`)

  if (DRY) {
    console.log(`   would: url=${realUrl !== scrap.url ? 'decoded, ' : ''}clear dead_link, re-fetch+shoot+enrich`)
    continue
  }

  // Persist the decoded URL first so the capture + stored record use the real one.
  if (realUrl !== scrap.url) {
    await db.from('scraps').update({ url: realUrl }).eq('scrap_id', scrap.scrap_id)
  }

  // Hand repair a clean slate so every field regenerates through the cookie-aware
  // path: null the polluted fields + the old bot-block screenshot.
  const fresh = {
    ...scrap,
    url: realUrl,
    content: null,
    summary: null,
    tags: [],
    location: null,
    relationships: null,
    financial_analysis: null,
    content_type: null,
    screenshot_url: null,
  }

  try {
    await repairScrapWithAI(fresh, { auto: true, fetchContent: true })
  } catch (e) {
    console.log(`   ✗ repair threw: ${e.message}`)
  }

  // Did we get a real summary back?
  const { data: after } = await db
    .from('scraps')
    .select('summary')
    .eq('scrap_id', scrap.scrap_id)
    .single()

  if (after?.summary) {
    recovered++
    // repair's partial update never overwrites the stale dead_link marker — clear
    // it explicitly now that real content is back.
    await db.from('scraps').update({ content_type: null }).eq('scrap_id', scrap.scrap_id)
    // Force a fresh screenshot (cookies + stealth) — the old one is the bot-block
    // shot, and generateScreenshot otherwise skips existing Cloudinary IDs.
    try {
      const shot = await generateScreenshot(realUrl, scrap.scrap_id, { force: true })
      if (shot?.url) await db.from('scraps').update({ screenshot_url: shot.url }).eq('scrap_id', scrap.scrap_id)
      console.log(`   ✓ recovered (${after.summary.length} char summary${shot?.url ? ', new shot' : shot?.blocked ? ', shot still walled' : ''})`)
    } catch (e) {
      console.log(`   ✓ recovered (${after.summary.length} char summary; shot failed: ${e.message})`)
    }
  } else {
    stillDead++
    console.log('   … still no content (genuinely dead or still walled)')
  }
}

console.log(`\n${DRY ? '[DRY] ' : ''}Done. recovered ${recovered}, still-dead ${stillDead}`)
process.exit(0)
