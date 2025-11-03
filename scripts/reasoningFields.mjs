/**
 * Reasoning Fields Extraction
 * Extracts content_type, concept_tags, and confidence scores for AI reasoning
 */

import { completion } from './llmService.mjs'

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
      model: 'google/gemini-2.0-flash-exp:free',
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

/**
 * Extract confidence scores from AI
 * Ask the AI how confident it is in its extractions
 */
export async function extractConfidenceScores(scrapObj, options = {}) {
  const { scrapId, taskType = 'confidence_assessment' } = options

  const prompt = `Assess the extraction quality for this content:

SUMMARY (${scrapObj.summary?.length || 0} chars):
${scrapObj.summary?.substring(0, 500) || 'none'}

TAGS:
${scrapObj.tags?.join(', ') || 'none'}

RELATIONSHIPS:
${scrapObj.relationships?.length || 0} extracted

For each extraction, rate your confidence (0.0-1.0):
- 0.9-1.0: Very confident, clear and unambiguous
- 0.7-0.8: Confident, likely correct
- 0.5-0.6: Moderate, some uncertainty
- 0.3-0.4: Low, significant uncertainty
- 0.0-0.2: Very low, probably wrong

Return ONLY a JSON object with scores:
{
  "summary": 0.9,
  "tags": 0.85,
  "relationships": 0.7
}`

  try {
    const response = await completion({
      messages: [
        { role: 'system', content: 'You assess extraction quality and return confidence scores as JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      maxTokens: 100,
      model: 'google/gemini-2.0-flash-exp:free',
      scrapId,
      taskType,
    })

    if (!response) {
      return { summary: 0.5, tags: 0.5, relationships: 0.5 }
    }

    // Parse JSON object from response
    const match = response.match(/\{.*?\}/s)
    if (!match) {
      return { summary: 0.5, tags: 0.5, relationships: 0.5 }
    }

    const scores = JSON.parse(match[0])

    // Ensure all scores are between 0 and 1
    return {
      summary: Math.max(0, Math.min(1, scores.summary || 0.5)),
      tags: Math.max(0, Math.min(1, scores.tags || 0.5)),
      relationships: Math.max(0, Math.min(1, scores.relationships || 0.5)),
    }

  } catch (error) {
    console.error('Error extracting confidence scores:', error.message)
    return { summary: 0.5, tags: 0.5, relationships: 0.5 }
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

  // 3. Extract confidence scores (requires AI if we have extractions)
  if (scrapObj.summary) {
    scrapObj.extraction_confidence = await extractConfidenceScores(
      scrapObj,
      { scrapId, taskType: 'confidence_assessment' },
    )
  } else {
    scrapObj.extraction_confidence = null
  }

  return scrapObj
}
