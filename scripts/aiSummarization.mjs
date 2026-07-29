import { completion, MODELS, PROMPTS, loadCoreTags } from './llmService.mjs'
import { getModelForTask, getApiEndpoint } from '../lib/config.mjs'
import { breakContentIntoChunks } from '../helpers.js'
import { discoverThreadContext } from '../lib/threadContext.mjs'
import Bottleneck from 'bottleneck'
import fetch from 'node-fetch'

const DEBUG = process.env.DEBUG === 'true'
const ENABLE_THREADS = process.env.ENABLE_THREAD_CONTEXT === 'true' // Murphy's opt-in flag

// Minimum content length to consider "real" content (not just title/metadata)
const MIN_CONTENT_LENGTH = 100
function log(...args) {
  if (DEBUG) console.log(...args)
}

// Rate limiting
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
})

const blacklistPhrases = ['Here is a summary'] // Add more phrases as needed

/**
 * Strip conversational preamble the model sometimes prepends before the actual
 * summary (e.g. "Here's a detailed summary of the webpage based on the provided
 * screenshot:"). These leak onto the display cards, so we scrub them from every
 * summary before it's returned. Idempotent — safe to run on already-clean text.
 */
export function stripSummaryPreamble(text) {
  if (!text || typeof text !== 'string') return text
  let out = text.trim()
  // A leading sentence that announces the summary and ends in a colon, optionally
  // referencing "the webpage", "the provided screenshot", "the content", etc.
  const preamble = /^\s*(sure[,!]?\s*)?(here'?s|here is|below is|this is|following is)\b[^\n:]{0,160}:\s*/i
  // Up to two stacked preambles ("Sure! Here's a summary: Here's a detailed...")
  for (let i = 0; i < 2 && preamble.test(out); i++) out = out.replace(preamble, '').trim()
  return out
}

export async function summarizeContent(content, options = {}) {
  const { scrapId, scrap, tags, taskType = 'summarization', ...otherOptions } = options

  if (!content) {
    log('❌ No content to summarize')
    return null
  }

  try {
    log(`🔍 Original content length: ${content.length}`)

    // Murphy's "Stupid Simple" thread discovery
    let threadContext = null
    if (ENABLE_THREADS && scrap && tags && tags.length > 0) {
      log('🧵 Discovering thread context...')
      // discoverThreadContext() already returns formatted string, not array
      threadContext = await discoverThreadContext(scrap, { tags })
      if (threadContext) {
        log('✅ Found related bookmarks')
      } else {
        log('📭 No related bookmarks found')
      }
    }

    // Clean up HTML content if present
    const cleanContent = content
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    log(`📝 Cleaned content length: ${cleanContent.length}`)
    log(`📝 Content preview: ${cleanContent.slice(0, 100)}...`)

    if (!cleanContent) {
      log('❌ No content after cleaning')
      return null
    }

    // Configure chunk size based on model
    const chunkSizeTokens = options.chunkSize || 120000
    log(`📏 Using chunk size: ${chunkSizeTokens}`)

    // Break content into chunks
    const chunks = breakContentIntoChunks(cleanContent, chunkSizeTokens)
    log(`📑 Split into ${chunks.length} chunks`)
    chunks.forEach((chunk, i) => {
      log(`Chunk ${i + 1} length: ${chunk.length}`)
    })

    // Process chunks
    log('🤖 Generating summaries...')
    const summaries = []
    for (const [i, chunk] of chunks.entries()) {
      try {
        log(`Processing chunk ${i + 1}/${chunks.length}`)
        const summary = await limiter.schedule(async () => {
          log(`🔄 Starting chunk ${i + 1} summarization...`)
          const result = await summarizeChunk(chunk, {
            ...otherOptions,
            scrapId,
            taskType,
            threadContext: i === 0 ? threadContext : null, // Only add context to first chunk
          })
          log(
            `✅ Chunk ${i + 1} summary generated (${result?.length || 0} chars)`,
          )
          return result
        })
        if (summary) {
          summaries.push(summary)
          log(`✅ Chunk ${i + 1} summary added to results`)
        } else {
          log(`⚠️ Chunk ${i + 1} summary was null, skipping`)
        }
      } catch (error) {
        console.error(`❌ Error processing chunk ${i + 1}:`, error)
        log('⚠️ Continuing with remaining chunks...')
      }
    }

    if (summaries.length === 0) {
      log('❌ No summaries were generated')
      return null
    }

    // Combine summaries
    const summary = stripSummaryPreamble(summaries.join('\n').trim())
    log(`✅ Final summary generated (${summary.length} chars)`)
    log(`📝 First line: ${summary.split('\n')[0]}`)

    return summary
  } catch (error) {
    console.error('❌ Error in summarization:', error)
    console.error(error.stack)
    return null
  }
}

/**
 * Summarize content from a screenshot using Gemini's vision capability
 * Used as fallback when text content is blocked/empty
 */
export async function summarizeFromScreenshot(screenshotUrl, options = {}) {
  const { scrapId, url, title } = options

  if (!screenshotUrl) {
    log('❌ No screenshot URL provided for vision summarization')
    return null
  }

  if (!process.env.OPENROUTER_API_KEY) {
    log('❌ OPENROUTER_API_KEY not set for vision summarization')
    return null
  }

  try {
    log(`📸 Summarizing from screenshot: ${screenshotUrl}`)

    // Route through the same OpenRouter proxy endpoint llmService uses — the
    // bare OPENROUTER_API_KEY 401s against openrouter.ai directly; the proxy
    // handles auth. (getApiEndpoint('openrouter') -> router.tools.ejfox.com/v1)
    // Hard timeout so a hung request can't wedge the caller forever.
    const visionTimeoutMs = parseInt(process.env.LLM_TIMEOUT_MS || '90000', 10)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), visionTimeoutMs)
    let response
    try {
      response = await fetch(`${getApiEndpoint('openrouter')}/chat/completions`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://scrapbook.ejfox.com',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are analyzing a screenshot of a webpage that couldn't be scraped for text content. Create a detailed summary based on what you can see in this screenshot.

Context:
- URL: ${url || 'unknown'}
- Title: ${title || 'unknown'}

Instructions:
• Describe what type of content this is (article, product page, video, app, etc.)
• Extract any visible text, headlines, prices, or key information
• Note the main topic or purpose of the page
• Include any visible details that would help remember what this page is about
• Format as bullet points starting with "• "
• Be comprehensive - this summary is the only record of this page's content
• Output ONLY the bullet points. Do NOT include any preamble, intro sentence, or phrase like "Here's a summary" — start directly with the first "• " bullet.

Analyze the screenshot and provide the bullet-point summary:`,
              },
              {
                type: 'image_url',
                image_url: { url: screenshotUrl },
              },
            ],
          },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      }),
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      const errorText = await response.text()
      log(`❌ Vision API error: ${response.status} - ${errorText}`)
      return null
    }

    const data = await response.json()
    const summary = data.choices?.[0]?.message?.content

    if (summary) {
      const cleaned = stripSummaryPreamble(summary)
      log(`✅ Vision summary generated (${cleaned.length} chars)`)
      return cleaned
    }

    log('❌ No summary in vision API response')
    return null
  } catch (error) {
    console.error('❌ Error in vision summarization:', error)
    return null
  }
}

/**
 * Check if content is too short/empty to summarize meaningfully
 */
export function isContentInsufficient(content) {
  if (!content) return true
  const cleaned = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length < MIN_CONTENT_LENGTH
}

async function summarizeChunk(chunk, options = {}) {
  const { scrapId, taskType = 'summarization', threadContext, ...otherOptions } = options
  const startTime = performance.now()
  let summary = null
  let retries = 0
  let messages = otherOptions.messages || []

  const blacklistInstruction = `The following phrases are not allowed in the summary: ${blacklistPhrases
    .map((phrase) => `"${phrase}"`)
    .join(', ')}.`

  // Create properly formatted messages array
  const systemMessage = {
    role: 'system',
    content:
      'You are an expert content analyst helping someone build their digital memory. Your summaries help them remember why they saved something, what was interesting about it, and all the key information they might want to recall later. Be thorough, insightful, and capture the essence of why this content matters.',
  }

  // Build user message with optional thread context
  let userContent = 'You are summarizing content for a digital memory system. Create a rich, detailed summary that captures everything interesting and useful.\n\n'

  // Murphy's thread context injection
  if (threadContext) {
    userContent += threadContext + '\n\n---\n\n'
  }

  userContent += `Instructions:
• Generate as many bullet points as the content warrants (typically 5-15)
• Each point must start with "• "
• Be comprehensive - capture ALL interesting facts, insights, quotes, numbers, dates, names
• For articles: main thesis, supporting arguments, evidence, counterpoints, conclusions, author insights
• For code/docs: purpose, key features, how it works, API details, examples, limitations
• For products: all features, pricing tiers, technical specs, use cases, comparisons
• For social media: the actual content of posts, discussions, key points made

Write in a natural, informative style. Be specific and detailed. Include context that helps understand why this was saved.

${blacklistInstruction}

Content to summarize:
${chunk}`

  const userMessage = {
    role: 'user',
    content: userContent,
  }

  while (summary === null && retries < 3) {
    try {
      log(`🔄 Attempt ${retries + 1}/3 to generate summary...`)
      const response = await completion({
        messages: [systemMessage, userMessage, ...messages],
        temperature: options.temperature || 0.3,
        maxTokens: options.metaSummary ? 2048 : 16384,  // Doubled the output limit
        model: options.model || getModelForTask('summarization'),
        scrapId,
        taskType,
      })

      if (!response) {
        log(`⚠️ Attempt ${retries + 1} failed - no response from API`)
        retries++
        continue
      }

      summary = response
      log(`✅ Got response of ${summary.length} chars`)

      if (blacklistPhrases.some((phrase) => summary?.trim().includes(phrase))) {
        log(
          `⚠️ Summary contains blacklisted phrase. Retrying... (Attempt ${
            retries + 1
          })`,
        )
        messages.push({
          role: 'user',
          content: userMessage.content,
        })
        messages.push({
          role: 'assistant',
          content:
            summary +
            '\n\nThis response was rejected because it contained a blacklisted phrase.',
        })
        summary = null
        retries++
      }
    } catch (error) {
      log(
        `❌ Error during completion (Attempt ${retries + 1}): ${error.message}`,
      )
      if (error.response?.data) {
        log(
          `API Response Data: ${JSON.stringify(error.response.data, null, 2)}`,
        )
      }
      messages.push({
        role: 'assistant',
        content: `Error: ${error.message}`,
      })
      retries++

      // Add delay between retries
      if (retries < 3) {
        const delay = retries * 1000
        log(`⏳ Waiting ${delay}ms before next attempt...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  const endTime = performance.now()
  const duration = Math.round(endTime - startTime)

  if (summary) {
    log(`✅ Successfully generated summary in ${duration}ms`)
  } else {
    log(
      `❌ Failed to generate summary after ${retries} attempts (${duration}ms)`,
    )
  }

  return summary
}

/**
 * Generate a META-summary: a ~140 character synthesis of all analysis outputs
 * This combines insights from summary, tags, relationships, location, etc.
 * into a compact, Twitter-length overview of the scrap.
 */
export function generateMetaSummary(scrap) {
  const parts = []
  const maxLength = 140

  // Helper to strip HTML and markdown
  const stripFormatting = (text) => {
    if (!text) return ''
    return text
      .replace(/<[^>]*>/g, ' ')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n/g, ' ')
      .trim()
  }

  // Start with content type if available
  if (scrap.content_type && scrap.content_type !== 'bookmark') {
    parts.push(scrap.content_type.toUpperCase())
  }

  // Add primary subject from title or first concept tag
  if (scrap.title) {
    const title = stripFormatting(scrap.title).substring(0, 40)
    parts.push(title)
  } else if (scrap.concept_tags && scrap.concept_tags.length > 0) {
    parts.push(scrap.concept_tags[0])
  }

  // Add location if notable
  if (scrap.location && scrap.location !== 'Unknown') {
    parts.push(`@ ${scrap.location}`)
  }

  // Add relationship count if significant
  if (scrap.relationships && scrap.relationships.length > 0) {
    parts.push(`${scrap.relationships.length} connections`)
  }

  // Add financial context if present
  if (scrap.financial_analysis?.tracked_assets?.length > 0) {
    const symbols = scrap.financial_analysis.tracked_assets.map((a) => a.symbol).join(',')
    parts.push(`$${symbols}`)
  }

  // Add key tags (max 2-3)
  const keyTags = []
  if (scrap.tags && Array.isArray(scrap.tags)) {
    keyTags.push(...scrap.tags.slice(0, 2))
  } else if (scrap.concept_tags && Array.isArray(scrap.concept_tags)) {
    keyTags.push(...scrap.concept_tags.slice(0, 2))
  }
  if (keyTags.length > 0) {
    parts.push(`#${keyTags.join(' #')}`)
  }

  // Combine parts and truncate to max length
  let summary = parts.join(' · ')

  // If we have room and a summary exists, add a snippet
  if (summary.length < maxLength - 20 && scrap.summary) {
    const cleanSummary = stripFormatting(scrap.summary)
    const remainingSpace = maxLength - summary.length - 3 // -3 for " - "
    if (remainingSpace > 20) {
      const snippet = cleanSummary.substring(0, remainingSpace)
      summary += ` - ${snippet}`
    }
  }

  // Final truncation
  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength - 1) + '…'
  }

  return summary || 'No summary available'
}

export async function metaSummaryToTags(summary, options = {}) {
  if (!summary) {
    log('❌ No summary to tag')
    return []
  }

  const MAX_RETRIES = 3
  const rawCoreTags = await loadCoreTags()

  if (!rawCoreTags || rawCoreTags.length === 0) {
    log('❌ No core tags available - cannot generate tags')
    return []
  }

  // Exclude personal/workflow action tags ("!tobuy", "!tohire", "!news", "!inspo", …)
  // — those are applied manually and must never be auto-assigned by the tagger.
  const coreTags = rawCoreTags.filter(
    (t) => typeof t === 'string' && t.trim() && !t.trim().startsWith('!'),
  )

  // Create a Set for O(1) validation lookup (lowercase for case-insensitive matching)
  const coreTagsSet = new Set(coreTags.map(t => t.toLowerCase()))

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log(`🏷️ Generating tags (attempt ${attempt}/${MAX_RETRIES})...`)

      // Convert prompt to messages array format
      const messages = [
        {
          role: 'system',
          content:
            'You are a precise content tagger that selects the most relevant tags from a predefined list. Only return tags that exactly match items in the provided list.',
        },
        {
          role: 'user',
          content: `From the list below, choose ONLY the 1-3 tags that are genuinely central to this content. Fewer precise tags are better than more loosely-related ones. If only one tag truly fits, return just one. Do NOT include tags that are merely tangentially related.

Tag list:
${coreTags.join('\n')}

Content to tag:
${summary}

Return only valid tags from the list above, one per line, no explanations. Tags must exactly match the list.`,
        },
      ]

      const startTime = performance.now()
      const response = await completion({
        messages,
        temperature: 0.2 + (attempt - 1) * 0.1, // Slightly increase temperature on retries
        maxTokens: 100,
        model: options.model || MODELS.GPT_3_5_TURBO,
        scrapId: options.scrapId,
        taskType: 'tagging',
      })
      const endTime = performance.now()
      log(`✅ Tags response in ${endTime - startTime}ms`)

      // Parse and validate tags against core list
      const rawTags = response
        .split('\n')
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0)

      // Only keep tags that exist in the core tags list
      const validTags = rawTags.filter((tag) => coreTagsSet.has(tag))

      if (validTags.length === 0 && rawTags.length > 0) {
        log(`⚠️ LLM returned ${rawTags.length} tags but none matched core list: ${rawTags.join(', ')}`)
      }

      if (validTags.length > 0) {
        log(`✅ Generated ${validTags.length} valid tags:`, validTags)
        return validTags
      }

      // No valid tags - retry if we have attempts left
      if (attempt < MAX_RETRIES) {
        log('⚠️ No valid tags generated, retrying...')
        await new Promise(resolve => setTimeout(resolve, 500 * attempt))
      }
    } catch (error) {
      console.error(`❌ Error generating tags (attempt ${attempt}):`, error.message)
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt))
      }
    }
  }

  log('❌ Failed to generate valid tags after all retries')
  return []
}

// CLI testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const testContent = `
    This is a test article about Vue.js composition API and performance optimization.
    It includes code examples and best practices for using ref() and computed().
    The article discusses various technical aspects of Vue 3 development.
  `

  console.log('🧪 Testing summarization...')
  summarizeContent(testContent, { metaSummary: true })
    .then(async (summary) => {
      console.log('\n📝 Summary:')
      console.log(summary)

      console.log('\n🏷️ Generating tags...')
      const tags = await metaSummaryToTags(summary, {})
      console.log('Tags:', tags)
    })
    .catch(console.error)
}
