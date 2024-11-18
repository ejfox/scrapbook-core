#!/usr/bin/env node

import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import fs from 'fs/promises';
import path from 'path';
import { generateScrapId } from '../helpers.js';
import { extractLocation } from './aiGeolocation.mjs';
import { generateScreenshot } from './generateScreenshot.mjs';
import winston from "winston";

dotenv.config();

const DEBUG = process.env.DEBUG === "true";

// Get API token from environment
const apiToken = process.env.PINBOARD_TOKEN;

if (!apiToken) {
  console.error("PINBOARD_TOKEN is not set in environment variables");
  process.exit(1);
}

// Add cache file paths
const CACHE_FILE = './data/pinboard_cache.json';
const CACHE_META_FILE = './data/pinboard_cache_meta.json';

// Add better rate limiting
const allPostsLimiter = new Bottleneck({
  minTime: 300000, // 5 minutes for posts/all
  maxConcurrent: 1
});

const recentPostsLimiter = new Bottleneck({
  minTime: 60000, // 1 minute for posts/recent
  maxConcurrent: 1
});

const standardLimiter = new Bottleneck({
  minTime: 3000, // 3 seconds for all other endpoints
  maxConcurrent: 1
});

// Add better logging
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

// Improve cache handling
async function readCache() {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function writeCache(bookmarks) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(bookmarks, null, 2));
}

async function readCacheMeta() {
  try {
    const data = await fs.readFile(CACHE_META_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { lastUpdate: null };
  }
}

async function writeCacheMeta(meta) {
  await fs.mkdir(path.dirname(CACHE_META_FILE), { recursive: true });
  await fs.writeFile(CACHE_META_FILE, JSON.stringify(meta, null, 2));
}

// Check for updates using posts/update endpoint
async function checkForUpdates() {
  try {
    const response = await standardLimiter.schedule(() =>
      axios.get("https://api.pinboard.in/v1/posts/update", {
        params: {
          auth_token: apiToken,
          format: "json"
        }
      })
    );
    return response.data.update_time;
  } catch (error) {
    console.error("Error checking for updates:", error);
    throw error;
  }
}

// Fetch recent bookmarks for testing/validation
async function fetchRecentBookmarks(count = 5) {
  try {
    const response = await recentPostsLimiter.schedule(() =>
      axios.get("https://api.pinboard.in/v1/posts/recent", {
        params: {
          auth_token: apiToken,
          format: "json",
          count
        }
      })
    );
    return response.data.posts;
  } catch (error) {
    console.error("Error fetching recent bookmarks:", error);
    return [];
  }
}

// Add rate limit logging
async function fetchWithRateLimitLogging(url, params) {
  try {
    logger.info(`📊 Rate limit status before request:`);
    
    // Different messages based on endpoint
    if (url.includes('/posts/all')) {
      logger.info(`  • Pinboard /posts/all endpoint limited to 1 request per 5 minutes`);
      logger.info(`  • Current time: ${new Date().toLocaleTimeString()}`);
      logger.info(`  • Next request allowed at: ${new Date(Date.now() + 300000).toLocaleTimeString()}`);
    } else if (url.includes('/posts/recent')) {
      logger.info(`  • Pinboard /posts/recent endpoint limited to 1 request per minute`);
      logger.info(`  • Current time: ${new Date().toLocaleTimeString()}`);
      logger.info(`  • Next request allowed at: ${new Date(Date.now() + 60000).toLocaleTimeString()}`);
    } else {
      logger.info(`  • Pinboard standard endpoint limited to 1 request per 3 seconds`);
      logger.info(`  • Current time: ${new Date().toLocaleTimeString()}`);
      logger.info(`  • Next request allowed at: ${new Date(Date.now() + 3000).toLocaleTimeString()}`);
    }

    const response = await axios.get(url, { params });
    
    // Log rate limit info if available
    const rateLimit = {
      remaining: response.headers['x-ratelimit-remaining'],
      limit: response.headers['x-ratelimit-limit'],
      reset: response.headers['x-ratelimit-reset']
    };

    if (rateLimit.remaining) {
      const resetDate = new Date(rateLimit.reset * 1000).toLocaleTimeString();
      logger.info(`📊 Rate limit after request:`);
      logger.info(`  • ${rateLimit.remaining}/${rateLimit.limit} requests remaining`);
      logger.info(`  • Resets at: ${resetDate}`);
    }

    return response;
  } catch (error) {
    if (error.response?.status === 429) {
      const resetTime = error.response.headers['x-ratelimit-reset'];
      const waitTime = Math.ceil((resetTime * 1000 - Date.now()) / 1000);
      logger.warn(`⚠️ Rate limited! Must wait ${waitTime} seconds`);
      logger.warn(`  • Next request allowed at: ${new Date(resetTime * 1000).toLocaleTimeString()}`);
    }
    throw error;
  }
}

// Main fetch function with smart caching
export async function fetchBookmarksWithCache(testMode = false) {
  logger.info("🔄 Checking for Pinboard updates...");
  
  try {
    // First check when Pinboard was last updated
    const lastPinboardUpdate = await checkForUpdates();
    const cacheMeta = await readCacheMeta();
    
    // If nothing's changed, use cache
    if (cacheMeta.lastUpdate && lastPinboardUpdate === cacheMeta.lastUpdate) {
      logger.info("✨ No new updates since last fetch, using cache");
      const cached = await readCache();
      logger.info(`📚 Loaded ${cached.length} bookmarks from cache`);
      return cached;
    }

    // If we're testing, just get recent bookmarks
    if (testMode) {
      logger.info("🧪 Test mode: fetching recent bookmarks only");
      return await fetchRecentBookmarks(5);
    }

    // If we have a cache but need to update
    if (cacheMeta.lastUpdate) {
      logger.info(`🔄 Cache exists but needs update (last: ${cacheMeta.lastUpdate})`);
      logger.info(`🔄 Fetching only new bookmarks since last update`);
      
      const cached = await readCache();
      logger.info(`📚 Loaded ${cached.length} bookmarks from cache`);
      
      // Get recent bookmarks to merge with cache
      const newBookmarks = await fetchRecentBookmarks(100); // Get last 100 to be safe
      logger.info(`📚 Fetched ${newBookmarks.length} new bookmarks`);
      
      // Merge and deduplicate
      const merged = [...newBookmarks, ...cached];
      const unique = merged.filter((bookmark, index, self) =>
        index === self.findIndex((b) => b.hash === bookmark.hash)
      );

      logger.info(`📚 Total unique bookmarks: ${unique.length}`);
      
      // Update cache
      await writeCache(unique);
      await writeCacheMeta({ lastUpdate: lastPinboardUpdate });
      
      return unique;
    }

    // If no cache exists, do initial full fetch (but be smart about it)
    logger.info("📥 No cache found - doing initial fetch");
    logger.info("⚠️ This will take a while, but we only need to do it once");
    
    let allBookmarks = [];
    let start = 0;
    const batchSize = 100;
    const startTime = Date.now();

    while (true) {
      logger.info(`\n📊 Progress Update:
  • Fetching batch starting at ${start}
  • Have ${allBookmarks.length} bookmarks so far
  • Elapsed time: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes
  • Next batch in: 5 minutes (Pinboard API limit)
`);

      const response = await allPostsLimiter.schedule(() =>
        axios.get("https://api.pinboard.in/v1/posts/all", {
          params: {
            auth_token: apiToken,
            format: "json",
            start,
            results: batchSize,
            meta: 1
          }
        })
      );

      const bookmarks = response.data;
      if (!bookmarks.length) break;

      allBookmarks = allBookmarks.concat(bookmarks);
      logger.info(`📚 Fetched ${allBookmarks.length} bookmarks total`);

      // If we got less than batch size, we're done
      if (bookmarks.length < batchSize) {
        logger.info("✅ Reached end of bookmarks");
        break;
      }

      start += batchSize;
      
      // Save progress to cache after each batch
      logger.info("💾 Saving progress to cache...");
      await writeCache(allBookmarks);
      await writeCacheMeta({ lastUpdate: lastPinboardUpdate });

      // Wait for rate limit
      logger.info("⏱️ Waiting 5 minutes for rate limit...");
      await new Promise(resolve => setTimeout(resolve, 300000));
    }

    logger.info("✅ Initial fetch complete!");
    return allBookmarks;

  } catch (error) {
    logger.error("❌ Error fetching bookmarks, falling back to cache");
    logger.error(error);
    return await readCache();
  }
}

// Add function to get total bookmark count
async function getTotalBookmarkCount() {
  try {
    const response = await standardLimiter.schedule(() =>
      axios.get("https://api.pinboard.in/v1/posts/all", {
        params: {
          auth_token: apiToken,
          format: "json",
          results: 1
        }
      })
    );
    
    // The response includes a count header
    return parseInt(response.headers['x-total-count']) || 0;
  } catch (error) {
    logger.error("Error getting total bookmark count:", error);
    return 0;
  }
}

export async function processBookmark(bookmark) {
  try {
    logger.info(`🔄 Processing bookmark: ${bookmark.href.substring(0, 50)}...`);

    // Generate screenshot if needed
    logger.debug("📸 Generating screenshot...");
    const screenshot_url = await generateScreenshot({
      source: 'pinboard',
      shortId: generateScrapId('pinboard', bookmark.hash),
      url: bookmark.href
    });

    // Extract location if possible
    logger.debug("🌍 Extracting location...");
    const { location, latitude, longitude, otherLocations } = await extractLocation(
      bookmark.extended || bookmark.description,
      { url: bookmark.href }
    );

    logger.info(`✅ Processed bookmark: ${bookmark.href.substring(0, 50)}...`);
    return {
      id: generateScrapId('pinboard', bookmark.hash),
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
      created_at: bookmark.time,
      updated_at: bookmark.time,
      shared: false,
      tags: bookmark.tags.split(' ').filter(Boolean),
      metadata: {
        hash: bookmark.hash,
        meta: bookmark.meta,
        toread: bookmark.toread === "yes",
        shared: bookmark.shared === "yes",
        locations: otherLocations,
      }
    };
  } catch (error) {
    logger.error(`❌ Error processing bookmark ${bookmark.href}:`, error);
    throw error;
  }
}

// Process bookmarks in parallel
export async function processBookmarks(bookmarks) {
  return Promise.all(
    bookmarks.map(bookmark => 
      processLimiter.schedule(() => processBookmark(bookmark))
    )
  );
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchBookmarksWithCache()
    .then(async (bookmarks) => {
      console.log(`Fetched ${bookmarks.length} bookmarks`);
      if (bookmarks.length) {
        const processed = await processBookmark(bookmarks[0]);
        console.log('Sample processed bookmark:', JSON.stringify(processed, null, 2));
      }
    })
    .catch((error) => {
      console.error("Error in main execution:", error);
      process.exit(1);
    });
}
