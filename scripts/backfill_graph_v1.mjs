#!/usr/bin/env node

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import {
  createProjectionRecords,
  DEFAULT_EXTRACTOR_VERSION,
  DEFAULT_FETCH_PAGE_SIZE,
  DEFAULT_ONTOLOGY_VERSION,
  fetchRelationshipScraps,
} from '../lib/graphProjection.mjs'

dotenv.config()

const UPSERT_BATCH_SIZE = 500
const LOOKUP_BATCH_SIZE = 100

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: null,
    scrapId: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--limit' && argv[i + 1]) {
      options.limit = Number.parseInt(argv[i + 1], 10)
      i += 1
    } else if (arg === '--scrap-id' && argv[i + 1]) {
      options.scrapId = argv[i + 1]
      i += 1
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

function chunkArray(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function upsertRows(supabase, table, rows, onConflict) {
  if (rows.length === 0) return

  for (const batch of chunkArray(rows, UPSERT_BATCH_SIZE)) {
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict })

    if (error) {
      throw new Error(`Failed to upsert ${table}: ${error.message}`)
    }
  }
}

async function fetchKeyMap(supabase, table, keyColumn, keys) {
  const keyMap = new Map()

  for (const batch of chunkArray(keys, LOOKUP_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from(table)
      .select(`id, ${keyColumn}`)
      .in(keyColumn, batch)

    if (error) {
      throw new Error(`Failed to fetch ${table} keys: ${error.message}`)
    }

    for (const row of data || []) {
      keyMap.set(row[keyColumn], row.id)
    }
  }

  return keyMap
}

function withUpdatedAt(row, runTimestamp) {
  return {
    ...row,
    updated_at: runTimestamp,
  }
}

function prepareDocumentRows(documents, runTimestamp) {
  return documents.map((document) => {
    const metadata = {
      ...(document.metadata || {}),
      external_scrap_id: document.external_scrap_id || null,
    }

    return withUpdatedAt({
      document_key: document.document_key,
      scrap_id: document.scrap_id,
      url: document.url,
      title: document.title,
      document_kind: document.document_kind,
      source: document.source,
      publisher: document.publisher || null,
      author: document.author || null,
      published_at: document.published_at,
      captured_at: document.captured_at,
      reliability: document.reliability || {},
      metadata,
      active_extractor_version: document.active_extractor_version,
      active_ontology_version: document.active_ontology_version,
      processing_status: document.processing_status,
      is_partial: document.is_partial,
      last_processed_at: document.last_processed_at,
      extraction_history: document.extraction_history || [],
    }, runTimestamp)
  })
}

function prepareEntityRows(entities, runTimestamp) {
  return entities.map((entity) => withUpdatedAt({
    entity_key: entity.entity_key,
    display_name: entity.display_name,
    entity_type: entity.entity_type,
    type_axes: entity.type_axes || [],
    aliases: entity.aliases || [],
    canonical_status: entity.canonical_status,
    is_provisional: entity.is_provisional,
    metadata: entity.metadata || {},
  }, runTimestamp))
}

function prepareClaimRows(claims, entityIdByKey, runTimestamp) {
  return claims.map((claim) => {
    const subjectEntityId = entityIdByKey.get(claim.subject_entity_key)
    const objectEntityId = entityIdByKey.get(claim.object_entity_key)

    if (!subjectEntityId || !objectEntityId) {
      throw new Error(`Missing entity ids for claim ${claim.claim_key}`)
    }

    return withUpdatedAt({
      claim_key: claim.claim_key,
      subject_entity_id: subjectEntityId,
      predicate: claim.predicate,
      object_entity_id: objectEntityId,
      claim_mode: claim.claim_mode,
      claim_state: claim.claim_state,
      asserted_at: claim.asserted_at,
      valid_from: claim.valid_from || null,
      valid_to: claim.valid_to || null,
      raw_text: claim.raw_text || null,
      metadata: claim.metadata || {},
    }, runTimestamp)
  })
}

function prepareEvidenceRows(evidence, documentIdByKey, entityIdByKey, claimIdByKey, runTimestamp) {
  return evidence.map((item) => {
    const documentId = documentIdByKey.get(item.document_key)
    if (!documentId) {
      throw new Error(`Missing document id for evidence ${item.evidence_key}`)
    }

    const row = withUpdatedAt({
      evidence_key: item.evidence_key,
      document_id: documentId,
      edge_kind: item.edge_kind,
      target_kind: item.target_kind,
      entity_id: null,
      claim_id: null,
      snippet: item.snippet,
      mention_text: item.mention_text,
      offset_start: item.offset_start,
      offset_end: item.offset_end,
      confidence: item.confidence,
      extractor_version: item.extractor_version,
      ontology_version: item.ontology_version,
      processing_status: item.processing_status,
      is_partial: item.is_partial,
      error_stage: item.error_stage,
      error_message: item.error_message,
      metadata: item.metadata || {},
    }, runTimestamp)

    if (item.target_kind === 'entity') {
      const entityId = entityIdByKey.get(item.entity_key)
      if (!entityId) {
        throw new Error(`Missing entity id for evidence ${item.evidence_key}`)
      }
      row.entity_id = entityId
    } else {
      const claimId = claimIdByKey.get(item.claim_key)
      if (!claimId) {
        throw new Error(`Missing claim id for evidence ${item.evidence_key}`)
      }
      row.claim_id = claimId
    }

    return row
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const supabase = getSupabase()
  const runTimestamp = new Date().toISOString()

  const scraps = await fetchRelationshipScraps(supabase, {
    limit: options.limit,
    scrapId: options.scrapId,
    pageSize: DEFAULT_FETCH_PAGE_SIZE,
  })

  const projection = createProjectionRecords(scraps, {
    extractorVersion: DEFAULT_EXTRACTOR_VERSION,
    ontologyVersion: DEFAULT_ONTOLOGY_VERSION,
    projectionSource: 'backfill_graph_v1',
    generatedAt: runTimestamp,
  })

  if (options.dryRun) {
    console.log(JSON.stringify({
      dry_run: true,
      ...projection.summary,
    }, null, 2))
    return
  }

  const documentRows = prepareDocumentRows(projection.documents, runTimestamp)
  const entityRows = prepareEntityRows(projection.entities, runTimestamp)

  await upsertRows(supabase, 'graph_documents', documentRows, 'document_key')
  await upsertRows(supabase, 'graph_entities', entityRows, 'entity_key')

  const documentIdByKey = await fetchKeyMap(
    supabase,
    'graph_documents',
    'document_key',
    documentRows.map((row) => row.document_key),
  )

  const entityIdByKey = await fetchKeyMap(
    supabase,
    'graph_entities',
    'entity_key',
    entityRows.map((row) => row.entity_key),
  )

  const claimRows = prepareClaimRows(projection.claims, entityIdByKey, runTimestamp)
  await upsertRows(supabase, 'graph_claims', claimRows, 'claim_key')

  const claimIdByKey = await fetchKeyMap(
    supabase,
    'graph_claims',
    'claim_key',
    claimRows.map((row) => row.claim_key),
  )

  const evidenceRows = prepareEvidenceRows(
    projection.evidence,
    documentIdByKey,
    entityIdByKey,
    claimIdByKey,
    runTimestamp,
  )
  await upsertRows(supabase, 'graph_evidence', evidenceRows, 'evidence_key')

  console.log(JSON.stringify({
    dry_run: false,
    ...projection.summary,
    written_documents: documentRows.length,
    written_entities: entityRows.length,
    written_claims: claimRows.length,
    written_evidence: evidenceRows.length,
  }, null, 2))
}

main().catch((error) => {
  console.error('Failed to backfill graph v1:', error.message)
  process.exit(1)
})
