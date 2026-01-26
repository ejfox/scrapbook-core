import puppeteer from 'puppeteer-core'
import dotenv from 'dotenv'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import winston from 'winston'
import { v2 as cloudinary } from 'cloudinary'

dotenv.config()

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
      setTimeout(() => reject(new Error('Cloudinary upload timeout')), timeoutMs)
    )
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

// Add browser lifecycle management
let browserWSEndpoint = null

// Enhanced browser launcher with better error checking
async function getBrowserLauncher() {
  try {
    // Production configuration for Fly.io
    if (process.env.NODE_ENV === 'production') {
      return {
        executablePath: '/usr/bin/chromium',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-dev-shm-usage', // Important for Docker/Fly.io
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote', // Recommended for running in containers
          '--single-process', // Recommended for containerized environments
          '--disable-extensions',
          '--window-size=1080,1920',
        ],
        headless: 'new',
        defaultViewport: {
          width: 1080,
          height: 1920,
          deviceScaleFactor: 2,
        },
      }
    }

    // Development configuration
    if (os.platform() === 'darwin') {
      return {
        executablePath:
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--no-sandbox', '--disable-gpu'],
        headless: 'new',
      }
    }

    throw new Error(`Unsupported platform: ${os.platform()}`)
  } catch (error) {
    logger.error('Browser launcher error:', error)
    throw error
  }
}

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

// Add retry logic
async function takeScreenshotWithRetry(page, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 85,
        fullPage: false,
        captureBeyondViewport: false,
      })
      return screenshotBuffer
    } catch (error) {
      logger.warn(`Screenshot attempt ${i + 1} failed: ${error.message}`)
      if (i === retries - 1) throw error
      await page.waitForTimeout(1000)
    }
  }
}

// Update the screenshot function with better cleanup
// scrapId is used as Cloudinary public_id to prevent duplicates
export async function generateScreenshot(url, scrapId = null) {
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

  // Check if screenshot already exists in Cloudinary (skip if so)
  if (scrapId) {
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
      headless: 'new',
      executablePath: getChromePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled', // Hide automation
      ],
    })

    const page = await browser.newPage()

    // Set random user agent
    const userAgent = getRandomUserAgent()
    await page.setUserAgent(userAgent)

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

    // Hide webdriver and automation properties
    await page.evaluateOnNewDocument(() => {
      // Override navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      })

      // Mock plugins to look like real browser
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      })

      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      })

      // Add realistic chrome properties
      window.chrome = {
        runtime: {},
      }
    })

    await page.setViewport({ width: 1080, height: 1920 })

    // Increase timeout to 60s for slow sites
    await page.setDefaultNavigationTimeout(60000)

    // Navigate with retry logic
    let navigationError
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
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

    // Brief wait for critical content
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Take the screenshot and save to temp file
    await page.screenshot({
      path: tempFilePath,
      type: 'jpeg',
      quality: 80,
      fullPage: true,
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
      return { url: result.secure_url, public_id: result.public_id }
    } catch (error) {
      logger.error('Failed to upload screenshot to Cloudinary:', error)
      return { url: null, localPath: tempFilePath }
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
        logger.error('Failed to cleanup temp file:', error)
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
