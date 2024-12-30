#!/usr/bin/env node
import Arena from "are.na";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import { generateScrapId } from "../helpers.js";
import { generateScreenshot } from "./generateScreenshot.mjs";
import { processImagesForScrap } from "./imageEmbedding.mjs";
import winston from "winston";
import { createClient } from "@supabase/supabase-js";
import { INSTANCE_NAME } from "../helpers/instanceName.mjs";
import chalk from "chalk";
import { arenaLimiter, processLimiter } from "./shared/rateLimiters.mjs";
import { v2 as cloudinary } from "cloudinary";

dotenv.config();

// Simple debug flag from env
const DEBUG = process.env.DEBUG === "true";

// Improve logging
const logger = winston.createLogger({
  level: DEBUG ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

// Setup logging helpers
function logMetric(name, data = {}) {
  logger.info(name, {
    type: "metric",
    metric: name,
    source: "arena",
    ...data,
  });
}

function logStatus(level, message, data = {}) {
  logger.log(level, message, {
    type: "status",
    source: "arena",
    ...data,
  });
}

function logError(message, error, context = {}) {
  logger.error(message, {
    type: "error",
    source: "arena",
    error: error.message,
    stack: error.stack,
    ...context,
  });
}

// Environment checks
const USER_SLUG = process.env.USER_SLUG || "ej-fox";
const ARENA_ACCESS_TOKEN = process.env.ARENA_ACCESS_TOKEN;

if (!ARENA_ACCESS_TOKEN) {
  logger.error("ARENA_ACCESS_TOKEN is not set in the environment variables.");
  process.exit(1);
}

logger.info("Initializing Arena client");
const arena = new Arena({ accessToken: ARENA_ACCESS_TOKEN });

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: "public" },
  }
);

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Add this helper function for merging scraps
async function mergeExistingScrap(newScrap) {
  try {
    // Check for existing scrap
    const { data, error } = await supabase
      .from("scraps")
      .select("*")
      .eq("scrap_id", newScrap.scrap_id)
      .limit(1);

    if (error) {
      logger.error(`Failed to check for existing scrap: ${error.message}`);
      throw error;
    }

    const existing = data?.[0];
    if (!existing) return newScrap;

    logger.info(`Found existing scrap for ${newScrap.scrap_id}`);

    // Smart merging
    const merged = {
      ...existing,
      ...newScrap,
      // Keep existing embeddings if they exist
      image_embedding: existing.image_embedding || newScrap.image_embedding,
      // Merge arrays without duplicates
      tags: [...new Set([...(existing.tags || []), ...(newScrap.tags || [])])],
      relationships: [
        ...new Set([
          ...(existing.relationships || []),
          ...(newScrap.relationships || []),
        ]),
      ],
      // Merge metadata, keeping track of updates
      metadata: {
        ...(existing.metadata || {}),
        ...(newScrap.metadata || {}),
        last_checked: new Date().toISOString(),
        update_count: (existing.metadata?.update_count || 0) + 1,
        previous_image_urls: [
          ...(existing.metadata?.image_urls || []),
          ...(existing.metadata?.previous_image_urls || []),
        ].filter(Boolean),
      },
    };

    logger.debug(`Merged scrap details:
      • ID: ${merged.scrap_id}
      • Title: ${merged.title}
      • Has image embedding: ${Boolean(merged.image_embedding)}
      • Tags: ${merged.tags.join(", ")}
      • Update count: ${merged.metadata.update_count}
    `);

    return merged;
  } catch (error) {
    logger.error(`Error merging scrap: ${error.message}`);
    return newScrap;
  }
}

// Update processBlock with metrics
export const processBlock = async (block) => {
  if (!block || !block.id) {
    logError("Invalid block provided", new Error("Invalid block"), { block });
    return null;
  }

  const blockId = block.id;
  const startTime = Date.now();

  logStatus("info", `Processing Arena block: ${blockId}`, {
    block_id: blockId,
    block_type: block.class,
    channel: block.channel,
  });

  try {
    // Handle different block classes (Image, Text, Media, Link, etc)
    const content = (() => {
      if (!block.class) return "No content";

      switch (block.class.toLowerCase()) {
        case "image":
          return (
            block.description ||
            block.title ||
            block.generated_title ||
            "Untitled image"
          );
        case "text":
          return block.content || block.description || "Empty text block";
        case "link":
          return block.description || block.source?.title || "Untitled link";
        case "attachment":
          return block.description || block.title || "Untitled attachment";
        case "media":
          return block.description || block.embed?.title || "Untitled media";
        default:
          return block.content || block.description || "No content";
      }
    })();

    // Get best available URL
    const url = (() => {
      if (block.source?.url) return block.source.url;
      if (block.attachment?.url) return block.attachment.url;
      if (block.embed?.url) return block.embed.url;
      return `https://www.are.na/block/${block.id}`;
    })();

    // Get best available image URL with highest resolution
    const getHighestResolutionUrl = () => {
      if (block.image?.original?.url) return block.image.original.url;
      if (block.image?.large?.url) return block.image.large.url;
      if (block.image?.display?.url) return block.image.display.url;
      if (block.image?.square?.url) return block.image.square.url;
      if (block.image?.thumb?.url) return block.image.thumb.url;
      if (block.attachment?.url) return block.attachment.url;
      if (block.embed?.thumbnail_url) return block.embed.thumbnail_url;
      return null;
    };

    const originalImageUrl = getHighestResolutionUrl();
    let screenshot_url = null;

    if (originalImageUrl) {
      const imageStartTime = Date.now();
      try {
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(originalImageUrl, {
          folder: "arena",
          public_id: `arena-${block.id}`,
          overwrite: true,
          resource_type: "auto",
          transformation: [
            { quality: "auto" },
            { fetch_format: "auto" },
            { dpr: "auto" },
          ],
        });

        screenshot_url = result.secure_url;

        logMetric("image_processed", {
          block_id: blockId,
          duration_ms: Date.now() - imageStartTime,
          original_size: result.bytes,
          format: result.format,
          width: result.width,
          height: result.height,
        });
      } catch (error) {
        logError("Image processing failed", error, {
          block_id: blockId,
          original_url: originalImageUrl,
        });
        screenshot_url = originalImageUrl;
      }
    }

    // Parse dates safely
    const created = block.created_at ? new Date(block.created_at) : new Date();
    const updated = block.updated_at ? new Date(block.updated_at) : created;

    const scrap = {
      id: generateScrapId("arena", block.id),
      source: "arena",
      type: "block",
      url,
      title: block.title || block.generated_title || "Untitled Block",
      content,
      screenshot_url,
      published_at: created.toISOString(),
      created_at: created.toISOString(),
      updated_at: updated.toISOString(),
      shared: false,
      tags: [
        block.class?.toLowerCase(),
        block.base_class?.toLowerCase(),
      ].filter(Boolean),
      metadata: {
        class: block.class,
        base_class: block.base_class,
        channel: block.channel,
        connected_to_channels: block.connected_to_channels?.map((c) => ({
          id: c.id,
          title: c.title,
        })),
        source_data: block.source && {
          provider: block.source.provider?.name,
          url: block.source.url,
          title: block.source.title,
        },
        image_data: block.image && {
          thumb: block.image.thumb?.url,
          square: block.image.square?.url,
          display: block.image.display?.url,
          original_url: originalImageUrl,
          cloudinary_url: screenshot_url,
        },
        embed: block.embed && {
          type: block.embed.type,
          title: block.embed.title,
          author_name: block.embed.author_name,
          author_url: block.embed.author_url,
          thumbnail_url: block.embed.thumbnail_url,
        },
        attachment: block.attachment && {
          file_name: block.attachment.file_name,
          extension: block.attachment.extension,
          content_type: block.attachment.content_type,
          file_size: block.attachment.file_size,
        },
      },
    };

    // Process images and get embeddings
    logStatus("info", "Processing images for block", { block_id: blockId });
    const embeddingStartTime = Date.now();
    const scrapWithImages = await processImagesForScrap(scrap);

    if (scrapWithImages.image_embedding) {
      logMetric("embedding_generated", {
        block_id: blockId,
        duration_ms: Date.now() - embeddingStartTime,
        dimensions: scrapWithImages.image_embedding.length,
      });
    }

    const totalDuration = Date.now() - startTime;
    logMetric("block_processed", {
      block_id: blockId,
      duration_ms: totalDuration,
      block_type: block.class,
      has_content: !!content,
      has_image: !!screenshot_url,
      has_embedding: !!scrapWithImages.image_embedding,
      tags_count: scrap.tags.length,
      connected_channels: block.connected_to_channels?.length || 0,
    });

    return scrapWithImages;
  } catch (error) {
    logError("Block processing failed", error, {
      block_id: blockId,
      duration_ms: Date.now() - startTime,
      block_type: block.class,
    });
    return null;
  }
};

// Add at top level
let isShuttingDown = false;

// Export function to set shutdown state
export function setShuttingDown(value) {
  isShuttingDown = value;
}

// Update fetchAllBlocks with metrics
export const fetchAllBlocks = async (testMode = false, options = {}) => {
  const startTime = Date.now();
  let processedCount = 0;
  let errorCount = 0;
  let totalChannels = 0;
  let currentChannel = 0;

  if (options.isShuttingDown) {
    isShuttingDown = options.isShuttingDown;
  }

  try {
    logStatus("info", "Fetching Are.na channels...");
    const userChannels = await arena.user(USER_SLUG).channels();

    if (!userChannels?.length) {
      throw new Error("No channels found for user");
    }

    totalChannels = userChannels.length;
    logMetric("channels_found", {
      total_channels: totalChannels,
      channels: userChannels.map((c) => c.title),
    });

    const channelsToProcess = testMode ? [userChannels[0]] : userChannels;

    for (const channel of channelsToProcess) {
      if (isShuttingDown) break;

      currentChannel++;
      const channelStartTime = Date.now();

      logStatus("info", `Processing channel: ${channel.title}`, {
        channel_id: channel.id,
        progress: `${currentChannel}/${totalChannels}`,
      });

      try {
        const response = await arenaLimiter.schedule(() =>
          arena.channel(channel.id).contents({
            page: 1,
            per: testMode ? 5 : 100,
            sort: "updated_at",
            direction: "desc",
          })
        );

        const blocks = response || [];

        logMetric("channel_processed", {
          channel_id: channel.id,
          channel_title: channel.title,
          blocks_count: blocks.length,
          duration_ms: Date.now() - channelStartTime,
        });

        for (const block of blocks) {
          if (isShuttingDown) break;
          processedCount++;
        }
      } catch (error) {
        errorCount++;
        logError("Channel processing failed", error, {
          channel_id: channel.id,
          channel_title: channel.title,
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    logMetric("arena_sync_completed", {
      total_duration_ms: totalDuration,
      channels_processed: currentChannel,
      total_channels: totalChannels,
      blocks_processed: processedCount,
      errors: errorCount,
      test_mode: testMode,
    });

    return allBlocks;
  } catch (error) {
    logError("Arena sync failed", error, {
      duration_ms: Date.now() - startTime,
      channels_processed: currentChannel,
      blocks_processed: processedCount,
    });
    throw error;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  logger.info("Starting main execution");
  fetchAllBlocks(DEBUG)
    .then((blocks) => {
      logger.info(`Total blocks fetched: ${blocks.length}`);
      if (DEBUG && blocks.length > 0) {
        logger.debug("Sample block:", JSON.stringify(blocks[0], null, 2));
      }
    })
    .catch((error) => {
      logger.error("Unhandled error in main:", error);
      process.exit(1);
    });
}
