import puppeteerCore from 'puppeteer-core'
import { addExtra } from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import dotenv from 'dotenv'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import winston from 'winston'
import { v2 as cloudinary } from 'cloudinary'
import { getCookiesForUrl, isSocialUrl } from '../lib/captureDomains.mjs'

dotenv.config()

// puppeteer-extra wraps puppeteer-core (the default `puppeteer-extra` import
// expects full puppeteer, which isn't installed). Stealth plugin replaces the
// old hand-rolled navigator.webdriver spoofing with a maintained evasion suite.
const puppeteer = addExtra(puppeteerCore)
puppeteer.use(StealthPlugin())

// Check if Cloudinary is configured
const isCloudinaryConfigured = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
)

// Configure Cloudinary only if credentials are available
if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  })
}

/**
 * Check if a screenshot already exists in Cloudinary for this scrap.
 * Returns the existing URL if found, null otherwise.
 */
export async function checkExistingScreenshot(scrapId) {
  if (!isCloudinaryConfigured || !scrapId) return null

  const publicId = `scrapbook/screenshots/${scrapId}`

  try {
    const result = await cloudinary.api.resource(publicId, { resource_type: 'image' })
    if (result?.secure_url) {
      return { url: result.secure_url, public_id: result.public_id, existing: true }
    }
  } catch (error) {
    // 404 means doesn't exist - that's fine
    if (error?.error?.http_code !== 404) {
      // Log unexpected errors but don't fail
      console.warn(`Cloudinary check failed for ${scrapId}:`, error?.error?.message || error.message)
    }
  }
  return null
}

// Create temp directory for screenshots if it doesn't exist
const TEMP_DIR = path.join(os.tmpdir(), 'scrapbook-screenshots')
async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true })
  } catch (error) {
    logger.error('Failed to create temp directory:', error)
  }
}

// Cleanup temp files older than 1 hour
export async function cleanupTempFiles() {
  try {
    const files = await fs.readdir(TEMP_DIR)
    const now = Date.now()
    const ONE_HOUR = 60 * 60 * 1000

    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file)
      const stats = await fs.stat(filePath)

      if (now - stats.mtime.getTime() > ONE_HOUR) {
        try {
          await fs.unlink(filePath)
          logger.debug(`Cleaned up old temp file: ${file}`)
        } catch (error) {
          logger.error(`Failed to delete temp file ${file}:`, error)
        }
      }
    }
  } catch (error) {
    logger.error('Error during temp file cleanup:', error)
  }
}

// Helper function to upload to Cloudinary with timeout
// Uses scrap_id as public_id to prevent duplicates - same scrap = same file
async function uploadToCloudinary(buffer, scrapId, timeoutMs = 45000) {
  if (!isCloudinaryConfigured) {
    throw new Error('Cloudinary is not configured - screenshot upload skipped')
  }

  // Use scrap_id directly as public_id (e.g., "pinboard-90fa78eb14c2dbe56fa2fc1115b4327b")
  const publicId = scrapId || undefined

  return Promise.race([
    new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'scrapbook/screenshots',
          public_id: publicId,
          overwrite: true, // Replace existing screenshot for same scrap
          format: 'jpg',
          quality: 'auto:good',
        },
        (error, result) => {
          if (error) reject(error)
          else resolve(result)
        },
      )

      uploadStream.end(buffer)
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Cloudinary upload timeout')), timeoutMs),
    ),
  ])
}

// Pool of realistic user agents (recent Chrome versions)
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
]

// Get random user agent
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

// Enhanced logger
const logger = winston.createLogger({
  level: process.env.DEBUG === 'true' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`
    }),
  ),
  transports: [new winston.transports.Console()],
})

// Helper to get detailed error info from response
function getResponseError(response) {
  if (!response) return 'No response received'

  const status = response.status()
  const statusText = response.statusText()

  const errorMap = {
    401: 'Unauthorized - Site requires authentication',
    403: 'Forbidden - Site blocked our request',
    404: 'Page not found',
    429: 'Too many requests - We were rate limited',
    500: 'Server error on target site',
    503: 'Service unavailable - Site might be down',
  }

  return errorMap[status] || `HTTP ${status} - ${statusText}`
}

// Add Chrome path detection
const getChromePath = () => {
  if (process.env.CHROME_EXECUTABLE_PATH) {
    return process.env.CHROME_EXECUTABLE_PATH
  }

  // Default paths by platform
  switch (process.platform) {
  case 'darwin':
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  case 'linux':
    return '/usr/bin/chromium'
  default:
    throw new Error(`Unsupported platform: ${process.platform}`)
  }
}

// Post-render heuristic: inspect the settled DOM for blocker signals so we can
// refuse to store signup boxes / cookie walls / CAPTCHAs as if they were the
// page's content. Runs in the page context, returns cheap booleans + text size.
// Deliberately conservative — a wall is only asserted when the page is BOTH
// signal-positive AND text-poor, so real articles that merely mention "cookie"
// or link a login don't get flagged.
async function classifyRenderedPage(page) {
  try {
    return await page.evaluate(() => {
      const text = (document.body?.innerText || '').trim()
      const textLen = text.length
      const lower = text.toLowerCase()
      const has = (sel) => !!document.querySelector(sel)

      const hasCaptcha =
        has('iframe[src*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="challenge" i]') ||
        has('#challenge-form, #cf-challenge-running, .cf-browser-verification') ||
        /verify (you are|you’re) (a )?human|are you a robot|complete the (security )?check/.test(lower)

      const hasCookieWall =
        has('#onetrust-banner-sdk, #cookieConsent, .cookie-consent, .gdpr, [id*="cookie" i][class*="banner" i]') ||
        /we (use|value) (your )?cookies|accept (all )?cookies|manage (your )?(cookie )?preferences/.test(lower)

      const looksLoginWall =
        /(log in|sign in|sign up|create (an )?account) to (see|view|continue|read)|join (twitter|x|instagram|facebook)|see more on (instagram|facebook)|new to twitter/.test(lower)

      return { textLen, hasCaptcha, hasCookieWall, looksLoginWall }
    })
  } catch {
    // If evaluate fails (nav aborted, detached frame) treat as unknown, not blocked.
    return { textLen: 0, hasCaptcha: false, hasCookieWall: false, looksLoginWall: false }
  }
}

// Fold the raw signals + HTTP status into a capture verdict. Only asserts a
// blocking category when the page is ALSO text-poor (< ~200 visible chars),
// which is what keeps false positives (Cloudflare *docs*, articles about
// paywalls) out of the reject lane.
function verdictFrom(status, sig) {
  const textPoor = sig.textLen < 200
  if (status >= 400) {
    return { blocked: true, category: 'error_page' }
  }
  if (sig.hasCaptcha && textPoor) return { blocked: true, category: 'captcha' }
  if (sig.looksLoginWall && textPoor) return { blocked: true, category: 'login_wall' }
  if (sig.hasCookieWall && textPoor) return { blocked: true, category: 'cookie_wall' }
  if (textPoor) return { blocked: true, category: 'blank' }
  return { blocked: false, category: 'content' }
}

// Update the screenshot function with better cleanup
// scrapId is used as Cloudinary public_id to prevent duplicates.
// opts.force   -> bypass the "already exists" short-circuit (required for recapture)
// opts.headful -> launch with a visible browser (harder-to-detect for stubborn sites)
// Returns { url, public_id, capture_status, category, blocked }.
export async function generateScreenshot(url, scrapId = null, opts = {}) {
  const { force = false, headful = false } = opts
  if (!url || url === null || url === undefined || url === '') {
    logger.warn(`Skipping screenshot generation - invalid URL: ${url}`)
    return null
  }

  // Ensure url is a string and handle URL objects
  const urlString =
    typeof url === 'object' && url.href ? url.href : String(url)

  // Basic URL validation and normalization
  try {
    url = new URL(urlString).toString()
  } catch (error) {
    logger.warn(`Invalid URL format: ${urlString}`)
    throw new Error(`Invalid URL format: ${urlString}`)
  }

  // Check if screenshot already exists in Cloudinary (skip if so). Recapture
  // passes force:true to overwrite the stale image in the same public_id slot.
  if (scrapId && !force) {
    const existing = await checkExistingScreenshot(scrapId)
    if (existing) {
      logger.info(`Screenshot already exists for ${scrapId}, skipping generation`)
      return existing
    }
  }

  let browser
  let tempFilePath

  try {
    // Ensure temp directory exists
    await ensureTempDir()

    // Create a unique temp file name
    const tempFileName = `screenshot-${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}.jpg`
    tempFilePath = path.join(TEMP_DIR, tempFileName)

    browser = await puppeteer.launch({
      headless: headful ? false : 'new',
      executablePath: getChromePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    })

    const page = await browser.newPage()

    // Set random user agent (stealth plugin patches the rest of the fingerprint).
    await page.setUserAgent(getRandomUserAgent())

    // Set extra headers to look like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    })

    // Apply per-domain auth cookies (data/cookies.json) BEFORE navigating so
    // logged-in-only pages (X/Twitter/Instagram/Facebook, NYT) render real
    // content instead of a signup wall.
    const cookies = getCookiesForUrl(url)
    if (cookies.length) {
      try {
        await page.setCookie(...cookies)
        logger.info(`Applied ${cookies.length} auth cookie(s) for ${new URL(url).hostname}`)
      } catch (e) {
        logger.warn(`Failed to set cookies for ${url}: ${e.message}`)
      }
    }

    // Fixed viewport for CONSISTENT card aspect ratios (no more fullPage giants).
    // Social posts read best portrait; everything else gets a standard card.
    // deviceScaleFactor 2 => crisp @2x captures.
    const social = isSocialUrl(url)
    const viewport = social
      ? { width: 1080, height: 1350, deviceScaleFactor: 2 }
      : { width: 1200, height: 1500, deviceScaleFactor: 2 }
    await page.setViewport(viewport)
    await page.setDefaultNavigationTimeout(45000)

    // Navigate with retry. networkidle2 (was domcontentloaded) waits for the
    // page to settle so stylesheets/fonts have loaded — kills the unstyled
    // "giant CSS-less" renders. Capture the response so we can gate on status.
    let navigationError
    let response = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 45000,
        })
        navigationError = null
        break
      } catch (error) {
        navigationError = error
        logger.warn(`Navigation attempt ${attempt} failed: ${error.message}`)
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2s before retry
        }
      }
    }

    // If navigation failed after retries, throw the error
    if (navigationError) {
      throw navigationError
    }

    // Let webfonts settle (with a short cap) so text isn't captured mid-swap.
    await Promise.race([
      page.evaluate(() => document.fonts?.ready).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ])

    // Inspect the settled DOM: is this real content, or a wall/CAPTCHA/error?
    const status = response?.status?.() ?? 0
    const signals = await classifyRenderedPage(page)
    const verdict = verdictFrom(status, signals)

    // If it's a blocker page (and text-poor), DON'T store it as a screenshot —
    // return the verdict so the caller can route to a text path / skip vision.
    if (verdict.blocked) {
      logger.warn(`Capture blocked for ${scrapId || url}: ${verdict.category} (status ${status}, ${signals.textLen} chars) — not storing`)
      return { url: null, public_id: null, capture_status: status, category: verdict.category, blocked: true }
    }

    // Take the screenshot and save to temp file. fullPage:false + fixed viewport
    // => every card is the same shape; the above-the-fold hero is also the
    // highest-signal region for vision summarization.
    await page.screenshot({
      path: tempFilePath,
      type: 'jpeg',
      quality: 82,
      fullPage: false,
      captureBeyondViewport: false,
    })

    // Read the file and upload to Cloudinary if configured
    const screenshot = await fs.readFile(tempFilePath)

    if (!isCloudinaryConfigured) {
      logger.warn('Cloudinary not configured - screenshots will not be uploaded')
      return { url: null, localPath: tempFilePath }
    }

    try {
      const result = await uploadToCloudinary(screenshot, scrapId)
      logger.info(`Screenshot uploaded for ${scrapId || 'unknown'}: ${result.public_id}`)
      // Trigger temp file cleanup
      cleanupTempFiles().catch((error) =>
        logger.error('Background cleanup failed:', error),
      )
      return {
        url: result.secure_url,
        public_id: result.public_id,
        capture_status: status,
        category: verdict.category, // 'content'
        blocked: false,
      }
    } catch (error) {
      logger.error('Failed to upload screenshot to Cloudinary:', error)
      return { url: null, localPath: tempFilePath, capture_status: status, category: verdict.category }
    }
  } finally {
    // Cleanup resources
    if (browser) {
      try {
        await browser.close()
      } catch (error) {
        logger.error('Failed to close browser:', error)
        // Force kill if close doesn't work
        try {
          const process = browser.process()
          if (process && !process.killed) {
            process.kill('SIGKILL')
          }
        } catch (killError) {
          logger.error('Failed to kill browser process:', killError)
        }
      }
    }

    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath)
        logger.debug('Cleaned up temp screenshot file')
      } catch (error) {
        // ENOENT is expected when we bailed before writing (e.g. blocked page).
        if (error.code !== 'ENOENT') logger.error('Failed to cleanup temp file:', error)
      }
    }
  }
}

// Add cleanup on process exit
process.on('SIGTERM', async () => {
  try {
    await cleanupTempFiles()
  } catch (error) {
    logger.error('Error cleaning up on exit:', error)
  }
})

export async function handleArenaImage(scrap) {
  // Arena blocks have image data in their source_data
  if (!scrap.source_data?.image) {
    throw new Error('No image data in Arena block')
  }

  // Get the highest resolution image URL
  // Arena provides: large, display, square, thumb versions
  const imageUrl =
    scrap.source_data.image.large?.url ||
    scrap.source_data.image.display?.url ||
    scrap.source_data.image.original?.url

  if (!imageUrl) {
    throw new Error('No suitable image URL found in Arena block')
  }

  if (!isCloudinaryConfigured) {
    logger.warn('Cloudinary not configured - Arena image will not be uploaded')
    return { url: null, originalUrl: imageUrl }
  }

  try {
    // Upload directly to Cloudinary using the URL
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: 'scrapbook/arena',
      public_id: scrap.scrap_id,
      overwrite: true,
      format: 'jpg',
      quality: 'auto:good',
    })

    logger.info(`Arena image uploaded for ${scrap.scrap_id}: ${result.public_id}`)
    return { url: result.secure_url, public_id: result.public_id }
  } catch (error) {
    logger.error(`Failed to upload Arena image: ${error.message}`)
    return { url: null, originalUrl: imageUrl }
  }
}
