import crypto from 'crypto'

export const DEFAULT_EXTRACTOR_VERSION = 'legacy-relationships-preview'
export const DEFAULT_ONTOLOGY_VERSION = 'ontology-v1-draft'
export const DEFAULT_FETCH_PAGE_SIZE = 250

function hashValue(value) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizePredicate(value) {
  return normalizeText(value)
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
}

function normalizeRelationship(raw) {
  if (!raw || typeof raw !== 'object') return null

  if (raw.source?.name && raw.target?.name && raw.type) {
    return {
      sourceName: normalizeText(raw.source.name),
      sourceType: normalizeText(raw.source.type),
      targetName: normalizeText(raw.target.name),
      targetType: normalizeText(raw.target.type),
      predicate: normalizePredicate(raw.type),
      raw,
    }
  }

  if (raw.source && raw.target && raw.relationship) {
    return {
      sourceName: normalizeText(raw.source),
      sourceType: normalizeText(raw.sourceType),
      targetName: normalizeText(raw.target),
      targetType: normalizeText(raw.targetType),
      predicate: normalizePredicate(raw.relationship),
      raw,
    }
  }

  return null
}

function isLikelyModel(name) {
  return /(gpt|claude|llama|gemini|mistral|qwen|bert|t5|whisper|embedding)/i.test(name)
}

function mapLegacyTypeToOntology(rawType, name) {
  const type = normalizeText(rawType)
  const cleanName = normalizeText(name)

  switch (type.toLowerCase()) {
  case 'person':
    return { entityType: 'Person', isProvisional: false }
  case 'organization':
    return { entityType: 'Organization', isProvisional: false }
  case 'location':
    return { entityType: 'Location', isProvisional: false }
  case 'technology':
    return { entityType: isLikelyModel(cleanName) ? 'Model' : 'Tool', isProvisional: false }
  case 'tool':
    return { entityType: 'Tool', isProvisional: false }
  case 'product':
    return { entityType: isLikelyModel(cleanName) ? 'Model' : 'Tool', isProvisional: true }
  case 'project':
    return { entityType: 'Project', isProvisional: false }
  case 'dataset':
    return { entityType: 'Dataset', isProvisional: false }
  case 'model':
    return { entityType: 'Model', isProvisional: false }
  case 'artwork':
    return { entityType: 'Artwork', isProvisional: false }
  case 'concept':
  case 'event':
  case '':
    return { entityType: 'Unknown', isProvisional: true }
  default:
    return { entityType: 'Unknown', isProvisional: true }
  }
}

function buildEntityKey(entityType, displayName) {
  const slug = slugify(displayName) || hashValue(displayName).slice(0, 12)
  return `${entityType.toLowerCase()}:${slug}`
}

function buildClaimKey(subjectKey, predicate, objectKey) {
  return `claim:${hashValue(`${subjectKey}|${predicate}|${objectKey}`)}`
}

function buildEvidenceKey(documentKey, edgeKind, targetKind, targetKey, extra = '') {
  return `evidence:${hashValue(`${documentKey}|${edgeKind}|${targetKind}|${targetKey}|${extra}`)}`
}

export async function fetchRelationshipScraps(supabase, options = {}) {
  const pageSize = options.pageSize || DEFAULT_FETCH_PAGE_SIZE

  if (options.scrapId) {
    const { data, error } = await supabase
      .from('scraps')
      .select('id, scrap_id, title, url, source, published_at, created_at, updated_at, relationships')
      .eq('scrap_id', options.scrapId)
      .limit(1)

    if (error) throw error
    return data || []
  }

  const scraps = []
  let from = 0

  while (true) {
    const to = from + pageSize - 1
    let query = supabase
      .from('scraps')
      .select('id, scrap_id, title, url, source, published_at, created_at, updated_at, relationships')
      .not('relationships', 'is', null)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    if (options.limit) {
      query = query.limit(Math.min(pageSize, options.limit - scraps.length))
    }

    const { data, error } = await query

    if (error) throw error
    if (!data || data.length === 0) break

    scraps.push(...data)
    if (options.limit && scraps.length >= options.limit) break
    if (data.length < pageSize) break
    from += pageSize
  }

  return options.limit ? scraps.slice(0, options.limit) : scraps
}

export function createProjectionRecords(scraps, options = {}) {
  const extractorVersion = options.extractorVersion || DEFAULT_EXTRACTOR_VERSION
  const ontologyVersion = options.ontologyVersion || DEFAULT_ONTOLOGY_VERSION
  const projectionSource = options.projectionSource || 'graph_projection'
  const generatedAt = options.generatedAt || new Date().toISOString()

  const documents = new Map()
  const entities = new Map()
  const claims = new Map()
  const evidence = new Map()

  let malformedRelationships = 0
  let normalizedRelationships = 0

  for (const scrap of scraps) {
    const documentKey = `scrap:${scrap.id}`
    documents.set(documentKey, {
      document_key: documentKey,
      scrap_id: scrap.id,
      external_scrap_id: scrap.scrap_id,
      url: scrap.url || null,
      title: scrap.title || null,
      document_kind: 'scrap',
      source: scrap.source || null,
      published_at: scrap.published_at || null,
      captured_at: scrap.created_at || null,
      active_extractor_version: extractorVersion,
      active_ontology_version: ontologyVersion,
      processing_status: 'complete',
      is_partial: false,
      last_processed_at: generatedAt,
      reliability: {},
      metadata: {
        updated_at: scrap.updated_at || null,
      },
      extraction_history: [
        {
          extractor_version: extractorVersion,
          ontology_version: ontologyVersion,
          run_timestamp: generatedAt,
          source: projectionSource,
        },
      ],
    })

    const relationships = Array.isArray(scrap.relationships) ? scrap.relationships : []

    for (let index = 0; index < relationships.length; index += 1) {
      const raw = relationships[index]
      const rel = normalizeRelationship(raw)
      if (!rel) {
        malformedRelationships += 1
        continue
      }

      const {
        sourceName,
        sourceType,
        targetName,
        targetType,
        predicate,
      } = rel

      if (!sourceName || !targetName || !predicate) {
        malformedRelationships += 1
        continue
      }

      normalizedRelationships += 1

      const sourceOntology = mapLegacyTypeToOntology(sourceType, sourceName)
      const targetOntology = mapLegacyTypeToOntology(targetType, targetName)

      const sourceKey = buildEntityKey(sourceOntology.entityType, sourceName)
      const targetKey = buildEntityKey(targetOntology.entityType, targetName)

      if (!entities.has(sourceKey)) {
        entities.set(sourceKey, {
          entity_key: sourceKey,
          display_name: sourceName,
          entity_type: sourceOntology.entityType,
          type_axes: [],
          aliases: [],
          canonical_status: 'provisional',
          is_provisional: sourceOntology.isProvisional,
          metadata: {
            raw_type: sourceType || null,
          },
        })
      }

      if (!entities.has(targetKey)) {
        entities.set(targetKey, {
          entity_key: targetKey,
          display_name: targetName,
          entity_type: targetOntology.entityType,
          type_axes: [],
          aliases: [],
          canonical_status: 'provisional',
          is_provisional: targetOntology.isProvisional,
          metadata: {
            raw_type: targetType || null,
          },
        })
      }

      const claimKey = buildClaimKey(sourceKey, predicate, targetKey)
      if (!claims.has(claimKey)) {
        claims.set(claimKey, {
          claim_key: claimKey,
          subject_entity_key: sourceKey,
          predicate,
          object_entity_key: targetKey,
          claim_mode: rel.raw.claim_mode || 'asserted',
          claim_state: 'unreviewed',
          asserted_at: scrap.published_at || scrap.created_at || null,
          raw_text: null,
          metadata: {
            first_seen_scrap_id: scrap.id,
            raw_predicate: rel.raw.relationship || rel.raw.type || null,
          },
        })
      }

      const assertionEvidenceKey = buildEvidenceKey(documentKey, 'ASSERTS', 'claim', claimKey, String(index))
      evidence.set(assertionEvidenceKey, {
        evidence_key: assertionEvidenceKey,
        document_key: documentKey,
        edge_kind: 'ASSERTS',
        target_kind: 'claim',
        claim_key: claimKey,
        entity_key: null,
        mention_text: null,
        snippet: null,
        offset_start: null,
        offset_end: null,
        confidence: null,
        extractor_version: extractorVersion,
        ontology_version: ontologyVersion,
        processing_status: 'complete',
        is_partial: false,
        error_stage: null,
        error_message: null,
        metadata: {
          relationship_index: index,
          raw_relationship: rel.raw,
        },
      })

      const sourceMentionKey = buildEvidenceKey(documentKey, 'MENTIONS', 'entity', sourceKey, `source:${index}`)
      evidence.set(sourceMentionKey, {
        evidence_key: sourceMentionKey,
        document_key: documentKey,
        edge_kind: 'MENTIONS',
        target_kind: 'entity',
        claim_key: null,
        entity_key: sourceKey,
        mention_text: sourceName,
        snippet: null,
        offset_start: null,
        offset_end: null,
        confidence: null,
        extractor_version: extractorVersion,
        ontology_version: ontologyVersion,
        processing_status: 'complete',
        is_partial: false,
        error_stage: null,
        error_message: null,
        metadata: {
          role: 'subject',
          relationship_index: index,
        },
      })

      const targetMentionKey = buildEvidenceKey(documentKey, 'MENTIONS', 'entity', targetKey, `target:${index}`)
      evidence.set(targetMentionKey, {
        evidence_key: targetMentionKey,
        document_key: documentKey,
        edge_kind: 'MENTIONS',
        target_kind: 'entity',
        claim_key: null,
        entity_key: targetKey,
        mention_text: targetName,
        snippet: null,
        offset_start: null,
        offset_end: null,
        confidence: null,
        extractor_version: extractorVersion,
        ontology_version: ontologyVersion,
        processing_status: 'complete',
        is_partial: false,
        error_stage: null,
        error_message: null,
        metadata: {
          role: 'object',
          relationship_index: index,
        },
      })
    }
  }

  const provisionalEntities = Array.from(entities.values()).filter(entity => entity.is_provisional).length

  return {
    documents: Array.from(documents.values()),
    entities: Array.from(entities.values()),
    claims: Array.from(claims.values()),
    evidence: Array.from(evidence.values()),
    summary: {
      scraps_processed: scraps.length,
      normalized_relationships: normalizedRelationships,
      malformed_relationships: malformedRelationships,
      documents: documents.size,
      entities: entities.size,
      provisional_entities: provisionalEntities,
      claims: claims.size,
      evidence: evidence.size,
      extractor_version: extractorVersion,
      ontology_version: ontologyVersion,
      generated_at: generatedAt,
    },
  }
}
