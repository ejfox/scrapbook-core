#!/usr/bin/env node
import { program } from "commander";
import { fetchAllBlocks } from "./dl_arena.mjs";
import { fetchStatuses, fetchUserId, processStatus } from "./dl_mastodon.mjs";
import { fetchBookmarksWithCache, processBookmark } from "./dl_pinboard.mjs";
import { fetchGithubData } from "./dl_github.mjs";
import * as helpers from "../helpers.js";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";
import Bottleneck from "bottleneck";
import { summarizeContent, metaSummaryToTags } from "./aiSummarization.mjs";
import {
  summarizeGitHubActivity,
  gitHubSummaryToTags,
} from "./aiGithubSummarization.mjs";
import { generateMastodonTags } from "./aiMastodonSummarization.mjs";
import { extractLocation } from "./aiGeolocation.mjs";
import { extractRelationships } from "./aiRelationshipExtraction.mjs";
import dotenv from "dotenv";
import winston from "winston";
import { generateScreenshot } from './generateScreenshot.mjs';
import { v2 as cloudinary } from "cloudinary";

dotenv.config();

// Environment variables and flags
let DEBUG = process.env.DEBUG === "true";
let isShuttingDown = false;

// Initialize Supabase client with better error handling
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: { 'x-my-custom-header': 'scrapbook-core' },
    }
  }
);

// Initialize Cloudinary client
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Bottleneck limiters for rate-limiting async tasks
const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 1500 });
const upsertLimiter = new Bottleneck({ maxConcurrent: 3, minTime: 1500 });
const browserLimiter = new Bottleneck({ maxConcurrent: 1, minTime: 1500 });

// Setup logging
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

// Replace console.log with logger
function log(...args) {
  if (DEBUG) logger.debug(args.join(' '));
}

// Improve shutdown handling
async function gracefulShutdown() {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }
  
  isShuttingDown = true;
  logger.info("Initiating graceful shutdown...");

  try {
    // Stop all limiters
    await Promise.all([
      limiter.stop({ dropWaitingJobs: true }),
      upsertLimiter.stop({ dropWaitingJobs: true }),
      browserLimiter.stop({ dropWaitingJobs: true })
    ]);

    logger.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', error => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown();
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

// Remove OpenAI-specific code
const generateEmbedding = async (text) => {
  // For now, just return null if embeddings are requested
  return null;
};

// Improve the existing scrap check function
async function getExistingScrap(scrapData) {
  const { data, error } = await supabase
    .from("scraps")
    .select("*")
    .or(`id.eq.${scrapData.id},source_id.eq.${scrapData.source_id},url.eq.${scrapData.url}`)
    .limit(1);
    
  if (error) {
    logger.error(`Failed to check for existing scrap: ${error.message}`);
    return null;
  }
  
  return data?.[0];
}

// Add a new function to merge scrap data
function mergeScrapData(existing, updated) {
  if (!existing) return updated;
  
  return {
    ...existing,
    ...updated,
    // Merge arrays without duplicates
    tags: [...new Set([...(existing.tags || []), ...(updated.tags || [])])],
    relationships: [...new Set([...(existing.relationships || []), ...(updated.relationships || [])])],
    // Keep track of updates
    metadata: {
      ...(existing.metadata || {}),
      ...(updated.metadata || {}),
      last_updated: new Date().toISOString(),
      update_count: (existing.metadata?.update_count || 0) + 1
    }
  };
}

// Improve the upsert function
async function upsertWithRetry(scrapData, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      // Check for existing scrap
      const existing = await getExistingScrap(scrapData);
      
      // Merge data if exists
      const mergedData = mergeScrapData(existing, scrapData);
      
      // Perform upsert with conflict handling
      const { error } = await supabase
        .from("scraps")
        .upsert(mergedData, {
          onConflict: 'id',
          ignoreDuplicates: false,
          returning: 'minimal'
        });
      
      if (error) {
        if (error.message.includes('timeout') && i < retries - 1) {
          logger.warn(`Timeout on attempt ${i + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
          continue;
        }
        throw error;
      }
      
      return;
    } catch (error) {
      if (i === retries - 1) throw error;
      logger.warn(`Error on attempt ${i + 1}, retrying: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

// Extract and add relationships to scrap
async function extractAndAddRelationships(scrapObj) {
  const content = scrapObj.summary || scrapObj.content;
  if (!content) return scrapObj;

  try {
    if (process.env.OPENROUTER_API_KEY) {
      scrapObj.relationships = await limiter.schedule(() =>
        extractRelationships(content, { isRawText: !scrapObj.summary })
      );
    } else {
      logger.info('Skipping relationship extraction - OpenRouter API key not configured');
      logger.info('Please set OPENROUTER_API_KEY to enable AI features');
      scrapObj.relationships = [];
    }
  } catch (error) {
    logger.error(
      `Failed to extract relationships for ${scrapObj.id}:`,
      error.message
    );
    scrapObj.relationships = [];
  }

  return scrapObj;
}

// Then define the functions
async function fetchAndUpsertPinboardBookmarks() {
  try {
    const bookmarks = await fetchBookmarksWithCache();
    logger.info(`Found ${bookmarks.length} bookmarks`);

    for (const bookmark of bookmarks) {
      if (isShuttingDown) break;
      
      try {
        const processedBookmark = await processBookmark(bookmark);
        if (processedBookmark) {
          await upsertWithRetry(processedBookmark);
        }
      } catch (error) {
        logger.error(`Failed to process bookmark: ${bookmark.href}`, error);
      }
    }
  } catch (error) {
    logger.error("Error in Pinboard fetch:", error);
  }
}

async function fetchAndUpsertMastodonStatuses() {
  const userId = await fetchUserId();
  const statuses = await fetchStatuses(userId);
  log(`Fetched ${statuses.length} Mastodon statuses`);

  for (const status of statuses) {
    if (isShuttingDown) break;

    try {
      // Process status with new structure
      const processedStatus = await processStatus(status);
      
      // Generate embeddings if enabled
      if (processedStatus.content && process.env.USE_OPENAI) {
        processedStatus.embedding = await generateEmbedding(processedStatus.content);
      }

      // Extract relationships
      await extractAndAddRelationships(processedStatus);
      
      // Upsert to database
      await upsertWithRetry(processedStatus);
    } catch (error) {
      log(`Failed to process status: ${status.id}`, error);
    }
  }
}

async function fetchAndUpsertArenaBlocks() {
  const blocks = await fetchAllBlocks();
  log(`Fetched ${blocks.length} Are.na blocks`);

  for (const block of blocks) {
    if (isShuttingDown) break;

    try {
      // Process block with new structure
      const processedBlock = await processBlock(block);
      
      // Generate embeddings if enabled
      if (processedBlock.content && process.env.USE_OPENAI) {
        processedBlock.embedding = await generateEmbedding(processedBlock.content);
      }

      // Extract relationships
      await extractAndAddRelationships(processedBlock);
      
      // Upsert to database
      await upsertWithRetry(processedBlock);
    } catch (error) {
      log(`Failed to process block: ${block.id}`, error);
    }
  }
}

async function fetchAndUpsertGithubData() {
  const githubData = await fetchGithubData();
  log(`Fetched GitHub data`);

  // Process all GitHub item types
  const allScraps = [
    ...githubData.userRepos,
    ...githubData.userPRs,
    ...githubData.userIssues,
    ...githubData.userGists,
    ...githubData.userReleases,
    ...githubData.starredRepos
  ];

  for (const scrap of allScraps) {
    if (isShuttingDown) break;

    try {
      // Generate embeddings if enabled
      if (scrap.content && process.env.USE_OPENAI) {
        scrap.embedding = await generateEmbedding(scrap.content);
      }

      // Extract relationships
      await extractAndAddRelationships(scrap);
      
      // Upsert to database
      await upsertWithRetry(scrap);
    } catch (error) {
      log(`Failed to process GitHub item: ${scrap.id}`, error);
    }
  }
}

// Then add program options
program
  .option("--all", "Fetch from all sources")
  .option("--pinboard", "Fetch from Pinboard")
  .option("--mastodon", "Fetch from Mastodon")
  .option("--arena", "Fetch from Are.na")
  .option("--github", "Fetch from GitHub")
  .option("--new-only", "Only fetch new items")
  .parse(process.argv);

const options = program.opts();

// Main execution function
async function main() {
  logger.info("Starting processing with options:", {
    all: options.all || false,
    pinboard: options.pinboard || false,
    mastodon: options.mastodon || false,
    arena: options.arena || false,
    github: options.github || false,
    newOnly: options.newOnly || false
  });
  
  try {
    // Fetch from Pinboard if specified
    if (options.all || options.pinboard) {
      logger.info("\nFetching from Pinboard...");
      const bookmarks = await fetchBookmarksWithCache();
      logger.info(`Found ${bookmarks.length} bookmarks`);

      for (const bookmark of bookmarks) {
        if (isShuttingDown) break;
        
        try {
          const processedBookmark = await processBookmark(bookmark);
          if (processedBookmark) {
            await upsertWithRetry(processedBookmark);
          }
        } catch (error) {
          logger.error(`Failed to process bookmark: ${bookmark.href}`, error);
        }
      }
    }

    // Fetch from Mastodon if specified
    if (options.all || options.mastodon) {
      logger.info("\nFetching from Mastodon...");
      await fetchAndUpsertMastodonStatuses();
    }

    // Fetch from Are.na if specified
    if (options.all || options.arena) {
      logger.info("\nFetching from Are.na...");
      await fetchAndUpsertArenaBlocks();
    }

    // Fetch from GitHub if specified
    if (options.all || options.github) {
      logger.info("\nFetching from GitHub...");
      await fetchAndUpsertGithubData();
    }

    logger.info("\nProcessing completed successfully");
    process.exit(0);
  } catch (error) {
    logger.error("Error in main process:", error.message);
    process.exit(1);
  }
}

// Run main function at the end
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error("Unhandled error:", error);
    process.exit(1);
  });
}

export { 
  fetchAndUpsertPinboardBookmarks, 
  fetchAndUpsertMastodonStatuses, 
  fetchAndUpsertArenaBlocks, 
  fetchAndUpsertGithubData 
};


