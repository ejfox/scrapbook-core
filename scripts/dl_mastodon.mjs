import axios from 'axios'
import dotenv from 'dotenv'
import { generateScrapId } from '../helpers.js'
import { processImagesForScrap } from './imageDescriptions.mjs'
import { createRestAPIClient } from 'masto'
import sanitizeHtml from 'sanitize-html'
import winston from 'winston'
import { createClient } from '@supabase/supabase-js'
import { INSTANCE_NAME } from '../helpers/instanceName.mjs'
import { generateScreenshot } from './generateScreenshot.mjs'

dotenv.config()

const MASTODON_API_URL = process.env.MASTODON_API_URL
const MASTODON_ACCESS_TOKEN = process.env.MASTODON_ACCESS_TOKEN

if (!MASTODON_API_URL || !MASTODON_ACCESS_TOKEN) {
  console.error('MASTODON_API_URL and MASTODON_ACCESS_TOKEN must be set')
  process.exit(1)
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' },
  },
)

// Add logger setup at the top after imports
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

// Make this function available for validation
export async function fetchUserId() {
  try {
    const response = await axios.get(
      `${MASTODON_API_URL}/api/v1/accounts/verify_credentials`,
      {
        headers: {
          Authorization: `Bearer ${MASTODON_ACCESS_TOKEN}`,
        },
      },
    )
    return response.data.id
  } catch (error) {
    console.error('Error fetching user ID:', error.message)
    throw error
  }
}

export async function fetchStatuses(userId, testMode = false) {
  try {
    const response = await axios.get(
      `${MASTODON_API_URL}/api/v1/accounts/${userId}/statuses`,
      {
        headers: {
          Authorization: `Bearer ${MASTODON_ACCESS_TOKEN}`,
        },
        params: {
          limit: testMode ? 5 : 40,
          exclude_reblogs: true,
          exclude_replies: false,
        },
      },
    )
    return response.data
  } catch (error) {
    console.error('Error fetching statuses:', error.message)
    return []
  }
}

// Add this function to check for duplicates
async function checkExistingStatus(statusId) {
  const { data, error } = await supabase
    .from('scraps')
    .select('*')
    .eq('scrap_id', `mastodon-${statusId}`)
    .limit(1)

  if (error) {
    logger.error('Error checking for existing status:', error)
    return null
  }

  return data?.[0]
}

// Add more thorough HTML sanitization options
const sanitizeOptions = {
  allowedTags: [], // Remove ALL HTML tags
  allowedAttributes: {}, // Remove ALL attributes
  textFilter: function (text) {
    return text
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .replace(/\n+/g, '\n') // Collapse multiple newlines
      .replace(/&nbsp;/g, ' ') // Replace &nbsp; with regular space
      .replace(/&#x200B;/g, '') // Remove zero-width spaces
      .replace(/[""]/g, '"') // Normalize quotes
      .replace(/['']/g, "'") // Normalize apostrophes
      .trim()
  },
}

// Add more detailed logging for status processing
export async function processStatus(status, isValidation = false) {
  const scrapId = `mastodon-${status.id}`

  try {
    // Skip claiming during validation
    if (!isValidation) {
      const { data: claim } = await supabase
        .from('scraps')
        .update({
          processing_instance_id: INSTANCE_NAME,
          processing_started_at: new Date().toISOString(),
        })
        .eq('scrap_id', scrapId)
        .is('processing_instance_id', null)
        .select()
        .single()

      if (!claim) {
        logger.info(`Skipping status ${status.id} - already being processed`)
        return null
      }
    }

    logger.info(`\n🔄 Processing Mastodon status: ${status.id}`)

    // Basic validation of required fields
    if (!status || !status.id) {
      logger.error('Invalid status object received')
      return null
    }

    // Clean up HTML content - store raw HTML in metadata
    const cleanContent = sanitizeHtml(status.content || '', sanitizeOptions)

    // More lenient content validation during validation mode
    if (!isValidation && !cleanContent.trim()) {
      logger.warn(`⚠️ Skipping status ${status.id} - empty after sanitization`)
      return null
    }

    // Ensure we have a URL - construct one if missing
    const url =
      status.url ||
      `${MASTODON_API_URL}/@${status.account?.username || 'unknown'}/${
        status.id
      }`

    // Convert Mastodon date strings to ISO format with fallbacks
    const now = new Date().toISOString()
    const published_at = status.created_at
      ? new Date(status.created_at).toISOString()
      : now
    const created_at = status.created_at
      ? new Date(status.created_at).toISOString()
      : now
    const updated_at = status.edited_at
      ? new Date(status.edited_at).toISOString()
      : created_at

    // Generate screenshot if URL is available
    let screenshot_url = null
    if (url) {
      try {
        screenshot_url = await generateScreenshot(url)
      } catch (error) {
        logger.warn(`Failed to generate screenshot for ${url}:`, error)
      }
    }

    // Create scrap object with more defensive programming
    const scrap = {
      scrap_id: scrapId,
      source: 'mastodon',
      type: 'status',
      url,
      title: cleanContent
        ? cleanContent.substring(0, 100) +
          (cleanContent.length > 100 ? '...' : '')
        : `Mastodon Status ${status.id}`,
      content: cleanContent || `Empty status ${status.id}`,
      screenshot_url,
      published_at,
      created_at,
      updated_at,
      shared: false,
      tags: [
        ...(status.tags
          ?.map((tag) => tag.name?.toLowerCase())
          ?.filter(Boolean) || []),
        status.visibility,
      ].filter(Boolean),
      metadata: {
        id: status.id,
        visibility: status.visibility || 'unknown',
        sensitive: !!status.sensitive,
        language: status.language || 'unknown',
        replies_count: status.repliesCount || 0,
        reblogs_count: status.reblogsCount || 0,
        favourites_count: status.favouritesCount || 0,
        media_attachments:
          status.mediaAttachments?.map((media) => ({
            type: media.type || 'unknown',
            url: media.url,
            preview_url: media.previewUrl,
            description: media.description,
          })) || [],
        mentions:
          status.mentions?.map((mention) => ({
            id: mention.id,
            username: mention.username,
            url: mention.url,
          })) || [],
        raw_html_content: status.content || '',
        original_created_at: status.created_at,
        original_edited_at: status.edited_at,
      },
    }

    // Process images if present and not in validation mode
    if (!isValidation && status.mediaAttachments?.length > 0) {
      logger.info(
        `Processing ${status.mediaAttachments.length} media attachments...`,
      )
      return await processImagesForScrap(scrap)
    }

    logger.info(`✅ Successfully processed status: ${status.id}`)
    return scrap
  } catch (error) {
    logger.error(`Error processing status ${status.id}:`, error)

    // Only handle claims if not in validation mode
    if (!isValidation) {
      await supabase
        .from('scraps')
        .update({
          processing_instance_id: null,
          processing_started_at: null,
        })
        .eq('scrap_id', scrapId)
    }

    // During validation, we want to see the error
    if (isValidation) {
      throw error
    }

    return null
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const userId = await fetchUserId()
  console.log(`User ID: ${userId}`)

  const statuses = await fetchStatuses(userId)
  console.log(`Fetched ${statuses.length} statuses`)

  const processed = await Promise.all(statuses.map(processStatus))
  console.log(`Processed ${processed.filter(Boolean).length} valid statuses`)
}
