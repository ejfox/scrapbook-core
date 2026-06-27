#!/usr/bin/env node
/**
 * quality_bakeoff.mjs — per-task model "buffet". For each enrichment task, run a
 * slate of candidate models on the same eval scraps and print the actual outputs
 * side by side, so a human can pick the model per task. Writes a markdown report
 * to data/golden/bakeoff_report.md.
 *
 * Usage: node scripts/quality_bakeoff.mjs [--limit N]
 */
import 'dotenv/config'
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { summarizeContent, metaSummaryToTags } from './aiSummarization.mjs'
import { extractConceptTags } from './reasoningFields.mjs'

const SLATES = {
  summary: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite', 'qwen/qwen3-235b-a22b-2507', 'google/gemma-3-12b-it'],
  tags: ['openai/gpt-4o-mini', 'qwen/qwen3-235b-a22b-2507', 'google/gemini-2.5-flash-lite'],
  concepts: ['google/gemma-3-12b-it', 'qwen/qwen3-235b-a22b-2507', 'google/gemini-2.5-flash-lite'],
}

const limit = (() => { const i = process.argv.indexOf('--limit'); return i !== -1 ? parseInt(process.argv[i + 1], 10) : 3 })()

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } })
const { data: scraps } = await sb.from('scraps')
  .select('scrap_id,title,url,content,summary')
  .like('scrap_id', 'pinboard-%')
  .limit(limit)

const report = []
const W = (s) => { report.push(s); console.error(s) }

for (const scrap of scraps) {
  const content = scrap.content || scrap.summary || ''
  if (!content) continue
  W(`\n${'█'.repeat(72)}`)
  W(`SCRAP: ${(scrap.title || scrap.url || '').slice(0, 64)}  (${content.length} chars)`)

  // ── SUMMARY buffet ──
  W(`\n### TASK: summary`)
  let firstSummary = null
  for (const model of SLATES.summary) {
    try {
      const s = await summarizeContent(content, { metaSummary: true, model, taskType: 'summarization', scrapId: scrap.scrap_id })
      if (!firstSummary && s) firstSummary = s
      W(`\n  ── ${model}`)
      W(`     ${(s || '(none)').replace(/\n/g, '\n     ').slice(0, 600)}`)
    } catch (e) { W(`\n  ── ${model}  ERROR: ${e.message.slice(0, 80)}`) }
  }

  const summaryForDerived = firstSummary || scrap.summary || content.slice(0, 1500)

  // ── TAGS buffet ──
  W(`\n### TASK: tags  (on shared summary)`)
  for (const model of SLATES.tags) {
    try {
      const t = await metaSummaryToTags(summaryForDerived, { model, scrapId: scrap.scrap_id })
      W(`  ── ${model.padEnd(34)} ${JSON.stringify(t)}`)
    } catch (e) { W(`  ── ${model.padEnd(34)} ERROR: ${e.message.slice(0, 60)}`) }
  }

  // ── CONCEPT_TAGS buffet ──
  W(`\n### TASK: concept_tags  (on shared summary)`)
  for (const model of SLATES.concepts) {
    try {
      const c = await extractConceptTags(summaryForDerived, [], { model, scrapId: scrap.scrap_id, taskType: 'concept_extraction' })
      W(`  ── ${model.padEnd(34)} ${JSON.stringify(c)}`)
    } catch (e) { W(`  ── ${model.padEnd(34)} ERROR: ${e.message.slice(0, 60)}`) }
  }
}

fs.mkdirSync('data/golden', { recursive: true })
fs.writeFileSync('data/golden/bakeoff_report.md', report.join('\n'))
console.error(`\n\nReport written to data/golden/bakeoff_report.md`)
process.exit(0)
