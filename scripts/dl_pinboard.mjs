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

// Processing helpers
async function shouldProcessBookmark(bookmark, existingData) {
  // Always process if no existing data
  if (!existingData) return true;

  // Check if content has changed
  const contentChanged = 
    bookmark.description !== existingData.title ||
    bookmark.extended !== existingData.content ||
    bookmark.shared !== (existingData.shared ? "yes" : "no") ||
    bookmark.tags !== existingData.tags?.join(' ');

  if (contentChanged) {
    logger.info(`Content changed for ${bookmark.href}`);
    return true;
  }

  // Check last_checked timestamp
  const lastChecked = existingData.metadata?.last_checked;
  if (!lastChecked) return true;

  const hoursSinceLastCheck = (Date.now() - new Date(lastChecked).getTime()) / (1000 * 60 * 60);
  
  // If checked in last 24 hours and no content changes, skip
  if (hoursSinceLastCheck < 24 && !contentChanged) {
    logger.info(`Skipping recently processed bookmark: ${bookmark.href}`);
    logger.info(`Last checked ${Math.round(hoursSinceLastCheck)} hours ago`);
    return false;
  }

  // Check if screenshot needs refresh (older than 7 days)
  if (existingData.screenshot_url) {
    const daysSinceScreenshot = hoursSinceLastCheck / 24;
    if (daysSinceScreenshot > 7) {
      logger.info(`Screenshot older than 7 days for ${bookmark.href}`);
      return true;
    }
  }

  return true;
}

// Main processing function
export async function processBookmark(bookmark) {
  try {
    logger.info(`🔄 Processing bookmark: ${bookmark.href.substring(0, 50)}...`);

    const scrap_id = `pinboard:${bookmark.hash}`;
    
    // Check for existing bookmark
    const { data, error } = await supabase
      .from("scraps")
      .select("*")
      .eq("scrap_id", scrap_id);

    if (error) {
      logger.error(`Failed to check for existing bookmark: ${error.message}`);
      throw error;
    }

    // Take the most recently updated record if multiple exist
    const existingData = data && data.length > 0 
      ? data.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0]
      : null;

    // Check if we should process this bookmark
    const shouldProcess = await shouldProcessBookmark(bookmark, existingData);
    if (!shouldProcess) {
      logger.info(`Skipping bookmark: ${bookmark.href}`);
      return existingData;
    }

    // Generate screenshot if needed
    const screenshot_url = await generateScreenshot({
      source: 'pinboard',
      shortId: bookmark.hash,
      url: bookmark.href
    });

    // Extract location if possible
    const { location, latitude, longitude, otherLocations } = await extractLocation(
      bookmark.extended || bookmark.description,
      { url: bookmark.href }
    );

    // Prepare scrap object
    const scrap = {
      id: existingData?.id || undefined,
      scrap_id,
      source: "pinboard",
      type: "bookmark",
      url: bookmark.href,
      title: bookmark.description,
      content: bookmark.extended || bookmark.description,
      screenshot_url,
      location,
      latitude,
      longitude,
      published_at: bookmark.time,
      created_at: existingData?.created_at || bookmark.time,
      updated_at: bookmark.time,
      shared: bookmark.shared === "yes",
      tags: bookmark.tags.split(' ').filter(Boolean),
      metadata: {
        ...(existingData?.metadata || {}),
        hash: bookmark.hash,
        meta: bookmark.meta,
        toread: bookmark.toread === "yes",
        shared: bookmark.shared === "yes",
        locations: otherLocations,
        last_checked: new Date().toISOString(),
        update_count: (existingData?.metadata?.update_count || 0) + 1
      }
    };

    logger.info(`✅ Processed bookmark: ${bookmark.href.substring(0, 50)}...`);
    return scrap;

  } catch (error) {
    logger.error(`❌ Error processing bookmark ${bookmark.href}:`, error);
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
