import axios from 'axios'

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const SEARCH_BATCH_DELAY_MS = 200
const MAX_SEARCH_RESULTS = 5
const USER_AGENT = 'ScrapbookCore/1.2 (https://github.com/ejfox/scrapbook-core; ejfox@ejfox.com) axios'
const WIKIDATA_HEADERS = { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT }

// Map our ontology types to Wikidata instance-of (P31) QIDs for filtering
const TYPE_HINTS = {
  Person: ['Q5'],                           // human
  Organization: ['Q43229', 'Q4830453'],     // organization, business
  Location: ['Q515', 'Q6256', 'Q3624078'],  // city, country, sovereign state
  Tool: ['Q7397', 'Q166142'],               // software, application
  Model: ['Q11660', 'Q7397'],               // AI model falls under software loosely
  Dataset: ['Q1172284'],                     // dataset
  Artwork: ['Q838948', 'Q3305213'],          // work of art, painting
  Project: ['Q170584'],                      // project
}

// Entities that are too generic or common to bind reliably without strong context
const AMBIGUOUS_BLOCKLIST = new Set([
  'company', 'product designer', 'staff writer', 'animated series',
  'play now', 'audio effects', 'user guide', 'expert help',
  'technical skills', 'privacy policy', 'getting started guide',
])

/**
 * Search Wikidata for entity candidates using wbsearchentities.
 * Returns raw search results with QID, label, description, and concepturi.
 */
export async function searchWikidata(query, options = {}) {
  const { language = 'en', limit = MAX_SEARCH_RESULTS } = options

  const params = {
    action: 'wbsearchentities',
    search: query,
    language,
    limit,
    format: 'json',
    uselang: language,
  }

  const response = await axios.get(WIKIDATA_API, { params, headers: WIKIDATA_HEADERS })
  return (response.data.search || []).map(result => ({
    qid: result.id,
    label: result.label || '',
    description: result.description || '',
    conceptUri: result.concepturi || '',
    matchType: result.match?.type || 'unknown',
  }))
}

/**
 * Fetch full Wikidata entities by QIDs using wbgetentities.
 * Returns a map of QID -> { label, description, aliases, instanceOf, sitelinks }.
 */
export async function fetchWikidataEntities(qids, options = {}) {
  const { language = 'en' } = options

  if (qids.length === 0) return new Map()

  const params = {
    action: 'wbgetentities',
    ids: qids.join('|'),
    props: 'labels|descriptions|aliases|claims|sitelinks',
    languages: language,
    format: 'json',
  }

  const response = await axios.get(WIKIDATA_API, { params, headers: WIKIDATA_HEADERS })
  const entities = response.data.entities || {}
  const result = new Map()

  for (const [qid, entity] of Object.entries(entities)) {
    if (entity.missing !== undefined) continue

    const instanceOfClaims = entity.claims?.P31 || []
    const instanceOf = instanceOfClaims
      .map(claim => claim.mainsnak?.datavalue?.value?.id)
      .filter(Boolean)

    const aliases = (entity.aliases?.[language] || []).map(a => a.value)
    const sitelinkCount = Object.keys(entity.sitelinks || {}).length

    result.set(qid, {
      qid,
      label: entity.labels?.[language]?.value || '',
      description: entity.descriptions?.[language]?.value || '',
      aliases,
      instanceOf,
      sitelinkCount,
    })
  }

  return result
}

/**
 * Score a Wikidata candidate against an entity from our graph.
 * Returns a confidence score between 0 and 1.
 *
 * IMPORTANT: This is the heuristic fast-path. It should ONLY produce high scores
 * when we are very confident. For Person entities, name-only matches are NOT
 * sufficient — common names collide constantly. Person heuristic matches require
 * BOTH name match AND type confirmation (P31 = Q5).
 */
export function scoreCandidate(candidate, entity) {
  let score = 0
  const entityName = entity.display_name.toLowerCase().trim()
  const candidateLabel = candidate.label.toLowerCase().trim()
  const isPerson = entity.entity_type === 'Person'

  // Exact label match (case-insensitive)
  if (entityName === candidateLabel) {
    score += 0.3
  } else if (candidateLabel.includes(entityName) || entityName.includes(candidateLabel)) {
    score += 0.15
  }

  // Alias match
  const aliasMatch = (candidate.aliases || []).some(
    alias => alias.toLowerCase().trim() === entityName,
  )
  if (aliasMatch) score += 0.1

  // Type alignment — check if candidate's P31 overlaps with our expected type
  const expectedQids = TYPE_HINTS[entity.entity_type] || []
  const typeOverlap = (candidate.instanceOf || []).some(qid => expectedQids.includes(qid))
  if (typeOverlap) {
    score += 0.25
  } else if (expectedQids.length > 0) {
    // Type MISMATCH penalty — if we expected a type and didn't get it, penalize
    score -= 0.1
  }

  // For Person entities: if the candidate IS a human (Q5), that's critical confirmation.
  // If it's NOT a human, hard penalty — we should never heuristic-bind a non-human to a Person entity.
  if (isPerson) {
    const isHuman = (candidate.instanceOf || []).includes('Q5')
    if (!isHuman) {
      score -= 0.2
    }
  }

  // Sitelink count as a notability signal
  // Higher bar: only notable entities (>50 sitelinks) get a boost
  if (candidate.sitelinkCount > 50) score += 0.1
  else if (candidate.sitelinkCount > 20) score += 0.05

  // Description presence
  if (candidate.description && candidate.description.length > 10) score += 0.05

  // Search match type bonus
  if (candidate.matchType === 'label') score += 0.05

  return Math.max(0, Math.min(score, 1.0))
}

/**
 * Determine whether an entity needs LLM disambiguation even if heuristic score is high.
 * Person names are inherently ambiguous — "Josh Kramer" could be anyone.
 */
export function requiresLlmConfirmation(entity, topCandidate) {
  // Person entities ALWAYS need LLM confirmation unless the Wikidata description
  // clearly matches context we already have (which we can't check without context).
  // The heuristic alone can never distinguish between "Josh Kramer the basketball player"
  // and "Josh Kramer the tech person" — both score identically.
  if (entity.entity_type === 'Person') return true

  // Entities with low sitelink counts are obscure — more likely to be wrong matches
  if ((topCandidate.sitelinkCount || 0) < 5) return true

  return false
}

/**
 * Build an LLM prompt for disambiguating Wikidata candidates.
 * Uses entity context (claims, co-occurring entities) for smarter matching.
 */
export function buildDisambiguationPrompt(entity, candidates, context = {}) {
  const candidateList = candidates.map((c, i) =>
    `${i + 1}. ${c.qid} — "${c.label}": ${c.description || '(no description)'}` +
    ` [sitelinks: ${c.sitelinkCount || 0}]` +
    (c.aliases?.length ? ` [aliases: ${c.aliases.slice(0, 5).join(', ')}]` : '') +
    (c.instanceOf?.length ? ` [instance_of: ${c.instanceOf.join(', ')}]` : ''),
  ).join('\n')

  const contextLines = []
  if (context.claims?.length) {
    contextLines.push('Known relationships from our graph:')
    for (const claim of context.claims.slice(0, 10)) {
      contextLines.push(`  - ${claim.subject} ${claim.predicate} ${claim.object}`)
    }
  }
  if (context.coOccurring?.length) {
    contextLines.push(`Co-occurring entities: ${context.coOccurring.slice(0, 10).join(', ')}`)
  }
  if (entity.entity_type) {
    contextLines.push(`Expected type in our graph: ${entity.entity_type} (NOTE: our entity types are often wrong — a "Person" might actually be an Organization or Location. Use Wikidata's P31 as the source of truth for what the entity IS.)`)
  }

  const hasContext = context.claims?.length > 0 || context.coOccurring?.length > 0

  return `You are an entity resolution system. Decide which Wikidata entity (if any) matches the entity from our knowledge graph.

Entity from our graph:
  Name: "${entity.display_name}"
  Key: ${entity.entity_key}
${contextLines.length ? '\nContext:\n' + contextLines.join('\n') : ''}

Wikidata candidates:
${candidateList}

Instructions:
- We STRONGLY prefer no match over a wrong match. False positives are unacceptable.
- Respond with a JSON object: {"qid": "Q..." or null, "confidence": 0.0-1.0, "reason": "brief reason"}

Matching rules:
1. NOTABLE + UNAMBIGUOUS entities: If a candidate has an exact name match, high sitelinks (>20), and there is only ONE plausible match of the right kind, you CAN match it even without graph context. Examples: "George Floyd", "Harvard University", "Simon Willison", "OpenAI" — these are globally notable and unambiguous.
2. COMMON NAMES without context: If the name is common (could be many people) and there is no graph context to disambiguate, respond null. Examples: "Josh Kramer", "Jennifer Carson", "Joshua Martin" could be anyone.
3. NON-ENTITIES: If the name is clearly not a real entity (UI text, generic terms, article titles), respond null.
4. TYPE MISMATCH is OK: Our graph types are unreliable. "Harvard University" typed as Person is still Harvard University (Q13371). Match based on what the entity IS in Wikidata, not what our graph claims it is.
5. Confidence scale: 0.9+ = certain, 0.7-0.89 = very likely, 0.6-0.69 = probable. Below 0.6 = prefer null.
6. The sitelink count is a strong notability signal. Entities with >50 sitelinks are well-documented in Wikidata.

Respond with ONLY the JSON object, no other text.`
}

/**
 * Parse the LLM's disambiguation response.
 */
export function parseDisambiguationResponse(text) {
  const cleaned = text.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '')

  try {
    const parsed = JSON.parse(cleaned)
    return {
      qid: parsed.qid || null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      reason: parsed.reason || '',
    }
  } catch {
    return { qid: null, confidence: 0, reason: 'Failed to parse LLM response' }
  }
}

/**
 * Resolve a single entity against Wikidata.
 * Two-tier strategy:
 *   1. Heuristic scoring — if top candidate scores >= highConfidenceThreshold AND
 *      does not require LLM confirmation, accept immediately
 *   2. LLM disambiguation — for ambiguous entities or when heuristic isn't enough
 *
 * @param {object} entity - { display_name, entity_type, entity_key, ... }
 * @param {object} options - { completionFn, context, highConfidenceThreshold, minAcceptConfidence }
 * @returns {{ qid, label, description, confidence, method }}
 */
export async function resolveEntity(entity, options = {}) {
  const {
    completionFn,
    context = {},
    highConfidenceThreshold = 0.75,
    minAcceptConfidence = 0.6,
  } = options

  // Skip junk entities
  if (isJunkEntity(entity.display_name)) {
    return { qid: null, label: null, description: null, confidence: 0, method: 'skipped_junk' }
  }

  // Skip blocklisted generic terms
  if (AMBIGUOUS_BLOCKLIST.has(entity.display_name.toLowerCase().trim())) {
    return { qid: null, label: null, description: null, confidence: 0, method: 'skipped_blocklist' }
  }

  // Search Wikidata
  const searchResults = await searchWikidata(entity.display_name)

  if (searchResults.length === 0) {
    return { qid: null, label: null, description: null, confidence: 0, method: 'no_candidates' }
  }

  // Fetch full entity data for all candidates
  const qids = searchResults.map(r => r.qid)
  const fullEntities = await fetchWikidataEntities(qids)

  // Merge search results with full entity data
  const candidates = searchResults.map(sr => ({
    ...sr,
    ...(fullEntities.get(sr.qid) || {}),
  }))

  // Score all candidates
  const scored = candidates.map(c => ({
    ...c,
    score: scoreCandidate(c, entity),
  })).sort((a, b) => b.score - a.score)

  const topCandidate = scored[0]

  // Tier 1: High-confidence heuristic match — ONLY if LLM confirmation not required
  if (topCandidate.score >= highConfidenceThreshold && !requiresLlmConfirmation(entity, topCandidate)) {
    return {
      qid: topCandidate.qid,
      label: topCandidate.label,
      description: topCandidate.description,
      confidence: topCandidate.score,
      method: 'heuristic',
    }
  }

  // Tier 2: LLM disambiguation — the only path for Person entities and ambiguous matches
  if (completionFn && topCandidate.score > 0.1) {
    const prompt = buildDisambiguationPrompt(entity, scored.slice(0, 5), context)

    try {
      const response = await completionFn({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        maxTokens: 200,
        taskType: 'entityResolution',
      })

      if (response) {
        const parsed = parseDisambiguationResponse(response)
        if (parsed.qid && parsed.confidence >= minAcceptConfidence) {
          const matchedCandidate = candidates.find(c => c.qid === parsed.qid)
          return {
            qid: parsed.qid,
            label: matchedCandidate?.label || null,
            description: matchedCandidate?.description || null,
            confidence: parsed.confidence,
            method: 'llm',
            reason: parsed.reason,
          }
        }
        return {
          qid: null, label: null, description: null,
          confidence: 0,
          method: parsed.qid ? 'llm_low_confidence' : 'llm_rejected',
          reason: parsed.reason,
        }
      }
    } catch {
      // LLM failed — do NOT fall through to heuristic for Person entities
    }
  }

  // Tier 3: No LLM available — only accept non-Person heuristic matches above threshold
  if (!completionFn && !requiresLlmConfirmation(entity, topCandidate) && topCandidate.score >= highConfidenceThreshold) {
    return {
      qid: topCandidate.qid,
      label: topCandidate.label,
      description: topCandidate.description,
      confidence: topCandidate.score,
      method: 'heuristic',
    }
  }

  return { qid: null, label: null, description: null, confidence: 0, method: 'below_threshold' }
}

/**
 * Filter out obvious junk entity names that shouldn't be resolved.
 */
export function isJunkEntity(name) {
  if (!name || typeof name !== 'string') return true

  const trimmed = name.trim()

  // Too short
  if (trimmed.length < 2) return true

  // Pure punctuation or symbols
  if (/^[^a-zA-Z0-9]+$/.test(trimmed)) return true

  // Dollar amounts
  if (/^\$[\d,.]+\s*(million|billion|m|b|k)?$/i.test(trimmed)) return true

  // Bare numbers
  if (/^\d+$/.test(trimmed)) return true

  // HTML/UI debris
  if (/^(click|submit|cancel|ok|yes|no|close|menu|nav|footer|header|sidebar)$/i.test(trimmed)) return true

  // Single common word that's unlikely to be an entity
  if (/^(the|a|an|this|that|it|they|we|he|she|is|are|was|were|be|been)$/i.test(trimmed)) return true

  return false
}

/**
 * Batch resolve entities with rate limiting.
 * Yields results as they complete for progress reporting.
 *
 * @param {Array} entities - Array of entity objects from graph_entities
 * @param {object} options - { completionFn, contextFn, batchDelay, highConfidenceThreshold }
 * @returns {AsyncGenerator<{ entity, result }>}
 */
export async function* batchResolve(entities, options = {}) {
  const { batchDelay = SEARCH_BATCH_DELAY_MS, contextFn, ...resolveOptions } = options

  for (const entity of entities) {
    let context = {}
    if (contextFn) {
      try {
        context = await contextFn(entity)
      } catch {
        // Context fetch failed — resolve without it
      }
    }

    const result = await resolveEntity(entity, { ...resolveOptions, context })
    yield { entity, result }

    // Rate limit Wikidata API calls
    if (batchDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, batchDelay))
    }
  }
}
