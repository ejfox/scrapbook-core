#!/usr/bin/env node

import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import fs from 'fs/promises';
import path from 'path';
import { generateScrapId } from '../helpers.js';
import { extractLocation } from './aiGeolocation.mjs';
import { generateScreenshot } from './generateScreenshot.mjs';

dotenv.config();

const DEBUG = process.env.DEBUG === "true";

function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

// Rate limiting per Pinboard docs:
// - posts/all: once every 5 minutes
// - posts/recent: once per minute
// - everything else: once every 3 seconds
const allPostsLimiter = new Bottleneck({
  minTime: 300000, // 5 minutes
  maxConcurrent: 1
});

const recentPostsLimiter = new Bottleneck({
  minTime: 60000, // 1 minute
  maxConcurrent: 1
});

const generalLimiter = new Bottleneck({
  minTime: 3000, // 3 seconds
  maxConcurrent: 1
});

const apiToken = process.env.PINBOARD_TOKEN;
const CACHE_FILE = path.join(process.cwd(), 'data', 'pinboard_cache.json');
const CACHE_META_FILE = path.join(process.cwd(), 'data', 'pinboard_meta.json');

if (!apiToken) {
  console.error("PINBOARD_TOKEN is not set");
  process.exit(1);
}

// Cache handling
async function readCache() {
  try {
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
    const response = await generalLimiter.schedule(() =>
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

// Main fetch function with proper caching
export async function fetchBookmarksWithCache(testMode = false) {
  log("Checking for Pinboard updates...");
  
  try {
    // For test mode, just get recent bookmarks
    if (testMode) {
      log("Test mode: fetching recent bookmarks");
      return await fetchRecentBookmarks(5);
    }

    const lastPinboardUpdate = await checkForUpdates();
    const cacheMeta = await readCacheMeta();
    
    // If no updates since last fetch, use cache
    if (cacheMeta.lastUpdate && lastPinboardUpdate === cacheMeta.lastUpdate) {
      log("No new updates, using cache");
      return await readCache();
    }

    log(`New updates found (${lastPinboardUpdate}), fetching all bookmarks...`);

    // Fetch all bookmarks with pagination
    let allBookmarks = [];
    let start = 0;
    const BATCH_SIZE = 100; // Pinboard recommended batch size

    while (true) {
      log(`Fetching batch starting at ${start}`);
      
      try {
        const response = await allPostsLimiter.schedule(() =>
          axios.get("https://api.pinboard.in/v1/posts/all", {
            params: {
              auth_token: apiToken,
              format: "json",
              start,
              results: BATCH_SIZE,
              meta: 1 // Include change detection signatures
            },
            timeout: 30000
          })
        );

        const bookmarks = response.data;
        if (!bookmarks.length) break;
        
        allBookmarks = allBookmarks.concat(bookmarks);
        log(`Fetched ${allBookmarks.length} bookmarks so far`);
        
        if (bookmarks.length < BATCH_SIZE) break;
        start += BATCH_SIZE;

      } catch (error) {
        if (error.response?.status === 429) {
          log("Rate limited, waiting before retry...");
          await new Promise(resolve => setTimeout(resolve, 300000)); // 5 min
          continue;
        }
        throw error;
      }
    }

    // Update cache
    await writeCache(allBookmarks);
    await writeCacheMeta({ lastUpdate: lastPinboardUpdate });

    log(`Completed fetch of ${allBookmarks.length} bookmarks`);
    return allBookmarks;

  } catch (error) {
    log("Error fetching bookmarks, falling back to cache");
    console.error(error);
    return await readCache();
  }
}

export async function processBookmark(bookmark) {
  try {
    // Generate screenshot if needed
    const screenshot_url = await generateScreenshot({
      source: 'pinboard',
      shortId: generateScrapId('pinboard', bookmark.hash),
      url: bookmark.href
    });

    // Extract location if possible
    const { location, latitude, longitude, otherLocations } = await extractLocation(
      bookmark.extended || bookmark.description,
      { url: bookmark.href }
    );

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
    console.error(`Error processing bookmark ${bookmark.href}:`, error);
    throw error;
  }
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
