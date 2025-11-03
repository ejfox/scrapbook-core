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
import { extractAndAddFinancialAnalysis } from "./aiFinancialAnalysis.mjs";
import { enrichWithReasoningFields } from "./reasoningFields.mjs";
import { resetSession, printCostSummary, checkCostAlerts } from "./costTracking.mjs";
import { showHeader, StepVisualizer, showSummary, showTags, showConfidence, showSuccess, separator } from "./cyberpunkUI.mjs";
import {
  shouldContinueProcessing,
  startProcessingRun,
  recordSuccess,
  recordFailure,
  validateData,
  printSafetyStatus,
} from "./safetyManager.mjs";
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
import { processImagesForScrap, getImageDescription } from "./imageDescriptions.mjs";
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

// Webhook alerting system
async function sendWebhookAlert(data) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await axios.post(webhookUrl, {
      timestamp: new Date().toISOString(),
      instance: process.env.INSTANCE_NAME || "unknown",
      ...data,
    }, { timeout: 5000 });
  } catch (error) {
    // Don't log webhook failures to avoid loops
    console.error("Webhook failed:", error.message);
  }
}

// Track stats for daily summary
const dailyStats = {
  processed: { arena: 0, github: 0, pinboard: 0, mastodon: 0 },
  errors: [],
  startTime: Date.now(),
  memory: { peak: 0, current: 0 },
  stepFailures: {
    screenshots: 0,
    relationships: 0,
    embeddings: 0,
    ai_summary: 0,
    image_upload: 0,
  },
  stepAttempts: {
    screenshots: 0,
    relationships: 0,
    embeddings: 0,
    ai_summary: 0,
    image_upload: 0,
  },
};

import { getRateLimitConfig } from "../lib/config.mjs";

// Bottleneck limiters for rate-limiting async tasks using centralized config
const generalConfig = getRateLimitConfig("general");
const upsertConfig = getRateLimitConfig("upsert");
const browserConfig = getRateLimitConfig("browser");

const limiter = new Bottleneck({
  maxConcurrent: generalConfig.maxConcurrent,
  minTime: generalConfig.minTimeBetweenRequests,
});
const upsertLimiter = new Bottleneck({
  maxConcurrent: upsertConfig.maxConcurrent,
  minTime: upsertConfig.minTimeBetweenRequests,
});
const browserLimiter = new Bottleneck({
  maxConcurrent: browserConfig.maxConcurrent,
  minTime: browserConfig.minTimeBetweenRequests,
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

let rejectionCount = 0;
process.on("unhandledRejection", (reason, promise) => {
  rejectionCount++;
  logger.error(`Unhandled Rejection #${rejectionCount} at:`, promise);
  logger.error("Rejection reason:", reason);
  if (reason?.stack) {
    logger.error("Error stack:", reason.stack);
  }

  // Track error
  dailyStats.errors.push({
    type: "unhandledRejection",
    message: reason?.message || String(reason),
    timestamp: new Date().toISOString(),
  });

  // Send webhook alert for critical errors
  if (rejectionCount >= 3) {
    const memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const uptimeHours = Math.round(process.uptime() / 3600 * 100) / 100;

    // Only send if not in cooldown
    const cooldownKey = "critical_restart";
    const lastAlert = alertCooldowns.get(cooldownKey);
    if (!lastAlert || Date.now() - lastAlert > 5 * 60 * 1000) { // 5min cooldown
      alertCooldowns.set(cooldownKey, Date.now());

      sendWebhookAlert({
        alert_type: "critical_error",
        title: `🚨 CRITICAL: ${rejectionCount} unhandled errors in ${uptimeHours}h (${memoryMB}MB) - restarting`,
        error_type: "unhandledRejection",
        error_count: rejectionCount,
        message: reason?.message || String(reason),
        memory_mb: memoryMB,
        uptime_hours: uptimeHours,
      });
    }
  }

  // Don't crash on first few rejections, just log and continue
  if (rejectionCount < 3) {
    logger.warn("Continuing execution, will shutdown if more rejections occur");
    return;
  }

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
// Only set SendGrid API key if it's configured
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

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
  if (!process.env.OPENROUTER_API_KEY) {
    logStatus("warn", "⚠️  Skipping AI enrichment - OPENROUTER_API_KEY not configured");
    return scrapData;
  }

  // Note: OPENAI_API_KEY is checked within generateEmbedding function

  const scrapIdentifier =
    scrapData.scrap_id || scrapData.id || `${scrapData.source}-${Date.now()}`;
  const startTime = Date.now();

  const stepViz = new StepVisualizer(scrapData.title || scrapData.url || scrapIdentifier);
  stepViz.showTitle();

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
    stepViz.startStep(5);  // EMBED step
    let textEmbedding = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        textEmbedding = await limiter.schedule(() =>
          generateEmbedding(contentToProcess, {
            type: "text",
            scrapId: scrapIdentifier,
            taskType: "text_embedding",
          }),
        );
        if (textEmbedding) {
          scrapData.embedding = textEmbedding;  // OpenAI text-embedding-3-small
          stepViz.completeStep(5, "1536 dimensions");
          trackStep("embeddings", true);
          break;
        }
      } catch (error) {
        logger.error(
          chalk.red(`❌ Embedding generation failed (attempt ${attempt}/3)`),
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        if (attempt === 3) {
          trackStep("embeddings", false);
        }
      }
    }

    // Generate summary and tags
    stepViz.startStep(2);  // SUMMARIZE step
    const enrichedWithSummary = await generateSummaryAndTags(scrapData, scrapIdentifier);
    if (enrichedWithSummary.summary) {
      scrapData.summary = enrichedWithSummary.summary;
      scrapData.tags = enrichedWithSummary.tags;
      stepViz.completeStep(2, `${scrapData.summary.length} chars, ${scrapData.tags.length} tags`);
      showSummary(scrapData.summary, 2);
      showTags(scrapData.tags, null);

      // Extract relationships from the summary
      stepViz.startStep(4);  // FIND RELATIONS step
      const enrichedWithRelationships =
        await extractAndAddRelationships(scrapData, scrapIdentifier);
      if (enrichedWithRelationships.relationships) {
        scrapData.relationships = enrichedWithRelationships.relationships;
        stepViz.completeStep(4, `${scrapData.relationships.length} connections`);
      } else {
        stepViz.completeStep(4, "none found");
      }

      // Extract financial analysis
      logger.info(chalk.blue("\n4️⃣  Analyzing financial content..."));
      const enrichedWithFinancials = await extractAndAddFinancialAnalysis(scrapData);
      if (enrichedWithFinancials.financial_analysis?.assets?.length > 0) {
        scrapData.financial_analysis = enrichedWithFinancials.financial_analysis;
        const analysis = scrapData.financial_analysis;
        const totalAssets = analysis.assets.length;
        const trackedCount = analysis.tracked_assets?.length || 0;
        const discoveredCount = analysis.discovered_assets?.length || 0;

        const avgSentiment = analysis.assets
          .reduce((sum, asset) => sum + asset.sentiment_score, 0) / totalAssets;

        logger.info(
          chalk.green(
            `✅ Found ${totalAssets} financial assets (${trackedCount} tracked, ${discoveredCount} discovered) - avg sentiment: ${avgSentiment.toFixed(2)}`,
          ),
        );

        // Show tracked assets first
        if (trackedCount > 0) {
          logger.info(chalk.cyan("   📊 Tracked assets:"));
          analysis.tracked_assets.forEach(asset => {
            const sentimentColor = asset.sentiment_score >= 0.1 ? chalk.green :
              asset.sentiment_score <= -0.1 ? chalk.red : chalk.yellow;
            logger.info(
              chalk.gray(`     • ${asset.ticker}: ${sentimentColor(asset.sentiment_score.toFixed(2))}`),
            );
          });
        }

        // Show discovered assets
        if (discoveredCount > 0) {
          logger.info(chalk.magenta("   🔍 Discovered assets:"));
          analysis.discovered_assets.forEach(asset => {
            const sentimentColor = asset.sentiment_score >= 0.1 ? chalk.green :
              asset.sentiment_score <= -0.1 ? chalk.red : chalk.yellow;
            const typeEmoji = asset.asset_type === "crypto" ? "₿" :
              asset.asset_type === "etf" ? "📈" :
                asset.asset_type === "commodity" ? "🏗️" : "📊";
            logger.info(
              chalk.gray(`     ${typeEmoji} ${asset.ticker} (${asset.asset_type}): ${sentimentColor(asset.sentiment_score.toFixed(2))}`),
            );
          });
        }
      } else {
        logger.info(chalk.yellow("ℹ️  No financial content detected"));
      }

      // Extract location from the summary
      logger.info(chalk.blue("\n5️⃣  Extracting location..."));
      const location = await limiter.schedule(() =>
        extractLocation(scrapData.summary, { scrapId: scrapIdentifier }),
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

    // Generate screenshot if URL exists and we don't have one
    if (!scrapData.screenshot_url) {
      // For Are.na images, use the highest resolution version directly
      if (scrapData.source === "arena" && scrapData.metadata?.image_data) {
        const imageUrl = scrapData.metadata.image_data.original_url ||
                        scrapData.metadata.image_data.display ||
                        scrapData.metadata.image_data.cloudinary_url;
        if (imageUrl) {
          scrapData.screenshot_url = imageUrl;
          const urlShort = imageUrl.split("/").pop()?.substring(0, 20) || "image";
          logger.info(chalk.green(`📸 ARENA → ${urlShort}... ✅`));
          trackStep("screenshots", true);
        }
      }
      // For everything else with a URL, generate screenshot
      else if (scrapData.url) {
        const urlShort = scrapData.url.substring(0, 50);
        const startTime = Date.now();
        process.stdout.write(chalk.blue(`📸 SCREENSHOT → ${urlShort}... `));
        try {
          const screenshot = await browserLimiter.schedule(() =>
            generateScreenshot(scrapData.url),
          );
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          if (screenshot?.url) {
            scrapData.screenshot_url = screenshot.url;
            const filename = screenshot.url.split("/").pop()?.substring(0, 20) || "screenshot";
            console.log(chalk.green(`✅ ${filename} (${duration}s)`));
            trackStep("screenshots", true);
          } else {
            console.log(chalk.yellow(`⚠️ no URL (${duration}s)`));
            trackStep("screenshots", false);
          }
        } catch (error) {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(chalk.red(`❌ ${error.message.substring(0, 30)} (${duration}s)`));
          trackStep("screenshots", false);
        }
      }
    }

    // Process images
    if (scrapData.screenshot_url || scrapData.metadata?.image_url) {
      logger.info(chalk.blue("\n6️⃣  Processing image..."));
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

    // Extract reasoning fields (content_type, concept_tags, confidence)
    if (scrapData.summary) {
      stepViz.startStep(6);  // REASON step
      try {
        await enrichWithReasoningFields(scrapData, { scrapId: scrapIdentifier });
        stepViz.completeStep(6, `${scrapData.content_type}, ${scrapData.concept_tags?.length || 0} concepts`);
        showTags(null, scrapData.concept_tags);
        showConfidence(scrapData.extraction_confidence);
      } catch (error) {
        logger.error(chalk.red("❌ Reasoning field extraction failed:", error.message));
      }
    }

    const totalDuration = Date.now() - startTime;
    stepViz.startStep(7);  // SAVE step
    stepViz.completeStep(7, `${(totalDuration / 1000).toFixed(1)}s total`);
    showSuccess();
    separator();

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
          logger.info("[DRY RUN] Data:", {
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
            summary: enrichedData.summary || null, // EXPLICITLY include summary
            metadata: enrichedData.metadata || {},
            tags: enrichedData.tags || [],
            relationships: enrichedData.relationships || null,
            location: enrichedData.location || null,
            latitude: enrichedData.latitude || null,
            longitude: enrichedData.longitude || null,
            financial_analysis: enrichedData.financial_analysis || null,
            screenshot_url: enrichedData.screenshot_url || null,
            embedding: enrichedData.embedding || null,
            embedding_nomic: enrichedData.embedding_nomic || null,
            image_embedding: enrichedData.image_embedding || null,
            content_type: enrichedData.content_type || null,
            concept_tags: enrichedData.concept_tags || [],
            extraction_confidence: enrichedData.extraction_confidence || null,
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
async function extractAndAddRelationships(scrapObj, scrapId) {
  const content = scrapObj.summary || scrapObj.content;
  if (!content) return scrapObj;

  try {
    if (process.env.OPENROUTER_API_KEY) {
      // Try 3 different models for relationship extraction
      let extractedRelationships = [];
      const models = [
        "deepseek/deepseek-chat-v3.1",     // First try: DeepSeek (default)
        "google/gemini-2.5-flash",         // Second try: Gemini
        "openai/gpt-4o-mini",               // Third try: OpenAI
      ];

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const model = models[attempt];
          logger.info(chalk.blue(`🔗 Attempt ${attempt + 1}/3 with ${model}...`));

          extractedRelationships = await limiter.schedule(() =>
            extractRelationships(content, {
              isRawText: !scrapObj.summary,
              url: scrapObj.url,
              scrapId,
              model,
            }),
          );

          // If we got relationships, break out of retry loop
          if (extractedRelationships && extractedRelationships.length > 0) {
            logger.info(chalk.green(`✅ Got ${extractedRelationships.length} relationships from ${model}`));
            trackStep("relationships", true);
            break;
          } else {
            logger.warn(chalk.yellow(`⚠️ ${model} returned no relationships, trying next model...`));
          }
        } catch (error) {
          logger.error(chalk.red(`❌ Attempt ${attempt + 1} failed: ${error.message}`));
          if (attempt === 2) {
            // Last attempt failed
            logger.error("All 3 models failed to extract relationships");
            trackStep("relationships", false);
            extractedRelationships = [];
          } else {
            // Wait a bit before next attempt
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

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
async function generateSummaryAndTags(scrapObj, scrapId) {
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
      try {
        scrapObj.summary = await limiter.schedule(() =>
          summarizeContent(contentToProcess, {
            metaSummary: true,
            scrapId,
            taskType: "summarization",
          }),
        );
        trackStep("ai_summary", scrapObj.summary && scrapObj.summary.length > 0);
      } catch (error) {
        logger.error("AI summary generation failed:", error.message);
        trackStep("ai_summary", false);
      }

      // Generate tags from summary if we have one
      if (scrapObj.summary) {
        logger.info("Generating tags from summary...");
        const summaryTags = await limiter.schedule(() =>
          metaSummaryToTags(scrapObj.summary, { scrapId }),
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
    // Check safety conditions before starting
    const safetyCheck = shouldContinueProcessing(true); // automated=true
    if (!safetyCheck.safe) {
      logger.warn(chalk.red(`🚨 Safety check failed: ${safetyCheck.reason}`));
      return;
    }

    logStatus("info", "🔄 Checking for Pinboard updates...");
    const bookmarks = await fetchBookmarksWithCache();

    logMetric("source_processing_started", {
      source,
      total_items: bookmarks.length,
      cache_used: true,
    });

    // Apply safety limits for automated runs
    let bookmarksToProcess = bookmarks;
    const isManualRun = options.limit; // If user specified limit, treat as manual
    const safetyLimits = isManualRun ?
      parseInt(process.env.SAFETY_MANUAL_MAX_ITEMS_PER_RUN || "500") :
      parseInt(process.env.SAFETY_MAX_ITEMS_PER_RUN || "50");

    // Apply user limit or safety limit
    if (options.limit) {
      const limit = parseInt(options.limit, 10);
      if (!isNaN(limit) && limit > 0) {
        bookmarksToProcess = bookmarks.slice(0, Math.min(limit, safetyLimits));
        logger.info(
          chalk.blue(
            `Limiting to ${Math.min(limit, safetyLimits)} bookmarks (user: ${limit}, safety: ${safetyLimits}, total: ${bookmarks.length})`,
          ),
        );
      }
    } else {
      // Apply safety limits for automated runs
      bookmarksToProcess = bookmarks.slice(0, safetyLimits);
      if (bookmarks.length > safetyLimits) {
        logger.info(
          chalk.yellow(
            `🛡️  Safety limit applied: processing ${safetyLimits} of ${bookmarks.length} bookmarks`,
          ),
        );
      }
    }

    // Start safety-managed processing run
    startProcessingRun({
      isAutomated: !isManualRun,
      expectedItems: bookmarksToProcess.length,
    });

    for (const bookmark of bookmarksToProcess) {
      if (isShuttingDown) break;

      const scrapId = `pinboard-${bookmark.hash}`;
      const itemStart = Date.now();

      // Check safety before processing each item
      const itemSafetyCheck = shouldContinueProcessing(!isManualRun);
      if (!itemSafetyCheck.safe) {
        logger.warn(chalk.yellow(`🛑 Safety stop during processing: ${itemSafetyCheck.reason}`));
        break;
      }

      // Validate data before processing
      const validation = validateData(bookmark, source);
      if (!validation.valid) {
        logger.warn(chalk.yellow(`⚠️  Skipping malformed bookmark: ${validation.reason}`));
        recordFailure(scrapId, source, new Error(`Data validation: ${validation.reason}`));
        continue;
      }

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

        // Record successful processing
        recordSuccess(scrapId, source);

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
        // Record failure for safety tracking
        recordFailure(scrapId, source, error);

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

    // Track for daily summary
    dailyStats.processed[source] = metrics.processed.bySource[source] || 0;
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

    // Track for daily summary
    dailyStats.processed[source] = metrics.processed.bySource[source] || 0;
  } catch (error) {
    logger.error("Error in Mastodon processing", {
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

    // Track for daily summary
    dailyStats.processed[source] = metrics.processed.bySource[source] || 0;
  } catch (error) {
    logger.error("Error in Arena processing", {
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
  logger.info("Fetched GitHub data");

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

    if (limit !== null && usage >= limit) {
      logStatus(
        "warn",
        `OpenRouter credit limit exceeded! Usage: ${usage}, Limit: ${limit}. AI features will be disabled.`,
      );
      return { enabled: false, reason: "Credit limit exceeded" };
    }

    return { enabled: true, usage, limit, is_free_tier };
  } catch (error) {
    // Don't log credential errors as harshly - they're configuration issues, not bugs
    const logLevel = error.code === 401 || error.code === "ERR_BAD_REQUEST" ? "warn" : "error";
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
            trackStep("screenshots", true);
            return { screenshot_url: screenshot.url };
          } else {
            logger.warn(chalk.yellow("⚠️ No screenshot URL returned"));
            trackStep("screenshots", false);
            return null;
          }
        } catch (error) {
          logger.error(`Screenshot generation failed for ${scrap.url}:`, error);
          trackStep("screenshots", false);
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
  showHeader();
  logger.info(`Starting scrapbook processing (Instance: ${INSTANCE_NAME})`);

  // Send startup notification
  const memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  sendWebhookAlert({
    alert_type: "startup",
    title: `🚀 STARTED: scrapbook-core (${memoryMB}MB) on ${INSTANCE_NAME}`,
    instance: INSTANCE_NAME,
    memory_mb: memoryMB,
    node_version: process.version,
  });

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

    // SAFETY: Hard timeout for cron jobs - kill after 10 minutes
    const MAX_RUNTIME = parseInt(process.env.MAX_RUNTIME_MS || "600000"); // 10 minutes default
    setTimeout(() => {
      logger.error(`🚨 Process exceeded maximum runtime of ${MAX_RUNTIME}ms - forcing exit`);
      process.exit(1);
    }, MAX_RUNTIME);

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
  // Check initial safety conditions
  logger.info(chalk.blue("\n🛡️  Checking Safety Conditions..."));
  const initialSafetyCheck = shouldContinueProcessing(true);
  if (!initialSafetyCheck.safe) {
    logger.error(chalk.red(`🚨 Cannot start processing: ${initialSafetyCheck.reason}`));
    logger.info(chalk.gray(`   Recommendation: ${initialSafetyCheck.recommendation}`));
    printSafetyStatus();
    return;
  }

  // Reset cost tracking for this run
  resetSession();
  logger.info(chalk.cyan("💰 Cost tracking session reset"));

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

  // Process each source with safety checks
  logger.info(chalk.blue("\n5️⃣ Processing Sources..."));
  for (const source of ["pinboard", "github", "mastodon", "arena"]) {
    if (options.all || options[source]) {
      // Check safety before each source
      const sourceSafetyCheck = shouldContinueProcessing(true);
      if (!sourceSafetyCheck.safe) {
        logger.warn(chalk.yellow(`🛑 Stopping at ${source}: ${sourceSafetyCheck.reason}`));
        break;
      }

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
            function: "runProcessing",
          },
        );
        if (DEBUG) {
          logger.error(chalk.gray("Full error:"), error);
        }
      }
    }
  }

  // Print cost summary and check for alerts at the end of processing
  logger.info(chalk.cyan("\n💰 PROCESSING RUN COMPLETE - COST SUMMARY:"));
  printCostSummary();

  // Check for cost alerts
  const alerts = checkCostAlerts();
  if (alerts.length > 0) {
    logger.warn(chalk.yellow(`⚠️  ${alerts.length} cost alerts:`));
    alerts.forEach(alert => {
      const icon = alert.severity === "critical" ? "🚨" : "⚠️";
      logger.warn(chalk.yellow(`   ${icon} ${alert.message}`));
    });
  }

  // Print final safety status
  logger.info(chalk.blue("\n🛡️  FINAL SAFETY STATUS:"));
  printSafetyStatus();
}

// Track step failures and send alerts for degraded services
const alertCooldowns = new Map();
function trackStep(stepName, success = true) {
  if (!dailyStats.stepAttempts[stepName]) return; // Unknown step

  dailyStats.stepAttempts[stepName]++;
  if (!success) {
    dailyStats.stepFailures[stepName]++;

    // Check if this step is consistently failing (>50% failure rate after 5+ attempts)
    const attempts = dailyStats.stepAttempts[stepName];
    const failures = dailyStats.stepFailures[stepName];
    const failureRate = failures / attempts;

    if (attempts >= 5 && failureRate >= 0.5) {
      // Check cooldown (don't spam same alert)
      const cooldownKey = `degraded_${stepName}`;
      const lastAlert = alertCooldowns.get(cooldownKey);
      if (!lastAlert || Date.now() - lastAlert > 30 * 60 * 1000) { // 30min cooldown
        alertCooldowns.set(cooldownKey, Date.now());

        // Send degradation alert with cleaner title
        const stepDisplay = stepName.replace("_", " ");
        sendWebhookAlert({
          alert_type: "service_degradation",
          title: `⚠️ DEGRADED: ${stepDisplay} failing ${Math.round(failureRate * 100)}% (${failures}/${attempts})`,
          step: stepName,
          failure_rate: Math.round(failureRate * 100),
          failures: failures,
          attempts: attempts,
          memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        });
      }
    }
  }
}

// Send daily summary webhook
async function sendDailySummary() {
  const endTime = Date.now();
  const duration = endTime - dailyStats.startTime;
  const memory = process.memoryUsage();

  // Update peak memory
  dailyStats.memory.current = Math.round(memory.rss / 1024 / 1024);
  dailyStats.memory.peak = Math.max(dailyStats.memory.peak, dailyStats.memory.current);

  const totalProcessed = Object.values(dailyStats.processed).reduce((a, b) => a + b, 0);

  const successRate = totalProcessed > 0 ? Math.round((1 - dailyStats.errors.length / totalProcessed) * 100) : 100;
  const durationHours = Math.round(duration / 3600000 * 10) / 10; // 1 decimal place
  const uptimeHours = Math.round(process.uptime() / 3600 * 100) / 100;

  // Calculate step failure rates for degraded services
  const stepFailures = Object.entries(dailyStats.stepFailures)
    .map(([step, failures]) => {
      const attempts = dailyStats.stepAttempts[step] || 0;
      const rate = attempts > 0 ? Math.round((failures / attempts) * 100) : 0;
      return { step, failures, attempts, rate };
    })
    .filter(s => s.attempts > 0 && s.rate > 0);

  const degradedSteps = stepFailures.filter(s => s.rate >= 30);
  const degradedInfo = degradedSteps.length > 0 ? ` - ${degradedSteps.length} degraded` : "";

  await sendWebhookAlert({
    alert_type: "daily_summary",
    title: `✅ PROCESSED ${totalProcessed} items in ${durationHours}h (${successRate}% success, ${dailyStats.memory.peak}MB peak${degradedInfo})`,
    duration_minutes: Math.round(duration / 60000),
    processed: dailyStats.processed,
    total_processed: totalProcessed,
    errors: {
      count: dailyStats.errors.length,
      recent: dailyStats.errors.slice(-3), // Last 3 errors
    },
    step_failures: stepFailures,
    degraded_services: degradedSteps,
    memory: {
      peak_mb: dailyStats.memory.peak,
      current_mb: dailyStats.memory.current,
    },
    uptime_hours: uptimeHours,
    success_rate: successRate,
  });
}

// Run main function with better error handling
if (import.meta.url === `file://${process.argv[1]}`) {
  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise);
    logger.error("Rejection reason:", reason);
    if (reason?.stack) {
      logger.error("Error stack:", reason.stack);
    }
    process.exit(1);
  });

  main()
    .then(async () => {
      // Send daily summary on successful completion
      await sendDailySummary();
      logger.info("✅ Processing completed successfully");

      // Final safety and cost summary after all processing
      logger.info(chalk.cyan("\n💰 FINAL COST SUMMARY:"));
      printCostSummary();

      logger.info(chalk.blue("\n🛡️  FINAL SAFETY STATUS:"));
      printSafetyStatus();

      // CRITICAL: Exit cleanly after successful completion
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error("Unhandled error:", error);
      dailyStats.errors.push({
        type: "fatal",
        message: error.message,
        timestamp: new Date().toISOString(),
      });
      await sendDailySummary(); // Send summary even on failure
      process.exit(1);
    });
}

export {
  fetchAndUpsertPinboardBookmarks,
  fetchAndUpsertMastodonStatuses,
  fetchAndUpsertArenaBlocks,
  fetchAndUpsertGithubData,
};
