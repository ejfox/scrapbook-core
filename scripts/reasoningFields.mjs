/**
 * Reasoning Fields Extraction
 * Extracts content_type, concept_tags, and confidence scores for AI reasoning
 */

import { completion } from './llmService.mjs'
import { getModelForTask } from '../lib/config.mjs'

/**
 * Infer content type from URL and content patterns
 * This is cheap - no AI needed
 */
export function inferContentType(url, content, title) {
  const urlLower = (url || '').toLowerCase()
  const contentLower = (content || '').toLowerCase()
  const titleLower = (title || '').toLowerCase()

  // News patterns
  if (urlLower.match(/\/(news|article|story|breaking|politics|world)\//)) return 'news'
  if (urlLower.match(/(nytimes|washingtonpost|reuters|apnews|cnn|bbc|theguardian|wsj)\.com/)) return 'news'

  // Opinion/blog patterns
  if (urlLower.match(/\/(opinion|commentary|blog|post)\//)) return 'opinion'
  if (urlLower.match(/(medium\.com|substack\.com|\/blog\/)/)) return 'opinion'

  // Tutorial patterns
  if (urlLower.match(/\/(tutorial|guide|how-to|howto|learn)\//)) return 'tutorial'
  if (titleLower.match(/^(how to|tutorial|guide to|learn)/)) return 'tutorial'

  // Research patterns
  if (urlLower.match(/\/(research|paper|study|journal|arxiv|doi)\//)) return 'research'
  if (urlLower.match(/\.(pdf)(\?|$)/)) return 'research'

  // Product patterns
  if (urlLower.match(/\/(product|pricing|buy|shop|store)\//)) return 'product'
  if (urlLower.match(/(amazon\.com|ebay\.com|shopify\.com)/)) return 'product'

  // Discussion patterns
  if (urlLower.match(/(reddit\.com|hackernews|news\.ycombinator|discourse|forum)/)) return 'discussion'
  if (urlLower.match(/\/(comments|thread|discussion)\//)) return 'discussion'

  // Social media
  if (urlLower.match(/(twitter\.com|x\.com|mastodon|threads\.net)/)) return 'discussion'

  // Video
  if (urlLower.match(/(youtube\.com|vimeo\.com|\/watch\?)/)) return 'video'

  // Documentation
  if (urlLower.match(/\/(docs|documentation|api|reference)\//)) return 'documentation'

  // Default
  return 'article'
}

/**
 * Extract concept tags using AI
 * These are THREAD-level concepts - overarching themes that connect scraps
 * NOT just better tags, but narrative threads that span multiple pieces of content
 */
export async function extractConceptTags(summary, existingTags, options = {}) {
  const { scrapId, taskType = 'concept_extraction' } = options

  if (!summary || summary.length < 50) {
    return []
  }

  const prompt = `Extract 3-5 THREAD-level concepts from this content.

WHAT ARE THREADS?
Threads are overarching narratives/themes that CONNECT multiple pieces of content.
They answer: "What ongoing story, trend, or investigation does this belong to?"

REGULAR TAGS (specific to THIS piece):
- "machinelearning", "tensorflow", "python"
- Describe what's IN this specific content

THREAD CONCEPTS (connect MULTIPLE pieces):
- "ai_capability_scaling" - an ongoing trend across many AI articles
- "regulatory_capture" - a theme that appears in policy/business/tech
- "decentralization_movement" - a narrative thread across crypto/web3/politics

RULES:
1. Think LONGITUDINAL: What ongoing story does this contribute to?
2. Think CONNECTION: What theme would help me find RELATED content?
3. Use snake_case: "climate_attribution_science" not "Climate Science"
4. Be specific but not narrow: "supply_chain_resilience" not "chip_shortage"
5. Focus on TRENDS, NARRATIVES, MOVEMENTS, not just topics

EXAMPLES:

Input: "Article about ICE budget increasing for enforcement operations"
Tags: immigration, politics, ice
Concepts: ["state_capacity_building", "immigration_enforcement_expansion", "executive_power_creep"]

Input: "Tutorial on using LLMs for code generation"
Tags: ai, coding, llm, tutorial
Concepts: ["ai_augmented_development", "developer_tooling_evolution", "code_synthesis_advancement"]

Input: "New research on attribution of extreme weather to climate change"
Tags: climate, research, weather
Concepts: ["climate_attribution_science", "extreme_weather_trends", "climate_evidence_accumulation"]

Now extract THREAD concepts from this summary:
${summary}

Existing tags (for context): ${existingTags?.join(', ') || 'none'}

Return ONLY a JSON array of 3-5 thread concepts. Format: ["concept_one", "concept_two", ...]`

  try {
    const response = await completion({
      messages: [
        { role: 'system', content: 'You extract semantic concepts from content summaries. Return only JSON arrays.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 200,
      model: options.model || getModelForTask('conceptExtraction'),
      scrapId,
      taskType,
    })

    if (!response) return []

    // Parse JSON array from response
    const match = response.match(/\[(.*?)\]/s)
    if (!match) return []

    const concepts = JSON.parse('[' + match[1] + ']')
    return concepts.filter(c => typeof c === 'string' && c.length > 2)

  } catch (error) {
    console.error('Error extracting concept tags:', error.message)
    return []
  }
}

// Placeholder/empty summaries the summarizer emits when it has nothing to work with.
const EMPTY_SUMMARY_RE = /^\s*(\[no content available\]|no content|n\/?a|none|unknown)\s*$/i

/**
 * Compute deterministic confidence scores from real, measurable signals.
 *
 * Deliberately NOT an LLM call. Asking a model to grade its own opaque prior
 * outputs (a) has no ground truth to reason from, violating "ground claims in
 * evidence", and (b) leaks the few-shot example — the old prompt showed
 * {"summary":0.9,"tags":0.85,...} and the model copied it verbatim onto every
 * scrap. Modern prompt-engineering guidance is to prefer deterministic /
 * schema-grounded signals over self-assessment for exactly this reason.
 *
 * Each score reflects something we can actually observe:
 *  - summary: real, non-placeholder, and substantive enough to be trustworthy
 *  - tags: present at a sensible count (not zero, not spammy)
 *  - relationships: the mean of the per-edge confidences the relationship
 *    pipeline already produced (grounded), or 0 when there are none to assess
 */
export function computeConfidenceScores(scrapObj) {
  const clamp = (n) => Math.max(0, Math.min(1, n))

  // --- summary ---
  const summary = typeof scrapObj.summary === 'string' ? scrapObj.summary.trim() : ''
  let summaryScore = 0
  if (summary && !EMPTY_SUMMARY_RE.test(summary)) {
    // Ramp from a real-but-thin summary (~0.55) up to full confidence by ~800 chars.
    summaryScore = clamp(0.4 + summary.length / 800)
  }

  // --- tags ---
  const tags = Array.isArray(scrapObj.tags)
    ? scrapObj.tags.filter((t) => typeof t === 'string' && t.trim() && !t.startsWith('!'))
    : []
  let tagScore
  if (tags.length === 0) tagScore = 0
  else if (tags.length <= 5) tagScore = clamp(0.6 + tags.length * 0.08) // 1→0.68 … 5→1.0
  else tagScore = clamp(1 - (tags.length - 5) * 0.1) // penalize tag spam

  // --- relationships ---
  const rels = Array.isArray(scrapObj.relationships) ? scrapObj.relationships : []
  let relScore = 0
  if (rels.length > 0) {
    const perEdge = rels
      .map((r) => (typeof r?.confidence === 'number' ? clamp(r.confidence) : null))
      .filter((c) => c !== null)
    relScore = perEdge.length > 0
      ? perEdge.reduce((a, b) => a + b, 0) / perEdge.length
      : 0.6 // edges survived the strict ontology but carried no explicit score
  }

  return {
    summary: Number(summaryScore.toFixed(2)),
    tags: Number(tagScore.toFixed(2)),
    relationships: Number(relScore.toFixed(2)),
  }
}

/**
 * Extract all reasoning fields at once
 * Call this after summary/tags/relationships are generated
 */
export async function enrichWithReasoningFields(scrapObj, options = {}) {
  const { scrapId } = options

  // 1. Infer content type (free, pattern-based)
  scrapObj.content_type = inferContentType(
    scrapObj.url,
    scrapObj.content,
    scrapObj.title,
  )

  // 2. Extract concept tags (requires AI if we have summary)
  if (scrapObj.summary && scrapObj.summary.length > 50) {
    scrapObj.concept_tags = await extractConceptTags(
      scrapObj.summary,
      scrapObj.tags,
      { scrapId, taskType: 'concept_extraction' },
    )
  } else {
    scrapObj.concept_tags = []
  }

  // 3. Confidence scores — deterministic, derived from real signals (no LLM call)
  scrapObj.extraction_confidence = scrapObj.summary
    ? computeConfidenceScores(scrapObj)
    : null

  return scrapObj
}
