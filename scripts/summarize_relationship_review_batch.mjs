#!/usr/bin/env node

import { readFile } from 'fs/promises'

function parseArgs(argv) {
  const options = {
    file: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--file' && argv[i + 1]) {
      options.file = argv[i + 1]
      i += 1
    }
  }

  if (!options.file) {
    throw new Error('Usage: node scripts/summarize_relationship_review_batch.mjs --file <path>')
  }

  return options
}

function summarize(payload) {
  const totals = {
    processed: payload.processed || 0,
    non_empty: 0,
    total_relationships: 0,
    by_type: {},
    by_claim_mode: {},
    source_modes: payload.summary?.source_modes || {},
    skipped_reasons: payload.summary?.skipped_reasons || {},
    used_recovery_count: payload.summary?.used_recovery_count || 0,
    raw_candidate_count: payload.summary?.raw_candidate_count || 0,
    pre_review_candidate_count: payload.summary?.pre_review_candidate_count || 0,
    post_review_candidate_count: payload.summary?.post_review_candidate_count || 0,
    final_relationship_count: payload.summary?.final_relationship_count || 0,
  }

  for (const row of payload.results || []) {
    if ((row.relationship_count || 0) > 0) {
      totals.non_empty += 1
    }

    totals.total_relationships += row.relationship_count || 0

    for (const relationship of row.relationships || []) {
      totals.by_type[relationship.type] = (totals.by_type[relationship.type] || 0) + 1
      const claimMode = relationship.claim_mode || 'asserted'
      totals.by_claim_mode[claimMode] = (totals.by_claim_mode[claimMode] || 0) + 1
    }
  }

  return {
    processed: totals.processed,
    non_empty: totals.non_empty,
    total_relationships: totals.total_relationships,
    by_type: Object.entries(totals.by_type).sort((a, b) => b[1] - a[1]),
    by_claim_mode: Object.entries(totals.by_claim_mode).sort((a, b) => b[1] - a[1]),
    source_modes: totals.source_modes,
    skipped_reasons: totals.skipped_reasons,
    used_recovery_count: totals.used_recovery_count,
    raw_candidate_count: totals.raw_candidate_count,
    pre_review_candidate_count: totals.pre_review_candidate_count,
    post_review_candidate_count: totals.post_review_candidate_count,
    final_relationship_count: totals.final_relationship_count,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const raw = await readFile(options.file, 'utf8')
  const payload = JSON.parse(raw)
  console.log(JSON.stringify(summarize(payload), null, 2))
}

main().catch((error) => {
  console.error('Failed to summarize relationship review batch:', error.message)
  process.exit(1)
})
