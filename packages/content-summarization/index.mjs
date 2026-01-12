import Bottleneck from 'bottleneck'
import dotenv from 'dotenv'

dotenv.config()

const DEBUG = process.env.DEBUG === 'true'

/**
 * @typedef {Object} LLMProvider
 * @property {Function} completion - Function to call LLM completion API
 */

/**
 * @typedef {Object} SummarizeOptions
 * @property {string} [scrapId] - ID for tracking
 * @property {Object} [scrap] - Full scrap object for context
 * @property {string[]} [tags] - Tags for thread context
 * @property {string} [taskType='summarization'] - Type of task
 * @property {number} [chunkSize=120000] - Tokens per chunk
 * @property {number} [temperature=0.3] - LLM temperature
 * @property {boolean} [metaSummary=false] - Generate short meta-summary
 * @property {LLMProvider} llmProvider - LLM provider with completion method
 * @property {string} [threadContext] - Optional context from related content
 */

// Minimum content length to consider "real" content
const MIN_CONTENT_LENGTH = 100

function log(...args) {
  if (DEBUG) console.log(...args)
}

// Rate limiting
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
})

const blacklistPhrases = ['Here is a summary']

/**
 * Simple tokenizer using character estimation
 * 1 token ≈ 4 characters for most English text
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

/**
 * Break content into chunks based on token size
 * @param {string} content - Content to chunk
 * @param {number} chunkSizeTokens - Target tokens per chunk
 * @returns {string[]} Array of content chunks
 */
export function breakContentIntoChunks(content, chunkSizeTokens = 6144) {
  if (!content) return []

  // Ensure content is a string
  const text = String(content)

  // Split into sentences more reliably
  const sentences = text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .filter(Boolean)

  const chunks = []
  let currentChunk = ''

  for (const sentence of sentences) {
    const sentenceTokenSize = estimateTokens(currentChunk + sentence)

    if (sentenceTokenSize > chunkSizeTokens) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim())
      }
      currentChunk = ''
    }

    currentChunk += sentence + ' '
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}

/**
 * Check if content is too short/empty to summarize meaningfully
 * @param {string} content - Content to check
 * @returns {boolean} True if content is insufficient
 */
export function isContentInsufficient(content) {
  if (!content) return true
  const cleaned = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length < MIN_CONTENT_LENGTH
}

/**
 * Summarize a single chunk of content
 * @private
 */
async function summarizeChunk(chunk, options = {}) {
  const { scrapId, taskType = 'summarization', threadContext, llmProvider, ...otherOptions } = options
  const startTime = performance.now()
  let summary = null
  let retries = 0
  let messages = otherOptions.messages || []

  if (!llmProvider || typeof llmProvider.completion !== 'function') {
    throw new Error('llmProvider with completion method is required')
  }

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
    content: userContent
  }

  while (summary === null && retries < 3) {
    try {
      log(`🔄 Attempt ${retries + 1}/3 to generate summary...`)
      const response = await llmProvider.completion({
        messages: [systemMessage, userMessage, ...messages],
        temperature: options.temperature || 0.3,
        maxTokens: options.metaSummary ? 2048 : 16384,
        model: options.model,
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

      // Case-insensitive blacklist check
      if (blacklistPhrases.some((phrase) => summary?.trim().toLowerCase().includes(phrase.toLowerCase()))) {
        log(
          `⚠️ Summary contains blacklisted phrase. Retrying... (Attempt ${
            retries + 1
          })`,
        )
        // Add the rejected response to conversation history for context
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
 * Summarize content with automatic chunking and multi-chunk handling
 * 
 * @param {string} content - Content to summarize
 * @param {SummarizeOptions} options - Summarization options
 * @returns {Promise<string|null>} Generated summary or null
 * 
 * @example
 * ```js
 * import { summarizeContent } from '@scrapbook/content-summarization'
 * 
 * const llmProvider = {
 *   async completion({ messages, temperature, maxTokens }) {
 *     // Your LLM API call here
 *     return responseText
 *   }
 * }
 * 
 * const summary = await summarizeContent(longArticle, { llmProvider })
 * console.log(summary)
 * ```
 */
export async function summarizeContent(content, options = {}) {
  const { scrapId, scrap, tags, taskType = 'summarization', llmProvider, ...otherOptions } = options

  if (!content) {
    log('❌ No content to summarize')
    return null
  }

  if (!llmProvider || typeof llmProvider.completion !== 'function') {
    throw new Error('llmProvider with completion method is required')
  }

  try {
    log(`🔍 Original content length: ${content.length}`)

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
            llmProvider,
            threadContext: i === 0 ? options.threadContext : null // Only add context to first chunk
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
    const summary = summaries.join('\n').trim()
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
 * Generate a META-summary: a ~140 character synthesis
 * @param {Object} scrap - Scrap object with various fields
 * @returns {string} Meta-summary
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
    const remainingSpace = maxLength - summary.length - 3
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
