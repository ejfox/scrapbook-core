// Dry-run proof harness for the enrichment quality fixes.
// Reprocesses 3 representative scraps through the REAL extraction functions
// and prints OLD (stored) vs NEW (recomputed). Writes nothing to the DB.
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { metaSummaryToTags } from './aiSummarization.mjs'
import { extractLocation } from './aiGeolocation.mjs'
import { extractFinancialAnalysis } from './aiFinancialAnalysis.mjs'
import { computeConfidenceScores } from './reasoningFields.mjs'

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const TITLES = ['CHRONOS II', 'Graphics Engineer', 'Subway Builder']

const { data: scraps } = await db
  .from('scraps')
  .select('id,scrap_id,source,title,url,content,summary,tags,location,financial_analysis,extraction_confidence,relationships')
  .or(TITLES.map((t) => `title.ilike.%${t}%`).join(','))

for (const s of scraps) {
  console.log('\n' + '='.repeat(70))
  console.log(`SCRAP: ${s.title}  [${s.source}]`)
  console.log('='.repeat(70))

  const text = [s.content, s.summary].filter(Boolean).join('\n\n')

  // --- TAGS (main-pipeline tagger + the same !-strip the pipeline now applies) ---
  const rawTags = await metaSummaryToTags(s.summary, { scrapId: s.scrap_id })
  const newTags = [...new Set([...(rawTags || [])])].filter(
    (t) => typeof t === 'string' && t.trim() && !t.startsWith('!'),
  )
  console.log('\nTAGS')
  console.log('  OLD:', JSON.stringify(s.tags))
  console.log('  NEW:', JSON.stringify(newTags))

  // --- LOCATION (abstention prompt + high floor) ---
  const loc = await extractLocation(text, { url: s.url, scrapId: s.scrap_id })
  console.log('\nLOCATION')
  console.log('  OLD:', s.location)
  console.log('  NEW:', loc?.location ?? 'null (abstained)')

  // --- FINANCIAL (phantom-asset guard) ---
  const fin = await extractFinancialAnalysis(text, { url: s.url })
  console.log('\nFINANCIAL')
  console.log('  OLD:', JSON.stringify(s.financial_analysis)?.slice(0, 80))
  console.log('  NEW assets:', JSON.stringify(fin.assets))

  // --- CONFIDENCE (deterministic, grounded) ---
  const conf = computeConfidenceScores({ ...s, tags: newTags })
  console.log('\nCONFIDENCE')
  console.log('  OLD:', JSON.stringify(s.extraction_confidence), '(hardcoded copy of prompt example)')
  console.log('  NEW:', JSON.stringify(conf), '(computed from real signals)')
}

console.log('\n[dry run — no DB writes]')
process.exit(0)
