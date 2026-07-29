// Reclassify scraps whose stored summary is actually a summary of a dead / 404 /
// unreachable page. Nulls the polluted summary + derived fields and marks
// content_type='dead_link' so the feed can filter them. Pass --dry to preview.
//
// Uses the same summaryDescribesErrorPage() detector the live pipeline now uses,
// so what gets cleaned here is exactly what the pipeline will refuse to create.
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { summaryDescribesErrorPage } from '../lib/contentQuality.mjs'

const DRY = process.argv.includes('--dry')
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

let from = 0
const page = 1000
let scanned = 0
let flagged = 0
const samples = []

for (;;) {
  const { data, error } = await db
    .from('scraps')
    .select('id,title,url,summary')
    .not('summary', 'is', null)
    // Only the URL-fetching source can have "dead page" summaries. Mastodon/arena
    // are user content — a post whose text is literally "the page you are looking
    // for isn't here" is a real post, not a 404.
    .eq('source', 'pinboard')
    .range(from, from + page - 1)
  if (error) throw error
  if (!data.length) break
  scanned += data.length

  for (const r of data) {
    if (!summaryDescribesErrorPage(r.summary)) continue
    flagged++
    if (samples.length < 12) {
      samples.push(`  [${(r.title || '').slice(0, 34)}] ${r.summary.slice(0, 70).replace(/\n/g, ' ')}`)
    }
    if (!DRY) {
      const { error: e } = await db
        .from('scraps')
        .update({
          summary: null,
          tags: [],
          concept_tags: [],
          location: null,
          latitude: null,
          longitude: null,
          extraction_confidence: null,
          content_type: 'dead_link',
          updated_at: new Date().toISOString(),
        })
        .eq('id', r.id)
      if (e) console.error('  update failed', r.id, e.message)
    }
  }
  if (data.length < page) break
  from += page
}

console.log(`\n${DRY ? '[DRY] ' : ''}Dead-summary cleanup: flagged ${flagged} / ${scanned} scanned`)
console.log('\nSamples of what matched:')
samples.forEach((s) => console.log(s))
if (DRY) console.log('\n[dry run — no writes]')
process.exit(0)
