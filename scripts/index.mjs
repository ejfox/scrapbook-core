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
import { generateEmbedding } from "./llmService.mjs";
import { extractLocation } from "./aiGeolocation.mjs";
import { extractRelationships } from "./aiRelationshipExtraction.mjs";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import winston from "winston";
import LokiTransport from "winston-loki";
import { generateScreenshot, cleanupTempFiles } from "./generateScreenshot.mjs";
import { v2 as cloudinary } from "cloudinary";
import os from "os";
import axios from "axios";
import chalk from "chalk";
import sgMail from "@sendgrid/mail";
import Arena from "are.na";
import { arenaLimiter, processLimiter } from "./shared/rateLimiters.mjs";
import { processImagesForScrap, getImageEmbedding } from "./imageEmbedding.mjs";
import readline from "readline";
import cron from "node-cron";
import { run_terminal_cmd } from "./utils.mjs";

// Load environment variables from .env file
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  console.log(`Loading environment variables from ${envPath}`);
  dotenv.config({ path: envPath });
} else {
  console.log("No .env file found, using environment variables from system");
  dotenv.config();
}

// Debug environment variables immediately
console.log("DEBUG: Environment variables after dotenv load:");
console.log(
  "OPENROUTER_API_KEY:",
  process.env.OPENROUTER_API_KEY
    ? process.env.OPENROUTER_API_KEY.substring(0, 10) + "..."
    : "not set",
);
console.log("NODE_ENV:", process.env.NODE_ENV || "not set");

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Setup logging with file transport and Loki
const logger = winston.createLogger({
  level: process.env.DEBUG === "true" ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(
          ({ timestamp, level, message, type, ...rest }) => {
            // Status logs get pretty formatting
            if (!type || type === "status") {
              return `${timestamp} [${level}]: ${message}`;
            }
            // Metric logs stay as JSON
            return JSON.stringify({ timestamp, level, message, type, ...rest });
          },
        ),
      ),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
    }),
    new LokiTransport({
      host: "https://loki.tools.ejfox.com",
      json: true,
      labels: {
        job: "scrapbook",
        service: "scrapbook-core",
        instance: process.env.INSTANCE_NAME || "default",
        version: process.env.npm_package_version || "unknown",
        environment: process.env.NODE_ENV || "development",
      },
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
      batching: true,
      interval: 5,
      gracefulShutdown: true,
      clearOnError: false,
      replaceTimestamp: true,
      onConnectionError: (err) => {
        console.error("Loki connection error:", err);
      },
    }),
  ],
});

// Helper functions for different log types
function logStatus(level, message, data = {}) {
  logger.log(level, message, {
    type: "status",
    ...data,
    // Add standard labels for better querying
    source: data.source || "core",
    function: data.function || "unknown",
    phase: data.phase || "unknown",
  });
}

function logMetric(name, data = {}) {
  logger.info(name, {
    type: "metric",
    metric: name,
    ...data,
    // Add standard metric labels
    source: data.source || "core",
    function: data.function || "unknown",
    duration_ms: data.duration_ms,
    success: data.success !== false, // default to true
    // Add memory metrics by default
    memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    memory_rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
}

function logError(message, error, context = {}) {
  logger.error(message, {
    type: "error",
    error: error.message,
    stack: error.stack,
    code: error.code,
    ...context,
    // Add standard error labels
    source: context.source || "core",
    function: context.function || "unknown",
    phase: context.phase || "unknown",
    severity: context.severity || "error",
    // Add memory state on errors
    memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    memory_rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
}

import { getRateLimitConfig } from "../lib/config.mjs";

// Bottleneck limiters for rate-limiting async tasks using centralized config
const generalConfig = getRateLimitConfig('general');
const upsertConfig = getRateLimitConfig('upsert');
const browserConfig = getRateLimitConfig('browser');

const limiter = new Bottleneck({ 
  maxConcurrent: generalConfig.maxConcurrent, 
  minTime: generalConfig.minTimeBetweenRequests 
});
const upsertLimiter = new Bottleneck({ 
  maxConcurrent: upsertConfig.maxConcurrent, 
  minTime: upsertConfig.minTimeBetweenRequests 
});
const browserLimiter = new Bottleneck({ 
  maxConcurrent: browserConfig.maxConcurrent, 
  minTime: browserConfig.minTimeBetweenRequests 
});

// Add metrics tracking
const metrics = {
  startTime: Date.now(),
  processed: { total: 0, bySource: {} },
  skipped: { total: 0, bySource: {} },
  errors: { total: 0, bySource: {} },
  processingTimes: { total: 0, bySource: {} },
  memory: { initial: process.memoryUsage() },
};

// Initialize last metrics state
const lastMetrics = {
  memory: process.memoryUsage(),
  limiters: {},
};

// Enhance the existing rate limiters with metrics
function enhanceRateLimiter(limiter, name) {
  const originalSchedule = limiter.schedule.bind(limiter);
  limiter.schedule = async function (...args) {
    const start = Date.now();
    try {
      const result = await originalSchedule(...args);
      const duration = Date.now() - start;
      logMetric("rate_limiter", {
        name,
        status: "success",
        duration_ms: duration,
        queued: limiter.queued(),
        running: limiter.running(),
        function: "rate_limiter",
        source: name,
      });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logError("Rate limiter error", error, {
        name,
        duration_ms: duration,
        queued: limiter.queued(),
        running: limiter.running(),
        function: "rate_limiter",
        source: name,
        severity: error.code === 429 ? "warn" : "error",
      });
      throw error;
    }
  };
  return limiter;
}

// Enhance all limiters
[limiter, upsertLimiter, browserLimiter, arenaLimiter, processLimiter].forEach(
  (l, i) => {
    if (l) enhanceRateLimiter(l, `limiter_${i}`);
  },
);

// Add process metrics
function startPeriodicMetricLogging() {
  const interval = setInterval(() => {
    if (isShuttingDown) {
      clearInterval(interval);
      return;
    }

    const memory = process.memoryUsage();
    logMetric("process_stats", {
      source: "core",
      function: "metrics",
      heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
      rss_mb: Math.round(memory.rss / 1024 / 1024),
      external_mb: Math.round(memory.external / 1024 / 1024),
      uptime_minutes: Math.round(process.uptime() / 60),
      active_handles: process._getActiveHandles().length,
      active_requests: process._getActiveRequests().length,
    });

    // Log rate limiter states
    const limiters = {
      main: limiter,
      upsert: upsertLimiter,
      browser: browserLimiter,
      arena: arenaLimiter,
      process: processLimiter,
    };

    for (const [name, l] of Object.entries(limiters)) {
      if (!l) continue;
      logMetric("limiter_state", {
        source: "rate_limiter",
        function: name,
        queued: l.queued(),
        running: l.running(),
        capacity: l.running() / (l.running() + l.queued()),
      });
    }
  }, 60 * 1000); // Every minute

  process.on("exit", () => {
    clearInterval(interval);
    logMetric("process_exit", {
      source: "core",
      function: "exit",
      heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptime_minutes: Math.round(process.uptime() / 60),
    });
  });
}

// NOW we can validate environment variables
logger.debug("Checking environment variables...");
const requiredEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENROUTER_API_KEY",
];

const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingEnvVars.length > 0) {
  logger.error(
    "Missing required environment variables:",
    missingEnvVars.join(", "),
  );
  process.exit(1);
}

logger.debug("Environment variables loaded:", {
  OPENROUTER_API_KEY_LENGTH: process.env.OPENROUTER_API_KEY?.length,
  NODE_ENV: process.env.NODE_ENV,
});

// Send ready signal to PM2 when app is initialized
if (process.send) {
  process.send("ready");
}

// Environment variables and flags
let isShuttingDown = false;

// Improve shutdown handling
async function gracefulShutdown(signal = "unknown") {
  if (isShuttingDown) {
    logger.info("Force exiting...");
    process.exit(1);
  }

  isShuttingDown = true;
  logger.info(`Received shutdown signal: ${signal}`);

  // Set a timeout to force exit after 5 seconds
  const forceExitTimeout = setTimeout(() => {
    logger.error("Forced exit after timeout");
    process.exit(1);
  }, 5000);

  try {
    // Stop all limiters immediately
    const limiters = [
      limiter,
      upsertLimiter,
      browserLimiter,
      arenaLimiter,
      processLimiter,
    ].filter(Boolean);

    logger.info("Stopping rate limiters...");
    await Promise.all(limiters.map((l) => l.stop({ dropWaitingJobs: true })));

    logger.info("Shutdown complete");
    clearTimeout(forceExitTimeout);
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
}

// Handle various shutdown signals
process.on("SIGINT", () => gracefulShutdown("SIGINT (Ctrl+C)"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGUSR2", () => gracefulShutdown("SIGUSR2"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("unhandledRejection");
});

// IMMEDIATELY set up commander before anything else
program
  .allowUnknownOption()
  .option("--all", "Fetch from all sources")
  .option("--pinboard", "Fetch from Pinboard")
  .option("--mastodon", "Fetch from Mastodon")
  .option("--arena", "Fetch from Are.na")
  .option("--github", "Fetch from GitHub")
  .option("--debug", "Enable debug logging")
  .option("--test", "Run in test mode (process fewer items)")
  .option("--dry-run", "Run without making any database changes")
  .option(
    "--limit <number>",
    "Limit the number of items to process from each source",
  )
  .option("--fix", "Fix missing data in existing scraps")
  .option("--fix-dry-run", "Show what would be fixed without making changes")
  .option("--fix-images", "Only fix missing images")
  .option("--fix-embeddings", "Only fix missing embeddings")
  .option("--fix-ai", "Only fix missing AI data")
  .option("--fix-pinboard", "Fix only Pinboard scraps")
  .option("--fix-arena", "Fix only Are.na scraps")
  .option("--fix-mastodon", "Fix only Mastodon scraps")
  .option("--clean", "Delete scraps with missing essential data")
  .option(
    "--clean-empty",
    "Only delete completely empty scraps (all fields NULL)",
  )
  .option("--clean-partial", "Only delete scraps missing some but not all data")
  .option(
    "--clean-dry-run",
    "Show what would be cleaned without deleting anything",
  );

// Parse arguments (no sync needed!)
program.parse(process.argv);

// Debug logging AFTER parsing
console.log("Process arguments:", process.argv);
console.log("Parsed options:", program.opts());

// Get options
const options = program.opts();
const DEBUG = options.debug || process.env.DEBUG === "true";

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
  },
);

// Initialize Cloudinary client
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Replace console.log with logger
function log(...args) {
  if (DEBUG) logger.debug(args.join(" "));
}

// Improve the existing scrap check function
async function getExistingScrap(scrapData) {
  const { data, error } = await supabase
    .from("scraps")
    .select("*")
    .or(
      `id.eq."${scrapData.id}",` +
        `scrap_id.eq."${scrapData.scrap_id}",` +
        `url.eq."${scrapData.url}"`,
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
            typeof r.target === "string",
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
    logStatus("warn", "⚠️  Skipping AI enrichment - API keys not configured");
    return scrapData;
  }

  const scrapIdentifier =
    scrapData.scrap_id || scrapData.id || `${scrapData.source}-${Date.now()}`;
  const startTime = Date.now();

  logger.info(
    chalk.blue(
      `\n📝 Processing ${chalk.bold(scrapData.source)} scrap: ${chalk.gray(
        scrapIdentifier,
      )}`,
    ),
  );
  if (scrapData.title) {
    logger.info(
      chalk.gray(
        `Title: ${scrapData.title.substring(0, 60)}${
          scrapData.title.length > 60 ? "..." : ""
        }`,
      ),
    );
  }

  try {
    const contentToProcess = [
      scrapData.content,
      scrapData.description,
      scrapData.title,
      scrapData.metadata?.description,
      scrapData.metadata?.content,
      scrapData.metadata?.original_content,
      scrapData.metadata?.text,
      scrapData.url,
      scrapData.metadata?.url,
      scrapData.metadata?.original_url,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!contentToProcess) {
      logger.info(chalk.yellow("⚠️  No content available to process"));
      return scrapData;
    }

    // Generate text embedding with retries
    logger.info(chalk.blue("\n1️⃣  Generating text embedding..."));
    let textEmbedding = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        textEmbedding = await limiter.schedule(() =>
          generateEmbedding(contentToProcess, { type: "text" }),
        );
        if (textEmbedding) {
          scrapData.embedding_nomic = textEmbedding;
          logger.info(chalk.green("✅ Text embedding generated successfully"));
          break;
        }
      } catch (error) {
        logger.error(
          chalk.red(`❌ Embedding generation failed (attempt ${attempt}/3)`),
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }

    // Generate summary and tags
    logger.info(chalk.blue("\n2️⃣  Generating summary and tags..."));
    const enrichedWithSummary = await generateSummaryAndTags(scrapData);
    if (enrichedWithSummary.summary) {
      scrapData.summary = enrichedWithSummary.summary;
      scrapData.tags = enrichedWithSummary.tags;
      logger.info(
        chalk.green(`✅ Generated summary (${scrapData.summary.length} chars)`),
      );
      logger.info(
        chalk.green(
          `✅ Generated ${scrapData.tags.length} tags: ${chalk.gray(
            scrapData.tags.join(", "),
          )}`,
        ),
      );

      // Extract relationships from the summary
      logger.info(chalk.blue("\n3️⃣  Extracting relationships..."));
      const enrichedWithRelationships =
        await extractAndAddRelationships(scrapData);
      if (enrichedWithRelationships.relationships) {
        scrapData.relationships = enrichedWithRelationships.relationships;
        logger.info(
          chalk.green(
            `✅ Found ${scrapData.relationships.length} relationships`,
          ),
        );
      } else {
        logger.info(chalk.yellow("ℹ️  No relationships found"));
      }

      // Extract location from the summary
      logger.info(chalk.blue("\n4️⃣  Extracting location..."));
      const location = await limiter.schedule(() =>
        extractLocation(scrapData.summary),
      );
      if (location) {
        scrapData.location = location.location;
        scrapData.latitude = location.latitude;
        scrapData.longitude = location.longitude;
        logger.info(
          chalk.green(`✅ Found location: ${chalk.gray(location.location)}`),
        );
      } else {
        logger.info(chalk.yellow("ℹ️  No location found"));
      }
    } else {
      logger.info(chalk.yellow("⚠️  Failed to generate summary"));
    }

    // Process images
    if (scrapData.screenshot_url || scrapData.metadata?.image_url) {
      logger.info(chalk.blue("\n5️⃣  Processing image..."));
      const imageStartTime = Date.now();

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const withImageEmbedding = await processImagesForScrap(scrapData);
          if (withImageEmbedding.image_embedding) {
            scrapData.image_embedding = withImageEmbedding.image_embedding;
            logger.info(chalk.green("✅ Image embedding generated"));
            break;
          }
        } catch (error) {
          logger.error(
            chalk.red(`❌ Image processing failed (attempt ${attempt}/3)`),
          );
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    logger.info(
      chalk.blue(
        `\n✨ Processing completed in ${chalk.bold(
          (totalDuration / 1000).toFixed(1),
        )}s`,
      ),
    );
    logger.info(chalk.gray("Results:"));
    logger.info(
      chalk.gray(
        `• Text Embedding: ${scrapData.embedding_nomic ? "✅" : "❌"}`,
      ),
    );
    logger.info(chalk.gray(`• Summary: ${scrapData.summary ? "✅" : "❌"}`));
    logger.info(chalk.gray(`• Tags: ${scrapData.tags?.length || 0}`));
    logger.info(
      chalk.gray(`• Relationships: ${scrapData.relationships?.length || 0}`),
    );
    logger.info(chalk.gray(`• Location: ${scrapData.location ? "✅" : "❌"}`));
    logger.info(
      chalk.gray(
        `• Image Embedding: ${scrapData.image_embedding ? "✅" : "❌"}`,
      ),
    );

    return scrapData;
  } catch (error) {
    logger.error(
      chalk.red(`\n❌ AI enrichment failed for ${scrapIdentifier}:`),
      error,
    );
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
        "processing_instance_id, processing_started_at, screenshot_url, metadata",
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
          `Skipping image processing for ${scrapId} - already has image`,
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
      if (options.dryRun) {
        logger.info(`[DRY RUN] Would create new scrap: ${scrapId}`);
        return true;
      }
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
        if (options.dryRun) {
          logger.info(`[DRY RUN] Would upsert scrap: ${scrapId}`);
          logger.info(`[DRY RUN] Data:`, {
            title: enrichedData.title?.substring(0, 50) + "...",
            source: source,
            type: enrichedData.type || getTypeFromSource(source),
          });
          return { success: true, dryRun: true };
        }
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
          },
        );

        if (upsertError) {
          logger.error(`Failed to upsert ${scrapId}:`, upsertError);
          return false;
        }

        logger.info(
          chalk.green(`✅ Successfully upserted ${scrapId} to database`),
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
      // Use the improved relationship extraction with retries
      const extractedRelationships = await limiter.schedule(() =>
        extractRelationships(content, {
          isRawText: !scrapObj.summary,
          url: scrapObj.url,
          maxRetries: 2,
        }),
      );

      function validateRelationships(relationships) {
        if (!Array.isArray(relationships)) return [];
        return relationships.map((relationship) => {
          // make sure they are in cypher format
          const validated = validateAIOutput("relationships", relationship);
          return validated || null;
        });
      }

      // Validate the relationships before assigning
      const validatedRelationships = validateRelationships(
        extractedRelationships,
      );

      scrapObj.relationships = validatedRelationships;

      // Log success or failure
      if (validatedRelationships && validatedRelationships.length > 0) {
        logger.info(
          chalk.green(
            `✅ Extracted ${validatedRelationships.length} relationships`,
          ),
        );
      } else {
        logger.info(chalk.yellow("ℹ️ No relationships found in content"));
      }
    } else {
      logger.info(
        "Skipping relationship extraction - OpenRouter API key not configured",
      );
      logger.info("Please set OPENROUTER_API_KEY to enable AI features");
      scrapObj.relationships = [];
    }
  } catch (error) {
    logger.error(
      `Failed to extract relationships for ${
        scrapObj.id || scrapObj.scrap_id
      }:`,
      error.message,
    );
    scrapObj.relationships = [];
  }

  return scrapObj;
}

// Add this helper function near the top with other helper functions
async function generateSummaryAndTags(scrapObj) {
  // Gather all possible content sources
  const contentToProcess = [
    scrapObj.content,
    scrapObj.description,
    scrapObj.title,
    scrapObj.metadata?.description,
    scrapObj.metadata?.content,
    scrapObj.metadata?.original_content,
    scrapObj.metadata?.text,
    scrapObj.url,
    scrapObj.metadata?.url,
    scrapObj.metadata?.original_url,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!contentToProcess) {
    logger.warn("No content to summarize");
    return scrapObj;
  }

  try {
    if (process.env.OPENROUTER_API_KEY) {
      // Generate summary
      logger.info("Generating summary...");
      scrapObj.summary = await limiter.schedule(() =>
        summarizeContent(contentToProcess, { metaSummary: true }),
      );

      // Generate tags from summary if we have one
      if (scrapObj.summary) {
        logger.info("Generating tags from summary...");
        const summaryTags = await limiter.schedule(() =>
          metaSummaryToTags(scrapObj.summary),
        );
        scrapObj.tags = [
          ...new Set([...(scrapObj.tags || []), ...summaryTags]),
        ];
        logger.info(`Generated ${summaryTags.length} tags`);
      } else {
        logger.warn("No summary generated, skipping tag generation");
      }
    } else {
      logger.info(
        "Skipping summary generation - OpenRouter API key not configured",
      );
      logger.info("Please set OPENROUTER_API_KEY to enable AI features");
    }
  } catch (error) {
    logger.error(
      `Failed to generate summary for ${scrapObj.id}:`,
      error.message,
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
        new Date(Date.now() - STUCK_THRESHOLD_MINS * 60 * 1000).toISOString(),
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
          stuckScraps.map((s) => s.scrap_id),
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
  const startTime = Date.now();
  const source = "pinboard";

  try {
    logStatus("info", "🔄 Checking for Pinboard updates...");
    const bookmarks = await fetchBookmarksWithCache();

    logMetric("source_processing_started", {
      source,
      total_items: bookmarks.length,
      cache_used: true,
    });

    // Apply limit if specified
    let bookmarksToProcess = bookmarks;
    if (options.limit) {
      const limit = parseInt(options.limit, 10);
      if (!isNaN(limit) && limit > 0) {
        bookmarksToProcess = bookmarks.slice(0, limit);
        logger.info(
          chalk.blue(
            `Limiting to ${limit} bookmarks (out of ${bookmarks.length} total)`,
          ),
        );
      }
    }

    for (const bookmark of bookmarksToProcess) {
      if (isShuttingDown) break;

      const scrapId = `pinboard-${bookmark.hash}`;
      const itemStart = Date.now();

      try {
        if (
          !(await claimProcessAndUpsert(
            scrapId,
            source,
            bookmark,
            processBookmark,
          ))
        ) {
          logMetric("item_skipped", {
            source,
            scrap_id: scrapId,
            reason: "already_processing",
            url: bookmark.href,
          });
          metrics.skipped.total++;
          metrics.skipped.bySource[source] =
            (metrics.skipped.bySource[source] || 0) + 1;
          continue;
        }

        metrics.processed.total++;
        metrics.processed.bySource[source] =
          (metrics.processed.bySource[source] || 0) + 1;

        const itemDuration = Date.now() - itemStart;
        metrics.processingTimes.total += itemDuration;
        metrics.processingTimes.bySource[source] =
          (metrics.processingTimes.bySource[source] || 0) + itemDuration;

        logMetric("item_processed", {
          source,
          scrap_id: scrapId,
          duration_ms: itemDuration,
          url: bookmark.href,
        });
      } catch (error) {
        logError("Item processing failed", error, {
          source,
          scrap_id: scrapId,
          url: bookmark.href,
        });

        metrics.errors.total++;
        metrics.errors.bySource[source] =
          (metrics.errors.bySource[source] || 0) + 1;
        await releaseScrap(scrapId);
      }
    }

    const totalDuration = Date.now() - startTime;
    logMetric("source_processing_completed", {
      source,
      total_duration_ms: totalDuration,
      items_processed: metrics.processed.bySource[source] || 0,
      items_skipped: metrics.skipped.bySource[source] || 0,
      items_errored: metrics.errors.bySource[source] || 0,
      avg_item_duration_ms:
        metrics.processingTimes.bySource[source] /
        (metrics.processed.bySource[source] || 1),
    });
  } catch (error) {
    logError("Source processing failed", error, { source });
    metrics.errors.total++;
    metrics.errors.bySource[source] =
      (metrics.errors.bySource[source] || 0) + 1;
  }
}

async function fetchAndUpsertMastodonStatuses() {
  const startTime = Date.now();
  const source = "mastodon";
  try {
    const userId = await fetchUserId();
    const statuses = await fetchStatuses(userId);
    logger.info(`Found ${statuses.length} statuses`, {
      source,
      total_statuses: statuses.length,
    });

    // Apply limit if specified
    let statusesToProcess = statuses;
    if (options.limit) {
      const limit = parseInt(options.limit, 10);
      if (!isNaN(limit) && limit > 0) {
        statusesToProcess = statuses.slice(0, limit);
        logger.info(
          chalk.blue(
            `Limiting to ${limit} statuses (out of ${statuses.length} total)`,
          ),
        );
      }
    }

    for (const status of statusesToProcess) {
      if (isShuttingDown) break;

      const scrapId = `mastodon-${status.id}`;
      const itemStart = Date.now();

      try {
        if (
          !(await claimProcessAndUpsert(scrapId, source, status, processStatus))
        ) {
          logger.info(
            `Skipping status ${status.id} - already being processed`,
            {
              source,
              status_id: status.id,
              reason: "already_processing",
            },
          );
          metrics.skipped.total++;
          metrics.skipped.bySource[source] =
            (metrics.skipped.bySource[source] || 0) + 1;
          continue;
        }

        metrics.processed.total++;
        metrics.processed.bySource[source] =
          (metrics.processed.bySource[source] || 0) + 1;

        const itemDuration = Date.now() - itemStart;
        metrics.processingTimes.total += itemDuration;
        metrics.processingTimes.bySource[source] =
          (metrics.processingTimes.bySource[source] || 0) + itemDuration;
      } catch (error) {
        logger.error(`Failed to process status: ${status.id}`, {
          source,
          status_id: status.id,
          error: error.message,
          stack: error.stack,
        });
        metrics.errors.total++;
        metrics.errors.bySource[source] =
          (metrics.errors.bySource[source] || 0) + 1;
        await releaseScrap(scrapId);
      }
    }

    const totalDuration = Date.now() - startTime;
    logMetric(source, {
      total_duration_ms: totalDuration,
      items_processed: metrics.processed.bySource[source] || 0,
      items_skipped: metrics.skipped.bySource[source] || 0,
      items_errored: metrics.errors.bySource[source] || 0,
    });
  } catch (error) {
    logger.error(`Error in Mastodon processing`, {
      source,
      error: error.message,
      stack: error.stack,
    });
    metrics.errors.total++;
    metrics.errors.bySource[source] =
      (metrics.errors.bySource[source] || 0) + 1;
  }
}

async function fetchAndUpsertArenaBlocks() {
  const startTime = Date.now();
  const source = "arena";
  try {
    const channels = await arena.user(USER_SLUG).channels();
    logger.info(`Found ${channels.length} channels`, {
      source,
      total_channels: channels.length,
    });

    // Apply limit to channels if specified
    let channelsToProcess = channels;
    if (options.limit) {
      const limit = parseInt(options.limit, 10);
      if (!isNaN(limit) && limit > 0 && limit < channels.length) {
        channelsToProcess = channels.slice(0, limit);
        logger.info(
          chalk.blue(
            `Limiting to ${limit} channels (out of ${channels.length} total)`,
          ),
        );
      }
    }

    for (const channel of channelsToProcess) {
      if (isShuttingDown) break;

      logger.info(`Processing channel: ${channel.title}`, {
        source,
        channel_id: channel.id,
        channel_title: channel.title,
      });

      const blocks = await arenaLimiter.schedule(() =>
        arena.channel(channel.id).contents({
          page: 1,
          per: 100,
          sort: "updated_at",
          direction: "desc",
        }),
      );

      if (!blocks?.length) {
        logger.warn(`No blocks found in channel: ${channel.title}`, {
          source,
          channel_id: channel.id,
          channel_title: channel.title,
        });
        continue;
      }

      logger.info(`Found ${blocks.length} blocks in channel ${channel.title}`, {
        source,
        channel_id: channel.id,
        channel_title: channel.title,
        blocks_count: blocks.length,
      });

      // Apply limit to blocks if specified
      let blocksToProcess = blocks;
      if (options.limit) {
        const limit = parseInt(options.limit, 10);
        if (!isNaN(limit) && limit > 0 && limit < blocks.length) {
          blocksToProcess = blocks.slice(0, limit);
          logger.info(
            chalk.blue(
              `Limiting to ${limit} blocks (out of ${blocks.length} total) in channel ${channel.title}`,
            ),
          );
        }
      }

      for (const block of blocksToProcess) {
        if (isShuttingDown) break;

        const scrapId = `arena-${block.id}`;
        const itemStart = Date.now();

        try {
          if (
            !(await claimProcessAndUpsert(scrapId, source, block, processBlock))
          ) {
            logger.info(
              `Skipping block ${block.id} - already being processed`,
              {
                source,
                block_id: block.id,
                reason: "already_processing",
              },
            );
            metrics.skipped.total++;
            metrics.skipped.bySource[source] =
              (metrics.skipped.bySource[source] || 0) + 1;
            continue;
          }

          metrics.processed.total++;
          metrics.processed.bySource[source] =
            (metrics.processed.bySource[source] || 0) + 1;

          const itemDuration = Date.now() - itemStart;
          metrics.processingTimes.total += itemDuration;
          metrics.processingTimes.bySource[source] =
            (metrics.processingTimes.bySource[source] || 0) + itemDuration;
        } catch (error) {
          logger.error(`Failed to process block: ${block.id}`, {
            source,
            block_id: block.id,
            error: error.message,
            stack: error.stack,
          });
          metrics.errors.total++;
          metrics.errors.bySource[source] =
            (metrics.errors.bySource[source] || 0) + 1;
          await releaseScrap(scrapId);
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    logMetric(source, {
      total_duration_ms: totalDuration,
      items_processed: metrics.processed.bySource[source] || 0,
      items_skipped: metrics.skipped.bySource[source] || 0,
      items_errored: metrics.errors.bySource[source] || 0,
    });
  } catch (error) {
    logger.error(`Error in Arena processing`, {
      source,
      error: error.message,
      stack: error.stack,
    });
    metrics.errors.total++;
    metrics.errors.bySource[source] =
      (metrics.errors.bySource[source] || 0) + 1;
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

  // Apply limit if specified
  let scrapsToProcess = allScraps;
  if (options.limit) {
    const limit = parseInt(options.limit, 10);
    if (!isNaN(limit) && limit > 0) {
      scrapsToProcess = allScraps.slice(0, limit);
      logger.info(
        chalk.blue(
          `Limiting to ${limit} GitHub items (out of ${allScraps.length} total)`,
        ),
      );
    }
  }

  for (const scrap of scrapsToProcess) {
    if (isShuttingDown) break;

    const scrapId = `github-${scrap.id}`;

    try {
      if (
        !(await claimProcessAndUpsert(scrapId, "github", scrap, (data) => data))
      ) {
        logger.info(
          `Skipping GitHub item ${scrap.id} - already being processed`,
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

// Add this helper function near the top with other helper functions
async function checkOpenRouterCredits() {
  if (!process.env.OPENROUTER_API_KEY) {
    logStatus(
      "info",
      "OpenRouter API key not configured - AI features will be disabled",
    );
    return { enabled: false, reason: "No API key configured" };
  }

  try {
    logStatus(
      "debug",
      `Checking OpenRouter API with key starting with: ${process.env.OPENROUTER_API_KEY.substring(
        0,
        10,
      )}...`,
    );

    const startTime = Date.now();
    const response = await axios.get("https://openrouter.ai/api/v1/auth/key", {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://github.com/ejfox/scrapbook-core",
        "X-Title": "Scrapbook Core",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const duration = Date.now() - startTime;

    if (!response.data?.data) {
      logError(
        "Invalid OpenRouter API response",
        new Error("Invalid response format"),
        {
          duration_ms: duration,
          response_data: response.data,
        },
      );
      return { enabled: false, reason: "Invalid API response" };
    }

    const { usage, limit, is_free_tier, rate_limit } = response.data.data;

    logMetric("openrouter_credits", {
      usage,
      limit,
      is_free_tier,
      rate_limit_requests: rate_limit?.requests,
      rate_limit_interval: rate_limit?.interval,
      duration_ms: duration,
    });

    if (usage >= limit) {
      logStatus(
        "warn",
        `OpenRouter credit limit exceeded! Usage: ${usage}, Limit: ${limit}. AI features will be disabled.`,
      );
      return { enabled: false, reason: "Credit limit exceeded" };
    }

    return { enabled: true, usage, limit, is_free_tier };
  } catch (error) {
    // Don't log credential errors as harshly - they're configuration issues, not bugs
    const logLevel = error.code === 401 || error.code === 'ERR_BAD_REQUEST' ? 'warn' : 'error';
    logger[logLevel]("OpenRouter API check failed - continuing without AI features", {
      api_key_present: !!process.env.OPENROUTER_API_KEY,
      error_code: error.code,
      error_message: error.message,
    });
    return { enabled: false, reason: error.message };
  }
}

// Add priority scoring function
function getPriorityScore(scrap, issues) {
  let score = 0;

  // Base priority by source
  const sourcePriority = {
    pinboard: 3, // Highest - most likely to have useful content
    arena: 2, // Medium - visual content
    mastodon: 1, // Lower - shorter content
  };
  score += sourcePriority[scrap.source] || 0;

  // Prioritize items with more missing data
  score += issues.length;

  // Prioritize items with URLs (more likely to have useful content)
  if (scrap.url) score += 2;

  // Prioritize recent items
  const ageInDays =
    (Date.now() - new Date(scrap.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (ageInDays < 7) score += 3;
  else if (ageInDays < 30) score += 2;
  else if (ageInDays < 90) score += 1;

  return score;
}

// Update the identifyAndFixMissingData function
async function identifyAndFixMissingData(options = {}) {
  const {
    batchSize = 50,
    processImages = true,
    processEmbeddings = true,
    processAI = true,
    dryRun = false,
    source = null,
  } = options;

  logger.info(chalk.blue("\n🔧 Starting to fix missing data..."));
  logger.info(chalk.gray("Options:"));
  logger.info(chalk.gray(`• Process Images: ${processImages}`));
  logger.info(chalk.gray(`• Process Embeddings: ${processEmbeddings}`));
  logger.info(chalk.gray(`• Process AI: ${processAI}`));
  logger.info(chalk.gray(`• Source: ${source || "all"}`));
  logger.info(chalk.gray(`• Dry Run: ${dryRun}`));

  let processed = 0;
  let fixed = 0;
  let hasMore = true;
  let lastUpdated = new Date().toISOString();

  // Build query conditions based on what we're fixing
  const conditions = [];

  if (processImages) {
    conditions.push("screenshot_url.is.null");
  }

  if (processEmbeddings) {
    conditions.push("embedding_nomic.is.null");
    conditions.push("image_embedding.is.null");
  }

  if (processAI) {
    conditions.push("summary.is.null");
    conditions.push("relationships.is.null");
    conditions.push("location.is.null");
  }

  if (conditions.length === 0) {
    logger.warn("No processing options selected, nothing to fix");
    return { processed: 0, fixed: 0 };
  }

  // Process in stages for efficiency
  const stages = [
    // If processAI is true, put AI Enrichment first
    processAI && {
      name: "AI Enrichment",
      enabled: processAI,
      condition: "summary.is.null,location.is.null,relationships.is.null",
      process: async (scrap) => {
        // Skip AI enrichment for Arena scraps
        if (scrap.source === "arena") {
          logger.info(chalk.gray("⏭️ Skipping AI enrichment for Arena scrap"));
          return {
            summary: null,
            location: null,
            latitude: null,
            longitude: null,
            relationships: null,
          };
        }

        const enriched = await enrichScrapWithAI(scrap);
        return {
          summary: enriched.summary,
          location: enriched.location,
          latitude: enriched.latitude,
          longitude: enriched.longitude,
          relationships: enriched.relationships,
        };
      },
    },
    processImages && {
      name: "Screenshots",
      enabled: processImages,
      condition: "screenshot_url.is.null,url.not.is.null",
      process: async (scrap) => {
        try {
          if (!scrap.url) {
            logger.debug("Skipping screenshot - no URL provided");
            return { screenshot_url: null };
          }
          logger.info(chalk.blue(`📸 Generating screenshot for ${scrap.url}`));
          const screenshot = await browserLimiter.schedule(() =>
            generateScreenshot(scrap.url),
          );

          if (screenshot?.url) {
            logger.info(chalk.green("✅ Screenshot generated"));
            return { screenshot_url: screenshot.url };
          } else {
            logger.warn(chalk.yellow("⚠️ No screenshot URL returned"));
            return null;
          }
        } catch (error) {
          logger.error(`Screenshot generation failed for ${scrap.url}:`, error);
          return null;
        }
      },
    },
    {
      name: "Text Embeddings",
      enabled: processEmbeddings,
      condition: "embedding_nomic.is.null",
      process: async (scrap) => {
        if (!scrap.content) return null;
        const embedding = await limiter.schedule(() =>
          generateEmbedding(scrap.content, { type: "text" }),
        );
        return embedding ? { embedding_nomic: embedding } : null;
      },
    },
    {
      name: "Image Embeddings",
      enabled: processEmbeddings,
      condition: "image_embedding.is.null,screenshot_url.not.is.null",
      process: async (scrap) => {
        if (!scrap.screenshot_url) return null;
        const withImageEmbedding = await processImagesForScrap(scrap);
        return withImageEmbedding.image_embedding
          ? { image_embedding: withImageEmbedding.image_embedding }
          : null;
      },
    },
  ].filter(Boolean); // Filter out any falsy stages

  // Process each stage
  for (const stage of stages) {
    if (!stage.enabled) continue;

    logger.info(chalk.blue(`\n🔄 Starting ${stage.name} stage...`));

    let hasMore = true;
    let lastUpdated = new Date().toISOString();

    while (hasMore && !isShuttingDown) {
      let query = supabase
        .from("scraps")
        .select("*")
        .or(stage.condition)
        .lt("updated_at", lastUpdated)
        .order("updated_at", { ascending: false })
        .limit(batchSize);

      if (source) {
        query = query.eq("source", source);
      }

      const { data: scraps, error } = await query;

      if (error || !scraps?.length) {
        hasMore = false;
        break;
      }

      // Update lastUpdated for next batch
      lastUpdated = scraps[scraps.length - 1].updated_at;

      for (const scrap of scraps) {
        processed++;

        if (dryRun) {
          logger.info(
            chalk.yellow(
              `\n📝 Scrap ${scrap.id} (${scrap.source}) needs: ${stage.name}`,
            ),
          );
          continue;
        }

        try {
          const claimed = await claimExistingScrap(scrap.scrap_id);
          if (!claimed) {
            logger.info(
              chalk.gray(`Skipping ${scrap.id} - already being processed`),
            );
            continue;
          }

          logger.info(
            chalk.blue(`\n🔄 Processing ${scrap.id} (${scrap.source})`),
          );

          const updates = await stage.process(scrap);

          if (updates) {
            const { error: updateError } = await supabase
              .from("scraps")
              .update({
                ...updates,
                updated_at: new Date().toISOString(),
                metadata: {
                  ...scrap.metadata,
                  last_fixed: new Date().toISOString(),
                },
              })
              .eq("id", scrap.id);

            if (updateError) {
              logger.error(`Failed to update scrap ${scrap.id}:`, updateError);
            } else {
              fixed++;
              logger.info(
                chalk.green(`✅ Updated ${stage.name} for scrap ${scrap.id}`),
              );
            }
          }

          await releaseScrap(scrap.scrap_id);
        } catch (error) {
          logger.error(`Error processing scrap ${scrap.id}:`, error);
          await releaseScrap(scrap.scrap_id);
        }
      }

      logger.info(
        chalk.blue(
          `\nProgress: Processed ${processed} scraps, fixed ${fixed} issues`,
        ),
      );
    }
  }

  return { processed, fixed };
}

// Add near other helper functions
async function cleanEmptyScraps(options = {}) {
  const { onlyEmpty = false, onlyPartial = false, dryRun = false } = options;
  logger.info(chalk.blue("\n🧹 Starting cleanup of scraps..."));

  try {
    // Build the query conditions based on options
    let conditions = [];

    if (onlyEmpty) {
      // Only completely empty scraps
      conditions = ["title.is.null", "content.is.null", "summary.is.null"];
    } else if (onlyPartial) {
      // Scraps that have some content but are missing important fields
      conditions = ["title.is.null", "content.is.null", "summary.is.null"];
    } else {
      // Default: both empty and partial
      conditions = [
        "title.is.null",
        "title.eq.EMPTY",
        "content.is.null",
        "content.eq.EMPTY",
        "summary.is.null",
      ];
    }

    // First get the scraps to show the user
    const { data: scrapsToDelete, error: findError } = await supabase
      .from("scraps")
      .select("*")
      .or(conditions.join(","))
      .not("source", "eq", "lock");

    if (findError) {
      logger.error("Error finding scraps:", findError);
      return;
    }

    const count = scrapsToDelete?.length || 0;
    const type = onlyEmpty
      ? "completely empty"
      : onlyPartial
        ? "partially empty"
        : "empty/incomplete";
    logger.info(chalk.yellow(`Found ${count} ${type} scraps`));

    if (count === 0) {
      logger.info(chalk.green("No matching scraps found!"));
      return;
    }

    // Group by source for reporting
    const bySource = scrapsToDelete.reduce((acc, scrap) => {
      acc[scrap.source] = (acc[scrap.source] || 0) + 1;
      return acc;
    }, {});

    logger.info(chalk.gray("\nBreakdown by source:"));
    Object.entries(bySource).forEach(([source, count]) => {
      logger.info(chalk.gray(`• ${source || "unknown"}: ${count} scraps`));
    });

    // Show some examples
    logger.info(chalk.gray("\nExample scraps to be deleted:"));
    scrapsToDelete.slice(0, 5).forEach((scrap) => {
      logger.info(chalk.gray(`• ID: ${scrap.id}`));
      logger.info(chalk.gray(`  Source: ${scrap.source}`));
      logger.info(chalk.gray(`  Title: ${scrap.title || "NULL"}`));
      logger.info(
        chalk.gray(`  Content: ${scrap.content ? "Has content" : "NULL"}`),
      );
      logger.info(chalk.gray(`  Summary: ${scrap.summary || "NULL"}`));
      if (scrap.url) {
        logger.info(chalk.gray(`  URL: ${scrap.url}`));
      }
      logger.info("");
    });

    if (dryRun) {
      logger.info(chalk.yellow("\nDRY RUN - No scraps will be deleted"));
      return;
    }

    // Ask for confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirmed = await new Promise((resolve) => {
      rl.question(
        chalk.yellow(
          `\nAre you sure you want to delete these ${count} scraps? (yes/no) `,
        ),
        (answer) => {
          rl.close();
          resolve(answer.toLowerCase() === "yes");
        },
      );
    });

    if (!confirmed) {
      logger.info(chalk.gray("Cleanup cancelled"));
      return;
    }

    // Delete the scraps - using a fresh delete query with the same conditions
    const { error: deleteError } = await supabase
      .from("scraps")
      .delete()
      .or(conditions.join(","))
      .not("source", "eq", "lock");

    if (deleteError) {
      logger.error("Error deleting scraps:", deleteError);
      return;
    }

    logger.info(chalk.green(`\n✨ Cleanup complete! Deleted ${count} scraps`));
  } catch (error) {
    logger.error("Error during cleanup:", error);
  }
}

// Add cleanup job near the runProcessing function
async function runCleanupJob(dryRun = false) {
  logger.info(
    chalk.blue(`\n🧹 Running cleanup job${dryRun ? " (DRY RUN)" : ""}...`),
  );

  try {
    // Clean up temporary files
    if (dryRun) {
      logger.info(
        chalk.yellow("Would clean up temporary files (skipped in dry run)"),
      );
    } else {
      await cleanupTempFiles();
    }

    // Clean up Docker volumes if needed
    if (process.env.NODE_ENV === "production") {
      if (dryRun) {
        // Use docker system df to show space usage without cleaning
        await run_terminal_cmd({
          command: "docker system df",
          require_user_approval: false,
          is_background: false,
        });
        logger.info(
          chalk.yellow("Would run docker system prune (skipped in dry run)"),
        );
      } else {
        await run_terminal_cmd({
          command: "docker system prune -f --volumes",
          require_user_approval: false,
          is_background: false,
        });
      }
    }

    logger.info(
      chalk.green(
        `✨ Cleanup ${dryRun ? "dry run" : ""} completed successfully`,
      ),
    );
  } catch (error) {
    logger.error("Error during cleanup:", error);
  }
}

// Main execution function
async function main() {
  logger.info(`Starting scrapbook processing (Instance: ${INSTANCE_NAME})`);
  logger.info(chalk.blue("\n🗺️ Processing Plan:"));
  logger.info(chalk.gray("1. Check OpenRouter credits (optional AI features)"));
  logger.info(chalk.gray("2. Initialize database if needed"));
  logger.info(
    chalk.gray("3. Clear any stuck processing from crashed instances"),
  );
  logger.info(chalk.gray("4. Process each source in sequence:"));
  logger.info(chalk.gray("   • Pinboard: Fetch bookmarks & process"));
  logger.info(chalk.gray("   • GitHub: Fetch repos/PRs/issues & process"));
  logger.info(chalk.gray("   • Mastodon: Fetch statuses & process"));
  logger.info(chalk.gray("   • Are.na: Fetch channels -> blocks & process"));
  logger.info(chalk.gray("\nFor each item:"));
  logger.info(chalk.gray("1. Try to claim it for processing"));
  logger.info(chalk.gray("2. Process content & generate embeddings"));
  logger.info(chalk.gray("3. Upload images to Cloudinary if needed"));
  logger.info(chalk.gray("4. Save to database"));
  logger.info(chalk.gray("5. Release claim\n"));

  try {
    // Start periodic metric logging
    startPeriodicMetricLogging();

    // Add dry run test if requested
    if (options.test) {
      logger.info(chalk.blue("\n🧪 Running cleanup dry run test..."));
      await runCleanupJob(true);
      return;
    }

    // Run initial processing
    await runProcessing();

    // Set up scheduled processing
    if (!options.test) {
      logger.info("Setting up scheduled jobs");

      // Use node-cron for local development, but in Docker we'll use system cron
      if (process.env.NODE_ENV !== "production") {
        // Schedule main processing
        cron.schedule("20 * * * *", async () => {
          logger.info("Running scheduled processing");
          try {
            await runProcessing();
          } catch (error) {
            logger.error("Error in scheduled processing:", error);
          }
        });

        // Schedule cleanup job every 6 hours
        cron.schedule("0 */6 * * *", async () => {
          logger.info("Running scheduled cleanup");
          try {
            await runCleanupJob();
          } catch (error) {
            logger.error("Error in scheduled cleanup:", error);
          }
        });
      } else {
        logger.info(
          "Running in production mode - using system cron instead of node-cron",
        );
      }

      // Keep the process alive
      process.stdin.resume();
    }
  } catch (error) {
    logger.error("Fatal error in main process:", error);
    process.exit(1);
  }
}

// Extract processing logic to reusable function
async function runProcessing() {
  // Check OpenRouter credits but don't stop processing if check fails
  logger.info(chalk.blue("\n1️⃣ Checking OpenRouter Credits..."));
  const aiStatus = await checkOpenRouterCredits();
  if (!aiStatus.enabled) {
    logger.warn(chalk.yellow(`AI features disabled: ${aiStatus.reason}`));
  }

  // Initialize database if needed
  logger.info(chalk.blue("\n2️⃣ Initializing Database..."));
  await initializeDatabaseIfNeeded();

  // Clear any stuck processing before starting
  logger.info(chalk.blue("\n3️⃣ Cleaning Up Stuck Processing..."));
  await clearStuckProcessing();

  // Run cleanup job
  logger.info(chalk.blue("\n4️⃣ Running Cleanup Job..."));
  await runCleanupJob();

  // Process each source
  logger.info(chalk.blue("\n5️⃣ Processing Sources..."));
  for (const source of ["pinboard", "github", "mastodon", "arena"]) {
    if (options.all || options[source]) {
      logger.info(
        chalk.green(`\n🔄 Starting ${chalk.bold(source)} processing...`),
      );

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
          {
            source,
            error: error.message,
            stack: error.stack,
            function: "runProcessing"
          }
        );
        if (DEBUG) {
          logger.error(chalk.gray("Full error:"), error);
        }
      }
    }
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
