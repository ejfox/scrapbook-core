// One-shot cleanup of the garbage enrichment fields the quality audit surfaced.
// Mostly deterministic (no LLM): strip !control tags, recompute fake confidence,
// null hallucinated AAPL financials. Locations (14) are re-checked with the fixed
// extractor. Pass --dry to preview without writing.
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { computeConfidenceScores } from './reasoningFields.mjs'
import { extractLocation } from './aiGeolocation.mjs'

const DRY = process.argv.includes('--dry')
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
const tag = DRY ? '[DRY] ' : ''

// ---------------------------------------------------------------------------
// 1. Strip !control tags from every record that has them (paginated full scan)
// ---------------------------------------------------------------------------
async function stripControlTags() {
  let from = 0
  const page = 1000
  let scanned = 0
  let fixed = 0
  for (;;) {
    const { data, error } = await db
      .from('scraps')
      .select('id,tags')
      .not('tags', 'is', null)
      .range(from, from + page - 1)
    if (error) throw error
    if (!data.length) break
    scanned += data.length
    for (const r of data) {
      if (!Array.isArray(r.tags)) continue
      const clean = r.tags.filter(
        (t) => typeof t === 'string' && t.trim() && !t.startsWith('!'),
      )
      if (clean.length !== r.tags.length) {
        fixed++
        if (!DRY) {
          const { error: e } = await db.from('scraps').update({ tags: clean }).eq('id', r.id)
          if (e) console.error('  tag update failed', r.id, e.message)
        }
      }
    }
    if (data.length < page) break
    from += page
  }
  console.log(`${tag}TAGS: stripped !control tags from ${fixed} records (${scanned} scanned)`)
}

// ---------------------------------------------------------------------------
// 2. Recompute extraction_confidence deterministically (replaces fake constants)
// ---------------------------------------------------------------------------
async function recomputeConfidence() {
  const { data } = await db
    .from('scraps')
    .select('id,summary,tags,relationships')
    .not('extraction_confidence', 'is', null)
  let fixed = 0
  for (const r of data) {
    const conf = r.summary ? computeConfidenceScores(r) : null
    if (!DRY) await db.from('scraps').update({ extraction_confidence: conf }).eq('id', r.id)
    fixed++
    if (DRY) console.log(`  ${r.id} -> ${JSON.stringify(conf)}`)
  }
  console.log(`${tag}CONFIDENCE: recomputed ${fixed} records`)
}

// ---------------------------------------------------------------------------
// 3. Null hallucinated financial_analysis (all current ones are phantom AAPL)
// ---------------------------------------------------------------------------
async function clearPhantomFinancial() {
  const { data } = await db
    .from('scraps')
    .select('id,financial_analysis')
    .not('financial_analysis', 'is', null)
  let cleared = 0
  for (const r of data) {
    const assets = r.financial_analysis?.assets || r.financial_analysis?.tracked_assets || []
    // Any asset whose mentions are empty / say "not mentioned" is phantom.
    const phantom =
      assets.length === 0 ||
      assets.every((a) => !a.mentions?.length || /not mentioned|none/i.test(a.context || ''))
    if (phantom) {
      cleared++
      if (!DRY) await db.from('scraps').update({ financial_analysis: null }).eq('id', r.id)
    }
  }
  console.log(`${tag}FINANCIAL: nulled ${cleared} phantom records`)
}

// ---------------------------------------------------------------------------
// 4. Re-check the 14 stored locations with the fixed (abstaining) extractor
// ---------------------------------------------------------------------------
async function recheckLocations() {
  const { data } = await db
    .from('scraps')
    .select('id,url,content,summary,location')
    .not('location', 'is', null)
  let kept = 0
  let dropped = 0
  for (const r of data) {
    const text = [r.content, r.summary].filter(Boolean).join('\n\n')
    if (!text) continue
    const loc = await extractLocation(text, { url: r.url })
    const newLoc = loc?.location || null
    if (newLoc) kept++
    else dropped++
    console.log(`  ${DRY ? '(dry) ' : ''}"${r.location}" -> ${newLoc || 'null (abstained)'}`)
    if (!DRY) {
      await db
        .from('scraps')
        .update({
          location: newLoc,
          latitude: loc?.latitude || null,
          longitude: loc?.longitude || null,
        })
        .eq('id', r.id)
    }
  }
  console.log(`${tag}LOCATION: kept ${kept}, dropped ${dropped}`)
}

console.log(DRY ? '=== DRY RUN (no writes) ===\n' : '=== CLEANUP (writing) ===\n')
await stripControlTags()
await recomputeConfidence()
await clearPhantomFinancial()
await recheckLocations()
console.log('\nDone.')
process.exit(0)
