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
const limiter = new Bottleneck({ 
  minTime: 3000,  // 3 seconds
  maxConcurrent: 1 
});

const allPostsLimiter = new Bottleneck({
  minTime: 300000, // 5 minutes
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
    const response = await limiter.schedule(() =>
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

// Fetch all bookmarks using posts/all endpoint
async function fetchAllBookmarks() {
  let allBookmarks = [];
  let start = 0;
  const BATCH_SIZE = 100; // Max allowed by API

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
        await new Promise(resolve => setTimeout(resolve, 300000)); // Wait 5 minutes
        continue;
      }
      throw error;
    }
  }

  return allBookmarks;
}

// Process a single bookmark
export async function processBookmark(bookmark) {
  try {
    // Extract location data if available
    const locationData = await extractLocation(bookmark.description);
    
    // Generate screenshot for URL
    const shortId = generateScrapId('pinboard', bookmark.href).substring(0, 8);
    const screenshot_url = bookmark.href ? 
      await generateScreenshot({
        source: 'pinboard',
        shortId,
        url: bookmark.href
      }) : null;

    return {
      id: generateScrapId('pinboard', bookmark.href),
      source: "pinboard",
      type: "bookmark",
      url: bookmark.href,
      title: bookmark.title || bookmark.description.split('\n')[0],
      content: bookmark.description,
      screenshot_url,
      location: locationData?.location,
      latitude: locationData?.latitude,
      longitude: locationData?.longitude,
      published_at: bookmark.time,
      created_at: bookmark.time,
      updated_at: bookmark.time,
      shared: bookmark.shared === "yes",
      tags: bookmark.tags ? 
        bookmark.tags.split(' ').filter(Boolean) : 
        [],
      metadata: {
        extended: bookmark.extended || null,
        toread: bookmark.toread === "yes",
        replace: bookmark.replace === "yes",
        hash: bookmark.hash, // Store Pinboard's change detection hash
        meta: bookmark.meta // Store meta signature if available
      }
    };
  } catch (error) {
    console.error(`Error processing bookmark ${bookmark.href}:`, error);
    throw error;
  }
}

// Main fetch function with caching
export async function fetchBookmarksWithCache() {
  console.log("\n[CACHE CHECK]");
  
  try {
    console.log("  • Checking Pinboard update time...");
    const lastPinboardUpdate = await checkForUpdates();
    console.log(`  • Pinboard last update: ${lastPinboardUpdate}`);
    
    console.log("\n[CACHE STATUS]");
    const cacheMeta = await readCacheMeta();
    console.log(`  • Cache last update: ${cacheMeta.lastUpdate || 'never'}`);
    
    // If no updates since last fetch, use cache
    if (cacheMeta.lastUpdate && lastPinboardUpdate === cacheMeta.lastUpdate) {
      console.log("\n[USING CACHE]");
      const cachedBookmarks = await readCache();
      console.log(`  • Retrieved ${cachedBookmarks.length} bookmarks from cache`);
      return cachedBookmarks;
    }

    console.log("\n[FETCHING UPDATES]");
    console.log(`  • New updates found (${lastPinboardUpdate})`);
    console.log("  • Starting batch fetch...");

    // Fetch all bookmarks
    let allBookmarks = [];
    let start = 0;
    const BATCH_SIZE = 100;

    while (true) {
      console.log(`    - Fetching batch ${start/BATCH_SIZE + 1}...`);
      
      try {
        const response = await allPostsLimiter.schedule(() =>
          axios.get("https://api.pinboard.in/v1/posts/all", {
            params: {
              auth_token: apiToken,
              format: "json",
              start,
              results: BATCH_SIZE,
              meta: 1
            },
            timeout: 30000
          })
        );

        const bookmarks = response.data;
        if (!bookmarks.length) break;
        
        allBookmarks = allBookmarks.concat(bookmarks);
        console.log(`    ✓ Total bookmarks: ${allBookmarks.length}`);
        
        if (bookmarks.length < BATCH_SIZE) break;
        start += BATCH_SIZE;

        // Show rate limit status
        console.log(`    • Rate limit pause (5 min)...`);
        await new Promise(resolve => setTimeout(resolve, 300000));

      } catch (error) {
        if (error.response?.status === 429) {
          console.log("    ! Rate limited, waiting 5 minutes...");
          await new Promise(resolve => setTimeout(resolve, 300000));
          continue;
        }
        throw error;
      }
    }

    console.log("\n[UPDATING CACHE]");
    console.log("  • Writing bookmarks to cache...");
    await writeCache(allBookmarks);
    console.log("  • Updating cache metadata...");
    await writeCacheMeta({ lastUpdate: lastPinboardUpdate });

    console.log("\n[COMPLETE]");
    console.log(`  • Fetched ${allBookmarks.length} bookmarks`);
    return allBookmarks;

  } catch (error) {
    console.error("\n[ERROR]");
    console.error("  ! Error fetching bookmarks:", error.message);
    console.error("  ! Falling back to cache...");
    return await readCache();
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
