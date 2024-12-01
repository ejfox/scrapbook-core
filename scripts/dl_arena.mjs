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
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

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

// Update processBlock to use merging and better logging
export const processBlock = async (block) => {
  if (!block || !block.id) {
    logger.error("Invalid block:", block);
    return null;
  }

  const blockId = block.id;
  logger.info(`\n📦 Processing Arena block: ${blockId}`);
  logger.info(`Type: ${block.class} | Channel: ${block.channel}`);

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
      // Check if we already have a Cloudinary version
      const existingCloudinaryUrl = block.metadata?.image_data?.cloudinary_url;
      if (existingCloudinaryUrl) {
        logger.debug(`Using existing Cloudinary URL: ${existingCloudinaryUrl}`);
        screenshot_url = existingCloudinaryUrl;
      } else {
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
          logger.debug("Cloudinary upload result:", {
            original_url: originalImageUrl,
            cloudinary_url: screenshot_url,
            public_id: result.public_id,
            bytes: result.bytes,
            format: result.format,
          });

          logger.info(`✅ Uploaded image to Cloudinary: ${screenshot_url}`);
        } catch (error) {
          logger.error(
            `Failed to upload image to Cloudinary: ${error.message}`
          );
          // Fallback to original URL if Cloudinary upload fails
          screenshot_url = originalImageUrl;
        }
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
      shared: false, // Always false by default
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

    logger.debug("Image data available:", {
      "metadata.image_data": scrap.metadata.image_data,
      screenshot_url: scrap.screenshot_url,
      class: scrap.metadata.class,
    });

    // Process images and get embeddings
    logger.info(`🖼️ Processing images for block ${blockId}`);
    const scrapWithImages = await processImagesForScrap(scrap);

    if (scrapWithImages.image_embedding) {
      logger.info(
        `✅ Generated image embedding for ${blockId} (${scrapWithImages.image_embedding.length} dimensions)`
      );
    } else {
      logger.info(
        `ℹ No image embedding generated for ${blockId}. Available image data:`,
        {
          "metadata.image_urls": scrapWithImages.metadata?.image_urls,
          "metadata.primary_image_url":
            scrapWithImages.metadata?.primary_image_url,
        }
      );
    }

    // Return processed scrap
    logger.info(`📊 Final scrap state for ${blockId}:`);

    // Log the final state
    logger.info(`📊 Final scrap state for ${blockId}:
      • Title: ${scrapWithImages.title.substring(0, 50)}...
      • Channel: ${scrapWithImages.metadata.channel}
      • Has image embedding: ${Boolean(scrapWithImages.image_embedding)}
      • Tags: ${scrapWithImages.tags.join(", ")}
    `);

    return scrapWithImages;
  } catch (error) {
    logger.error(`❌ Error processing block ${blockId}:`, error);
    return null;
  }
};

// Add at top level
let isShuttingDown = false;

// Export function to set shutdown state
export function setShuttingDown(value) {
  isShuttingDown = value;
}

// Update fetchAllBlocks to accept options
export const fetchAllBlocks = async (testMode = false, options = {}) => {
  if (options.isShuttingDown) {
    isShuttingDown = options.isShuttingDown;
  }
  let allBlocks = [];
  let processedCount = 0;
  let totalChannels = 0;
  let currentChannel = 0;

  try {
    logger.info("\n🔍 Fetching Are.na channels...");
    const userChannels = await arena.user(USER_SLUG).channels();
    if (!userChannels?.length) {
      throw new Error("No channels found for user");
    }
    totalChannels = userChannels.length;
    logger.info(chalk.green(`📚 Found ${totalChannels} channels`));
    logger.debug("Channels:", userChannels.map((c) => c.title).join(", "));

    const channelsToProcess = testMode ? [userChannels[0]] : userChannels;

    for (const channel of channelsToProcess) {
      currentChannel++;
      logger.info(
        `\n📂 Processing channel ${currentChannel}/${totalChannels}: ${channel.title}`
      );

      const response = await arenaLimiter.schedule(() =>
        arena.channel(channel.id).contents({
          page: 1,
          per: testMode ? 5 : 100,
          sort: "updated_at",
          direction: "desc",
        })
      );

      const blocks = response || [];
      if (!blocks.length) {
        logger.warn(
          chalk.yellow(`No blocks found in channel: ${channel.title}`)
        );
        continue;
      }
      logger.info(
        chalk.green(`📦 Found ${blocks.length} blocks in ${channel.title}`)
      );
      processedCount += blocks.length;

      for (const block of blocks) {
        if (isShuttingDown) break;
        // Enrich block with channel info before passing to index.mjs
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

        allBlocks.push(enrichedBlock);
      }

      // Update progress
      logger.info(`Progress: ${processedCount} blocks processed`);
      logger.info(`Channel progress: ${currentChannel}/${totalChannels}`);
    }

    logger.info(`\n✅ Processing complete!
      • Total channels processed: ${currentChannel}
      • Total blocks processed: ${processedCount}
      • Successful blocks: ${allBlocks.length}
      • Failed/skipped: ${processedCount - allBlocks.length}
    `);

    return allBlocks;
  } catch (error) {
    logger.error("\n❌ Error fetching blocks:", error);
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
