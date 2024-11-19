import axios from "axios";
import dotenv from "dotenv";
import { generateScrapId } from '../helpers.js';
import { processImagesForScrap } from './imageEmbedding.mjs';
import { createRestAPIClient } from 'masto';
import sanitizeHtml from 'sanitize-html';
import winston from 'winston';
import { supabase } from './supabase.mjs';

dotenv.config();

const MASTODON_API_URL = process.env.MASTODON_API_URL;
const MASTODON_ACCESS_TOKEN = process.env.MASTODON_ACCESS_TOKEN;

if (!MASTODON_API_URL || !MASTODON_ACCESS_TOKEN) {
  console.error("MASTODON_API_URL and MASTODON_ACCESS_TOKEN must be set");
  process.exit(1);
}

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

// Update processStatus to handle duplicates
export async function processStatus(status) {
  try {
    // Check for existing first
    const existing = await checkExistingStatus(status.id);
    if (existing && !status.edited_at) {
      logger.info(`Skipping unchanged status: ${status.id}`);
      return existing;
    }

    // Clean up HTML content
    const cleanContent = sanitizeHtml(status.content, {
      allowedTags: [], // Remove all HTML tags
      allowedAttributes: {}, // Remove all attributes
      textFilter: function(text) {
        return text
          .replace(/\s+/g, ' ') // Collapse multiple spaces
          .replace(/\n+/g, '\n') // Collapse multiple newlines
          .trim();
      }
    });

    // Create scrap object with clean content
    const scrap = {
      id: generateScrapId('mastodon', status.id),
      source: 'mastodon',
      type: 'status',
      url: status.url,
      title: cleanContent.substring(0, 100) + (cleanContent.length > 100 ? '...' : ''),
      content: cleanContent,
      published_at: status.createdAt,
      created_at: status.createdAt,
      updated_at: status.editedAt || status.createdAt,
      shared: true,
      tags: [
        ...status.tags.map(tag => tag.name.toLowerCase()),
        status.visibility
      ],
      metadata: {
        id: status.id,
        visibility: status.visibility,
        sensitive: status.sensitive,
        language: status.language,
        replies_count: status.repliesCount,
        reblogs_count: status.reblogsCount,
        favourites_count: status.favouritesCount,
        media_attachments: status.mediaAttachments.map(media => ({
          type: media.type,
          url: media.url,
          preview_url: media.previewUrl,
          description: media.description
        })),
        mentions: status.mentions.map(mention => ({
          id: mention.id,
          username: mention.username,
          url: mention.url
        })),
        raw_content: status.content // Keep original HTML content if needed
      }
    };

    // Process images if present
    if (status.mediaAttachments.length > 0) {
      return await processImagesForScrap(scrap);
    }

    return scrap;
  } catch (error) {
    logger.error('Error processing status:', error);
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
