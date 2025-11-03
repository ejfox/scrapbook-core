/**
 * Content Extraction Service
 * Fetches URLs and extracts clean, readable content using Mozilla Readability
 * Special handling for YouTube videos to extract transcripts
 */

import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import { YoutubeTranscript } from 'youtube-transcript'

/**
 * Extract YouTube video ID from URL
 * @param {string} url - YouTube URL
 * @returns {string|null} Video ID or null
 */
function extractYoutubeVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }

  return null
}

/**
 * Extract transcript from YouTube video
 * @param {string} url - YouTube URL
 * @returns {Promise<object|null>} Transcript data or null
 */
async function extractYoutubeTranscript(url) {
  try {
    const videoId = extractYoutubeVideoId(url)
    if (!videoId) return null

    const transcript = await YoutubeTranscript.fetchTranscript(videoId)

    if (!transcript || transcript.length === 0) {
      return null
    }

    // Combine all transcript segments into readable text
    const content = transcript.map((segment) => segment.text).join(' ')

    // Get video title from URL metadata (we'll fetch the page for this)
    let title = 'YouTube Video'
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; ScrapbookBot/1.0; +https://github.com/ejfox/scrapbook-core)',
        },
      })
      const html = await response.text()
      const titleMatch = html.match(/<title>(.+?)<\/title>/)
      if (titleMatch) {
        title = titleMatch[1].replace(' - YouTube', '')
      }
    } catch (error) {
      console.warn('Could not fetch video title:', error.message)
    }

    return {
      title,
      byline: null,
      content,
      excerpt: content.substring(0, 200),
      siteName: 'YouTube',
      length: content.length,
      publishedTime: null,
      extractedAt: new Date().toISOString(),
      method: 'youtube_transcript',
    }
  } catch (error) {
    console.warn('YouTube transcript extraction failed:', error.message)
    return null
  }
}

/**
 * Extract readable content from a URL
 * @param {string} url - The URL to fetch and extract content from
 * @param {object} options - Optional configuration
 * @param {number} options.timeout - Request timeout in ms (default: 10000)
 * @param {string} options.userAgent - User agent string
 * @returns {Promise<object|null>} Extracted content or null on failure
 */
export async function extractContent(url, options = {}) {
  const {
    timeout = 10000,
    userAgent = 'Mozilla/5.0 (compatible; ScrapbookBot/1.0; +https://github.com/ejfox/scrapbook-core)',
  } = options

  try {
    // Check if this is a YouTube URL and try transcript extraction first
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const transcriptResult = await extractYoutubeTranscript(url)
      if (transcriptResult) {
        return transcriptResult
      }
      // If transcript fails, fall through to regular extraction
      console.log('YouTube transcript failed, trying Readability...')
    }

    // Fetch the URL with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
      return null
    }

    // Get the HTML content
    const html = await response.text()

    // Parse with JSDOM
    const dom = new JSDOM(html, { url })

    // Extract readable content with Readability
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article) {
      console.warn(`Readability could not parse ${url}`)
      return null
    }

    // Return structured content
    return {
      title: article.title,
      byline: article.byline,
      content: article.textContent, // Plain text, no HTML
      excerpt: article.excerpt,
      siteName: article.siteName,
      length: article.length, // Character count
      publishedTime: article.publishedTime,
      extractedAt: new Date().toISOString(),
    }
  } catch (error) {
    // Handle specific error types
    if (error.name === 'AbortError') {
      console.warn(`Request timeout for ${url}`)
    } else if (error.message.includes('fetch')) {
      console.warn(`Network error fetching ${url}: ${error.message}`)
    } else {
      console.warn(`Error extracting content from ${url}: ${error.message}`)
    }
    return null
  }
}

/**
 * Extract content with exponential backoff retry
 * @param {string} url - The URL to fetch
 * @param {object} options - Optional configuration
 * @param {number} options.maxRetries - Maximum retry attempts (default: 2)
 * @param {number} options.initialDelay - Initial retry delay in ms (default: 1000)
 * @returns {Promise<object|null>}
 */
export async function extractContentWithRetry(url, options = {}) {
  const { maxRetries = 2, initialDelay = 1000, ...extractOptions } = options

  let lastError = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff
      const delay = initialDelay * Math.pow(2, attempt - 1)
      console.log(`Retrying ${url} (attempt ${attempt + 1}/${maxRetries + 1}) after ${delay}ms`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    try {
      const result = await extractContent(url, extractOptions)
      if (result) {
        return result
      }
    } catch (error) {
      lastError = error
      console.warn(`Attempt ${attempt + 1} failed for ${url}:`, error.message)
    }
  }

  console.error(`All ${maxRetries + 1} attempts failed for ${url}`)
  return null
}

/**
 * Rate-limited batch content extraction
 * @param {Array<string>} urls - Array of URLs to process
 * @param {object} options - Optional configuration
 * @param {number} options.concurrency - Max concurrent requests (default: 3)
 * @param {number} options.delayBetweenBatches - Delay between batches in ms (default: 1000)
 * @returns {Promise<Array<object>>} Array of extraction results
 */
export async function extractBatch(urls, options = {}) {
  const { concurrency = 3, delayBetweenBatches = 1000, ...extractOptions } = options

  const results = []

  // Process in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)

    console.log(`Processing batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(urls.length / concurrency)}`)

    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const content = await extractContentWithRetry(url, extractOptions)
        return { url, content, success: !!content }
      })
    )

    results.push(...batchResults)

    // Delay between batches (except for the last one)
    if (i + concurrency < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches))
    }
  }

  return results
}
