#!/usr/bin/env node

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { extractRelationships, extractRelationshipsDetailed } from './aiRelationshipExtraction.mjs'

dotenv.config()

function parseArgs(argv) {
  const options = {
    batchFile: null,
    dryRun: false,
    includeDiagnostics: false,
    limit: 10,
    source: null,
    force: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--batch-file' && argv[i + 1]) {
      options.batchFile = argv[i + 1]
      i += 1
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--include-diagnostics') {
      options.includeDiagnostics = true
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--limit' && argv[i + 1]) {
      options.limit = Number.parseInt(argv[i + 1], 10)
      i += 1
    } else if (arg === '--source' && argv[i + 1]) {
      options.source = argv[i + 1]
      i += 1
    }
  }

  return options
}

async function loadBatchFile(batchFile) {
  const { readFile } = await import('fs/promises')
  const raw = await readFile(batchFile, 'utf8')
  const parsed = JSON.parse(raw)

  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => (typeof item === 'string' ? item : item?.scrap_id))
      .filter(Boolean)
  }

  if (Array.isArray(parsed.scrap_ids)) {
    return parsed.scrap_ids.filter(Boolean)
  }

  if (Array.isArray(parsed.items)) {
    return parsed.items
      .map((item) => (typeof item === 'string' ? item : item?.scrap_id))
      .filter(Boolean)
  }

  throw new Error(`Unsupported batch file format: ${batchFile}`)
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

async function fetchCandidateScraps(supabase, options) {
  if (options.batchFile) {
    const scrapIds = await loadBatchFile(options.batchFile)
    if (scrapIds.length === 0) {
      return []
    }

    const { data, error } = await supabase
      .from('scraps')
      .select('id, scrap_id, source, title, url, summary, content, relationships')
      .in('scrap_id', scrapIds)

    if (error) {
      throw error
    }

    const ordered = new Map((data || []).map((scrap) => [scrap.scrap_id, scrap]))
    return scrapIds
      .map((scrapId) => ordered.get(scrapId))
      .filter(Boolean)
      .filter((scrap) =>
        typeof scrap.content === 'string' &&
        scrap.content.length >= 80 &&
        !(typeof scrap.scrap_id === 'string' && scrap.scrap_id.startsWith('__')),
      )
  }

  const fetchLimit = Math.max(options.limit * 5, options.limit)
  let query = supabase
    .from('scraps')
    .select('id, scrap_id, source, title, url, summary, content, relationships')
    .not('content', 'is', null)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(fetchLimit)

  if (options.source) {
    query = query.eq('source', options.source)
  }

  if (!options.force) {
    query = query.or('relationships.is.null,relationships.eq.[]')
  }

  const { data, error } = await query
  if (error) {
    throw error
  }

  return (data || [])
    .filter((scrap) =>
      typeof scrap.content === 'string' &&
      scrap.content.length >= 80 &&
      !(typeof scrap.scrap_id === 'string' && scrap.scrap_id.startsWith('__')),
    )
    .slice(0, options.limit)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const supabase = getSupabase()
  const scraps = await fetchCandidateScraps(supabase, options)
  const results = []
  const summary = {
    source_modes: {},
    claim_modes: {},
    skipped_reasons: {},
    used_recovery_count: 0,
    raw_candidate_count: 0,
    pre_review_candidate_count: 0,
    post_review_candidate_count: 0,
    final_relationship_count: 0,
  }

  for (const scrap of scraps) {
    const extractionOptions = {
      scrapId: scrap.scrap_id,
      source: scrap.source,
      title: scrap.title,
      url: scrap.url,
      summary: scrap.summary,
    }

    const detailed = options.includeDiagnostics
      ? await extractRelationshipsDetailed(scrap.content, extractionOptions)
      : { relationships: await extractRelationships(scrap.content, extractionOptions), diagnostics: null }

    const relationships = detailed.relationships
    const diagnostics = detailed.diagnostics

    if (diagnostics) {
      summary.source_modes[diagnostics.source_mode] = (summary.source_modes[diagnostics.source_mode] || 0) + 1
      if (diagnostics.skipped_reason) {
        summary.skipped_reasons[diagnostics.skipped_reason] = (summary.skipped_reasons[diagnostics.skipped_reason] || 0) + 1
      }
      if (diagnostics.used_recovery) {
        summary.used_recovery_count += 1
      }
      summary.raw_candidate_count += diagnostics.raw_candidate_count || 0
      summary.pre_review_candidate_count += diagnostics.pre_review_candidate_count || 0
      summary.post_review_candidate_count += diagnostics.post_review_candidate_count || 0
      summary.final_relationship_count += diagnostics.final_relationship_count || 0
      for (const [claimMode, count] of Object.entries(diagnostics.claim_mode_counts || {})) {
        summary.claim_modes[claimMode] = (summary.claim_modes[claimMode] || 0) + count
      }
    }

    results.push({
      id: scrap.id,
      scrap_id: scrap.scrap_id,
      title: scrap.title,
      relationship_count: relationships.length,
      relationships,
      ...(options.includeDiagnostics && diagnostics ? { diagnostics } : {}),
    })

    if (!options.dryRun) {
      const { error } = await supabase
        .from('scraps')
        .update({ relationships })
        .eq('id', scrap.id)

      if (error) {
        throw new Error(`Failed to update ${scrap.scrap_id}: ${error.message}`)
      }
    }
  }

  console.log(JSON.stringify({
    dry_run: options.dryRun,
    include_diagnostics: options.includeDiagnostics,
    processed: results.length,
    ...(options.includeDiagnostics ? { summary } : {}),
    results,
  }, null, 2))
}

main().catch((error) => {
  console.error('Failed to re-extract relationships:', error.message)
  process.exit(1)
})
