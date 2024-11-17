#!/usr/bin/env node
import OpenAI from "openai";
import { program } from "commander";
import { fetchAllBlocks } from "./dl_arena.mjs";
import { fetchStatuses, fetchUserId } from "./dl_mastodon.mjs";
import { fetchBookmarksWithCache, processBookmark } from "./dl_pinboard.mjs";
import { fetchGithubData, getRepoReadme } from "./dl_github.mjs";
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
import extractLocation from "./aiGeolocation.mjs";
import { extractRelationships } from "./aiRelationshipExtraction.mjs";
import dotenv from "dotenv";
import winston from "winston";
import { generateScreenshot } from './generateScreenshot.mjs';
import { v2 as cloudinary } from "cloudinary";

dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Environment variables and flags
let DEBUG = process.env.DEBUG === "true";
let isShuttingDown = false;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
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

// Graceful shutdown logic
async function gracefulShutdown() {
  log("Initiating graceful shutdown...");
  isShuttingDown = true;
  await limiter.stop({ dropWaitingJobs: true });
  await upsertLimiter.stop({ dropWaitingJobs: true });
  await browserLimiter.stop({ dropWaitingJobs: true });
  setTimeout(() => process.exit(0), 5000);
}

// Handle uncaught errors and shutdown signals
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  gracefulShutdown();
});

process.on("unhandledRejection", (error) => {
  logger.error("Unhandled Rejection:", error);
  gracefulShutdown();
});
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

// Generate embeddings using OpenAI
async function generateEmbedding(text) {
  if (!process.env.USE_OPENAI) return null;
  try {
    const response = await limiter.schedule(() =>
      openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: text,
      })
    );
    return response.data[0].embedding;
  } catch (error) {
    log("Embedding generation failed:", error.message);
    return null;
  }
}

// Check if scrap already exists in the database
async function getExistingScrap(shortId) {
  const { data, error } = await supabase
    .from("scraps")
    .select("*")
    .or(`id.eq.${shortId},metadata->>'shortId'.eq.${shortId}`)
    .single();
    
  if (error) {
    log(`Failed to retrieve scrap with ID: ${shortId}, error: ${error.message}`);
  }
  return data;
}

// Upsert a scrap into the database
async function upsertScrap(scrap) {
  const { error } = await supabase
    .from("scraps")
    .upsert({
      id: scrap.id,
      source: scrap.source,
      type: scrap.type,
      url: scrap.url,
      title: scrap.title,
      content: scrap.content,
      screenshot_url: scrap.screenshot_url,
      location: scrap.location,
      latitude: scrap.latitude,
      longitude: scrap.longitude,
      published_at: scrap.published_at,
      created_at: scrap.created_at,
      updated_at: scrap.updated_at,
      shared: scrap.shared,
      tags: scrap.tags,
      metadata: scrap.metadata
    });

  if (error) {
    log(`Failed to upsert scrap: ${scrap.id}, error: ${error.message}`);
  }
}

// Extract and add relationships to scrap
async function extractAndAddRelationships(scrapObj) {
  const content = scrapObj.summary || scrapObj.content;
  if (!content) return scrapObj;

  try {
    scrapObj.relationships = await limiter.schedule(() =>
      extractRelationships(content, { isRawText: !scrapObj.summary })
    );
  } catch (error) {
    logger.error(
      `Failed to extract relationships for ${scrapObj.id}:`,
      error.message
    );
    scrapObj.relationships = [];
  }

  return scrapObj;
}

// Generate a webpage screenshot using Puppeteer and upload to Supabase or Cloudinary
async function generateWebpageScreenshot(webUrl) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--single-process", // Add this to reduce memory usage
      "--disable-dev-shm-usage", // Add this to avoid using /dev/shm
    ],
    headless: "new",
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 }); // Reduce viewport size

  try {
    log(`Navigating to: ${webUrl}`);
    await page.goto(webUrl, { waitUntil: "networkidle0", timeout: 60000 });
    const screenshotBuffer = await page.screenshot({ encoding: "binary" });
    log(`Screenshot captured for ${webUrl}`);

    let screenshotUrl = null;

    if (process.env.SUPABASE_BUCKET) {
      const { data, error } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .upload(`screenshots/${Date.now()}.png`, screenshotBuffer, {
          contentType: "image/png",
        });
      if (error) {
        log(`Failed to upload screenshot to Supabase: ${error.message}`);
      } else {
        screenshotUrl = data.Key;
      }
    } else if (process.env.CLOUDINARY_FOLDER) {
      const result = await cloudinary.uploader.upload_stream(
        { folder: process.env.CLOUDINARY_FOLDER },
        (error, result) => {
          if (error) {
            log(`Failed to upload screenshot to Cloudinary: ${error.message}`);
          } else {
            screenshotUrl = result.secure_url;
          }
        }
      );
      result.end(screenshotBuffer);
    }

    return screenshotUrl;
  } catch (error) {
    log(`Failed to capture screenshot for ${webUrl}:`, error.message);
    return null;
  } finally {
    await browser.close();
  }
}
// Fetch and process Pinboard bookmarks
async function fetchAndUpsertPinboardBookmarks() {
  const rawBookmarks = await fetchBookmarksWithCache();
  log(`Fetched ${rawBookmarks.length} Pinboard bookmarks`);

  for (const bookmark of rawBookmarks) {
    if (isShuttingDown) break;
    
    try {
      // Process bookmark with new structure
      const processedBookmark = await processBookmark(bookmark);
      
      // Generate embeddings if enabled
      if (processedBookmark.content && process.env.USE_OPENAI) {
        processedBookmark.embedding = await generateEmbedding(processedBookmark.content);
      }

      // Extract relationships
      await extractAndAddRelationships(processedBookmark);
      
      // Upsert to database
      await upsertScrap(processedBookmark);
    } catch (error) {
      log(`Failed to process bookmark: ${bookmark.href}`, error);
    }
  }
}

// Fetch and process Mastodon statuses
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
      await upsertScrap(processedStatus);
    } catch (error) {
      log(`Failed to process status: ${status.id}`, error);
    }
  }
}

// Fetch and process Are.na blocks
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
      await upsertScrap(processedBlock);
    } catch (error) {
      log(`Failed to process block: ${block.id}`, error);
    const scrapId = helpers.scrapToUUID("arena" + block.id);
    if (newOnly && (await getExistingScrap(scrapId))) continue;

    const blockObj = {
      scrap_id: scrapId,
      source: "arena",
      content: block.content,
      tags: block.tags,
      metadata: {
        title: block.title,
        description: block.description,
        source: block.source,
        image: block.image,
        screenshotUrl: await browserLimiter.schedule(() =>
          generateWebpageScreenshot(block.source.url)
        ),
      },
    };

    if (block.connected_to_channels?.length > 0) {
      blockObj.relationships = block.connected_to_channels.map((channel) => ({
        source: {
          type: "Block",
          name: block.title || `Block ${block.id}`,
        },
        target: { type: "Channel", name: channel.title },
        type: "BELONGS_TO",
      }));
    }
  }
}

// Fetch and process GitHub data
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
      await upsertScrap(scrap);
    } catch (error) {
      log(`Failed to process GitHub item: ${scrap.id}`, error);
    }

    const scrapObj = {
      scrap_id: scrapId,
      source: "github",
      content,
      summary,
      tags: [...new Set([...(scrap.topics || []), ...aiGeneratedTags])],
      metadata: {
        type: scrap.type,
        name: scrap.name || scrap.title,
        full_name:
          scrap.full_name || (scrap.repo && scrap.repo.full_name) || null,
        href: scrap.html_url,
        language: scrap.language,
        stargazers_count: scrap.stargazers_count,
        forks_count: scrap.forks_count,
        images: scrap.images || [],
        screenshotUrl: await browserLimiter.schedule(() =>
          generateWebpageScreenshot(scrap.html_url)
        ),
      },
    };

    await upsertLimiter.schedule(() => upsertScrap(scrapObj, newOnly));
  }
}

// Main function orchestrating the whole process
async function main(options = {}) {
  options = { newOnly: true, ...options };
  logger.info("Starting processing with options:", JSON.stringify(options));

  try {
    // Test Supabase connection
    const { data, error } = await supabase.from("scraps").select("count");
    if (error) throw error;
    logger.info(`Successfully connected to Supabase. Found ${data[0].count} scraps`);

    if (options.pinboard) {
      logger.info("Starting Pinboard fetch...");
      await fetchAndUpsertPinboardBookmarks(options.newOnly);
    }
    if (options.mastodon) {
      logger.info("Starting Mastodon fetch...");
      await fetchAndUpsertMastodonStatuses(options.newOnly);
    }
    if (options.arena) {
      logger.info("Starting Arena fetch...");
      await fetchAndUpsertArenaBlocks(options.newOnly);
    }
    if (options.github) {
      logger.info("Starting GitHub fetch...");
      await fetchAndUpsertGithubData(options.newOnly);
    }

    logger.info("Processing completed successfully.");
  } catch (error) {
    logger.error("Error in main process:", error);
    throw error; // Re-throw to trigger non-zero exit code
  }
}

// Command-line interface setup
program
  .option("--pinboard", "Fetch and upsert Pinboard bookmarks")
  .option("--mastodon", "Fetch and upsert Mastodon statuses")
  .option("--arena", "Fetch and upsert Are.na blocks")
  .option("--github", "Fetch and upsert GitHub data")
  .option("--all", "Fetch and upsert all data sources")
  .option("--new-only", "Only upload new entries")
  .option("--debug", "Enable debug mode")
  .parse(process.argv);

const options = program.opts();
DEBUG = options.debug;

main(options).catch(gracefulShutdown);
