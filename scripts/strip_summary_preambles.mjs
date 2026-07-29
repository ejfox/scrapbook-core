#!/usr/bin/env node
// Strip leaked conversational preambles from existing summaries in-place.
// No LLM cost — the summary content underneath is fine, we just remove the
// "Here's a detailed summary..." intro that leaks onto the display cards.
//   node scripts/strip_summary_preambles.mjs           -> DRY RUN
//   node scripts/strip_summary_preambles.mjs --apply    -> commit
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'; dotenv.config()
import { stripSummaryPreamble } from './aiSummarization.mjs'

const APPLY = process.argv.includes('--apply')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// Pull every summary that looks like it has a preamble. Use head-anchored
// prefixes (no leading %) so Postgres can use an index and avoid timeouts.
const PREFIXES = ["Here's a detailed summary%", 'Here is a summary%', "Here's a summary%",
                  'Sure%', 'Below is%', 'This is a summary%', 'Following is%']
const seen = new Map()
for (const p of PREFIXES) {
  let from = 0
  while (true) {
    const { data, error } = await sb.from('scraps').select('id, summary')
      .ilike('summary', p).range(from, from + 999)
    if (error) { console.error(`query "${p}":`, error.message); break }
    if (!data.length) break
    for (const r of data) seen.set(r.id, r)
    from += 1000
    if (data.length < 1000) break
  }
}
const rows = [...seen.values()]

const changes = rows
  .map(r => ({ id: r.id, before: r.summary, after: stripSummaryPreamble(r.summary) }))
  .filter(c => c.after && c.after !== c.before)

console.log(`${APPLY ? '[APPLY]' : '[DRY RUN]'} scanned ${rows.length} candidate rows, ${changes.length} need stripping\n`)
changes.slice(0, 6).forEach(c => {
  console.log(`  BEFORE: ${c.before.slice(0,60).replace(/\n/g,' ')}`)
  console.log(`  AFTER:  ${c.after.slice(0,60).replace(/\n/g,' ')}\n`)
})

if (!APPLY) { console.log('[DRY RUN] re-run with --apply to commit.'); process.exit(0) }

let ok = 0
for (const c of changes) {
  const { error } = await sb.from('scraps').update({ summary: c.after }).eq('id', c.id)
  if (error) console.log(`  FAILED ${c.id}: ${error.message}`)
  else ok++
}
console.log(`[APPLY] stripped ${ok}/${changes.length} summaries.`)
