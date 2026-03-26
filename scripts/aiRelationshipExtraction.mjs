import { completion } from './llmService.mjs'
import { getModelForTask } from '../lib/config.mjs'
import {
  buildEntityTypePrompt,
  buildPredicatePrompt,
  isArticleLikeDocument,
  isGitHubDocument,
  isLowValueRelationship,
  isThinVideoShell,
  isVideoLikeDocument,
  normalizeEntityName,
  normalizeRelationshipForDocument,
  normalizeTypedRelationship,
  parseJsonObjectFromResponse,
  validateTypedRelationship,
} from '../lib/relationshipExtraction.mjs'

const MAX_CONTENT_CHARS = 14000
const MAX_GITHUB_PASSAGES = 12

const BASE_EXTRACTION_EXAMPLES = [
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
]

const REVIEW_EXAMPLE_CASES = [
  {
    label: 'GitHub keep as asserted',
    input: {
      index: 0,
      source: { name: 'MLXAudio', type: 'Organization' },
      type: 'DEVELOPS',
      target: { name: 'Sortformer speaker diarization model', type: 'Model' },
      evidence: 'This GitHub repository, maintained by MLXAudio, focuses on the implementation of the Sortformer speaker diarization model.',
    },
    output: {
      index: 0,
      source: { name: 'MLXAudio', type: 'Organization' },
      type: 'DEVELOPS',
      target: { name: 'Sortformer speaker diarization model', type: 'Model' },
      evidence: 'This GitHub repository, maintained by MLXAudio, focuses on the implementation of the Sortformer speaker diarization model.',
      decision: 'asserted',
      confidence: 0.87,
      reason: 'Explicit repository summary with named maintainer and concrete model implementation.',
    },
  },
  {
    label: 'Article keep as reported',
    input: {
      index: 1,
      source: { name: 'Arizona Department of Corrections', type: 'Organization' },
      type: 'DEVELOPS',
      target: { name: 'Inmate management software', type: 'Tool' },
      evidence: 'According to Arizona Department of Corrections whistleblowers, the inmate management software cannot interpret current sentencing laws.',
    },
    output: {
      index: 1,
      source: { name: 'Arizona Department of Corrections', type: 'Organization' },
      type: 'DEVELOPS',
      target: { name: 'Inmate management software', type: 'Tool' },
      evidence: 'According to Arizona Department of Corrections whistleblowers, the inmate management software cannot interpret current sentencing laws.',
      decision: 'reported',
      confidence: 0.52,
      reason: 'Grounded in the article but framed through whistleblower reporting rather than a directly established fact.',
    },
  },
  {
    label: 'Drop article background infrastructure',
    input: {
      index: 5,
      source: { name: 'Arizona Department of Corrections', type: 'Organization' },
      type: 'OPERATES',
      target: { name: 'Arizona prisons', type: 'Location' },
      evidence: 'According to Arizona Department of Corrections whistleblowers, hundreds of incarcerated people who should be eligible for release are being held in prison because the inmate management software cannot interpret current sentencing laws.',
    },
    output: {
      index: 5,
      decision: 'drop',
      drop_reason: 'background_context',
      reason: 'This is broad institutional background, but the article’s real graph-worthy relationship is the source-bound software claim.',
    },
  },
  {
    label: 'Drop generic actor',
    input: {
      index: 6,
      source: { name: 'Federal officers', type: 'Organization' },
      type: 'USES',
      target: { name: 'Less lethal weapons', type: 'Tool' },
      evidence: 'Federal officers used less lethal weapons on protesters.',
    },
    output: {
      index: 6,
      decision: 'drop',
      drop_reason: 'generic_actor',
      reason: 'The source is a generic actor label, not a stable named entity for the graph.',
    },
  },
  {
    label: 'Drop abstract social phenomenon',
    input: {
      index: 7,
      source: { name: 'Robert F. Kennedy Jr.', type: 'Person' },
      type: 'FUNDS',
      target: { name: 'Vaccine skepticism', type: 'Movement' },
      evidence: 'Robert F. Kennedy Jr. has drawn back public-health funding and fomented vaccine skepticism.',
    },
    output: {
      index: 7,
      decision: 'drop',
      drop_reason: 'abstract_phenomenon',
      reason: 'Vaccine skepticism is an abstract social condition here, not a named movement or other core entity.',
    },
  },
  {
    label: 'Keep named movement',
    input: {
      index: 8,
      source: { name: 'Martin Luther King Jr.', type: 'Person' },
      type: 'LEADS',
      target: { name: 'Civil Rights Movement', type: 'Movement' },
      evidence: 'Martin Luther King Jr. was a leading figure in the Civil Rights Movement.',
    },
    output: {
      index: 8,
      source: { name: 'Martin Luther King Jr.', type: 'Person' },
      type: 'LEADS',
      target: { name: 'Civil Rights Movement', type: 'Movement' },
      evidence: 'Martin Luther King Jr. was a leading figure in the Civil Rights Movement.',
      decision: 'asserted',
      confidence: 0.93,
      reason: 'This is a named, socially legible movement and the leadership relation is explicit.',
    },
  },
]

function buildExtractionExamplePayload(options = {}) {
  const examples = [...BASE_EXTRACTION_EXAMPLES]

  if (isGitHubDocument(options)) {
    examples.push({
      source: { name: 'MLXAudio', type: 'Organization' },
      type: 'DEVELOPS',
      target: { name: 'Sortformer speaker diarization model', type: 'Model' },
      evidence: 'This GitHub repository, maintained by MLXAudio, focuses on the implementation of the Sortformer speaker diarization model.',
    })
  } else if (isArticleLikeDocument(options, options.content || '')) {
    examples.push({
      source: { name: 'Donald Trump', type: 'Person' },
      type: 'LEADS',
      target: { name: 'Immigration Crackdown', type: 'Project' },
      evidence: 'President Donald Trump’s immigration crackdown in cities across the country.',
    })
    examples.push({
      source: { name: 'Arizona Department of Corrections', type: 'Organization' },
      type: 'DEVELOPS',
      target: { name: 'Inmate management software', type: 'Tool' },
      evidence: 'According to Arizona Department of Corrections whistleblowers, the inmate management software cannot interpret current sentencing laws.',
    })
    examples.push({
      source: { name: 'Martin Luther King Jr.', type: 'Person' },
      type: 'LEADS',
      target: { name: 'Civil Rights Movement', type: 'Movement' },
      evidence: 'Martin Luther King Jr. was a leading figure in the Civil Rights Movement.',
    })
  } else {
    examples.push({
      source: { name: 'Trevor Paglen', type: 'Person' },
      type: 'CREATED',
      target: { name: 'ImageNet Roulette', type: 'Artwork' },
      evidence: 'Trevor Paglen created ImageNet Roulette.',
    })
  }

  return JSON.stringify({ relationships: examples }, null, 2)
}

function buildExtractionCounterexamples(options = {}) {
  const examples = [
    '- Drop generic actors like `Federal officers -> USES -> Less lethal weapons` even if the sentence is literally true.',
    '- Drop abstract social conditions or sentiments like `Robert F. Kennedy Jr. -> FUNDS -> Vaccine skepticism` unless the text clearly names a real movement entity.',
  ]

  if (isGitHubDocument(options)) {
    examples.push('- Drop install/distribution noise like `ttylag -> INTEGRATES_WITH -> Homebrew`.')
  }

  if (isArticleLikeDocument(options, options.content || '')) {
    examples.push('- Only type something as Movement when it is a named, socially legible movement or coalition, such as `Civil Rights Movement`, `Black Lives Matter`, or `QAnon`.')
    examples.push('- If a relationship is explicit but journalistic or source-bound, still extract it and let the reviewer classify it as `reported` later.')
    examples.push('- When an investigative article centers on a software, tool, model, or system failure, prefer the technical relationship over broad institutional background like `Organization -> OPERATES -> Location`.')
  }

  return examples.join('\n')
}

function buildReviewExamplePayload(options = {}) {
  const examples = REVIEW_EXAMPLE_CASES.filter((example) => {
    if (isGitHubDocument(options)) {
      return ['GitHub keep as asserted', 'Drop generic actor', 'Drop abstract social phenomenon'].includes(example.label)
    }

    if (isArticleLikeDocument(options, options.content || '')) {
      return ['Article keep as reported', 'Drop article background infrastructure', 'Drop generic actor', 'Drop abstract social phenomenon', 'Keep named movement'].includes(example.label)
    }

    return ['Drop generic actor', 'Keep named movement'].includes(example.label)
  })

  return examples
    .map((example) => `${example.label}
Input:
${JSON.stringify(example.input, null, 2)}
Output:
${JSON.stringify(example.output, null, 2)}`)
    .join('\n\n')
}

function truncateContent(content) {
  if (content.length <= MAX_CONTENT_CHARS) {
    return content
  }

  const head = content.slice(0, 9500)
  const tail = content.slice(-3500)
  return `${head}\n\n[TRUNCATED MIDDLE]\n\n${tail}`
}

function cleanPassage(passage) {
  return passage
    .replace(/\s+/g, ' ')
    .trim()
}

function splitIntoPassages(content) {
  return content
    .split(/\n{2,}/)
    .map(cleanPassage)
    .filter((passage) => passage.length >= 40)
}

function scoreGitHubPassage(passage) {
  const lower = passage.toLowerCase()
  let score = 0

  if (lower.includes('summary')) score += 5
  if (lower.includes('maintained by')) score += 6
  if (lower.includes('author')) score += 5
  if (lower.includes('license and attribution')) score += 5
  if (lower.includes('copyright') || lower.includes('(c)')) score += 4
  if (lower.includes('repository')) score += 3
  if (lower.includes('implementation')) score += 4
  if (lower.includes('model')) score += 3
  if (lower.includes('library')) score += 3
  if (lower.includes('requires ')) score += 2
  if (lower.includes('depends on')) score += 2
  if (lower.includes('uses ')) score += 2
  if (lower.includes('built with')) score += 2
  if (lower.includes('ported')) score += 2
  if (lower.includes('owner')) score += 2
  if (/[A-Z][A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(passage)) score += 2

  if (
    lower.includes('navigation menu') ||
    lower.includes('skip to content') ||
    lower.includes('saved searches') ||
    lower.includes('sign up') ||
    lower.includes('pull requests') ||
    lower.includes('actions') ||
    lower.includes('security') ||
    lower.includes('insights')
  ) {
    score -= 8
  }

  if (
    lower.includes('brew install') ||
    lower.includes('go install') ||
    lower.includes('pip install') ||
    lower.includes('npm install') ||
    lower.includes('cargo install') ||
    lower.includes('homebrew')
  ) {
    score -= 5
  }

  if (passage.length > 800) score -= 2
  if (passage.length < 60) score -= 1

  return score
}

function selectGitHubContent(content, options = {}) {
  const summary = normalizeEntityName(options.summary || '')
  const passages = splitIntoPassages(content)
  const scored = passages
    .map((passage, index) => ({ passage, index, score: scoreGitHubPassage(passage) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_GITHUB_PASSAGES)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.passage)

  const sections = []
  if (summary) {
    sections.push(`Repository summary:\n${summary}`)
  }
  if (scored.length > 0) {
    sections.push(`Selected repository passages:\n${scored.join('\n\n')}`)
  } else {
    sections.push(`Repository content:\n${truncateContent(content)}`)
  }

  return sections.join('\n\n')
}

function selectExtractionContent(content, options = {}) {
  if (isGitHubDocument(options)) {
    return selectGitHubContent(content, options)
  }

  return buildDocumentPayload(content, options)
}

function buildDocumentPayload(content, options = {}) {
  const sections = []
  const normalizedSummary = normalizeEntityName(options.summary || '')

  if (normalizedSummary) {
    sections.push(`Supplemental summary:\n${normalizedSummary}`)
  }

  sections.push(`Primary text:\n${truncateContent(content)}`)

  return sections.join('\n\n')
}

function buildSourceSpecificNotes(options = {}) {
  if (isGitHubDocument(options)) {
    return [
      '- For GitHub and package pages, prefer DEVELOPS for maintainers/authors of tools, models, datasets, and repos.',
      '- Do not use INTEGRATES_WITH when the text is only about installation or distribution channels like Homebrew, pip, npm, Cargo, or go install.',
      '- Use FOUNDED only when the text explicitly says founded/co-founded, not when someone simply built, authored, or maintains a repo.',
    ].join('\n')
  }

  if (isArticleLikeDocument(options, options.content || '')) {
    return [
      '- On article/report pages, avoid CREATED edges for generic in-story media artifacts such as “a video”, “videos”, “a clip”, or descriptive phrases unless there is a clearly named work.',
      '- Prefer durable institutional or actor relationships over ephemeral media-production edges.',
      '- If the article is centrally about a tool, model, software system, or technical bug, extract that technical relationship rather than a broader background institution/location relation.',
    ].join('\n')
  }

  return '- Prefer durable institutional, financial, technical, and location relationships over ephemeral media references.'
}

function buildMessages(documentPayload, options = {}, mode = 'default') {
  const entityPrompt = buildEntityTypePrompt()
  const predicatePrompt = buildPredicatePrompt()
  const examplePayload = buildExtractionExamplePayload(options)
  const counterexamplePayload = buildExtractionCounterexamples(options)
  const contextLines = [
    options.title ? `Title: ${options.title}` : null,
    options.url ? `URL: ${options.url}` : null,
  ].filter(Boolean)
  const modeNotes = mode === 'recovery'
    ? '- This is a second-pass recall recovery for a long-form document. Extract at most 4 high-confidence relationships that are explicitly supported.\n- Prioritize organizations, people, models, datasets, tools, projects, and locations that have durable ties.\n- If the text only supports ephemeral media mentions or descriptive content production, return no relationship.'
    : '- Extract only the strongest supported semantic relationships.'
  const sourceSpecificNotes = buildSourceSpecificNotes({
    ...options,
    content: documentPayload,
  })

  return [
    {
      role: 'system',
      content: `You are an investigative relationship extraction specialist.

Your job is to extract only high-signal semantic relationships from a document.

Rules:
- Return valid JSON only.
- Use only the approved entity types and approved predicates.
- Omit weak, generic, structural, speculative, or page-chrome relationships.
- Prefer fewer, cleaner relationships over broad coverage.
- Use canonical predicate direction only.
- Keep evidence short, direct, and as close to verbatim from the text as possible.`,
    },
    {
      role: 'user',
      content: `Extract semantic relationships from this content.

Approved entity types:
${entityPrompt}

Approved predicates:
${predicatePrompt}

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
- creative works -> Artwork + CREATED
- named political/social formations -> Movement
- do not turn abstract sentiments or conditions into entities
${modeNotes}
${sourceSpecificNotes}

Positive examples:
${examplePayload}

Counterexamples:
${counterexamplePayload}

Document context:
${contextLines.join('\n')}

Content:
${documentPayload}`,
    },
  ]
}

async function repairJsonResponse(rawResponse, model) {
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

  return completion({
    messages: repairMessages,
    temperature: 0,
    maxTokens: 1800,
    model,
    taskType: 'relationshipAnalysisRepair',
  })
}

async function repairReviewResponse(rawResponse, model) {
  const repairMessages = [
    {
      role: 'system',
      content: 'Repair malformed model output into valid JSON. Output JSON only.',
    },
    {
      role: 'user',
      content: `Convert this into valid JSON with shape {"decisions":[...]}.
Each decision item must contain:
- index
- decision ("asserted", "reported", or "drop")
- reason
- optional drop_reason for dropped candidates
- and, if decision is not "drop", the original relationship fields

Do not invent new relationships. Preserve only the relationships already present in the raw output.

Raw output:
${rawResponse}`,
    },
  ]

  return completion({
    messages: repairMessages,
    temperature: 0,
    maxTokens: 2200,
    model,
    taskType: 'relationshipAnalysisReviewRepair',
  })
}

async function runExtractionPass(content, options = {}, mode = 'default') {
  const model = options.model || getModelForTask('relationshipAnalysis')
  const documentPayload = selectExtractionContent(content, options)
  const response = await completion({
    messages: buildMessages(documentPayload, options, mode),
    temperature: mode === 'recovery' ? 0.05 : 0.1,
    maxTokens: mode === 'recovery' ? 1200 : 1800,
    model,
    scrapId: options.scrapId,
    taskType: mode === 'recovery' ? 'relationshipAnalysisRecovery' : 'relationshipAnalysis',
  })

  if (!response) {
    return null
  }

  let payload = parseJsonObjectFromResponse(response)
  if (!payload) {
    const repaired = await repairJsonResponse(response, model)
    payload = parseJsonObjectFromResponse(repaired)
  }

  if (!payload || !Array.isArray(payload.relationships)) {
    return null
  }

  return payload.relationships
}

function buildReviewMessages(documentPayload, candidates, options = {}, mode = 'default') {
  const entityPrompt = buildEntityTypePrompt()
  const predicatePrompt = buildPredicatePrompt()
  const candidatePayload = JSON.stringify({ relationships: candidates }, null, 2)
  const examplePayload = buildReviewExamplePayload(options)
  const contextLines = [
    options.title ? `Title: ${options.title}` : null,
    options.url ? `URL: ${options.url}` : null,
    isGitHubDocument(options) ? 'Source mode: GitHub/repository page' : null,
    isArticleLikeDocument(options, options.content || '') ? 'Source mode: article/report page' : null,
  ].filter(Boolean)

  const modeNotes = mode === 'recovery'
    ? '- Be extra conservative on second-pass recovery output, but still classify grounded source-bound relationships as "reported" instead of automatically dropping them.\n- If a candidate is explicit in the text but sounds like journalism, whistleblower reporting, allegations, lawsuits, investigations, or quoted findings, prefer "reported".'
    : '- Keep only candidates that are clearly durable semantic relationships, or classify them as "reported" if they are grounded but source-bound.'

  return [
    {
      role: 'system',
      content: `You are an ontology adjudicator for an investigative graph.

Your job is to review candidate relationships and keep only the ones that deserve to enter the graph.

Rules:
- Return valid JSON only.
- Prefer dropping uncertain candidates over keeping weak ones.
- You must classify every candidate as exactly one of: "asserted", "reported", or "drop".
- If a candidate is grounded and useful but reads like a reported or source-bound claim rather than a durable semantic fact, classify it as "reported" instead of dropping it.
- Prefer "reported" for attributed, source-bound, allegation-like article claims.
- When article candidates include both a broad background relation and a more specific technical/system claim, prefer the technical/system claim.
- Drop abstract sentiments/conditions that are being coerced into entities. Keep named movements.
- Preserve plausible predicates when already grounded in the text.
- Keep evidence short and anchored to the supplied document text.`,
    },
    {
      role: 'user',
      content: `Review these candidate relationships.

Approved entity types:
${entityPrompt}

Approved predicates:
${predicatePrompt}

Decision rules:
${modeNotes}

Return JSON with this shape:
{
  "decisions": [
    {
      "index": 0,
      "decision": "asserted",
      "source": { "name": "Entity name", "type": "ApprovedType" },
      "type": "APPROVED_PREDICATE",
      "target": { "name": "Entity name", "type": "ApprovedType" },
      "evidence": "Short evidence grounded in the text",
      "confidence": 0.0
    }
    {
      "index": 1,
      "decision": "reported",
      "source": { "name": "Entity name", "type": "ApprovedType" },
      "type": "APPROVED_PREDICATE",
      "target": { "name": "Entity name", "type": "ApprovedType" },
      "evidence": "Short evidence grounded in the text",
      "confidence": 0.0
    },
    {
      "index": 2,
      "decision": "drop",
      "drop_reason": "generic_actor",
      "reason": "brief reason"
    }
  ]
}

Examples:
${examplePayload}

Document context:
${contextLines.join('\n')}

Document text:
${documentPayload}

Candidate relationships:
${candidatePayload}`,
    },
  ]
}

async function adjudicateRelationships(candidates, content, options = {}, mode = 'default') {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return []
  }

  const model = options.reviewModel || getModelForTask('relationshipReview') || options.model || getModelForTask('relationshipAnalysis')
  const documentPayload = selectExtractionContent(content, options)
  const response = await completion({
    messages: buildReviewMessages(documentPayload, candidates, options, mode),
    temperature: 0.05,
    maxTokens: 2200,
    model,
    scrapId: options.scrapId,
    taskType: mode === 'recovery' ? 'relationshipAnalysisReviewRecovery' : 'relationshipAnalysisReview',
  })

  if (!response) {
    return candidates
  }

  let payload = parseJsonObjectFromResponse(response)
  if (!payload) {
    const repaired = await repairReviewResponse(response, model)
    payload = parseJsonObjectFromResponse(repaired)
  }

  if (!payload || !Array.isArray(payload.decisions)) {
    return candidates
  }

  return payload.decisions
    .filter((decision) => decision && ['asserted', 'reported'].includes(decision.decision))
    .map((decision) => ({
      ...decision,
      claim_mode: decision.decision,
    }))
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

function countClaimModes(relationships) {
  return relationships.reduce((acc, relationship) => {
    const claimMode = relationship.claim_mode || 'asserted'
    acc[claimMode] = (acc[claimMode] || 0) + 1
    return acc
  }, {})
}

function buildEmptyDiagnostics(options = {}) {
  return {
    source_mode: isGitHubDocument(options)
      ? 'github'
      : isArticleLikeDocument(options, options.content || '')
        ? 'article'
        : 'default',
    skipped_reason: null,
    used_recovery: false,
    raw_candidate_count: 0,
    pre_review_candidate_count: 0,
    post_review_candidate_count: 0,
    final_relationship_count: 0,
    claim_mode_counts: {},
    raw_candidates: options.includeDebugArtifacts ? [] : undefined,
    pre_review_candidates: options.includeDebugArtifacts ? [] : undefined,
    post_review_candidates: options.includeDebugArtifacts ? [] : undefined,
    final_relationships: options.includeDebugArtifacts ? [] : undefined,
  }
}

function normalizeCandidates(rawRelationships, options, content, filterMode = 'strict') {
  let relationships = rawRelationships
    .map(normalizeTypedRelationship)
    .map((relationship) => normalizeRelationshipForDocument(relationship, options, content))
    .filter(Boolean)
    .filter(validateTypedRelationship)

  if (filterMode === 'strict') {
    relationships = relationships.filter((relationship) => !isLowValueRelationship(relationship, options, content))
  }

  return relationships
}

async function runRelationshipPipeline(content, options = {}) {
  const diagnostics = buildEmptyDiagnostics({
    ...options,
    content,
  })

  if (!content) {
    diagnostics.skipped_reason = 'empty_content'
    return { relationships: [], diagnostics }
  }

  if (isVideoLikeDocument(options, content) && isThinVideoShell(content)) {
    console.log('Skipping ontology extraction for thin video shell content')
    diagnostics.skipped_reason = 'thin_video_shell'
    return { relationships: [], diagnostics }
  }

  let rawRelationships = []
  let normalizedRelationships = []

  try {
    rawRelationships = await runExtractionPass(content, options, 'default')

    if (!rawRelationships) {
      console.log('❌ No response from LLM')
      diagnostics.skipped_reason = 'no_llm_response'
      return { relationships: [], diagnostics }
    }

    diagnostics.raw_candidate_count = rawRelationships.length
    if (options.includeDebugArtifacts) {
      diagnostics.raw_candidates = rawRelationships
    }

    normalizedRelationships = normalizeCandidates(rawRelationships, options, content, 'strict')

    if (
      normalizedRelationships.length === 0 &&
      rawRelationships.length > 0 &&
      (isArticleLikeDocument(options, content) || options.source === 'arena')
    ) {
      normalizedRelationships = normalizeCandidates(rawRelationships, options, content, 'permissive')
    }

    diagnostics.pre_review_candidate_count = normalizedRelationships.length
    if (options.includeDebugArtifacts) {
      diagnostics.pre_review_candidates = normalizedRelationships
    }

    normalizedRelationships = await adjudicateRelationships(
      normalizedRelationships,
      content,
      options,
      'default',
    )

    diagnostics.post_review_candidate_count = normalizedRelationships.length
    if (options.includeDebugArtifacts) {
      diagnostics.post_review_candidates = normalizedRelationships
    }

    normalizedRelationships = normalizeCandidates(normalizedRelationships, options, content, 'strict')

    if (
      normalizedRelationships.length === 0 &&
      isArticleLikeDocument(options, content) &&
      (content.length >= 2500 || Boolean(options.summary))
    ) {
      diagnostics.used_recovery = true
      const recoveredRelationships = await runExtractionPass(content, options, 'recovery')
      if (recoveredRelationships) {
        rawRelationships = recoveredRelationships
        diagnostics.raw_candidate_count = recoveredRelationships.length
        if (options.includeDebugArtifacts) {
          diagnostics.raw_candidates = recoveredRelationships
        }
        normalizedRelationships = normalizeCandidates(recoveredRelationships, {
          ...options,
          requireAnchoredEvidence: true,
        }, content, 'strict')

        if (
          normalizedRelationships.length === 0 &&
          recoveredRelationships.length > 0 &&
          isArticleLikeDocument(options, content)
        ) {
          normalizedRelationships = normalizeCandidates(recoveredRelationships, {
            ...options,
            requireAnchoredEvidence: true,
          }, content, 'permissive')
        }

        diagnostics.pre_review_candidate_count = normalizedRelationships.length
        if (options.includeDebugArtifacts) {
          diagnostics.pre_review_candidates = normalizedRelationships
        }

        normalizedRelationships = await adjudicateRelationships(
          normalizedRelationships,
          content,
          {
            ...options,
            requireAnchoredEvidence: true,
          },
          'recovery',
        )

        diagnostics.post_review_candidate_count = normalizedRelationships.length
        if (options.includeDebugArtifacts) {
          diagnostics.post_review_candidates = normalizedRelationships
        }

        normalizedRelationships = normalizeCandidates(normalizedRelationships, {
          ...options,
          requireAnchoredEvidence: true,
        }, content, 'strict')
      }
    }

    const dedupedRelationships = dedupeRelationships(normalizedRelationships)
    diagnostics.final_relationship_count = dedupedRelationships.length
    diagnostics.claim_mode_counts = countClaimModes(dedupedRelationships)
    if (options.includeDebugArtifacts) {
      diagnostics.final_relationships = dedupedRelationships
    }

    console.log(
      `✅ Extracted ${dedupedRelationships.length} ontology relationships (${rawRelationships.length - dedupedRelationships.length} dropped by normalization)`,
    )

    return {
      relationships: dedupedRelationships,
      diagnostics,
    }
  } catch (error) {
    console.error('Error extracting relationships:', error)
    diagnostics.skipped_reason = 'pipeline_error'
    return {
      relationships: [],
      diagnostics,
    }
  }
}

export async function extractRelationships(content, options = {}) {
  const result = await runRelationshipPipeline(content, options)
  return result.relationships
}

export async function extractRelationshipsDetailed(content, options = {}) {
  return runRelationshipPipeline(content, options)
}
