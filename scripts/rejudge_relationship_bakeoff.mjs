#!/usr/bin/env node

import dotenv from 'dotenv'
import { readFile, writeFile } from 'fs/promises'
import { createClient } from '@supabase/supabase-js'
import { completion } from './llmService.mjs'
import {
  buildJudgeCouncil,
  parseJudgeCouncilArg,
  judgeScrapWithCouncil,
  aggregateCouncilResults,
} from '../lib/relationshipJudgeCouncil.mjs'

dotenv.config()

function parseArgs(argv) {
  const options = {
    input: null,
    output: null,
    judgeModel: null,
    judgeCouncil: [],
    resume: true,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if ((arg === '--input' || arg === '--file') && argv[i + 1]) {
      options.input = argv[i + 1]
      i += 1
    } else if ((arg === '--output' || arg === '--out') && argv[i + 1]) {
      options.output = argv[i + 1]
      i += 1
    } else if (arg === '--judge-model' && argv[i + 1]) {
      options.judgeModel = argv[i + 1]
      i += 1
    } else if (arg === '--judge-council' && argv[i + 1]) {
      options.judgeCouncil = parseJudgeCouncilArg(argv[i + 1])
      i += 1
    } else if (arg === '--no-resume') {
      options.resume = false
    } else if (arg === '--resume') {
      options.resume = true
    }
  }

  if (!options.input) {
    throw new Error('Usage: node scripts/rejudge_relationship_bakeoff.mjs --input <json> [--output <json>] [--judge-model <model>] [--judge-council archivist=model,investigator=model,ontologist=model]')
  }

  return options
}

function getSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!process.env.SUPABASE_URL || !key) {
    throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY')
  }

  return createClient(
    process.env.SUPABASE_URL,
    key,
    { auth: { persistSession: false } },
  )
}

async function loadExistingPayload(output) {
  try {
    const raw = await readFile(output, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function buildPayload({
  basePayload,
  judgeCouncil,
  results,
  failures,
  status,
  currentScrapId = null,
  startedAt,
}) {
  return {
    ...basePayload,
    rejudge_started_at: startedAt,
    rejudged_at: status === 'completed' ? new Date().toISOString() : null,
    rejudge_updated_at: new Date().toISOString(),
    rejudge_status: status,
    rejudge_current_scrap_id: currentScrapId,
    judge_model: judgeCouncil.length === 1 ? judgeCouncil[0].model : null,
    judge_council: judgeCouncil,
    rejudge_failure_count: failures.length,
    rejudge_failures: failures,
    aggregate: aggregateCouncilResults(results, basePayload.candidate_models),
    results,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const supabase = getSupabase()
  const payload = JSON.parse(await readFile(options.input, 'utf8'))
  const output = options.output || options.input.replace(/\.json$/i, '.rejudged.json')
  const existingOutput = options.resume ? await loadExistingPayload(output) : null
  const sourceRows = payload.results
  const scrapIds = sourceRows.map((row) => row.scrap_id)
  const judgeCouncil = buildJudgeCouncil({
    judgeModel: options.judgeCouncil.length > 0 ? null : options.judgeModel,
    judgeCouncil: options.judgeCouncil,
  })

  const { data, error } = await supabase
    .from('scraps')
    .select('scrap_id, source, title, url, summary, content')
    .in('scrap_id', scrapIds)

  if (error) throw error

  const scrapMap = new Map((data || []).map((scrap) => [scrap.scrap_id, scrap]))
  const results = existingOutput?.results || []
  const failures = existingOutput?.rejudge_failures || []
  const completedIds = new Set(results.map((row) => row.scrap_id))
  const startedAt = existingOutput?.rejudge_started_at || new Date().toISOString()

  await writeFile(output, JSON.stringify(buildPayload({
    basePayload: payload,
    judgeCouncil,
    results,
    failures,
    status: 'running',
    currentScrapId: null,
    startedAt,
  }), null, 2))

  for (const row of sourceRows) {
    if (completedIds.has(row.scrap_id)) continue

    const scrap = scrapMap.get(row.scrap_id)
    if (!scrap) continue

    await writeFile(output, JSON.stringify(buildPayload({
      basePayload: payload,
      judgeCouncil,
      results,
      failures,
      status: 'running',
      currentScrapId: row.scrap_id,
      startedAt,
    }), null, 2))

    try {
      const judgment = await judgeScrapWithCouncil({
        scrap,
        perModelOutputs: row.model_results,
        judges: judgeCouncil,
        completion,
        taskType: 'relationshipModelBakeoffRejudge',
      })
      results.push({
        ...row,
        judgment,
      })
      completedIds.add(row.scrap_id)
    } catch (error) {
      failures.push({
        scrap_id: row.scrap_id,
        source: row.source,
        title: row.title,
        error: error.message,
        failed_at: new Date().toISOString(),
      })
    }

    await writeFile(output, JSON.stringify(buildPayload({
      basePayload: payload,
      judgeCouncil,
      results,
      failures,
      status: 'running',
      currentScrapId: null,
      startedAt,
    }), null, 2))
  }

  const nextPayload = buildPayload({
    basePayload: payload,
    judgeCouncil,
    results,
    failures,
    status: 'completed',
    currentScrapId: null,
    startedAt,
  })

  await writeFile(output, JSON.stringify(nextPayload, null, 2))
  console.log(JSON.stringify({ out_file: output, aggregate: nextPayload.aggregate }, null, 2))
}

main().catch((error) => {
  console.error('Failed to rejudge relationship bakeoff:', error.message)
  process.exit(1)
})
