#!/usr/bin/env node

// First do all imports
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
import os from "os";

dotenv.config();

// IMMEDIATELY set up commander before anything else
program
  .allowUnknownOption()
  .option('--all', 'Fetch from all sources')
  .option('--pinboard', 'Fetch from Pinboard')
  .option('--mastodon', 'Fetch from Mastodon')
  .option('--arena', 'Fetch from Are.na')
  .option('--github', 'Fetch from GitHub')
  .option('--debug', 'Enable debug logging')
  .option('--test', 'Run in test mode (process fewer items)');

// Parse arguments (no sync needed!)
program.parse(process.argv);

// Debug logging AFTER parsing
console.log('Process arguments:', process.argv);
console.log('Parsed options:', program.opts());

// Get options
const options = program.opts();
const DEBUG = options.debug || process.env.DEBUG === "true";

// Validate required environment variables early
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
];

const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

// Environment variables and flags
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
    .or(
      `id.eq."${scrapData.id}",` +
      `scrap_id.eq."${scrapData.scrap_id}",` +
      `url.eq."${scrapData.url}"`
    )
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
      
      // Add processing metadata
      mergedData.metadata = {
        ...mergedData.metadata,
        last_processed_by: INSTANCE_NAME,
        last_processed_at: new Date().toISOString()
      };
      
      // Perform upsert
      const { error } = await supabase
        .from("scraps")
        .upsert(mergedData, {
          onConflict: 'scrap_id',
          ignoreDuplicates: true,
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

// Add this helper function near the top with other helper functions
async function generateSummaryAndTags(scrapObj) {
  if (!scrapObj.content) return scrapObj;

  try {
    if (process.env.OPENROUTER_API_KEY) {
      // Generate summary
      scrapObj.summary = await limiter.schedule(() =>
        summarizeContent(scrapObj.content, { metaSummary: true })
      );

      // Generate tags from summary if we have one
      if (scrapObj.summary) {
        const summaryTags = await limiter.schedule(() =>
          metaSummaryToTags(scrapObj.summary)
        );
        scrapObj.tags = [...new Set([...(scrapObj.tags || []), ...summaryTags])];
      }
    } else {
      logger.info('Skipping summary generation - OpenRouter API key not configured');
      logger.info('Please set OPENROUTER_API_KEY to enable AI features');
    }
  } catch (error) {
    logger.error(
      `Failed to generate summary for ${scrapObj.id}:`,
      error.message
    );
  }

  return scrapObj;
}

// Add this helper function
async function shouldProcessScrap(scrapData) {
  if (!scrapData.url && !scrapData.scrap_id) return true;

  const { data, error } = await supabase
    .from("scraps")
    .select("updated_at, metadata")
    .or(
      'url.eq.' + scrapData.url,
      'scrap_id.eq.' + scrapData.scrap_id
    )
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    logger.error(`Error checking existing scrap: ${error.message}`);
    return true;
  }

  if (!data || data.length === 0) return true;

  const existing = data[0];
  const lastChecked = existing.metadata?.last_checked;
  
  if (!lastChecked) return true;

  // Only reprocess if it's been more than 24 hours
  const hoursSinceLastCheck = (Date.now() - new Date(lastChecked).getTime()) / (1000 * 60 * 60);
  return hoursSinceLastCheck > 24;
}

// Add near the top with other constants
const INSTANCE_NAME = process.env.INSTANCE_NAME || `${process.env.NODE_ENV || 'dev'}-${os.hostname()}-${Date.now()}`;
const STUCK_THRESHOLD_MINS = 5;

// Add this helper function
async function claimScrap(scrapId) {
  try {
    const { data, error } = await supabase
      .from('scraps')
      .update({
        processing_instance_id: INSTANCE_NAME,
        processing_started_at: new Date().toISOString()
      })
      .eq('scrap_id', scrapId)
      .is('processing_instance_id', null)
      .select()
      .single();

    if (error) {
      logger.error(`Failed to claim scrap ${scrapId}:`, error);
      return false;
    }

    return Boolean(data);
  } catch (error) {
    logger.error(`Error claiming scrap ${scrapId}:`, error);
    return false;
  }
}

async function releaseScrap(scrapId) {
  try {
    const { error } = await supabase
      .from('scraps')
      .update({
        processing_instance_id: null,
        processing_started_at: null
      })
      .eq('scrap_id', scrapId);

    if (error) {
      logger.error(`Failed to release scrap ${scrapId}:`, error);
    }
  } catch (error) {
    logger.error(`Error releasing scrap ${scrapId}:`, error);
  }
}

// Add this function to check and clear stuck processing
async function clearStuckProcessing() {
  try {
    const { data: stuckScraps } = await supabase
      .from('scraps')
      .select('scrap_id')
      .not('processing_instance_id', 'is', null)
      .lt('processing_started_at', 
        new Date(Date.now() - STUCK_THRESHOLD_MINS * 60 * 1000).toISOString()
      );

    if (stuckScraps?.length) {
      logger.info(`Found ${stuckScraps.length} stuck scraps, clearing...`);
      const { error } = await supabase
        .from('scraps')
        .update({
          processing_instance_id: null,
          processing_started_at: null
        })
        .in('scrap_id', stuckScraps.map(s => s.scrap_id));

      if (error) {
        logger.error('Failed to clear stuck processing:', error);
      }
    }
  } catch (error) {
    logger.error('Error clearing stuck processing:', error);
  }
}

// Then define the functions
async function fetchAndUpsertPinboardBookmarks() {
  const bookmarks = await fetchBookmarksWithCache();
  logger.info(`Found ${bookmarks.length} bookmarks`);

  for (const bookmark of bookmarks) {
    if (isShuttingDown) break;
    
    const scrapId = `pinboard-${bookmark.hash}`;
    
    try {
      // Try to claim the scrap
      if (!await claimScrap(scrapId)) {
        logger.info(`Skipping bookmark ${bookmark.href} - already being processed`);
        continue;
      }

      try {
        const processedBookmark = await processBookmark(bookmark);
        if (processedBookmark) {
          await upsertWithRetry(processedBookmark);
        }
      } finally {
        // Always release the claim
        await releaseScrap(scrapId);
      }
    } catch (error) {
      logger.error(`Failed to process bookmark: ${bookmark.href}`, error);
      await releaseScrap(scrapId);
    }
  }
}

async function fetchAndUpsertMastodonStatuses() {
  const userId = await fetchUserId();
  const statuses = await fetchStatuses(userId);
  logger.info(`Found ${statuses.length} Mastodon statuses`);

  for (const status of statuses) {
    if (isShuttingDown) break;
    
    const scrapId = `mastodon-${status.id}`;
    
    try {
      // Try to claim the scrap
      if (!await claimScrap(scrapId)) {
        logger.info(`Skipping status ${status.id} - already being processed`);
        continue;
      }

      try {
        let processedStatus = await processStatus(status);
        processedStatus = await generateSummaryAndTags(processedStatus);
        processedStatus = await extractAndAddRelationships(processedStatus);
        
        await upsertWithRetry(processedStatus);
      } finally {
        // Always release the claim
        await releaseScrap(scrapId);
      }
    } catch (error) {
      logger.error(`Failed to process status: ${status.id}`, error);
      await releaseScrap(scrapId);
    }
  }
}

async function fetchAndUpsertArenaBlocks() {
  const blocks = await fetchAllBlocks();
  logger.info(`Fetched ${blocks.length} Are.na blocks`);

  for (const block of blocks) {
    if (isShuttingDown) break;

    const scrapId = `arena-${block.id}`;
    
    try {
      // Try to claim the scrap
      if (!await claimScrap(scrapId)) {
        logger.info(`Skipping block ${block.id} - already being processed`);
        continue;
      }

      try {
        const processedBlock = await processBlock(block);
        
        if (processedBlock.content && process.env.USE_OPENAI) {
          processedBlock.embedding = await generateEmbedding(processedBlock.content);
        }

        await extractAndAddRelationships(processedBlock);
        await upsertWithRetry(processedBlock);
      } finally {
        await releaseScrap(scrapId);
      }
    } catch (error) {
      logger.error(`Failed to process block: ${block.id}`, error);
      await releaseScrap(scrapId);
    }
  }
}

async function fetchAndUpsertGithubData() {
  const githubData = await fetchGithubData();
  logger.info(`Fetched GitHub data`);

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

    const scrapId = `github-${scrap.id}`;
    
    try {
      // Try to claim the scrap
      if (!await claimScrap(scrapId)) {
        logger.info(`Skipping GitHub item ${scrap.id} - already being processed`);
        continue;
      }

      try {
        if (scrap.content && process.env.USE_OPENAI) {
          scrap.embedding = await generateEmbedding(scrap.content);
        }

        await extractAndAddRelationships(scrap);
        await upsertWithRetry(scrap);
      } finally {
        await releaseScrap(scrapId);
      }
    } catch (error) {
      logger.error(`Failed to process GitHub item: ${scrap.id}`, error);
      await releaseScrap(scrapId);
    }
  }
}

// Main execution function
async function main() {
  logger.info(`Starting scrapbook processing (Instance: ${INSTANCE_NAME})`);
  
  try {
    // Clear any stuck processing before starting
    await clearStuckProcessing();

    // 1. Pinboard first
    if (options.all || options.pinboard) {
      logger.info("\nFetching from Pinboard...");
      await fetchAndUpsertPinboardBookmarks();
    }

    // 2. GitHub second
    if (options.all || options.github) {
      logger.info("\nFetching from GitHub...");
      await fetchAndUpsertGithubData();
    }

    // 3. Mastodon third
    if (options.all || options.mastodon) {
      logger.info("\nFetching from Mastodon...");
      await fetchAndUpsertMastodonStatuses();
    }

    // 4. Are.na last
    if (options.all || options.arena) {
      logger.info("\nFetching from Are.na...");
      await fetchAndUpsertArenaBlocks();
    }

    logger.info("\nProcessing completed successfully");
    process.exit(0);
  } catch (error) {
    logger.error("Fatal error in main process:", error);
    process.exit(1);
  }

  if (options.all) {
    // Run claim cleanup every minute when doing full processing
    const cleanupInterval = setInterval(clearStuckProcessing, 60 * 1000);
    process.on('exit', () => clearInterval(cleanupInterval));
  }
}

// Run main function with better error handling
if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

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


