import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { generateScrapId } from "../helpers.js";
import { extractLocation } from "./aiGeolocation.mjs";
import { generateScreenshot } from "./generateScreenshot.mjs";
import winston from "winston";
import { createClient } from "@supabase/supabase-js";
import { getImageDescription } from "./imageDescriptions.mjs";
import OpenAI from "openai";
import { INSTANCE_NAME } from "../helpers/instanceName.mjs";
import puppeteer from "puppeteer";

dotenv.config();

// Constants
const DEBUG = process.env.DEBUG === "true";
const CACHE_DIR = "./data";
const CACHE_FILE = path.join(CACHE_DIR, "pinboard_cache.json");
const CACHE_META_FILE = path.join(CACHE_DIR, "pinboard_cache_meta.json");

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
    db: { schema: "public" },
  },
);

// Rate limiters
const limiters = {
  allPosts: new Bottleneck({
    minTime: 300000, // 5 minutes for posts/all
    maxConcurrent: 1,
  }),
  recentPosts: new Bottleneck({
    minTime: 60000, // 1 minute for posts/recent
    maxConcurrent: 1,
  }),
  standard: new Bottleneck({
    minTime: 3000, // 3 seconds for other endpoints
    maxConcurrent: 1,
  }),
  ai: new Bottleneck({
    minTime: 1000,
    maxConcurrent: 1,
  }),
};

// Logger setup
const logger = winston.createLogger({
  level: DEBUG ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

// Setup logging helpers
function logMetric(name, data = {}) {
  logger.info(name, {
    type: "metric",
    metric: name,
    source: "pinboard",
    ...data,
  });
}

function logStatus(level, message, data = {}) {
  logger.log(level, message, {
    type: "status",
    source: "pinboard",
    ...data,
  });
}

function logError(message, error, context = {}) {
  logger.error(message, {
    type: "error",
    source: "pinboard",
    error: error.message,
    stack: error.stack,
    ...context,
  });
}

// Cache management
const cache = {
  async ensureDir() {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  },

  async read() {
    try {
      await this.ensureDir();
      const startTime = Date.now();
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      const bookmarks = JSON.parse(data);

      logMetric("cache_read", {
        duration_ms: Date.now() - startTime,
        cache_size_bytes: data.length,
        bookmarks_count: bookmarks.length,
      });

      return bookmarks;
    } catch (error) {
      logError("Cache read failed", error);
      return [];
    }
  },

  async write(bookmarks) {
    try {
      await this.ensureDir();
      const startTime = Date.now();
      const data = JSON.stringify(bookmarks);
      await fs.writeFile(CACHE_FILE, data);

      logMetric("cache_write", {
        duration_ms: Date.now() - startTime,
        cache_size_bytes: data.length,
        bookmarks_count: bookmarks.length,
      });
    } catch (error) {
      logError("Cache write failed", error);
    }
  },

  async readMeta() {
    try {
      const data = await fs.readFile(CACHE_META_FILE, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      return { lastUpdate: null };
    }
  },

  async writeMeta(meta) {
    await this.ensureDir();
    await fs.writeFile(CACHE_META_FILE, JSON.stringify(meta, null, 2));
  },
};

// Pinboard API helpers
async function checkForUpdates() {
  try {
    const response = await limiters.standard.schedule(() =>
      axios.get("https://api.pinboard.in/v1/posts/update", {
        params: { auth_token: apiToken, format: "json" },
      }),
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
        params: { auth_token: apiToken, format: "json", count },
      }),
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
      ? tags.sort().join(",")
      : tags
        .split(/[\s,]+/)
        .filter(Boolean)
        .sort()
        .join(",");
  };

  // Helper to normalize dates - convert to UTC and compare only date parts
  const normalizeDate = (dateStr) => {
    const date = new Date(dateStr);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      day: date.getUTCDate(),
    };
  };

  // Helper to normalize content by trimming whitespace
  const normalizeContent = (str) => str?.trim().replace(/\s+/g, " ") || "";

  // Get bookmark content using same fallback logic as processBookmark
  const bookmarkContent = bookmark.extended || bookmark.description;

  // Prepare normalized values
  const normalized = {
    old: {
      title: normalizeContent(existingData.title),
      content: normalizeContent(existingData.content),
      shared: existingData.shared ? "yes" : "no",
      tags: normalizeTags(existingData.tags || []),
      date: normalizeDate(existingData.published_at),
    },
    new: {
      title: normalizeContent(bookmark.description),
      content: normalizeContent(bookmarkContent), // Use fallback content
      shared: bookmark.shared,
      tags: normalizeTags(bookmark.tags),
      date: normalizeDate(bookmark.time),
    },
  };

  // Debug log the normalized values before comparison
  logger.debug("Normalized values for comparison:");
  logger.debug("Old:", normalized.old);
  logger.debug("New:", normalized.new);

  // Check each field and log differences
  const changes = [];

  if (normalized.old.title !== normalized.new.title) {
    changes.push({
      field: "title",
      old: normalized.old.title,
      new: normalized.new.title,
    });
  }

  if (normalized.old.content !== normalized.new.content) {
    changes.push({
      field: "content",
      old: normalized.old.content,
      new: normalized.new.content,
    });
  }

  if (normalized.old.shared !== normalized.new.shared) {
    changes.push({
      field: "shared",
      old: normalized.old.shared,
      new: normalized.new.shared,
    });
  }

  if (normalized.old.tags !== normalized.new.tags) {
    changes.push({
      field: "tags",
      old: normalized.old.tags,
      new: normalized.new.tags,
    });
  }

  const oldDate = normalized.old.date;
  const newDate = normalized.new.date;

  if (
    oldDate.year !== newDate.year ||
    oldDate.month !== newDate.month ||
    oldDate.day !== newDate.day
  ) {
    changes.push({
      field: "date",
      old: new Date(existingData.published_at).toISOString(),
      new: new Date(bookmark.time).toISOString(),
    });
  }

  if (changes.length > 0) {
    logger.info(`\nContent changes detected for ${bookmark.href}:`);
    changes.forEach((change) => {
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
    return { shouldProcess: true, reason: "new_bookmark" };
  }

  // Check if content has changed
  if (contentChanged(bookmark, existingData)) {
    return { shouldProcess: true, reason: "content_changed" };
  }

  // Check metadata for processing flags
  if (existingData.metadata?.force_reprocess) {
    return { shouldProcess: true, reason: "force_reprocess" };
  }

  // Check last_checked timestamp
  const lastChecked = existingData.metadata?.last_checked;
  if (!lastChecked) {
    return { shouldProcess: true, reason: "never_checked" };
  }

  const hoursSinceLastCheck =
    (Date.now() - new Date(lastChecked).getTime()) / (1000 * 60 * 60);

  // If we've checked it recently, skip it
  if (hoursSinceLastCheck < 24) {
    logger.debug(`Skipping recently processed bookmark: ${bookmark.href}`);
    return { shouldProcess: false, reason: "recently_checked" };
  }

  // Check if screenshot is missing
  if (!existingData.screenshot_url) {
    return { shouldProcess: true, reason: "missing_screenshot" };
  }

  // Check if we're missing any critical fields
  const criticalFields = ["title", "content", "url", "published_at"];
  const missingFields = criticalFields.filter((field) => !existingData[field]);
  if (missingFields.length > 0) {
    return { shouldProcess: true, reason: "missing_fields" };
  }

  return { shouldProcess: false, reason: "no_changes" };
}

// Add rate limiting for screenshots
const screenshotLimiter = new Bottleneck({
  maxConcurrent: 1, // Only one screenshot at a time
  minTime: 1000, // Wait 1s between screenshots
});

// Main processing function
export async function processBookmark(bookmark) {
  const startTime = Date.now();
  const bookmarkId = bookmark.hash;

  try {
    // Process the bookmark
    const processed = {
      scrap_id: `pinboard-${bookmark.hash}`,
      source: "pinboard",
      type: "bookmark",
      url: bookmark.href,
      title: bookmark.description,
      content: bookmark.extended || bookmark.description || "",
      tags: bookmark.tags ? bookmark.tags.split(" ") : [],
      published_at: bookmark.time,
      created_at: bookmark.time,
      updated_at: new Date().toISOString(),
      shared: bookmark.shared === "yes",
      metadata: {
        original: bookmark,
        shared: bookmark.shared === "yes",
        toread: bookmark.toread === "yes",
        processed_at: new Date().toISOString(),
      },
    };

    // Try to get a screenshot if we have a URL
    if (bookmark.href) {
      try {
        const screenshotStartTime = Date.now();
        const screenshot = await screenshotLimiter.schedule(() =>
          generateScreenshot(bookmark.href),
        );

        if (screenshot?.url) {
          processed.screenshot_url = screenshot.url;
          logMetric("screenshot_generated", {
            bookmark_id: bookmarkId,
            duration_ms: Date.now() - screenshotStartTime,
            url: bookmark.href,
          });
        }
      } catch (error) {
        logError("Screenshot generation failed", error, {
          bookmark_id: bookmarkId,
          url: bookmark.href,
        });
      }
    }

    logMetric("bookmark_processed", {
      bookmark_id: bookmarkId,
      duration_ms: Date.now() - startTime,
      has_content: !!processed.content,
      has_screenshot: !!processed.screenshot_url,
      tags_count: processed.tags.length,
    });

    return processed;
  } catch (error) {
    logError("Bookmark processing failed", error, {
      bookmark_id: bookmarkId,
      duration_ms: Date.now() - startTime,
    });
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
    if (!merged.find((b) => b.hash === bookmark.hash)) {
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
      params: { auth_token: apiToken, format: "json" },
    }),
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
  const startTime = Date.now();
  logStatus("info", "🔄 Checking for Pinboard updates...");

  try {
    const lastPinboardUpdate = await checkForUpdates();
    const cacheMeta = await cache.readMeta();

    // Use cache if nothing's changed
    if (
      !testMode &&
      cacheMeta.lastUpdate &&
      lastPinboardUpdate === cacheMeta.lastUpdate
    ) {
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
    logError("Bookmark fetch failed", error, {
      duration_ms: Date.now() - startTime,
    });

    // Try to return cached data on error
    const cachedBookmarks = await cache.read();
    if (cachedBookmarks.length) {
      logStatus(
        "warn",
        `⚠️ Fetch failed, using ${cachedBookmarks.length} cached bookmarks`,
      );
      return cachedBookmarks;
    }
    throw error;
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchBookmarksWithCache()
    .then(async (bookmarks) => {
      console.log(`Fetched ${bookmarks.length} bookmarks`);
      process.exit(0);
    })
    .catch((error) => {
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
      logger.warn("No text provided for embedding generation");
      return null;
    }

    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: text.substring(0, 8000), // OpenAI has an 8k token limit
    });

    if (response.data[0]?.embedding) {
      logger.debug(
        `Generated embedding with ${response.data[0].embedding.length} dimensions`,
      );
      return response.data[0].embedding;
    }

    return null;
  } catch (error) {
    logger.error("Error generating OpenAI embedding:", error);
    return null;
  }
}

// Update main processing loop
async function fetchAndUpsertPinboardBookmarks() {
  const bookmarks = await fetchBookmarksWithCache();
  logger.info(`Found ${bookmarks.length} bookmarks`);

  for (const bookmark of bookmarks) {
    if (isShuttingDown) break;

    const scrapId = `pinboard-${bookmark.hash}`;
    await claimAndProcess(scrapId, "pinboard", bookmark, processBookmark);
  }
}
