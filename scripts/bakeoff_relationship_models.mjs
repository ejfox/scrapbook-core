#!/usr/bin/env node

import dotenv from 'dotenv'
import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { extractRelationshipsDetailed } from './aiRelationshipExtraction.mjs'
import { completion } from './llmService.mjs'
import {
  buildJudgeCouncil,
  parseJudgeCouncilArg,
  judgeScrapWithCouncil,
  aggregateCouncilResults,
} from '../lib/relationshipJudgeCouncil.mjs'

dotenv.config()

const DEFAULT_MODELS = [
  'deepseek/deepseek-chat-v3.1',
  'google/gemini-2.5-flash',
  'openai/gpt-4o-mini',
]

function parseArgs(argv) {
  const options = {
    batchFile: 'data/relationship-audit/mixed-review-batch-v2.stdout.json',
    models: DEFAULT_MODELS,
    judgeModel: null,
    judgeCouncil: [],
    outFile: null,
    resume: true,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--batch-file' && argv[i + 1]) {
      options.batchFile = argv[i + 1]
      i += 1
    } else if (arg === '--models' && argv[i + 1]) {
      options.models = argv[i + 1]
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      i += 1
    } else if (arg === '--judge-model' && argv[i + 1]) {
      options.judgeModel = argv[i + 1]
      i += 1
    } else if (arg === '--judge-council' && argv[i + 1]) {
      options.judgeCouncil = parseJudgeCouncilArg(argv[i + 1])
      i += 1
    } else if (arg === '--out-file' && argv[i + 1]) {
      options.outFile = argv[i + 1]
      i += 1
    } else if (arg === '--no-resume') {
      options.resume = false
    } else if (arg === '--resume') {
      options.resume = true
    }
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

async function loadBatchFile(batchFile) {
  const raw = await readFile(batchFile, 'utf8')
  const parsed = JSON.parse(raw)

  if (Array.isArray(parsed.scrap_ids)) {
    return parsed.scrap_ids.filter(Boolean)
  }

  if (Array.isArray(parsed.items)) {
    return parsed.items
      .map((item) => (typeof item === 'string' ? item : item?.scrap_id))
      .filter(Boolean)
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => (typeof item === 'string' ? item : item?.scrap_id))
      .filter(Boolean)
  }

  throw new Error(`Unsupported batch file format: ${batchFile}`)
}

async function fetchScraps(supabase, scrapIds) {
  const { data, error } = await supabase
    .from('scraps')
    .select('id, scrap_id, source, title, url, summary, content')
    .in('scrap_id', scrapIds)

  if (error) throw error

  const ordered = new Map((data || []).map((scrap) => [scrap.scrap_id, scrap]))
  return scrapIds.map((scrapId) => ordered.get(scrapId)).filter(Boolean)
}

async function loadExistingPayload(outFile) {
  try {
    const raw = await readFile(outFile, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function buildPayload({
  startedAt,
  options,
  judgeCouncil,
  scrapIds,
  scrapResults,
  failures,
  status,
  currentScrapId = null,
}) {
  return {
    started_at: startedAt,
    updated_at: new Date().toISOString(),
    status,
    current_scrap_id: currentScrapId,
    batch_file: options.batchFile,
    judge_model: judgeCouncil.length === 1 ? judgeCouncil[0].model : null,
    judge_council: judgeCouncil,
    candidate_models: options.models,
    requested_scrap_ids: scrapIds,
    completed_scrap_ids: scrapResults.map((row) => row.scrap_id),
    failure_count: failures.length,
    failures,
    aggregate: aggregateCouncilResults(scrapResults, options.models),
    results: scrapResults,
  }
}

async function persistPayload(outFile, payload) {
  await mkdir(path.dirname(outFile), { recursive: true })
  await writeFile(outFile, JSON.stringify(payload, null, 2))
}

function validateResumePayload(payload, options) {
  const existingModels = JSON.stringify(payload.candidate_models || [])
  const nextModels = JSON.stringify(options.models || [])
  if (existingModels !== nextModels) {
    throw new Error('Resume payload candidate_models do not match current --models')
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const supabase = getSupabase()
  const scrapIds = await loadBatchFile(options.batchFile)
  const outFile = options.outFile || path.join(
    'data',
    'relationship-audit',
    `relationship-model-bakeoff-${Date.now()}.json`,
  )
  const scraps = await fetchScraps(supabase, scrapIds)
  const judgeCouncil = buildJudgeCouncil({
    judgeModel: options.judgeCouncil.length > 0 ? null : options.judgeModel,
    judgeCouncil: options.judgeCouncil,
  })
  const existingPayload = options.resume ? await loadExistingPayload(outFile) : null

  if (existingPayload) {
    validateResumePayload(existingPayload, options)
  }

  const scrapResults = existingPayload?.results || []
  const failures = existingPayload?.failures || []
  const completedIds = new Set(scrapResults.map((row) => row.scrap_id))
  const startedAt = existingPayload?.started_at || new Date().toISOString()

  if (!existingPayload) {
    await persistPayload(outFile, buildPayload({
      startedAt,
      options,
      judgeCouncil,
      scrapIds,
      scrapResults,
      failures,
      status: 'running',
      currentScrapId: null,
    }))
  }

  for (const scrap of scraps) {
    if (completedIds.has(scrap.scrap_id)) continue

    await persistPayload(outFile, buildPayload({
      startedAt,
      options,
      judgeCouncil,
      scrapIds,
      scrapResults,
      failures,
      status: 'running',
      currentScrapId: scrap.scrap_id,
    }))

    const modelResults = []

    try {
      for (const model of options.models) {
        const result = await extractRelationshipsDetailed(scrap.content || '', {
          scrapId: scrap.scrap_id,
          source: scrap.source,
          title: scrap.title,
          url: scrap.url,
          summary: scrap.summary,
          model,
          reviewModel: model,
        })

        modelResults.push({
          model,
          diagnostics: result.diagnostics,
          relationships: result.relationships,
        })
      }

      const judgment = await judgeScrapWithCouncil({
        scrap,
        perModelOutputs: modelResults,
        judges: judgeCouncil,
        completion,
        taskType: 'relationshipModelBakeoffJudge',
      })

      scrapResults.push({
        scrap_id: scrap.scrap_id,
        title: scrap.title,
        source: scrap.source,
        model_results: modelResults,
        judgment,
      })
      completedIds.add(scrap.scrap_id)
    } catch (error) {
      failures.push({
        scrap_id: scrap.scrap_id,
        source: scrap.source,
        title: scrap.title,
        error: error.message,
        failed_at: new Date().toISOString(),
      })
    }

    await persistPayload(outFile, buildPayload({
      startedAt,
      options,
      judgeCouncil,
      scrapIds,
      scrapResults,
      failures,
      status: 'running',
      currentScrapId: null,
    }))
  }

  const payload = buildPayload({
    startedAt,
    options,
    judgeCouncil,
    scrapIds,
    scrapResults,
    failures,
    status: 'completed',
    currentScrapId: null,
  })
  payload.generated_at = new Date().toISOString()
  await persistPayload(outFile, payload)

  console.log(JSON.stringify({
    out_file: outFile,
    aggregate: payload.aggregate,
  }, null, 2))
}

main().catch((error) => {
  console.error('Failed to run relationship model bakeoff:', error.message)
  process.exit(1)
})
