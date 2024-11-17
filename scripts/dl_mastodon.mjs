import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import { generateScrapId } from '../helpers.js';
import { generateScreenshot } from './generateScreenshot.mjs';

dotenv.config();

const MASTODON_API_URL = "https://mastodon.social/api/v1/";
const USERNAME = "ejfox";
const ACCESS_TOKEN = process.env.MASTODON_TOKEN;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const limiter = new Bottleneck({
  minTime: 333,
  maxConcurrent: 1,
});

const axiosInstance = axios.create({
  baseURL: MASTODON_API_URL,
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
  },
  timeout: 10000,
});

// Fetch with retry logic
const fetchWithRetry = async (url, params = {}, retries = MAX_RETRIES) => {
  try {
    const response = await axiosInstance.get(url, { params });
    return response.data;
  } catch (error) {
    if (retries > 0 && error.response?.status >= 500) {
      console.warn(`Request failed, retrying... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return fetchWithRetry(url, params, retries - 1);
    }
    throw error;
  }
};

// Get user ID from username
export const fetchUserId = async () => {
  const data = await fetchWithRetry("accounts/search", {
    q: USERNAME,
    resolve: true,
  });
  const user = data.find(user => user.username === USERNAME);
  return user?.id;
};

// Process individual status
export async function processStatus(status) {
  // Extract media attachments
  const images = status.media_attachments
    .filter(a => a.type === "image")
    .map(a => ({
      url: a.url,
      preview_url: a.preview_url,
      description: a.description
    }));

  const shortId = generateScrapId('mastodon', status.id).substring(0, 8);
  
  // Generate screenshot if no media attachments
  const screenshot_url = images[0]?.url || (status.url ? 
    await generateScreenshot({
      source: 'mastodon',
      shortId,
      url: status.url
    }) : null);

  // Extract first paragraph as title, fallback to truncated content
  const title = status.content
    .split('\n')[0]
    .replace(/<[^>]*>/g, '')
    .slice(0, 100);

  // Clean HTML from content
  const cleanContent = status.content.replace(/<[^>]*>/g, '');

  return {
    id: generateScrapId('mastodon', status.id),
    source: "mastodon",
    type: "status",
    url: status.url,
    title,
    content: cleanContent,
    screenshot_url,
    published_at: status.created_at,
    created_at: status.created_at,
    updated_at: status.edited_at || status.created_at,
    shared: status.visibility === "public",
    tags: [
      ...status.tags.map(tag => tag.name),
      ...(status.language ? [`lang:${status.language}`] : [])
    ],
    metadata: {
      visibility: status.visibility,
      favourites_count: status.favourites_count,
      reblogs_count: status.reblogs_count,
      replies_count: status.replies_count,
      language: status.language,
      application: status.application?.name,
      mentions: status.mentions.map(m => ({
        username: m.username,
        url: m.url
      })),
      images,
      sensitive: status.sensitive,
      spoiler_text: status.spoiler_text || null
    }
  };
}

// Fetch all statuses
export const fetchStatuses = async (userId) => {
  let allStatuses = [];
  let maxId = null;
  const resultCount = 40;

  try {
    while (true) {
      const data = await limiter.schedule(() =>
        fetchWithRetry(`accounts/${userId}/statuses`, {
          limit: resultCount,
          max_id: maxId,
          exclude_reblogs: true
        })
      );

      if (!data.length) break;

      const processedStatuses = await Promise.all(
        data.map(status => processStatus(status))
      );
      
      allStatuses = allStatuses.concat(processedStatuses);
      maxId = data[data.length - 1].id;

      if (data.length < resultCount) break;
    }

    return allStatuses;
  } catch (error) {
    console.error("Error fetching statuses:", error);
    throw error;
  }
};

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const main = async () => {
    try {
      const userId = await fetchUserId();
      if (!userId) {
        throw new Error("User ID could not be found for the specified username.");
      }

      const statuses = await fetchStatuses(userId);
      console.log(`Fetched ${statuses.length} statuses`);
    } catch (error) {
      console.error("An error occurred:", error.message);
      process.exit(1);
    }
  };

  main();
}
