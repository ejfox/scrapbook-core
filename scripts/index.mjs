#!/usr/bin/env node

// First do all imports
import { program } from "commander";
import { fetchAllBlocks, processBlock } from "./dl_arena.mjs";
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
import { generateScreenshot } from "./generateScreenshot.mjs";
import { v2 as cloudinary } from "cloudinary";
import os from "os";
import axios from "axios";
import chalk from "chalk";
import sgMail from "@sendgrid/mail";
import Arena from "are.na";
import { arenaLimiter, processLimiter } from "./shared/rateLimiters.mjs";
import { processImagesForScrap, getImageEmbedding } from "./imageEmbedding.mjs";

dotenv.config();

// IMMEDIATELY set up commander before anything else
program
  .allowUnknownOption()
  .option("--all", "Fetch from all sources")
  .option("--pinboard", "Fetch from Pinboard")
  .option("--mastodon", "Fetch from Mastodon")
  .option("--arena", "Fetch from Are.na")
  .option("--github", "Fetch from GitHub")
  .option("--debug", "Enable debug logging")
  .option("--test", "Run in test mode (process fewer items)");

// Parse arguments (no sync needed!)
program.parse(process.argv);

// Debug logging AFTER parsing
console.log("Process arguments:", process.argv);
console.log("Parsed options:", program.opts());

// Get options
const options = program.opts();
const DEBUG = options.debug || process.env.DEBUG === "true";

// Setup logging
const logger = winston.createLogger({
  level: DEBUG ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

// Initialize Arena client
const USER_SLUG = process.env.USER_SLUG || "ej-fox";
const ARENA_ACCESS_TOKEN = process.env.ARENA_ACCESS_TOKEN;

if (!ARENA_ACCESS_TOKEN) {
  console.error("ARENA_ACCESS_TOKEN is not set in environment variables");
  process.exit(1);
}

const arena = new Arena({ accessToken: ARENA_ACCESS_TOKEN });

// Configure SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Function to send email notification using SendGrid
async function sendEmailNotification(subject, message) {
  const msg = {
    to: "ejfox@ejfox.com",
    from: process.env.SENDGRID_FROM_EMAIL, // Your SendGrid verified sender email
    subject: subject,
    text: message,
    html: `<p>${message}</p>`, // Optional HTML body
  };

  try {
    await sgMail.send(msg);
    logger.info("Email notification sent successfully!");
  } catch (error) {
    logger.error("Error sending email notification:", error);
  }
}

// Validate required environment variables early
const requiredEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingEnvVars.length > 0) {
  console.error(
    "Missing required environment variables:",
    missingEnvVars.join(", ")
  );
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
      schema: "public",
    },
    global: {
      headers: { "x-my-custom-header": "scrapbook-core" },
    },
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

// Replace console.log with logger
function log(...args) {
  if (DEBUG) logger.debug(args.join(" "));
}

// Improve shutdown handling
async function gracefulShutdown() {
  if (isShuttingDown) {
    console.log("Shutdown already in progress...");
    return;
  }

  isShuttingDown = true;
  logger.info("Initiating graceful shutdown...");

  try {
    // Stop all limiters
    await Promise.all([
      limiter.stop({ dropWaitingJobs: true }),
      upsertLimiter.stop({ dropWaitingJobs: true }),
      browserLimiter.stop({ dropWaitingJobs: true }),
    ]);

    logger.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  gracefulShutdown();
});
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown();
});

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

// Add near the top with other helper functions
function validateAIOutput(type, data) {
  try {
    switch (type) {
      case "summary":
        return typeof data === "string" && data.length > 0 ? data : null;

      case "tags":
        return Array.isArray(data)
          ? data.filter((t) => typeof t === "string")
          : [];

      case "relationships":
        if (!Array.isArray(data)) return [];
        return data.filter(
          (r) =>
            r &&
            typeof r === "object" &&
            typeof r.source === "string" &&
            typeof r.relationship === "string" &&
            typeof r.target === "string"
        );

      case "location":
        if (!data || typeof data !== "object") return null;
        return {
          name: data.location || "",
          latitude: Number(data.latitude) || null,
          longitude: Number(data.longitude) || null,
          metadata: data.metadata || {},
        };

      default:
        logger.warn(`Unknown AI output type: ${type}`);
        return null;
    }
  } catch (error) {
    logger.error(`Error validating ${type} output:`, error);
    return null;
  }
}

// Simplify enrichScrapWithAI to handle tags more directly
async function enrichScrapWithAI(scrapData) {
  if (!process.env.OPENROUTER_API_KEY || !process.env.NOMIC_API_KEY) {
    logger.info("Skipping AI enrichment - API keys not configured");
    return scrapData;
  }

  const scrapIdentifier =
    scrapData.scrap_id || scrapData.id || `${scrapData.source}-${Date.now()}`;
  logger.info(`🔍 Starting AI enrichment for ${scrapIdentifier}`);

  try {
    // Get content to process
    const contentToProcess = [
      scrapData.content,
      scrapData.description,
      scrapData.title,
      scrapData.metadata?.description,
      scrapData.metadata?.content,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!contentToProcess) {
      logger.info("⚠️ No content to process for AI enrichment");
      return scrapData;
    }

    // Generate text embedding
    logger.info("📊 Generating text embedding...");
    const textEmbedding = await limiter.schedule(() =>
      generateEmbedding(contentToProcess, { type: "text" })
    );
    if (textEmbedding) {
      scrapData.embedding_nomic = textEmbedding;
      logger.info("✅ Text embedding generated");
    }

    // Process images and generate image embedding if screenshot exists
    if (scrapData.screenshot_url) {
      logger.info("🖼️ Processing image...");
      const withImageEmbedding = await processImagesForScrap(scrapData);
      if (withImageEmbedding.image_embedding) {
        scrapData.image_embedding = withImageEmbedding.image_embedding;
        logger.info("✅ Image embedding generated");
      }
    }

    // Generate summary
    logger.info(`🤖 Generating summary for ${scrapIdentifier}...`);
    const summary = await limiter.schedule(() =>
      summarizeContent(contentToProcess, { metaSummary: true })
    );

    if (summary) {
      logger.info(`✅ Generated summary (${summary.length} chars)`);
      scrapData.summary = summary;

      // Generate tags from summary
      logger.info(`🏷️ Generating tags from summary...`);
      const summaryTags = await limiter.schedule(() =>
        metaSummaryToTags(summary)
      );

      if (summaryTags?.length) {
        logger.info(
          `✅ Generated ${summaryTags.length} tags: ${summaryTags.join(", ")}`
        );
        scrapData.tags = scrapData.tags || [];
        if (typeof scrapData.tags === "string") {
          try {
            scrapData.tags = JSON.parse(scrapData.tags);
          } catch (error) {
            logger.error(`Error parsing existing tags: ${error.message}`);
            scrapData.tags = [];
          }
        }
        scrapData.tags = [...new Set([...scrapData.tags, ...summaryTags])];
      }

      // Extract location information
      logger.info("🌍 Extracting location information...");
      const locationInfo = await limiter.schedule(() =>
        extractLocation(contentToProcess)
      );

      if (locationInfo) {
        const validatedLocation = validateAIOutput("location", locationInfo);
        if (validatedLocation) {
          scrapData.location = validatedLocation.name;
          scrapData.latitude = validatedLocation.latitude;
          scrapData.longitude = validatedLocation.longitude;
          scrapData.metadata = {
            ...scrapData.metadata,
            otherLocations: validatedLocation.metadata.otherLocations || [],
          };
          logger.info(`✅ Location extracted: ${validatedLocation.name}`);
        }
      }

      // Extract relationships
      logger.info("🔗 Extracting relationships...");
      const relationships = await limiter.schedule(() =>
        extractRelationships(contentToProcess)
      );

      if (relationships) {
        const validatedRelationships = validateAIOutput(
          "relationships",
          relationships
        );
        if (validatedRelationships.length > 0) {
          scrapData.relationships = validatedRelationships;
          logger.info(
            `✅ Found ${validatedRelationships.length} relationships`
          );
        }
      }
    }

    return scrapData;
  } catch (error) {
    logger.error("Error during AI enrichment:", error);
    return scrapData;
  }
}

// Simplify mergeScrapData as well
function mergeScrapData(existing, updated) {
  if (!existing) return updated;

  return {
    ...existing,
    ...updated,
    // Keep existing AI fields if not in update
    summary: updated.summary || existing.summary,
    location: updated.location || existing.location,
    latitude: updated.latitude || existing.latitude,
    longitude: updated.longitude || existing.longitude,
    // Keep track of updates
    metadata: {
      ...(existing.metadata || {}),
      ...(updated.metadata || {}),
      last_updated: new Date().toISOString(),
      update_count: (existing.metadata?.update_count || 0) + 1,
    },
  };
}

// Update the claimAndProcess function to include AI enrichment
async function claimProcessAndUpsert(scrapId, source, data, processFunction) {
  try {
    // First check if scrap exists and its processing status
    const { data: existing } = await supabase
      .from("scraps")
      .select(
        "processing_instance_id, processing_started_at, screenshot_url, metadata"
      )
      .eq("scrap_id", scrapId)
      .single();

    if (existing) {
      // Check if we already have a valid image
      const hasValidImage =
        existing.screenshot_url ||
        existing.metadata?.image_data?.cloudinary_url;

      if (hasValidImage) {
        logger.debug(
          `Skipping image processing for ${scrapId} - already has image`
        );
        data.screenshot_url = existing.screenshot_url;
        data.metadata = {
          ...data.metadata,
          image_data: existing.metadata?.image_data,
        };
      }
    }

    if (!existing) {
      // New scrap - create it with our claim
      const { error: insertError } = await supabase.from("scraps").insert({
        scrap_id: scrapId,
        processing_instance_id: INSTANCE_NAME,
        processing_started_at: new Date().toISOString(),
        source: source,
        type: getTypeFromSource(source),
        content: "",
        title: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
        tags: [],
      });

      if (insertError) {
        logger.error(`Failed to create scrap ${scrapId}:`, insertError);
        return false;
      }
    } else {
      // Existing scrap - check if stuck and try to claim
      const processingStarted = new Date(existing.processing_started_at);
      const isStuck = Date.now() - processingStarted.getTime() > 5 * 60 * 1000;

      if (existing.processing_instance_id && !isStuck) {
        logger.info(`Skipping ${scrapId} - already being processed`);
        return false;
      }

      // Try to claim existing scrap
      const { error: updateError } = await supabase
        .from("scraps")
        .update({
          processing_instance_id: INSTANCE_NAME,
          processing_started_at: new Date().toISOString(),
        })
        .eq("scrap_id", scrapId);

      if (updateError) {
        logger.error(`Failed to claim scrap ${scrapId}:`, updateError);
        return false;
      }
    }

    try {
      // Process the data first
      const processedData = await processFunction(data);

      if (processedData) {
        // Ensure scrap_id is set before AI enrichment
        processedData.scrap_id = scrapId;

        // Add AI enrichment step here
        const enrichedData = await enrichScrapWithAI(processedData);

        // Upsert the enriched data
        const { error: upsertError } = await supabase.from("scraps").upsert(
          {
            ...enrichedData,
            source: source,
            type: enrichedData.type || getTypeFromSource(source),
            scrap_id: scrapId, // Ensure scrap_id is set in final data
            content: enrichedData.content || "",
            title: enrichedData.title || "",
            metadata: enrichedData.metadata || {},
            tags: enrichedData.tags || [],
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "scrap_id",
            returning: "minimal",
          }
        );

        if (upsertError) {
          logger.error(`Failed to upsert ${scrapId}:`, upsertError);
          return false;
        }

        logger.info(
          chalk.green(`✅ Successfully upserted ${scrapId} to database`)
        );
      }

      return true;
    } finally {
      // Release the claim
      await supabase
        .from("scraps")
        .update({
          processing_instance_id: null,
          processing_started_at: null,
        })
        .eq("scrap_id", scrapId);
    }
  } catch (error) {
    logger.error(`Error processing ${scrapId}:`, error);
    return false;
  }
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
        last_processed_at: new Date().toISOString(),
      };

      // Perform upsert
      const { error } = await supabase.from("scraps").upsert(mergedData, {
        onConflict: "scrap_id",
        ignoreDuplicates: true,
        returning: "minimal",
      });

      if (error) {
        if (error.message.includes("timeout") && i < retries - 1) {
          logger.warn(`Timeout on attempt ${i + 1}, retrying...`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
          continue;
        }
        throw error;
      }

      return;
    } catch (error) {
      if (i === retries - 1) throw error;
      logger.warn(`Error on attempt ${i + 1}, retrying: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
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
      logger.info(
        "Skipping relationship extraction - OpenRouter API key not configured"
      );
      logger.info("Please set OPENROUTER_API_KEY to enable AI features");
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
        scrapObj.tags = [
          ...new Set([...(scrapObj.tags || []), ...summaryTags]),
        ];
      }
    } else {
      logger.info(
        "Skipping summary generation - OpenRouter API key not configured"
      );
      logger.info("Please set OPENROUTER_API_KEY to enable AI features");
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
    .or("url.eq." + scrapData.url, "scrap_id.eq." + scrapData.scrap_id)
    .order("updated_at", { ascending: false })
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
  const hoursSinceLastCheck =
    (Date.now() - new Date(lastChecked).getTime()) / (1000 * 60 * 60);
  return hoursSinceLastCheck > 24;
}

// Get instance ID using Fly.io's allocation ID or fallback for local dev
const INSTANCE_NAME = process.env.FLY_ALLOC_ID
  ? `fly-${process.env.FLY_ALLOC_ID}`
  : `local-${os.hostname().toLowerCase()}-${process.platform}-${
      process.env.NODE_ENV || "dev"
    }`;
const STUCK_THRESHOLD_MINS = 5;

// Add this helper function
async function processContent(data) {
  if (!data) return null;

  try {
    return {
      title: data.title || "",
      content: data.content || data.description || "",
      url: data.url || data.href || "",
      type: data.type || "unknown",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        original: data,
        processed_at: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error("Error processing content:", error);
    return null;
  }
}

// Helper function to claim existing scrap
async function claimExistingScrap(scrapId) {
  const { data, error } = await supabase
    .from("scraps")
    .update({
      processing_instance_id: INSTANCE_NAME,
      processing_started_at: new Date().toISOString(),
    })
    .eq("scrap_id", scrapId)
    .is("processing_instance_id", null)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No rows returned
      logger.debug(`Scrap ${scrapId} is already being processed`);
      return false;
    }
    logger.error(`Failed to claim scrap ${scrapId}:`, error);
    return false;
  }

  return Boolean(data);
}

// Add helper function to get default type
function getTypeFromSource(source) {
  const defaultTypes = {
    pinboard: "bookmark",
    mastodon: "status",
    arena: "block",
    github: "repo",
  };
  return defaultTypes[source] || "unknown";
}

async function releaseScrap(scrapId) {
  try {
    const { error } = await supabase
      .from("scraps")
      .update({
        processing_instance_id: null,
        processing_started_at: null,
      })
      .eq("scrap_id", scrapId);

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
      .from("scraps")
      .select("scrap_id")
      .not("processing_instance_id", "is", null)
      .lt(
        "processing_started_at",
        new Date(Date.now() - STUCK_THRESHOLD_MINS * 60 * 1000).toISOString()
      );

    if (stuckScraps?.length) {
      logger.info(`Found ${stuckScraps.length} stuck scraps, clearing...`);
      const { error } = await supabase
        .from("scraps")
        .update({
          processing_instance_id: null,
          processing_started_at: null,
        })
        .in(
          "scrap_id",
          stuckScraps.map((s) => s.scrap_id)
        );

      if (error) {
        logger.error("Failed to clear stuck processing:", error);
      }
    }
  } catch (error) {
    logger.error("Error clearing stuck processing:", error);
  }
}

// Add OpenRouter API URL
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";

// Then define the functions
async function fetchAndUpsertPinboardBookmarks() {
  const bookmarks = await fetchBookmarksWithCache();
  logger.info(`Found ${bookmarks.length} bookmarks`);

  for (const bookmark of bookmarks) {
    if (isShuttingDown) break;

    const scrapId = `pinboard-${bookmark.hash}`;

    try {
      if (
        !(await claimProcessAndUpsert(
          scrapId,
          "pinboard",
          bookmark,
          processBookmark
        ))
      ) {
        logger.info(
          `Skipping bookmark ${bookmark.href} - already being processed`
        );
        continue;
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

  for (const status of statuses) {
    if (isShuttingDown) break;

    const scrapId = `mastodon-${status.id}`;

    try {
      if (
        !(await claimProcessAndUpsert(
          scrapId,
          "mastodon",
          status,
          processStatus
        ))
      ) {
        logger.info(`Skipping status ${status.id} - already being processed`);
        continue;
      }
    } catch (error) {
      logger.error(`Failed to process status: ${status.id}`, error);
      await releaseScrap(scrapId);
    }
  }
}

async function fetchAndUpsertArenaBlocks() {
  const channels = await arena.user(USER_SLUG).channels();
  logger.info(chalk.green(`📚 Found ${channels.length} channels`));

  for (const channel of channels) {
    if (isShuttingDown) break;

    logger.info(chalk.blue(`\n📂 Processing channel: ${channel.title}`));

    const blocks = await arenaLimiter.schedule(() =>
      arena.channel(channel.id).contents({
        page: 1,
        per: 100,
        sort: "updated_at",
        direction: "desc",
      })
    );

    if (!blocks?.length) {
      logger.warn(chalk.yellow(`No blocks found in channel: ${channel.title}`));
      continue;
    }

    logger.info(chalk.green(`📦 Found ${blocks.length} blocks`));

    // Process blocks in this channel
    for (const block of blocks) {
      if (isShuttingDown) break;

      const enrichedBlock = {
        ...block,
        channel: channel.title,
        connected_to_channels: [
          {
            id: channel.id,
            title: channel.title,
          },
          ...(block.connected_to_channels || []),
        ],
      };

      const scrapId = `arena-${block.id}`;

      try {
        if (
          !(await claimProcessAndUpsert(
            scrapId,
            "arena",
            enrichedBlock,
            processBlock
          ))
        ) {
          logger.info(`Skipping block ${block.id} - already being processed`);
          continue;
        }
      } catch (error) {
        logger.error(`Failed to process block: ${block.id}`, error);
        await releaseScrap(scrapId);
      }
    }

    logger.info(
      chalk.green(`✅ Finished processing channel: ${channel.title}`)
    );
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
    ...githubData.starredRepos,
  ];

  for (const scrap of allScraps) {
    if (isShuttingDown) break;

    const scrapId = `github-${scrap.id}`;

    try {
      if (
        !(await claimProcessAndUpsert(scrapId, "github", scrap, (data) => data))
      ) {
        logger.info(
          `Skipping GitHub item ${scrap.id} - already being processed`
        );
        continue;
      }
    } catch (error) {
      logger.error(`Failed to process GitHub item: ${scrap.id}`, error);
      await releaseScrap(scrapId);
    }
  }
}

// Add near the top of main()
async function initializeDatabaseIfNeeded() {
  const { count } = await supabase
    .from("scraps")
    .select("*", { count: "exact", head: true });

  if (count === 0) {
    logger.info("Database is empty, initializing...");

    // Create a test scrap using 'lock' as source
    const { error } = await supabase.from("scraps").insert({
      scrap_id: "init-test",
      source: "lock", // Changed from 'system' to 'lock'
      type: "init",
      content: "Database initialization test",
      title: "Initialization Test",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        initialization: true,
        initialized_at: new Date().toISOString(),
        instance_name: INSTANCE_NAME,
      },
    });

    if (error) {
      logger.error("Failed to initialize database:", error);
      process.exit(1);
    }

    logger.info("Database initialized successfully");
  }
}

// Add a function to check OpenRouter credits
async function checkOpenRouterCredits() {
  if (!process.env.OPENROUTER_API_KEY) {
    logger.info(
      "Skipping OpenRouter credit check - OpenRouter API key not configured"
    );
    return true; // Assume sufficient credits if key is not set
  }

  try {
    const response = await axios.get(`${OPENROUTER_API_URL}/auth/key`, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!response.data?.data) {
      throw new Error("Invalid response format from OpenRouter API");
    }

    const { usage, limit, is_free_tier, rate_limit } = response.data.data;

    if (usage >= limit) {
      logger.error(
        chalk.redBright(
          `OpenRouter credit limit exceeded! Usage: ${usage}, Limit: ${limit}. Processing stopped.`
        )
      );
      return false;
    }

    logger.info(
      `OpenRouter credits - Usage: ${usage}, Limit: ${limit}, Type: ${
        is_free_tier ? "Free" : "Paid"
      }, Rate Limit: ${rate_limit?.requests}/${rate_limit?.interval}`
    );
    return true;
  } catch (error) {
    logger.error(
      `Error checking OpenRouter credits: ${error.message}. Processing stopped.`
    );
    return false;
  }
}

// Main execution function
async function main() {
  logger.info(`Starting scrapbook processing (Instance: ${INSTANCE_NAME})`);
  +(+logger.info(chalk.blue("\n🗺️ Processing Plan:")));
  +logger.info(chalk.gray("1. Check OpenRouter credits (for AI features)"));
  +logger.info(chalk.gray("2. Initialize database if needed"));
  +logger.info(
    chalk.gray("3. Clear any stuck processing from crashed instances")
  );
  +logger.info(chalk.gray("4. Process each source in sequence:"));
  +logger.info(chalk.gray("   • Pinboard: Fetch bookmarks & process"));
  +logger.info(chalk.gray("   • GitHub: Fetch repos/PRs/issues & process"));
  +logger.info(chalk.gray("   • Mastodon: Fetch statuses & process"));
  +logger.info(chalk.gray("   • Are.na: Fetch channels -> blocks & process"));
  +logger.info(chalk.gray("\nFor each item:"));
  +logger.info(chalk.gray("1. Try to claim it for processing"));
  +logger.info(chalk.gray("2. Process content & generate embeddings"));
  +logger.info(chalk.gray("3. Upload images to Cloudinary if needed"));
  +logger.info(chalk.gray("4. Save to database"));
  +logger.info(chalk.gray("5. Release claim\n"));

  try {
    // Check OpenRouter credits before starting processing
    +logger.info(chalk.blue("\n1️⃣ Checking OpenRouter Credits..."));
    const sufficientCredits = await checkOpenRouterCredits();
    if (!sufficientCredits) {
      return; // Stop processing if credits are insufficient
    }

    // Initialize database if needed
    +logger.info(chalk.blue("\n2️⃣ Initializing Database..."));
    await initializeDatabaseIfNeeded();

    // Clear any stuck processing before starting
    +logger.info(chalk.blue("\n3️⃣ Cleaning Up Stuck Processing..."));
    await clearStuckProcessing();

    // Process each source
    +logger.info(chalk.blue("\n4️⃣ Processing Sources..."));
    for (const source of ["pinboard", "github", "mastodon", "arena"]) {
      if (options.all || options[source]) {
        logger.info(
          chalk.green(`\n🔄 Starting ${chalk.bold(source)} processing...`)
        );

        // Map source names to their functions
        const sourceFunctions = {
          pinboard: fetchAndUpsertPinboardBookmarks,
          github: fetchAndUpsertGithubData,
          mastodon: fetchAndUpsertMastodonStatuses,
          arena: fetchAndUpsertArenaBlocks,
        };

        try {
          await sourceFunctions[source]();
        } catch (error) {
          logger.error(
            chalk.red(`❌ Error processing ${source}:`),
            error.message
          );
          if (DEBUG) {
            logger.error(chalk.gray("Full error:"), error);
          }
        }
      }
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
    process.on("exit", () => clearInterval(cleanupInterval));
  }
}

// Run main function with better error handling
if (import.meta.url === `file://${process.argv[1]}`) {
  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
  });

  main().catch((error) => {
    logger.error("Unhandled error:", error);
    process.exit(1);
  });
}

export {
  fetchAndUpsertPinboardBookmarks,
  fetchAndUpsertMastodonStatuses,
  fetchAndUpsertArenaBlocks,
  fetchAndUpsertGithubData,
};
