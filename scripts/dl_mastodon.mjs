import axios from "axios";
import dotenv from "dotenv";
import { generateScrapId } from '../helpers.js';
import { processImagesForScrap } from './imageEmbedding.mjs';
import { createRestAPIClient } from 'masto';
import sanitizeHtml from 'sanitize-html';
import winston from 'winston';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const MASTODON_API_URL = process.env.MASTODON_API_URL;
const MASTODON_ACCESS_TOKEN = process.env.MASTODON_ACCESS_TOKEN;

if (!MASTODON_API_URL || !MASTODON_ACCESS_TOKEN) {
  console.error("MASTODON_API_URL and MASTODON_ACCESS_TOKEN must be set");
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

// Add logger setup at the top after imports
const logger = winston.createLogger({
  level: process.env.DEBUG === "true" ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

// Make this function available for validation
export async function fetchUserId() {
  try {
    const response = await axios.get(`${MASTODON_API_URL}/api/v1/accounts/verify_credentials`, {
      headers: {
        Authorization: `Bearer ${MASTODON_ACCESS_TOKEN}`
      }
    });
    return response.data.id;
  } catch (error) {
    console.error("Error fetching user ID:", error.message);
    throw error;
  }
}

export async function fetchStatuses(userId, testMode = false) {
  try {
    const response = await axios.get(
      `${MASTODON_API_URL}/api/v1/accounts/${userId}/statuses`,
      {
        headers: {
          Authorization: `Bearer ${MASTODON_ACCESS_TOKEN}`
        },
        params: {
          limit: testMode ? 5 : 40,
          exclude_reblogs: true,
          exclude_replies: false
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching statuses:", error.message);
    return [];
  }
}

// Add this function to check for duplicates
async function checkExistingStatus(statusId) {
  const { data, error } = await supabase
    .from('scraps')
    .select('*')
    .eq('scrap_id', `mastodon-${statusId}`)
    .limit(1);

  if (error) {
    logger.error('Error checking for existing status:', error);
    return null;
  }

  return data?.[0];
}

// Add more thorough HTML sanitization options
const sanitizeOptions = {
  allowedTags: [], // Remove ALL HTML tags
  allowedAttributes: {}, // Remove ALL attributes
  textFilter: function(text) {
    return text
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .replace(/\n+/g, '\n') // Collapse multiple newlines
      .replace(/&nbsp;/g, ' ') // Replace &nbsp; with regular space
      .replace(/&#x200B;/g, '') // Remove zero-width spaces
      .replace(/[""]/g, '"') // Normalize quotes
      .replace(/['']/g, "'") // Normalize apostrophes
      .trim();
  }
};

// Add more detailed logging for status processing
export async function processStatus(status) {
  const scrapId = `mastodon-${status.id}`;

  try {
    // Try to claim the status
    const { data: claim } = await supabase
      .from('scraps')
      .update({
        processing_instance_id: INSTANCE_NAME,
        processing_started_at: new Date().toISOString()
      })
      .eq('scrap_id', scrapId)
      .is('processing_instance_id', null)
      .select()
      .single();

    if (!claim) {
      logger.info(`Skipping status ${status.id} - already being processed`);
      return null;
    }

    try {
      logger.info(`\n🔄 Processing Mastodon status: ${status.id}`);
      logger.debug('Raw status data:', {
        id: status.id,
        url: status.url,
        content: status.content?.substring(0, 100) + '...',
        raw_content_length: status.content?.length || 0
      });

      // Skip if no content
      if (!status.content) {
        logger.warn(`⚠️ Skipping status ${status.id} - no content`);
        return null;
      }

      // Check for existing first
      const existing = await checkExistingStatus(status.id);
      if (existing && !status.edited_at) {
        logger.info(`⏭️ Skipping unchanged status: ${status.id}`);
        return existing;
      }

      // Clean up HTML content - store raw HTML in metadata
      logger.info('Sanitizing HTML content...');
      const cleanContent = sanitizeHtml(status.content, sanitizeOptions);
      
      // Skip if sanitized content is empty
      if (!cleanContent.trim()) {
        logger.warn(`⚠️ Skipping status ${status.id} - empty after sanitization`);
        return null;
      }

      logger.debug('Sanitized content:', cleanContent.substring(0, 100) + '...');

      // Ensure we have a URL
      const url = status.url || `https://mastodon.social/@${status.account.username}/${status.id}`;
      if (!url) {
        logger.error(`❌ No URL available for status ${status.id}`);
        return null;
      }

      // Convert Mastodon date strings to ISO format
      logger.info('Processing dates...');
      const published_at = new Date(status.created_at).toISOString();
      const created_at = new Date(status.created_at).toISOString();
      const updated_at = status.edited_at 
        ? new Date(status.edited_at).toISOString() 
        : created_at;
      
      logger.debug('Dates:', { published_at, created_at, updated_at });

      // Create scrap object with clean content
      logger.info('Building scrap object...');
      const scrap = {
        id: generateScrapId('mastodon', status.id),
        source: 'mastodon',
        type: 'status',
        url,
        title: cleanContent.substring(0, 100) + (cleanContent.length > 100 ? '...' : ''),
        content: cleanContent,
        published_at,
        created_at,
        updated_at,
        shared: true,
        tags: [
          ...(status.tags?.map(tag => tag.name.toLowerCase()) || []),
          status.visibility
        ].filter(Boolean),
        metadata: {
          id: status.id,
          visibility: status.visibility,
          sensitive: status.sensitive,
          language: status.language,
          replies_count: status.repliesCount,
          reblogs_count: status.reblogsCount,
          favourites_count: status.favouritesCount,
          media_attachments: status.mediaAttachments?.map(media => ({
            type: media.type,
            url: media.url,
            preview_url: media.previewUrl,
            description: media.description
          })) || [],
          mentions: status.mentions?.map(mention => ({
            id: mention.id,
            username: mention.username,
            url: mention.url
          })) || [],
          raw_html_content: status.content,
          original_created_at: status.created_at,
          original_edited_at: status.edited_at
        }
      };

      logger.debug('Created scrap:', {
        id: scrap.id,
        url: scrap.url,
        dates: {
          published_at: scrap.published_at,
          created_at: scrap.created_at,
          updated_at: scrap.updated_at
        },
        tags: scrap.tags,
        media: scrap.metadata.media_attachments.length
      });

      // Process images if present
      if (status.mediaAttachments?.length > 0) {
        logger.info(`Processing ${status.mediaAttachments.length} media attachments...`);
        return await processImagesForScrap(scrap);
      }

      logger.info(`✅ Successfully processed status: ${status.id}`);
      return scrap;
    } finally {
      // Release claim
      await supabase
        .from('scraps')
        .update({
          processing_instance_id: null,
          processing_started_at: null
        })
        .eq('scrap_id', scrapId);
    }
  } catch (error) {
    logger.error(`Error processing status ${status.id}:`, error);
    // Release claim on error
    await supabase
      .from('scraps')
      .update({
        processing_instance_id: null,
        processing_started_at: null
      })
      .eq('scrap_id', scrapId);
    throw error;
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const userId = await fetchUserId();
  console.log(`User ID: ${userId}`);
  
  const statuses = await fetchStatuses(userId);
  console.log(`Fetched ${statuses.length} statuses`);
  
  const processed = await Promise.all(statuses.map(processStatus));
  console.log(`Processed ${processed.filter(Boolean).length} valid statuses`);
}
