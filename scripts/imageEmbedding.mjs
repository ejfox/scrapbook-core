import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import axios from "axios";
import cheerio from "cheerio";
import { marked } from "marked";
import winston from "winston";
import Bottleneck from "bottleneck";
import { nomicLimiter } from "./shared/rateLimiters.mjs";

dotenv.config();

const logger = winston.createLogger({
  level: process.env.DEBUG === "true" ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

// Initialize Supabase with service role for vector operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Extract and embed images from different source types
 */
export async function processImagesForScrap(scrap) {
  try {
    let imageUrls = [];

    switch (scrap.source) {
      case "mastodon":
        imageUrls = extractMastodonImages(scrap);
        break;
      case "arena":
        imageUrls = extractArenaImages(scrap);
        break;
      case "github":
        imageUrls = await extractGithubImages(scrap);
        break;
      default:
        logger.debug(`No image processing for source: ${scrap.source}`);
        return scrap;
    }

    if (!imageUrls.length) {
      logger.debug("No images found to process");
      return scrap;
    }

    // Get embedding for first image
    const firstImageUrl = imageUrls[0];
    logger.info(`Getting embedding for image: ${firstImageUrl}`);

    const embedding = await getImageEmbedding(firstImageUrl);
    if (!embedding) {
      logger.warn("Failed to get image embedding");
      return scrap;
    }

    // Add image data to scrap
    return {
      ...scrap,
      metadata: {
        ...scrap.metadata,
        image_urls: imageUrls,
        primary_image_url: firstImageUrl,
      },
      image_embedding: embedding,
    };
  } catch (error) {
    logger.error("Error processing images:", error);
    return scrap;
  }
}

// Source-specific image extractors
function extractMastodonImages(scrap) {
  const mediaAttachments = scrap.metadata?.media_attachments || [];
  const imageUrls = mediaAttachments
    .filter((media) => media.type === "image")
    .map((media) => media.url);

  // Log what we found
  logger.info(`Found ${imageUrls.length} images in Mastodon status`);
  return imageUrls;
}

function extractArenaImages(scrap) {
  if (scrap.metadata?.image_data?.display?.url) {
    return [scrap.metadata.image_data.display.url];
  }
  if (scrap.screenshot_url) {
    return [scrap.screenshot_url];
  }
  logger.debug(
    "Arena block metadata:",
    JSON.stringify(scrap.metadata, null, 2)
  );
  return [];
}

async function extractGithubImages(scrap) {
  try {
    let markdown = "";

    if (scrap.type === "pull_request") {
      markdown = scrap.metadata?.body || "";
    } else if (scrap.type === "repository") {
      // Fetch README content
      const readmeResponse = await axios.get(
        `https://api.github.com/repos/${scrap.metadata.full_name}/readme`,
        {
          headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3.raw",
          },
        }
      );
      markdown = readmeResponse.data;
    }

    // Parse markdown and extract image URLs
    const html = marked(markdown);
    const $ = cheerio.load(html);
    const images = [];

    $("img").each((i, elem) => {
      const src = $(elem).attr("src");
      if (src && !src.includes("badge")) {
        // Skip badges
        images.push(src);
      }
    });

    return images;
  } catch (error) {
    logger.error("Error extracting GitHub images:", error);
    return [];
  }
}

/**
 * Get embedding for an image URL using Nomic or similar service
 */
export async function getImageEmbedding(imageUrl) {
  return nomicLimiter.schedule("image-embedding", async () => {
    try {
      logger.info(`Fetching image from: ${imageUrl}`);

      // Create URLSearchParams for form data
      const params = new URLSearchParams();
      params.append("model", "nomic-embed-vision-v1.5");
      params.append("urls", imageUrl);

      logger.debug("Request details:", {
        url: "https://api-atlas.nomic.ai/v1/embedding/image",
        dimensionality: 768,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${process.env.NOMIC_API_KEY?.substring(
            0,
            8
          )}...`,
        },
      });

      // Get embedding from Nomic
      const nomicResponse = await axios.post(
        "https://api-atlas.nomic.ai/v1/embedding/image",
        params,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            Authorization: `Bearer ${process.env.NOMIC_API_KEY}`,
          },
          timeout: 30000,
        }
      );

      // Verify dimensionality
      const embedding = nomicResponse.data.embeddings[0];
      if (embedding && embedding.length !== 768) {
        logger.warn(
          `Unexpected embedding dimensionality: got ${embedding.length}, expected 768`
        );
      }

      return embedding;
    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn("Nomic API rate limit exceeded, will retry after cooldown");
        throw error;
      }
      logger.error("Error getting image embedding:", error.message);
      logger.error("Error details:", {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        url: imageUrl,
        response: error.response?.data,
      });
      return null;
    }
  });
}
