import dotenv from 'dotenv'

dotenv.config()

const MAX_CONTENT_CHARS = 12000

const SEMANTIC_ENTITY_TYPES = [
  'Person',
  'Organization',
  'Project',
  'Movement',
  'Artwork',
  'Tool',
  'Model',
  'Dataset',
  'Location',
]

const ENTITY_TYPE_DESCRIPTIONS = {
  Person: 'A person, pseudonym, handle, or online identity acting as a person.',
  Organization: 'A company, agency, institution, committee, newsroom, outlet, university, lab, nonprofit, or similar body.',
  Project: 'A campaign, initiative, investigation, editorial series, operation, program, or named undertaking.',
  Movement: 'A political, social, religious, ideological, or cultural movement that grows through people, institutions, narratives, and coordinated activity.',
  Artwork: 'A creative work such as a film, album, installation, performance, book, or zine.',
  Tool: 'A technical artifact such as software, a repository, a framework, a CLI, or a platform.',
  Model: 'A trained AI or ML model that behaves as a distinct technical or cultural artifact.',
  Dataset: 'A structured data artifact such as a registry, spreadsheet, archive, corpus, benchmark, or geospatial dataset.',
  Location: 'A real place in the world, including cities, campuses, compounds, buildings, and regions.',
}

const SEMANTIC_PREDICATES = [
  {
    id: 'WORKS_FOR',
    description: 'A person works for or holds a role within an organization.',
    subjectTypes: ['Person'],
    objectTypes: ['Organization'],
    aliases: ['EMPLOYED_BY', 'EMPLOYEE_OF', 'STAFF_AT'],
  },
  {
    id: 'LEADS',
    description: 'A person leads, heads, chairs, or directs an organization, project, or movement.',
    subjectTypes: ['Person'],
    objectTypes: ['Organization', 'Project', 'Movement'],
    aliases: ['HEADS', 'DIRECTS', 'CHAIRS', 'RUNS'],
  },
  {
    id: 'FOUNDED',
    description: 'A person founded an organization, project, movement, tool, model, or artwork.',
    subjectTypes: ['Person'],
    objectTypes: ['Organization', 'Project', 'Movement', 'Tool', 'Model', 'Artwork'],
    aliases: ['FOUNDER_OF', 'CO_FOUNDED', 'COFOUNDED'],
  },
  {
    id: 'MEMBER_OF',
    description: 'A person is a member of an organization, project, or movement.',
    subjectTypes: ['Person'],
    objectTypes: ['Organization', 'Project', 'Movement'],
    aliases: ['BELONGS_TO'],
  },
  {
    id: 'ADVISES',
    description: 'A person advises an organization, project, or movement.',
    subjectTypes: ['Person'],
    objectTypes: ['Organization', 'Project', 'Movement'],
    aliases: ['ADVISOR_TO', 'CONSULTS_FOR'],
  },
  {
    id: 'FUNDS',
    description: 'A person or organization funds another entity.',
    subjectTypes: ['Person', 'Organization'],
    objectTypes: ['Organization', 'Project', 'Movement', 'Artwork', 'Dataset', 'Tool', 'Model'],
    aliases: [],
    inverseAliases: ['FUNDED_BY', 'BACKED_BY', 'SUPPORTED_BY', 'SPONSORED_BY'],
  },
  {
    id: 'DONATES_TO',
    description: 'A person or organization donates to another entity.',
    subjectTypes: ['Person', 'Organization'],
    objectTypes: ['Organization', 'Project', 'Movement', 'Artwork'],
    aliases: ['CONTRIBUTES_TO', 'GIVES_TO'],
    inverseAliases: ['RECEIVED_DONATION_FROM'],
  },
  {
    id: 'INVESTS_IN',
    description: 'A person or organization invests in another entity.',
    subjectTypes: ['Person', 'Organization'],
    objectTypes: ['Organization', 'Project', 'Tool', 'Model', 'Dataset'],
    aliases: ['INVESTED_INTO'],
    inverseAliases: ['INVESTMENT_FROM', 'RAISED_FROM'],
  },
  {
    id: 'CONTRACTS_WITH',
    description: 'An organization or project contracts with another organization.',
    subjectTypes: ['Organization', 'Project'],
    objectTypes: ['Organization', 'Project'],
    aliases: ['SIGNED_CONTRACT_WITH', 'IN_CONTRACT_WITH'],
  },
  {
    id: 'PARTNERS_WITH',
    description: 'An organization, project, or movement partners with another organization, project, or movement.',
    subjectTypes: ['Organization', 'Project', 'Movement'],
    objectTypes: ['Organization', 'Project', 'Movement'],
    aliases: ['COLLABORATES_WITH'],
  },
  {
    id: 'OWNS',
    description: 'A person or organization owns another entity.',
    subjectTypes: ['Person', 'Organization'],
    objectTypes: ['Organization', 'Tool', 'Model', 'Dataset', 'Artwork', 'Project'],
    aliases: ['ACQUIRED', 'PURCHASED'],
    inverseAliases: ['OWNED_BY', 'ACQUIRED_BY'],
  },
  {
    id: 'CONTROLS',
    description: 'A person or organization controls another entity.',
    subjectTypes: ['Person', 'Organization'],
    objectTypes: ['Organization', 'Project', 'Tool', 'Model', 'Dataset'],
    aliases: ['OVERSEES', 'MANAGES'],
    inverseAliases: ['CONTROLLED_BY'],
  },
  {
    id: 'OPERATES',
    description: 'A person or organization operates a project, tool, dataset, or location.',
    subjectTypes: ['Person', 'Organization'],
    objectTypes: ['Project', 'Tool', 'Dataset', 'Location'],
    aliases: ['RUNS', 'MAINTAINS'],
    inverseAliases: ['OPERATED_BY'],
  },
  {
    id: 'DEVELOPS',
    description: 'A person or organization develops a tool, model, dataset, or project.',
    subjectTypes: ['Person', 'Organization'],
    objectTypes: ['Tool', 'Model', 'Dataset', 'Project'],
    aliases: ['BUILDS'],
    inverseAliases: ['DEVELOPED_BY', 'BUILT_BY'],
  },
  {
    id: 'CREATED',
    description: 'A person or organization created or authored an artwork.',
    subjectTypes: ['Person', 'Organization'],
    objectTypes: ['Artwork'],
    aliases: ['CREATES', 'AUTHORED', 'MADE'],
    inverseAliases: ['CREATED_BY', 'AUTHORED_BY'],
  },
  {
    id: 'USES',
    description: 'An entity uses a tool, model, or dataset.',
    subjectTypes: ['Person', 'Organization', 'Project', 'Tool', 'Model'],
    objectTypes: ['Tool', 'Model', 'Dataset'],
    aliases: ['USED'],
    inverseAliases: ['USED_BY'],
  },
  {
    id: 'INTEGRATES_WITH',
    description: 'A tool or model integrates with another tool or model.',
    subjectTypes: ['Tool', 'Model'],
    objectTypes: ['Tool', 'Model'],
    aliases: ['CONNECTS_TO'],
  },
  {
    id: 'HOSTED_ON',
    description: 'A tool, model, or dataset is hosted on an organization or tool platform.',
    subjectTypes: ['Tool', 'Model', 'Dataset'],
    objectTypes: ['Organization', 'Tool'],
    aliases: [],
  },
  {
    id: 'LOCATED_IN',
    description: 'An entity is located in a place.',
    subjectTypes: ['Person', 'Organization', 'Project', 'Movement', 'Artwork', 'Tool', 'Model', 'Dataset', 'Location'],
    objectTypes: ['Location'],
    aliases: ['BASED_IN', 'HEADQUARTERED_IN', 'OPERATES_IN', 'REGISTERED_IN'],
  },
  {
    id: 'INVESTIGATES',
    description: 'A person or organization investigates another entity.',
    subjectTypes: ['Person', 'Organization', 'Project'],
    objectTypes: ['Person', 'Organization', 'Project', 'Movement', 'Dataset', 'Tool', 'Model', 'Location'],
    aliases: ['PROBES'],
  },
  {
    id: 'SUES',
    description: 'A person or organization sues another person or organization.',
    subjectTypes: ['Person', 'Organization'],
    objectTypes: ['Person', 'Organization'],
    aliases: ['FILES_SUIT_AGAINST'],
    inverseAliases: ['SUED_BY'],
  },
  {
    id: 'TARGETS',
    description: 'A person or organization targets another entity.',
    subjectTypes: ['Person', 'Organization', 'Project'],
    objectTypes: ['Person', 'Organization', 'Project', 'Movement', 'Location'],
    aliases: [],
  },
  {
    id: 'APPROVES',
    description: 'An organization approves another entity.',
    subjectTypes: ['Organization'],
    objectTypes: ['Organization', 'Project', 'Tool', 'Model', 'Dataset'],
    aliases: ['AUTHORIZED'],
    inverseAliases: ['APPROVED_BY'],
  },
  {
    id: 'BANS',
    description: 'An organization bans another entity.',
    subjectTypes: ['Organization'],
    objectTypes: ['Organization', 'Tool', 'Model', 'Project', 'Movement'],
    aliases: ['RESTRICTS'],
    inverseAliases: ['BANNED_BY'],
  },
  {
    id: 'QUOTES',
    description: 'An organization or project quotes a person or organization. Use sparingly in semantic extraction.',
    subjectTypes: ['Organization', 'Project'],
    objectTypes: ['Person', 'Organization'],
    aliases: [],
  },
]

const ENTITY_TYPE_SET = new Set(SEMANTIC_ENTITY_TYPES)
const PREDICATE_MAP = new Map(SEMANTIC_PREDICATES.map((predicate) => [predicate.id, predicate]))
const PREDICATE_ALIAS_MAP = new Map()
const PREDICATE_INVERSE_ALIAS_MAP = new Map()

for (const predicate of SEMANTIC_PREDICATES) {
  for (const alias of predicate.aliases || []) {
    PREDICATE_ALIAS_MAP.set(alias, predicate.id)
  }
  for (const alias of predicate.inverseAliases || []) {
    PREDICATE_INVERSE_ALIAS_MAP.set(alias, predicate.id)
  }
}

const CURATED_EXAMPLES = [
  {
    source: { name: 'Carl Zimmer', type: 'Person' },
    type: 'WORKS_FOR',
    target: { name: 'The New York Times', type: 'Organization' },
    evidence: 'Carl Zimmer is a science columnist for The New York Times.',
  },
  {
    source: { name: 'Palantir', type: 'Organization' },
    type: 'CONTRACTS_WITH',
    target: { name: 'ICE', type: 'Organization' },
    evidence: 'Palantir has a contract with ICE.',
  },
  {
    source: { name: 'OpenAI', type: 'Organization' },
    type: 'DEVELOPS',
    target: { name: 'GPT-4o', type: 'Model' },
    evidence: 'OpenAI developed GPT-4o.',
  },
  {
    source: { name: 'Trevor Paglen', type: 'Person' },
    type: 'CREATED',
    target: { name: 'ImageNet Roulette', type: 'Artwork' },
    evidence: 'Trevor Paglen created ImageNet Roulette.',
  },
  {
    source: { name: 'Martin Luther King Jr.', type: 'Person' },
    type: 'LEADS',
    target: { name: 'Civil Rights Movement', type: 'Movement' },
    evidence: 'Martin Luther King Jr. was a leading figure in the Civil Rights Movement.',
  },
  {
    source: { name: 'Los Angeles', type: 'Location' },
    type: 'LOCATED_IN',
    target: { name: 'California', type: 'Location' },
    evidence: 'Los Angeles is in California.',
  },
]

const JUNK_ENTITY_PATTERNS = [
  /^[\W_]+$/u,
  /^\$[\d,.]+(?:\s*(?:million|billion|trillion|m|bn|k))?$/i,
  /^https?:\/\//i,
  /^www\./i,
  /^[\d,.%]+$/,
  /^[><=]+$/,
  /^[/"'`.,;:()[\]{}-]+$/,
  /^[A-Za-z]$/,
]

const GENERIC_JUNK_ENTITIES = new Set([
  'about',
  'article',
  'articles',
  'audio',
  'contact us',
  'contact',
  'cookie policy',
  'developers',
  'download',
  'home',
  'homepage',
  'menu',
  'news',
  'podcast',
  'podcasts',
  'press',
  'privacy policy',
  'read more',
  'share',
  'sign in',
  'sign up',
  'terms',
  'terms of service',
  'url',
  'video',
  'videos',
])

const ENTITY_TYPE_PATTERNS = {
  Organization: [
    /\b(Inc\.?|Corp\.?|LLC|Ltd\.?|GmbH|SA|AG|PLC|Company|Corporation|Group|Foundation|Institute|University|College|Agency|Department|Ministry|Commission|Committee|Council|Board|Authority|Office|Bureau|Service|Administration|Association|Society|Union|Federation|Alliance|Coalition|Network|Consortium|Trust|Fund)\b/i,
    /^(Microsoft|Google|Facebook|Meta|Amazon|Apple|OpenAI|Anthropic|DeepMind|IBM|Oracle|Intel|NVIDIA|MIT|Harvard|Stanford|CIA|NSA|FDA|CDC|FBI|NASA|UN|NATO|EU)$/i,
  ],
  Model: [
    /(^|\b)(gpt-\d|gpt-4o|claude|llama|gemini|mistral|bert|whisper|sdxl|stable diffusion)(\b|$)/i,
    /\b(model|llm|embedding model|vision model|foundation model)\b/i,
  ],
  Dataset: [
    /\b(dataset|data set|registry|corpus|benchmark|spreadsheet|csv|parquet|shapefile|geojson|archive|database)\b/i,
    /\b(common crawl|imagenet|laion|c4|covert catharsis)\b/i,
  ],
  Tool: [
    /\.(js|py|java|cpp|c|go|rs|ts|jsx|tsx|vue|rb|php|swift|kt|scala)$/i,
    /^(react|vue|angular|svelte|next\.?js|nuxt|webpack|babel|vite|rollup|esbuild|docker|kubernetes|terraform|postgresql|mongodb|redis|sqlite)$/i,
    /\b(framework|library|toolkit|platform|service|protocol|software|hardware|application|tool|package|module|api|sdk|cli|repository|repo)\b/i,
  ],
  Artwork: [
    /\b(film|album|song|book|novel|poem|essay collection|installation|performance|exhibition|zine|documentary|artwork|painting|sculpture)\b/i,
    /\broulette\b/i,
  ],
  Project: [
    /\b(project|initiative|campaign|investigation|operation|program|effort|series)\b/i,
  ],
  Movement: [
    /\b(movement|uprising|solidarity movement|political movement|social movement)\b/i,
    /^(Civil Rights Movement|Black Lives Matter|MAGA|Make America Great Again|QAnon|Tea Party)$/i,
  ],
  Location: [
    /^(United States|Canada|Mexico|Brazil|United Kingdom|France|Germany|China|Japan|India|Australia|New York|Los Angeles|San Francisco|Washington|London|Paris|Berlin|Rome|Madrid|Moscow|Beijing|Tokyo)$/i,
    /\b(street|avenue|road|boulevard|lane|drive|court|plaza|square|park|city|town|village|county|state|province|country|region|river|lake|mountain|island|campus|building)\b/i,
  ],
  Person: [
    /^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Sir|Dame)\s+/i,
    /^[A-Z][a-z]+(?:\s+[A-Z][a-z'-.]+)+$/,
    /\b(CEO|CTO|CFO|President|Director|Engineer|Scientist|Professor|Doctor|Attorney|Judge|Senator|Representative|Governor|Mayor|Minister|Secretary|Commissioner|Founder|Co-founder|Chair)\b/i,
    /^@[A-Za-z0-9_]+$/,
  ],
}

function truncateContent(content) {
  return content.length > MAX_CONTENT_CHARS
    ? `${content.slice(0, MAX_CONTENT_CHARS)}\n\n[TRUNCATED]`
    : content
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function stripOuterQuotes(value) {
  return value.replace(/^["'`]+|["'`]+$/g, '')
}

function normalizeEntityName(value) {
  if (typeof value !== 'string') return ''

  return normalizeWhitespace(stripOuterQuotes(value))
    .replace(/\u2019/g, '\'')
    .replace(/\u201c|\u201d/g, '"')
}

function isJunkEntityName(value) {
  const normalized = normalizeEntityName(value)
  if (!normalized || normalized.length < 2) return true

  if (GENERIC_JUNK_ENTITIES.has(normalized.toLowerCase())) {
    return true
  }

  return JUNK_ENTITY_PATTERNS.some((pattern) => pattern.test(normalized))
}

function normalizePredicateToken(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
}

function canonicalizeEntityType(value) {
  const clean = typeof value === 'string' ? value.trim() : ''
  if (!clean) return null

  const normalized = clean
    .replace(/[\s_-]+/g, ' ')
    .toLowerCase()

  const aliases = {
    person: 'Person',
    organization: 'Organization',
    org: 'Organization',
    project: 'Project',
    movement: 'Movement',
    artwork: 'Artwork',
    art: 'Artwork',
    tool: 'Tool',
    technology: 'Tool',
    product: 'Tool',
    software: 'Tool',
    model: 'Model',
    dataset: 'Dataset',
    data: 'Dataset',
    location: 'Location',
    place: 'Location',
  }

  const entityType = aliases[normalized] || clean
  return ENTITY_TYPE_SET.has(entityType) ? entityType : null
}

function canonicalizePredicate(value) {
  const token = normalizePredicateToken(value)
  if (!token) {
    return { id: null, shouldReverse: false }
  }

  if (PREDICATE_MAP.has(token)) {
    return { id: token, shouldReverse: false }
  }

  if (PREDICATE_ALIAS_MAP.has(token)) {
    return { id: PREDICATE_ALIAS_MAP.get(token), shouldReverse: false }
  }

  if (PREDICATE_INVERSE_ALIAS_MAP.has(token)) {
    return { id: PREDICATE_INVERSE_ALIAS_MAP.get(token), shouldReverse: true }
  }

  return { id: null, shouldReverse: false }
}

function isValidTypePair(predicateId, sourceType, targetType) {
  const predicate = PREDICATE_MAP.get(predicateId)
  if (!predicate) return false
  return predicate.subjectTypes.includes(sourceType) && predicate.objectTypes.includes(targetType)
}

function parseJsonObjectFromResponse(response) {
  if (typeof response !== 'string') return null

  const fencedMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch ? fencedMatch[1].trim() : response.trim()

  try {
    return JSON.parse(candidate)
  } catch {
    // fall through
  }

  const firstBrace = candidate.indexOf('{')
  const lastBrace = candidate.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null
  }

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1))
  } catch {
    return null
  }
}

function normalizeTypedRelationship(relationship) {
  if (!relationship || typeof relationship !== 'object') return null

  const sourceName = normalizeEntityName(relationship.source?.name || relationship.source)
  const targetName = normalizeEntityName(relationship.target?.name || relationship.target)
  const sourceType = canonicalizeEntityType(relationship.source?.type || relationship.sourceType)
  const targetType = canonicalizeEntityType(relationship.target?.type || relationship.targetType)
  const canonicalPredicate = canonicalizePredicate(relationship.type || relationship.relationship)

  let normalized = {
    source: { name: sourceName, type: sourceType },
    target: { name: targetName, type: targetType },
    type: canonicalPredicate.id,
    evidence: typeof relationship.evidence === 'string' ? normalizeWhitespace(relationship.evidence) : null,
    confidence: typeof relationship.confidence === 'number'
      ? Math.max(0, Math.min(1, relationship.confidence))
      : null,
  }

  if (canonicalPredicate.shouldReverse) {
    normalized = {
      ...normalized,
      source: { ...normalized.target },
      target: { ...normalized.source },
    }
  }

  if (
    !normalized.source.name ||
    !normalized.target.name ||
    !normalized.source.type ||
    !normalized.target.type ||
    !normalized.type
  ) {
    return null
  }

  if (normalized.source.name === normalized.target.name) {
    return null
  }

  if (isJunkEntityName(normalized.source.name) || isJunkEntityName(normalized.target.name)) {
    return null
  }

  if (!isValidTypePair(normalized.type, normalized.source.type, normalized.target.type)) {
    return null
  }

  return normalized
}

function validateTypedRelationship(relationship) {
  return Boolean(
    relationship &&
      relationship.source?.name &&
      relationship.source?.type &&
      relationship.target?.name &&
      relationship.target?.type &&
      relationship.type,
  )
}

function buildEntityTypePrompt() {
  return SEMANTIC_ENTITY_TYPES
    .map((entityType) => `- ${entityType}: ${ENTITY_TYPE_DESCRIPTIONS[entityType]}`)
    .join('\n')
}

function buildPredicatePrompt() {
  return SEMANTIC_PREDICATES
    .map((predicate) => {
      const pairings = predicate.subjectTypes
        .flatMap((subjectType) => predicate.objectTypes.map((objectType) => `${subjectType}->${objectType}`))
        .join(', ')
      return `- ${predicate.id}: ${predicate.description} Allowed pairs: ${pairings}`
    })
    .join('\n')
}

function buildMessages(content, options = {}) {
  const examplePayload = JSON.stringify({ relationships: CURATED_EXAMPLES }, null, 2)
  const contextLines = [
    options.title ? `Title: ${options.title}` : null,
    options.url ? `URL: ${options.url}` : null,
  ].filter(Boolean)

  return [
    {
      role: 'system',
      content: `You are an investigative relationship extraction specialist.

Your job is to extract only high-signal semantic relationships from a document.

Rules:
- Return valid JSON only.
- Use only the approved entity types and approved predicates.
- Omit weak, generic, structural, speculative, or page-chrome relationships.
- Never emit ASSOCIATED_WITH, RELATED_TO, ABOUT, IS_A, HAS_URL, HAS_SECTION, HAS_FEATURE, INCLUDES, ARE, or other vague predicates.
- Never treat prices, punctuation, standalone numbers, URLs, menu labels, or generic navigation text as entities.
- If the text does not support a clean semantic relationship, omit it.
- Prefer fewer, cleaner relationships over broad coverage.
- Use canonical predicate direction only.
- Keep evidence short and grounded in the text.`,
    },
    {
      role: 'user',
      content: `Extract semantic relationships from this content.

Approved entity types:
${buildEntityTypePrompt()}

Approved predicates:
${buildPredicatePrompt()}

Return JSON with this shape:
{
  "relationships": [
    {
      "source": { "name": "Entity name", "type": "ApprovedType" },
      "type": "APPROVED_PREDICATE",
      "target": { "name": "Entity name", "type": "ApprovedType" },
      "evidence": "Short evidence grounded in the text",
      "confidence": 0.0
    }
  ]
}

Notes:
- confidence is optional and should be between 0 and 1
- if there are no valid relationships, return {"relationships":[]}
- do not wrap the JSON in markdown fences
- if a creative work is mentioned, type it as Artwork and prefer CREATED over FOUNDED or DEVELOPS
- political and social movements are valid core entities; type them as Movement instead of coercing them into Project or Artwork
- use FOUNDED for organizations or initiatives, not for artworks

Example:
${examplePayload}

Document context:
${contextLines.join('\n')}

Content:
${truncateContent(content)}`,
    },
  ]
}

async function repairJsonResponse(rawResponse, options) {
  const repairMessages = [
    {
      role: 'system',
      content: 'Repair malformed model output into valid JSON. Output JSON only.',
    },
    {
      role: 'user',
      content: `Convert this into valid JSON with shape {"relationships":[...]}.
Do not invent new relationships. Preserve only relationships already present.

Raw output:
${rawResponse}`,
    },
  ]

  return options.llmProvider.completion({
    messages: repairMessages,
    temperature: 0,
    maxTokens: 1800,
    model: options.model,
  })
}

function dedupeRelationships(relationships) {
  const seen = new Set()
  const deduped = []

  for (const relationship of relationships) {
    const key = [
      relationship.source.name,
      relationship.source.type,
      relationship.type,
      relationship.target.name,
      relationship.target.type,
    ].join('|')

    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(relationship)
    }
  }

  return deduped
}

/**
 * @typedef {Object} LLMProvider
 * @property {Function} completion - Function to call LLM completion API
 */

/**
 * @typedef {Object} TypedEntityRef
 * @property {string} name
 * @property {string} type
 */

/**
 * @typedef {Object} TypedRelationship
 * @property {TypedEntityRef} source
 * @property {TypedEntityRef} target
 * @property {string} type
 * @property {string | null} [evidence]
 * @property {number | null} [confidence]
 */

/**
 * @typedef {Object} ExtractOptions
 * @property {string} [url] - Source URL for context
 * @property {string} [title] - Source title for context
 * @property {string} [model] - Override LLM model
 * @property {LLMProvider} llmProvider - LLM provider with completion method
 */

/**
 * Extract ontology-aware relationships between entities from text content.
 *
 * @param {string} content - Text content to analyze
 * @param {ExtractOptions} options - Extraction options
 * @returns {Promise<TypedRelationship[]>} Array of typed relationship objects
 */
export async function extractRelationships(content, options = {}) {
  if (!content) return []

  const { llmProvider } = options

  if (!llmProvider || typeof llmProvider.completion !== 'function') {
    throw new Error('llmProvider with completion method is required')
  }

  try {
    const response = await llmProvider.completion({
      messages: buildMessages(content, options),
      temperature: 0.1,
      maxTokens: 1800,
      model: options.model,
    })

    if (!response) {
      return []
    }

    let payload = parseJsonObjectFromResponse(response)

    if (!payload) {
      const repaired = await repairJsonResponse(response, options)
      payload = parseJsonObjectFromResponse(repaired)
    }

    if (!payload || !Array.isArray(payload.relationships)) {
      return []
    }

    return dedupeRelationships(
      payload.relationships
        .map(normalizeTypedRelationship)
        .filter(validateTypedRelationship),
    )
  } catch (error) {
    console.error('Error extracting relationships:', error)
    return []
  }
}

export { ENTITY_TYPE_PATTERNS }

/**
 * Detect entity type based on common patterns.
 *
 * @param {string} entityName - Entity name to classify
 * @returns {string} Detected entity type
 */
export function detectEntityType(entityName) {
  if (!entityName || typeof entityName !== 'string') return 'Organization'

  const trimmed = normalizeEntityName(entityName)
  if (!trimmed) return 'Organization'

  for (const [type, patterns] of Object.entries(ENTITY_TYPE_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(trimmed))) {
      return type
    }
  }

  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(trimmed)) {
    return 'Person'
  }

  if (/^[A-Z][A-Za-z0-9_.-]+$/.test(trimmed)) {
    return 'Organization'
  }

  return 'Project'
}
