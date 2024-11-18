import axios from "axios";
import dotenv from "dotenv";
import { generateScrapId } from '../helpers.js';
import { processImagesForScrap } from './imageEmbedding.mjs';

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

export async function processStatus(status) {
  if (!status || !status.id) {
    console.error('Invalid status:', status);
    return null;
  }

  try {
    // Extract media attachments
    const images = status.media_attachments
      .filter(a => a.type === "image")
      .map(a => ({
        url: a.url,
        preview_url: a.preview_url,
        description: a.description
      }));

    // Get best available URL
    const url = status.url || `${MASTODON_API_URL}/@${status.account.username}/${status.id}`;

    // Get best available screenshot
    const screenshot_url = images[0]?.url || null;

    // Add image processing
    const processedStatus = await processImagesForScrap({
      id: generateScrapId('mastodon', status.id),
      source: "mastodon",
      type: "status",
      url,
      title: status.spoiler_text || status.content.substring(0, 100),
      content: status.content,
      screenshot_url,
      published_at: status.created_at,
      created_at: status.created_at,
      updated_at: status.edited_at || status.created_at,
      shared: false,  // Default to false
      tags: [
        ...status.tags.map(t => t.name),
        status.visibility,
        status.language
      ].filter(Boolean),
      metadata: {
        visibility: status.visibility,
        language: status.language,
        replies_count: status.replies_count,
        reblogs_count: status.reblogs_count,
        favourites_count: status.favourites_count,
        media_attachments: status.media_attachments,
        mentions: status.mentions,
        account: {
          username: status.account.username,
          display_name: status.account.display_name,
          url: status.account.url
        }
      }
    });

    return processedStatus;
  } catch (error) {
    console.error(`Error processing status ${status?.id}:`, error);
    return null;
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
