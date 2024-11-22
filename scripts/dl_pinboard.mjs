import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import fs from 'fs/promises';
import path from 'path';
import { generateScrapId } from '../helpers.js';
import { extractLocation } from './aiGeolocation.mjs';
import { generateScreenshot } from './generateScreenshot.mjs';
import winston from "winston";
import { createClient } from "@supabase/supabase-js";
import { getImageEmbedding } from './imageEmbedding.mjs';
import OpenAI from 'openai';

dotenv.config();

// Constants
const DEBUG = process.env.DEBUG === "true";
const CACHE_DIR = './data';
const CACHE_FILE = path.join(CACHE_DIR, 'pinboard_cache.json');
const CACHE_META_FILE = path.join(CACHE_DIR, 'pinboard_cache_meta.json');

// Validate environment
const apiToken = process.env.PINBOARD_TOKEN;
if (!apiToken) {
  console.error("PINBOARD_TOKEN is not set in environment variables");
  process.exit(1);
}

// Initialize clients
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

// Rate limiters
const limiters = {
  allPosts: new Bottleneck({
    minTime: 300000, // 5 minutes for posts/all
    maxConcurrent: 1
  }),
  recentPosts: new Bottleneck({
    minTime: 60000, // 1 minute for posts/recent
    maxConcurrent: 1
  }),
  standard: new Bottleneck({
    minTime: 3000, // 3 seconds for other endpoints
    maxConcurrent: 1
  }),
  ai: new Bottleneck({
    minTime: 1000,
    maxConcurrent: 1
  })
};

// Logger setup
const logger = winston.createLogger({
  level: DEBUG ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

// Cache management
const cache = {
  async ensureDir() {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  },

  async read() {
    try {
      await this.ensureDir();
      const data = await fs.readFile(CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  },

  async write(bookmarks) {
    await this.ensureDir();
    await fs.writeFile(CACHE_FILE, JSON.stringify(bookmarks, null, 2));
  },

  async readMeta() {
    try {
      const data = await fs.readFile(CACHE_META_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return { lastUpdate: null };
    }
  },

  async writeMeta(meta) {
    await this.ensureDir();
    await fs.writeFile(CACHE_META_FILE, JSON.stringify(meta, null, 2));
  }
};

// Pinboard API helpers
async function checkForUpdates() {
  try {
    const response = await limiters.standard.schedule(() =>
      axios.get("https://api.pinboard.in/v1/posts/update", {
        params: { auth_token: apiToken, format: "json" }
      })
    );
    return response.data.update_time;
  } catch (error) {
    logger.error("Error checking for updates:", error);
    throw error;
  }
}

async function fetchRecentBookmarks(count = 5) {
  try {
    const response = await limiters.recentPosts.schedule(() =>
      axios.get("https://api.pinboard.in/v1/posts/recent", {
        params: { auth_token: apiToken, format: "json", count }
      })
    );
    return response.data.posts;
  } catch (error) {
    logger.error("Error fetching recent bookmarks:", error);
    return [];
  }
}

// Add this helper function to compare bookmark content
function contentChanged(bookmark, existingData) {
  // Helper to normalize and sort tags
  const normalizeTags = (tags) => {
    return Array.isArray(tags) 
      ? tags.sort().join(',')
      : tags.split(/[\s,]+/).filter(Boolean).sort().join(',');
  };

  // Helper to normalize dates - convert to UTC and compare only date parts
  const normalizeDate = (dateStr) => {
    const date = new Date(dateStr);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      day: date.getUTCDate()
    };
  };

  // Helper to normalize content by trimming whitespace
  const normalizeContent = (str) => str?.trim().replace(/\s+/g, ' ') || '';

  // Get bookmark content using same fallback logic as processBookmark
  const bookmarkContent = bookmark.extended || bookmark.description;

  // Prepare normalized values
  const normalized = {
    old: {
      title: normalizeContent(existingData.title),
      content: normalizeContent(existingData.content),
      shared: existingData.shared ? "yes" : "no",
      tags: normalizeTags(existingData.tags || []),
      date: normalizeDate(existingData.published_at)
    },
    new: {
      title: normalizeContent(bookmark.description),
      content: normalizeContent(bookmarkContent), // Use fallback content
      shared: bookmark.shared,
      tags: normalizeTags(bookmark.tags),
      date: normalizeDate(bookmark.time)
    }
  };

  // Debug log the normalized values before comparison
  logger.debug('Normalized values for comparison:');
  logger.debug('Old:', normalized.old);
  logger.debug('New:', normalized.new);

  // Check each field and log differences
  const changes = [];
  
  if (normalized.old.title !== normalized.new.title) {
    changes.push({
      field: 'title',
      old: normalized.old.title,
      new: normalized.new.title
    });
  }
  
  if (normalized.old.content !== normalized.new.content) {
    changes.push({
      field: 'content',
      old: normalized.old.content,
      new: normalized.new.content
    });
  }
  
  if (normalized.old.shared !== normalized.new.shared) {
    changes.push({
      field: 'shared',
      old: normalized.old.shared,
      new: normalized.new.shared
    });
  }
  
  if (normalized.old.tags !== normalized.new.tags) {
    changes.push({
      field: 'tags',
      old: normalized.old.tags,
      new: normalized.new.tags
    });
  }
  
  const oldDate = normalized.old.date;
  const newDate = normalized.new.date;
  
  if (oldDate.year !== newDate.year || 
      oldDate.month !== newDate.month || 
      oldDate.day !== newDate.day) {
    changes.push({
      field: 'date',
      old: new Date(existingData.published_at).toISOString(),
      new: new Date(bookmark.time).toISOString()
    });
  }

  if (changes.length > 0) {
    logger.info(`\nContent changes detected for ${bookmark.href}:`);
    changes.forEach(change => {
      logger.info(`\n${change.field} changed:`);
      logger.info(`  Old: "${change.old}"`);
      logger.info(`  New: "${change.new}"`);
    });
  }

  return changes.length > 0;
}

// Enhanced shouldProcessBookmark function
async function shouldProcessBookmark(bookmark, existingData) {
  const scrap_id = `pinboard:${bookmark.hash}`;
  
  // If we don't have existingData, try to fetch it from the database
  if (!existingData) {
    const { data: fromDb } = await supabase
      .from("scraps")
      .select("*")
      .eq("scrap_id", scrap_id)
      .single();
      
    if (fromDb) {
      existingData = fromDb;
    }
  }

  // If still no existing data, we should process it
  if (!existingData) {
    logger.debug(`No existing data found for ${bookmark.href}, will process`);
    return { shouldProcess: true, reason: 'new_bookmark' };
  }

  // Check if content has changed
  if (contentChanged(bookmark, existingData)) {
    return { shouldProcess: true, reason: 'content_changed' };
  }

  // Check metadata for processing flags
  if (existingData.metadata?.force_reprocess) {
    return { shouldProcess: true, reason: 'force_reprocess' };
  }

  // Check last_checked timestamp
  const lastChecked = existingData.metadata?.last_checked;
  if (!lastChecked) {
    return { shouldProcess: true, reason: 'never_checked' };
  }

  const hoursSinceLastCheck = (Date.now() - new Date(lastChecked).getTime()) / (1000 * 60 * 60);
  
  // If we've checked it recently, skip it
  if (hoursSinceLastCheck < 24) {
    logger.debug(`Skipping recently processed bookmark: ${bookmark.href}`);
    return { shouldProcess: false, reason: 'recently_checked' };
  }

  // Check if screenshot is missing
  if (!existingData.screenshot_url) {
    return { shouldProcess: true, reason: 'missing_screenshot' };
  }

  // Check if we're missing any critical fields
  const criticalFields = ['title', 'content', 'url', 'published_at'];
  const missingFields = criticalFields.filter(field => !existingData[field]);
  if (missingFields.length > 0) {
    return { shouldProcess: true, reason: 'missing_fields' };
  }

  return { shouldProcess: false, reason: 'no_changes' };
}

// Main processing function
export async function processBookmark(bookmark) {
  const scrapId = `pinboard-${bookmark.hash}`;

  try {
    // Try to claim the bookmark
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
      logger.info(`Skipping bookmark ${bookmark.href} - already being processed`);
      return null;
    }

    try {
      logger.info(`🔄 Processing bookmark: ${bookmark.href.substring(0, 50)}...`);

      // Generate all the data we need first
      const content = bookmark.extended || bookmark.description;
      
      const [screenshot_url, locationData] = await Promise.all([
        // Generate screenshot if we don't have one or if it's explicitly needed
        (!existing?.screenshot_url || reason === 'new_bookmark' || reason === 'missing_screenshot') 
          ? generateScreenshot({
              source: 'pinboard',
              shortId: bookmark.hash,
              url: bookmark.href
            })
          : Promise.resolve(existing?.screenshot_url),
        
        // Extract location
        extractLocation(content, { url: bookmark.href })
      ]);

      // And update the logging to be more verbose about screenshot generation
      if (!existing?.screenshot_url) {
        logger.info('No existing screenshot, will generate one');
      } else if (reason === 'new_bookmark' || reason === 'missing_screenshot') {
        logger.info('Regenerating screenshot due to reason:', reason);
      } else {
        logger.info('Using existing screenshot:', existing.screenshot_url);
      }

      // Generate embeddings if needed
      let embedding = existing?.embedding;
      let image_embedding = existing?.image_embedding;

      if (!embedding) {
        logger.info('Generating OpenAI embedding...');
        embedding = await generateEmbedding(content);
      }

      // Only generate image embedding if we have a screenshot
      if (screenshot_url && !image_embedding) {
        logger.info('Generating image embedding...');
        image_embedding = await getImageEmbedding(screenshot_url);
      }

      // Prepare complete scrap object with all data
      const scrap = {
        id: existing?.id || undefined,
        scrap_id,
        source: "pinboard",
        type: "bookmark",
        url: bookmark.href,
        title: bookmark.description,
        content,
        screenshot_url,
        location: locationData.location,
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        published_at: bookmark.time,
        created_at: existing?.created_at || bookmark.time,
        updated_at: bookmark.time,
        shared: bookmark.shared === "yes",
        tags: bookmark.tags.split(' ').filter(Boolean),
        embedding,
        image_embedding,
        metadata: {
          ...(existing?.metadata || {}),
          hash: bookmark.hash,
          meta: bookmark.meta,
          toread: bookmark.toread === "yes",
          shared: bookmark.shared === "yes",
          locations: locationData.otherLocations,
          last_checked: new Date().toISOString(),
          update_count: (existing?.metadata?.update_count || 0) + 1
        }
      };

      // Save complete scrap with all data
      const { data: savedScrap, error: saveError } = await supabase
        .from("scraps")
        .upsert(scrap)
        .select()
        .single();

      if (saveError) {
        throw new Error(`Failed to save scrap: ${saveError.message}`);
      }

      // Add detailed success logging
      logger.info(`✅ Processed bookmark: ${bookmark.href.substring(0, 50)}...`);
      logger.info('Fields processed:');
      const fieldStatus = {
        '📝 Content': Boolean(scrap.content),
        '🔤 Title': Boolean(scrap.title),
        '🔗 URL': Boolean(scrap.url),
        '📸 Screenshot': Boolean(scrap.screenshot_url),
        '📍 Location': Boolean(scrap.location),
        '🌐 Coordinates': Boolean(scrap.latitude && scrap.longitude),
        '🏷️ Tags': scrap.tags?.length || 0,
        '📅 Published': Boolean(scrap.published_at),
        '🔄 Updated': Boolean(scrap.updated_at),
        '🤝 Shared': scrap.shared,
        '🧮 Embeddings': {
          'OpenAI': Boolean(scrap.embedding),
          'Image': Boolean(scrap.image_embedding)
        }
      };

      // Log each field status with appropriate emoji
      Object.entries(fieldStatus).forEach(([field, value]) => {
        if (typeof value === 'object') {
          // Handle embeddings object
          logger.info(`${field}:`);
          Object.entries(value).forEach(([type, exists]) => {
            logger.info(`  ${exists ? '✅' : '❌'} ${type}`);
          });
        } else {
          const status = value === true ? '✅' : 
                        value === false ? '❌' : 
                        typeof value === 'number' ? `✅ (${value})` : '❓';
          logger.info(`${status} ${field}`);
        }
      });

      return savedScrap;

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
    logger.error(`Error processing bookmark ${bookmark.href}:`, error);
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

// Add these functions before fetchBookmarksWithCache
async function handleIncrementalUpdate(lastPinboardUpdate) {
  logger.info("🔄 Performing incremental update");
  
  // Get recent bookmarks first
  const recentBookmarks = await fetchRecentBookmarks(100);
  
  // Load existing cache
  const cachedBookmarks = await cache.read();
  
  // Merge recent with cached, avoiding duplicates
  const merged = [...recentBookmarks];
  for (const bookmark of cachedBookmarks) {
    if (!merged.find(b => b.hash === bookmark.hash)) {
      merged.push(bookmark);
    }
  }
  
  // Update cache
  await cache.write(merged);
  await cache.writeMeta({ lastUpdate: lastPinboardUpdate });
  
  logger.info(`📚 Updated cache with ${recentBookmarks.length} new bookmarks`);
  return merged;
}

async function handleInitialFetch(lastPinboardUpdate) {
  logger.info("🔄 Performing initial full fetch");
  
  // Get all bookmarks
  const response = await limiters.allPosts.schedule(() =>
    axios.get("https://api.pinboard.in/v1/posts/all", {
      params: { auth_token: apiToken, format: "json" }
    })
  );
  
  const bookmarks = response.data;
  
  // Update cache
  await cache.write(bookmarks);
  await cache.writeMeta({ lastUpdate: lastPinboardUpdate });
  
  logger.info(`📚 Cached ${bookmarks.length} bookmarks`);
  return bookmarks;
}

// Main fetch function
export async function fetchBookmarksWithCache(testMode = false) {
  logger.info("🔄 Checking for Pinboard updates...");
  
  try {
    const lastPinboardUpdate = await checkForUpdates();
    const cacheMeta = await cache.readMeta();
    
    // Use cache if nothing's changed
    if (!testMode && cacheMeta.lastUpdate && lastPinboardUpdate === cacheMeta.lastUpdate) {
      logger.info("✨ No new updates since last fetch, using cache");
      const cached = await cache.read();
      logger.info(`📚 Loaded ${cached.length} bookmarks from cache`);
      return cached;
    }

    // Test mode - just get recent bookmarks
    if (testMode) {
      logger.info("🧪 Test mode: fetching recent bookmarks only");
      return await fetchRecentBookmarks(5);
    }

    // Smart update if we have existing cache
    if (cacheMeta.lastUpdate) {
      return await handleIncrementalUpdate(lastPinboardUpdate);
    }

    // Initial full fetch
    return await handleInitialFetch(lastPinboardUpdate);

  } catch (error) {
    logger.error("❌ Error fetching bookmarks, falling back to cache");
    logger.error(error);
    return await cache.read();
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchBookmarksWithCache()
    .then(async bookmarks => {
      console.log(`Fetched ${bookmarks.length} bookmarks`);
      process.exit(0);
    })
    .catch(error => {
      console.error("Error in main execution:", error);
      process.exit(1);
    });
}

// Add OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Add generateEmbedding function
async function generateEmbedding(text) {
  try {
    if (!text) {
      logger.warn('No text provided for embedding generation');
      return null;
    }

    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: text.substring(0, 8000), // OpenAI has an 8k token limit
    });

    if (response.data[0]?.embedding) {
      logger.debug(`Generated embedding with ${response.data[0].embedding.length} dimensions`);
      return response.data[0].embedding;
    }

    return null;
  } catch (error) {
    logger.error('Error generating OpenAI embedding:', error);
    return null;
  }
}
