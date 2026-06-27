/**
 * Content Extraction Service
 * Tiered fallback chain to maximize content recovery across the archive:
 *   1. YouTube transcript (for video URLs)
 *   2. Local fetch + Mozilla Readability (fast, free, static HTML)
 *   3. Jina Reader r.jina.ai (free, handles JS SPAs like X / YouTube pages)
 *   4. Wayback Machine (dead links, defunct sites, some paywalls)
 * Per-domain cookies (data/cookies.json) are applied to tier 2 so the user's own
 * subscriptions (e.g. NYT) unlock paywalled content they are entitled to.
 *
 * Note: a screenshot+vision OCR tier is handled at the pipeline level
 * (summarizeFromScreenshot) as a last resort and is not invoked here.
 */

import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import { YoutubeTranscript } from 'youtube-transcript'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

// Minimum textContent length to consider an extraction "good enough" to stop
// escalating to the next fallback tier.
const MIN_GOOD_LENGTH = 500
// Use a realistic browser UA — the old "ScrapbookBot" string got blocked by many
// sites outright. (Hard-bot sites like NYT still need a real browser; this just
// stops needless 403s on the soft majority.)
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
const JINA_BASE = 'https://r.jina.ai/'
const WAYBACK_AVAILABLE = 'https://archive.org/wayback/available?url='

// ── Per-domain cookies ──────────────────────────────────────────────────────
// data/cookies.json: { "nytimes.com": "cookie1=val; cookie2=val", ... }
// The value is the raw Cookie request-header string for that domain (copy from
// DevTools → Network → any request → Request Headers → cookie). Gitignored.
let _cookieMap = null
function loadCookieMap() {
  if (_cookieMap !== null) return _cookieMap
  _cookieMap = {}
  try {
    const p = path.resolve(process.cwd(), 'data/cookies.json')
    if (existsSync(p)) {
      _cookieMap = JSON.parse(readFileSync(p, 'utf-8')) || {}
    }
  } catch (e) {
    console.warn('Could not load data/cookies.json:', e.message)
    _cookieMap = {}
  }
  return _cookieMap
}

function cookieHeaderForUrl(url) {
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return null }
  const map = loadCookieMap()
  // match exact host or any parent domain key (e.g. "nytimes.com" matches "cooking.nytimes.com")
  for (const domain of Object.keys(map)) {
    if (host === domain || host.endsWith('.' + domain)) return map[domain]
  }
  return null
}

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

async function extractYoutubeTranscript(url) {
  try {
    const videoId = extractYoutubeVideoId(url)
    if (!videoId) return null

    const transcript = await YoutubeTranscript.fetchTranscript(videoId)
    if (!transcript || transcript.length === 0) return null

    const content = transcript.map((segment) => segment.text).join(' ')

    let title = 'YouTube Video'
    try {
      const response = await fetch(url, { headers: { 'User-Agent': DEFAULT_UA } })
      const html = await response.text()
      const titleMatch = html.match(/<title>(.+?)<\/title>/)
      if (titleMatch) title = titleMatch[1].replace(' - YouTube', '')
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

// ── Tier 2: local fetch + Readability ───────────────────────────────────────
async function extractViaReadability(url, { timeout = 10000, userAgent = DEFAULT_UA } = {}) {
  // JSDOM/Readability blow the call stack on PDF binaries — skip straight to Jina,
  // which can read PDFs. Prevents the whole run from hanging on a single PDF link.
  if (/\.pdf(\?|#|$)/i.test(url)) {
    return null
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  try {
    const headers = { 'User-Agent': userAgent }
    const cookie = cookieHeaderForUrl(url)
    if (cookie) headers.Cookie = cookie

    const response = await fetch(url, { signal: controller.signal, headers, redirect: 'follow' })
    clearTimeout(timeoutId)
    if (!response.ok) {
      console.warn(`[readability] ${url}: ${response.status} ${response.statusText}`)
      return null
    }
    const html = await response.text()
    const dom = new JSDOM(html, { url })
    const article = new Readability(dom.window.document).parse()
    if (!article || !article.textContent) return null
    return {
      title: article.title,
      byline: article.byline,
      content: article.textContent,
      excerpt: article.excerpt,
      siteName: article.siteName,
      length: article.length,
      publishedTime: article.publishedTime,
      extractedAt: new Date().toISOString(),
      method: cookie ? 'readability+cookies' : 'readability',
    }
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') console.warn(`[readability] timeout ${url}`)
    else console.warn(`[readability] error ${url}: ${error.message}`)
    return null
  }
}

// ── Tier 3: Jina Reader ─────────────────────────────────────────────────────
function parseJinaResponse(text) {
  // Jina returns: "Title: ...\nURL Source: ...\n[Warning: ...]\nMarkdown Content:\n<body>"
  let title = ''
  const titleMatch = text.match(/^Title:\s*(.+)$/m)
  if (titleMatch) title = titleMatch[1].trim()
  const idx = text.indexOf('Markdown Content:')
  const body = idx !== -1 ? text.slice(idx + 'Markdown Content:'.length).trim() : text.trim()
  return { title, body }
}

async function extractViaJina(url, { timeout = 40000 } = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  try {
    const headers = { 'User-Agent': DEFAULT_UA }
    // Optional: a free Jina API key raises rate limits and quality.
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`
    const response = await fetch(JINA_BASE + url, { signal: controller.signal, headers })
    clearTimeout(timeoutId)
    if (!response.ok) {
      console.warn(`[jina] ${url}: ${response.status}`)
      return null
    }
    const text = await response.text()
    const { title, body } = parseJinaResponse(text)
    if (!body || body.length < 1) return null
    // Jina emits a "Warning: ... CAPTCHA / 403" banner when it actually failed.
    if (/Warning:.*(CAPTCHA|403|requiring)/i.test(text) && body.length < MIN_GOOD_LENGTH) return null
    return {
      title,
      byline: null,
      content: body,
      excerpt: body.substring(0, 200),
      siteName: null,
      length: body.length,
      publishedTime: null,
      extractedAt: new Date().toISOString(),
      method: 'jina',
    }
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') console.warn(`[jina] timeout ${url}`)
    else console.warn(`[jina] error ${url}: ${error.message}`)
    return null
  }
}

// ── Tier 4: Wayback Machine (dead links / defunct sites) ────────────────────
async function extractViaWayback(url, { timeout = 30000 } = {}) {
  try {
    const availController = new AbortController()
    const at = setTimeout(() => availController.abort(), 15000)
    const availResp = await fetch(WAYBACK_AVAILABLE + encodeURIComponent(url), {
      signal: availController.signal, headers: { 'User-Agent': DEFAULT_UA },
    })
    clearTimeout(at)
    if (!availResp.ok) return null
    const avail = await availResp.json()
    const snapshot = avail?.archived_snapshots?.closest
    if (!snapshot || !snapshot.available || !snapshot.url) return null

    // Snapshot HTML includes the original page; Readability strips the Wayback toolbar.
    const snapUrl = snapshot.url.replace(/^http:/, 'https:')
    const result = await extractViaReadability(snapUrl, { timeout })
    if (result && result.length >= 1) {
      return { ...result, method: 'wayback', wayback_timestamp: snapshot.timestamp, original_url: url }
    }
    return null
  } catch (error) {
    console.warn(`[wayback] error ${url}: ${error.message}`)
    return null
  }
}

/**
 * Extract readable content from a URL, escalating through fallback tiers until
 * one returns content of at least MIN_GOOD_LENGTH characters.
 * @param {string} url
 * @param {object} options
 * @param {number} [options.timeout] - per-request timeout for tier 2 (default 10000)
 * @param {string} [options.userAgent]
 * @param {boolean} [options.disableFallbacks] - only run tier 1/2 (no Jina/Wayback)
 * @returns {Promise<object|null>} best extraction (with .method/.length) or null
 */
export async function extractContent(url, options = {}) {
  const { disableFallbacks = false } = options
  let best = null
  const consider = (r) => { if (r && (!best || (r.length || 0) > (best.length || 0))) best = r }

  // Tier 1: YouTube transcript
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const t = await extractYoutubeTranscript(url)
    if (t && t.length >= MIN_GOOD_LENGTH) return t
    consider(t)
  }

  // Tier 2: local Readability (+ cookies)
  const readability = await extractViaReadability(url, options)
  if (readability && readability.length >= MIN_GOOD_LENGTH) return readability
  consider(readability)

  if (disableFallbacks) return best

  // Tier 3: Jina Reader
  const jina = await extractViaJina(url)
  if (jina && jina.length >= MIN_GOOD_LENGTH) return jina
  consider(jina)

  // Tier 4: Wayback Machine
  const wayback = await extractViaWayback(url)
  if (wayback && wayback.length >= MIN_GOOD_LENGTH) return wayback
  consider(wayback)

  // Return the best (possibly thin) result we managed, or null.
  return best
}

/**
 * Extract content with exponential backoff retry
 */
export async function extractContentWithRetry(url, options = {}) {
  const { maxRetries = 2, initialDelay = 1000, ...extractOptions } = options

  let lastError = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = initialDelay * Math.pow(2, attempt - 1)
      console.log(`Retrying ${url} (attempt ${attempt + 1}/${maxRetries + 1}) after ${delay}ms`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    try {
      const result = await extractContent(url, extractOptions)
      if (result) return result
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
 */
export async function extractBatch(urls, options = {}) {
  const { concurrency = 3, delayBetweenBatches = 1000, ...extractOptions } = options
  const results = []
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    console.log(`Processing batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(urls.length / concurrency)}`)
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const content = await extractContentWithRetry(url, extractOptions)
        return { url, content, success: !!content }
      }),
    )
    results.push(...batchResults)
    if (i + concurrency < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches))
    }
  }
  return results
}
