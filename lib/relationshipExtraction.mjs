import { ENTITY_TYPE_DESCRIPTIONS, SEMANTIC_ENTITY_TYPES } from '../config/ontology/entities.mjs'
import { SEMANTIC_PREDICATES } from '../config/ontology/predicates.mjs'

const ENTITY_TYPE_SET = new Set(SEMANTIC_ENTITY_TYPES)
const PREDICATE_MAP = new Map(SEMANTIC_PREDICATES.map((predicate) => [predicate.id, predicate]))
const CLAIM_MODE_SET = new Set(['asserted', 'reported'])

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

const OCCUPATION_TERMS = [
  'activist',
  'adviser',
  'advisor',
  'analyst',
  'architect',
  'artist',
  'assistant professor',
  'attorney',
  'author',
  'blogger',
  'broadcaster',
  'candidate',
  'ceo',
  'chair',
  'columnist',
  'commentator',
  'consultant',
  'content creator',
  'creator',
  'data journalist',
  'developer',
  'director',
  'economist',
  'editor',
  'engineer',
  'executive',
  'filmmaker',
  'founder',
  'fellow',
  'host',
  'influencer',
  'investigator',
  'journalist',
  'lawyer',
  'magazine',
  'manager',
  'musician',
  'photographer',
  'podcaster',
  'politician',
  'president',
  'private citizen',
  'private investigator',
  'producer',
  'professor',
  'programmer',
  'publisher',
  'radio host',
  'reporter',
  'researcher',
  'scientist',
  'software engineer',
  'spokesperson',
  'strategist',
  'teacher',
  'writer',
  'youtuber',
]

const GENERIC_MEDIA_NOUNS = [
  'article',
  'articles',
  'clip',
  'clips',
  'content',
  'episode',
  'episodes',
  'film',
  'photo',
  'photos',
  'podcast',
  'podcasts',
  'post',
  'posts',
  'segment',
  'segments',
  'story',
  'stories',
  'video',
  'videos',
]

const GENERIC_ACTOR_PATTERNS = [
  /^(federal|immigration|masked|armed|plainclothes)?\s*officers?$/i,
  /^(federal|immigration|masked|armed|plainclothes)?\s*agents?$/i,
  /^(dhs|ice|cbp|border patrol)\s+officers?$/i,
  /^(dhs|ice|cbp|border patrol)\s+agents?$/i,
  /^protesters?$/i,
  /^demonstrators?$/i,
  /^residents?$/i,
  /^immigrants?$/i,
  /^migrants?$/i,
  /^children$/i,
  /^parents?$/i,
  /^people$/i,
  /^officials?$/i,
  /^organizers?$/i,
  /^journalists?$/i,
  /^law enforcement$/i,
  /^local officials?$/i,
  /^government officials?$/i,
]

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function stripOuterQuotes(value) {
  return value.replace(/^["'`]+|["'`]+$/g, '')
}

export function canonicalizeEntityType(value) {
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

function normalizePredicateToken(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
}

export function canonicalizePredicate(value) {
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

export function normalizeEntityName(value) {
  if (typeof value !== 'string') return ''

  const normalized = normalizeWhitespace(stripOuterQuotes(value))
    .replace(/\u2019/g, '\'')
    .replace(/\u201c|\u201d/g, '"')

  return normalized
}

export function isJunkEntityName(value) {
  const normalized = normalizeEntityName(value)
  if (!normalized || normalized.length < 2) return true

  const lower = normalized.toLowerCase()
  if (GENERIC_JUNK_ENTITIES.has(lower)) return true

  return JUNK_ENTITY_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function parseJsonObjectFromResponse(response) {
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

export function buildEntityTypePrompt() {
  return SEMANTIC_ENTITY_TYPES
    .map((entityType) => `- ${entityType}: ${ENTITY_TYPE_DESCRIPTIONS[entityType]}`)
    .join('\n')
}

export function buildPredicatePrompt() {
  return SEMANTIC_PREDICATES
    .map((predicate) => {
      const pairings = predicate.subjectTypes
        .flatMap((subjectType) => predicate.objectTypes.map((objectType) => `${subjectType}->${objectType}`))
        .join(', ')
      return `- ${predicate.id}: ${predicate.description} Allowed pairs: ${pairings}`
    })
    .join('\n')
}

function normalizeForMatch(value) {
  return normalizeEntityName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeForEvidence(value) {
  return normalizeEntityName(value)
    .toLowerCase()
    .replace(/["'`]+/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hostFromUrl(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export function isGitHubDocument(options = {}) {
  const host = hostFromUrl(options.url)
  return host === 'github.com'
}

export function isArticleLikeDocument(options = {}, content = '') {
  if (isVideoLikeDocument(options, content) || isGitHubDocument(options)) {
    return false
  }

  const host = hostFromUrl(options.url)
  const title = typeof options.title === 'string' ? options.title.toLowerCase() : ''
  const text = typeof content === 'string' ? content.toLowerCase() : ''
  const sentenceLikeCount = (content.match(/[.!?]\s+[A-Z"']/g) || []).length
  const articleKeywordHit = [
    'whistleblower',
    'whistleblowers',
    'investigation',
    'investigates',
    'investigative',
    'report',
    'reporting',
    'lawsuit',
    'allegation',
    'allegations',
    'court',
    'judge',
  ].some((keyword) => title.includes(keyword) || text.includes(keyword))

  return (
    content.length >= 1200 ||
    (content.length >= 700 && sentenceLikeCount >= 6) ||
    title.includes(' | ') ||
    title.includes(' - ') ||
    title.includes(':') ||
    host.includes('nytimes.com') ||
    host.includes('theguardian.com') ||
    host.includes('wired.com') ||
    host.includes('propublica.org') ||
    articleKeywordHit ||
    text.includes('listen to this article') ||
    text.includes('reporter commentary')
  )
}

export function isVideoLikeDocument(options = {}, content = '') {
  const url = typeof options.url === 'string' ? options.url.toLowerCase() : ''
  const title = typeof options.title === 'string' ? options.title.toLowerCase() : ''
  const text = typeof content === 'string' ? content.toLowerCase() : ''

  return (
    url.includes('youtube.com/') ||
    url.includes('youtu.be/') ||
    title.includes('youtube') ||
    text.includes(' - youtube') ||
    text.includes('youtube.com/watch')
  )
}

export function isThinVideoShell(content = '') {
  const text = typeof content === 'string' ? content : ''
  if (!text) return false

  const lower = text.toLowerCase()
  const shellSignals = [
    'liveupcoming play now',
    'about press copyright contact us creators advertise developers',
    'how youtube works',
    'nfl sunday ticket',
  ]

  const shellSignalCount = shellSignals.filter((signal) => lower.includes(signal)).length
  return text.length < 2500 && shellSignalCount >= 1
}

export function isEntityAnchoredInDocument(entityName, options = {}, content = '') {
  const needle = normalizeForMatch(entityName)
  if (!needle) return false

  const haystacks = [
    typeof options.title === 'string' ? options.title : '',
    typeof options.url === 'string' ? options.url : '',
    typeof content === 'string' ? content : '',
  ]

  if (isGitHubDocument(options) && typeof options.summary === 'string') {
    haystacks.push(options.summary)
  }

  return haystacks.some((value) => normalizeForMatch(value).includes(needle))
}

export function isEvidenceAnchoredInDocument(evidence, options = {}, content = '') {
  const needle = normalizeForEvidence(evidence)
  if (!needle || needle.length < 16) return false

  const haystacks = [
    typeof options.title === 'string' ? options.title : '',
    typeof content === 'string' ? content : '',
  ]

  if (isGitHubDocument(options) && typeof options.summary === 'string') {
    haystacks.push(options.summary)
  }

  return haystacks.some((value) => normalizeForEvidence(value).includes(needle))
}

export function hasFormalRelationshipSignal(predicate, content = '') {
  const lower = typeof content === 'string' ? content.toLowerCase() : ''
  if (!lower) return false

  const signalMap = {
    WORKS_FOR: [
      'works for',
      'worked for',
      'employee of',
      'employed by',
      'staff at',
      'columnist for',
      'reporter at',
      'editor at',
      'professor at',
      'researcher at',
    ],
    LEADS: [
      'leads',
      'head of',
      'heads',
      'ceo of',
      'chief executive',
      'president of',
      'chair of',
      'director of',
      'executive director',
      'runs',
    ],
    MEMBER_OF: [
      'member of',
      'board member of',
      'belongs to',
      'part of',
      'serves on',
      'fellow at',
    ],
    ADVISES: [
      'advises',
      'advisor to',
      'adviser to',
      'consults for',
      'consultant to',
    ],
  }

  const signals = signalMap[predicate]
  if (!signals) return true
  return signals.some((signal) => lower.includes(signal))
}

function hasFoundedSignal(content = '') {
  const lower = typeof content === 'string' ? content.toLowerCase() : ''
  return [
    'founded',
    'co-founded',
    'cofounded',
    'founded by',
    'founder of',
    'launched by',
  ].some((signal) => lower.includes(signal))
}

function hasDevelopedSignal(content = '') {
  const lower = typeof content === 'string' ? content.toLowerCase() : ''
  return [
    'built by',
    'build by',
    'implementation of',
    'implemented',
    'implementing',
    'developed by',
    'developed',
    'created by',
    'authored by',
    'maintained by',
    'maintainer',
    'written by',
    'made by',
    'port from',
    'ported from',
  ].some((signal) => lower.includes(signal))
}

function hasInstallMethodSignal(content = '') {
  const lower = typeof content === 'string' ? content.toLowerCase() : ''
  return [
    'for installation',
    'can be installed via',
    'install using',
    'install with',
    'install via',
    'available via',
    'brew install',
    'homebrew',
    'go install',
    'pip install',
    'npm install',
    'pnpm add',
    'cargo install',
    'apt install',
  ].some((signal) => lower.includes(signal))
}

function hasOwnershipSignal(content = '') {
  const lower = typeof content === 'string' ? content.toLowerCase() : ''
  return [
    'owns',
    'owned by',
    'owner of',
    'acquired',
    'purchased',
    'bought',
  ].some((signal) => lower.includes(signal))
}

function looksLikeOccupationLabel(value = '') {
  const normalized = normalizeEntityName(value).toLowerCase()
  if (!normalized) return false

  if (normalized.length > 80) return false
  if (/^(the|a|an)\s+/.test(normalized)) return false
  if (/[,:;()[\]{}]/.test(normalized)) return false
  if (/[0-9]/.test(normalized)) return false
  if (normalized.split(/\s+/).length > 6) return false

  return OCCUPATION_TERMS.some((term) => normalized === term || normalized.endsWith(` ${term}`))
}

function looksLikeHumanName(value = '') {
  const normalized = normalizeEntityName(value)
  if (!normalized) return false

  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)

  if (tokens.length < 2 || tokens.length > 4) return false

  return tokens.every((token) => /^[A-Z][A-Za-z.'’-]+$/.test(token))
}

function isGenericMediaArtifactName(value = '') {
  const normalized = normalizeEntityName(value)
  const lower = normalized.toLowerCase()
  if (!normalized) return false

  if (GENERIC_MEDIA_NOUNS.some((term) => lower === term || lower.startsWith(`${term} `))) {
    return true
  }

  return (
    /^(a|an|the)\s+(video|clip|post|story|article|podcast|film)\b/i.test(normalized) ||
    /\b(video|videos|clip|clips|post|posts|story|stories|content)\b/i.test(normalized) &&
    /\b(claiming|purporting|showing|about|documenting|exposing|featuring)\b/i.test(normalized)
  )
}

export function looksLikeGenericActorName(value = '') {
  const normalized = normalizeEntityName(value)
  if (!normalized) return false

  return GENERIC_ACTOR_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isLowValueArticleMediaProduction(relationship, options = {}, content = '') {
  if (relationship.type !== 'CREATED' || !isArticleLikeDocument(options, content)) {
    return false
  }

  if (relationship.target.type !== 'Artwork') {
    return false
  }

  const evidence = relationship.evidence || ''
  const lowerEvidence = evidence.toLowerCase()

  if (
    isGenericMediaArtifactName(relationship.target.name) &&
    [
      'uploaded a video',
      'posted videos',
      'posted a video',
      'making content',
      'making her own videos',
      'making videos',
      'made a video',
      'shared a clip',
      'clip of the segment',
      'posted a clip',
    ].some((signal) => lowerEvidence.includes(signal))
  ) {
    return true
  }

  return false
}

export function normalizeRelationshipForDocument(relationship, options = {}, content = '') {
  if (!relationship) return null

  if (
    ['Person', 'Organization'].includes(relationship.source.type) &&
    looksLikeGenericActorName(relationship.source.name)
  ) {
    return null
  }

  if (
    ['Person', 'Organization'].includes(relationship.target.type) &&
    looksLikeGenericActorName(relationship.target.name)
  ) {
    return null
  }

  if (
    ['WORKS_FOR', 'LEADS', 'MEMBER_OF', 'ADVISES'].includes(relationship.type) &&
    relationship.target.type === 'Organization' &&
    looksLikeOccupationLabel(relationship.target.name)
  ) {
    return null
  }

  if (isLowValueArticleMediaProduction(relationship, options, content)) {
    return null
  }

  if (isGitHubDocument(options)) {
    if (relationship.source.type === 'Person' && !looksLikeHumanName(relationship.source.name)) {
      return null
    }

    if (relationship.target.type === 'Person' && !looksLikeHumanName(relationship.target.name)) {
      return null
    }

    if (['INTEGRATES_WITH', 'HOSTED_ON'].includes(relationship.type) && hasInstallMethodSignal(relationship.evidence || content)) {
      return null
    }

    if (
      relationship.type === 'HOSTED_ON' &&
      relationship.target.type === 'Organization' &&
      normalizeForMatch(relationship.target.name) === 'github'
    ) {
      return null
    }

    if (/\/tap$/i.test(relationship.target.name) || /\bhomebrew\b/i.test(relationship.target.name)) {
      return null
    }

    if (
      relationship.type === 'FOUNDED' &&
      relationship.source.type === 'Person' &&
      ['Tool', 'Model', 'Dataset', 'Project'].includes(relationship.target.type) &&
      !hasFoundedSignal(relationship.evidence || content) &&
      hasDevelopedSignal(relationship.evidence || content)
    ) {
      return {
        ...relationship,
        type: 'DEVELOPS',
      }
    }
  }

  return relationship
}

export function isLowValueRelationship(relationship, options = {}, content = '') {
  if (!relationship) return true

  const videoLike = isVideoLikeDocument(options, content)
  const thinVideoShell = videoLike && isThinVideoShell(content)

  if (!isEntityAnchoredInDocument(relationship.source.name, options, content)) {
    return true
  }

  if (!isEntityAnchoredInDocument(relationship.target.name, options, content)) {
    return true
  }

  if (thinVideoShell) {
    return true
  }

  if (relationship.claim_mode === 'reported') {
    return false
  }

  if (
    ['WORKS_FOR', 'LEADS', 'MEMBER_OF', 'ADVISES'].includes(relationship.type) &&
    !hasFormalRelationshipSignal(relationship.type, content)
  ) {
    return true
  }

  if (relationship.type === 'DEVELOPS' && !hasDevelopedSignal(relationship.evidence || content)) {
    return true
  }

  if (
    relationship.evidence &&
    (isArticleLikeDocument(options, content) || isGitHubDocument(options)) &&
    !isEvidenceAnchoredInDocument(relationship.evidence, options, content)
  ) {
    return true
  }

  if (relationship.type === 'FOUNDED' && !hasFoundedSignal(relationship.evidence || content)) {
    return true
  }

  if (relationship.type === 'OWNS' && !hasOwnershipSignal(relationship.evidence || content)) {
    return true
  }

  if (
    options.requireAnchoredEvidence &&
    (!relationship.evidence || !isEvidenceAnchoredInDocument(relationship.evidence, options, content))
  ) {
    return true
  }

  if (
    ['Tool', 'Model'].includes(relationship.source.type) &&
    relationship.type === 'USES' &&
    /^(data centers?|datacenters?|officers?|users?|systems?)$/i.test(relationship.source.name)
  ) {
    return true
  }

  return false
}

export function isValidTypePair(predicateId, sourceType, targetType) {
  const predicate = PREDICATE_MAP.get(predicateId)
  if (!predicate) return false
  return predicate.subjectTypes.includes(sourceType) && predicate.objectTypes.includes(targetType)
}

export function normalizeTypedRelationship(relationship) {
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
    claim_mode: CLAIM_MODE_SET.has(String(relationship.claim_mode || '').toLowerCase())
      ? String(relationship.claim_mode).toLowerCase()
      : 'asserted',
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

export function validateTypedRelationship(relationship) {
  return Boolean(
    relationship &&
      relationship.source?.name &&
      relationship.source?.type &&
      relationship.target?.name &&
      relationship.target?.type &&
      relationship.type,
  )
}

export function toLegacyRelationship(relationship) {
  if (!validateTypedRelationship(relationship)) return null
  return {
    source: relationship.source.name,
    sourceType: relationship.source.type,
    relationship: relationship.type,
    target: relationship.target.name,
    targetType: relationship.target.type,
  }
}
