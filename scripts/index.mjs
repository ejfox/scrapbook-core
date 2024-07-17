#!/usr/bin/env node
import OpenAI from "openai";
import { program } from "commander";
import { fetchAllBlocks } from "./dl_arena.mjs";
import { fetchStatuses, fetchUserId } from "./dl_mastodon.mjs";
import { fetchBookmarksWithCache } from "./dl_pinboard.mjs";
import { fetchGithubData } from "./dl_github.mjs";
import * as helpers from "../helpers.js";
import { updateManifest } from "./manifestHelpers.mjs";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";
import Bottleneck from "bottleneck";
import fs, { mkdir } from "fs/promises";
import axios from "axios";
import { summarizeContent, metaSummaryToTags } from "./aiSummarization.mjs";
import path from "path";
import terminalImage from "terminal-image";
import extractLocation from "./aiGeolocation.mjs";
import { extractRelationships } from "./aiRelationshipExtraction.mjs";
import dotenv from "dotenv";

process.on("unhandledRejection", (reason, promise) => {
  console.log("Unhandled Rejection at:", promise, "reason:", reason);
});

dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CHECKPOINT_FILE = "./data/checkpoint.json";
let DEBUG = false;
let isShuttingDown = false;

function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 500,
});

const upsertLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 1000,
});

const browserLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

async function generateEmbedding(text) {
  if (process.env.USE_OPENAI !== "true") {
    console.log("OpenAI is not enabled, skipping embedding generation.");
    return null;
  }

  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    return null;
  }
}

async function extractAndAddRelationships(scrapObj) {
  try {
    const content = scrapObj.summary || scrapObj.content;
    if (!content) {
      console.log(
        `No content available for scrap ${scrapObj.scrap_id}, skipping relationship extraction.`
      );
      return scrapObj;
    }

    const relationshipsData = await limiter.schedule(() =>
      extractRelationships(content, { isRawText: !scrapObj.summary })
    );

    scrapObj.relationships = relationshipsData.relationships;
    return scrapObj;
  } catch (error) {
    console.error(
      `Error extracting relationships for scrap ${scrapObj.scrap_id}:`,
      error
    );
    return scrapObj;
  }
}

async function ensureDirectoryExists(dirPath) {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
}

async function getExistingScrap(scrapId) {
  const { data, error } = await supabase
    .from("scraps")
    .select("*")
    .eq("scrap_id", scrapId)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error checking for existing scrap:", error);
  }

  return data;
}

async function loadCheckpoint() {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.log("No checkpoint file found, creating a new one.");
    const checkpoint = {
      pinboard: new Date(0).toISOString(),
      mastodon: new Date(0).toISOString(),
      arena: new Date(0).toISOString(),
      github: new Date(0).toISOString(),
    };
    await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
    return checkpoint;
  }
}

async function saveCheckpoint(checkpoint) {
  try {
    const directory = path.dirname(CHECKPOINT_FILE);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
    console.log("Checkpoint saved.");
  } catch (error) {
    console.error("Error saving checkpoint:", error);
  }
}

async function upsertScrap(scrap, newOnly = false) {
  try {
    if (newOnly) {
      const { data, error } = await supabase
        .from("scraps")
        .select("scrap_id")
        .eq("scrap_id", scrap.scrap_id)
        .single();

      if (data) {
        console.log(`Scrap ${scrap.scrap_id} already exists, skipping.`);
        return;
      }
    }

    // Generate embedding if summary exists and USE_OPENAI is true
    if (scrap.summary && process.env.USE_OPENAI === "true") {
      scrap.embedding = await generateEmbedding(scrap.summary);
    }

    const { data, error } = await supabase
      .from("scraps")
      .upsert(scrap, { onConflict: "scrap_id" });

    if (error) {
      console.error("Error upserting scrap:", error);
    } else {
      console.log(
        `Scrap ${newOnly ? "inserted" : "upserted"}: ${scrap.scrap_id} ${
          scrap.content
        } ${scrap.source}`
      );
    }
  } catch (error) {
    console.error("Error in upsertScrap:", error);
  }
}

async function fetchAndUpsertPinboardBookmarks(lastScrapTime, newOnly) {
  try {
    console.log(`Fetching Pinboard bookmarks since ${lastScrapTime}...`);
    const pinboardBookmarks = await fetchBookmarksWithCache(false);
    log(`Fetched ${pinboardBookmarks.length} Pinboard bookmarks`);

    if (pinboardBookmarks) {
      await updateManifest("pinboard", { lastFetch: new Date().toISOString() });
    }

    if (isShuttingDown) return lastScrapTime;

    for (const bookmark of pinboardBookmarks) {
      if (isShuttingDown) {
        console.log("Shutting down, skipping bookmark processing");
        break;
      }

      if (!lastScrapTime || new Date(bookmark.time) > new Date(lastScrapTime)) {
        const scrapId = helpers.scrapToUUID("pinboard" + bookmark.href);
        const existingScrap = await getExistingScrap(scrapId);

        if (newOnly && existingScrap) {
          console.log(`Scrap ${scrapId} already exists, skipping.`);
          continue;
        }

        let pageContent = "";
        let summary = existingScrap?.summary || "";

        if (!summary) {
          try {
            pageContent = await browserLimiter.schedule(() =>
              helpers.fetchPageContent(bookmark.href)
            );
            summary = await limiter.schedule(() =>
              summarizeContent(pageContent, { metaSummary: true })
            );
          } catch (error) {
            console.error("Error processing bookmark:", error);
          }
        }

        let location = existingScrap?.metadata?.location;
        let latitude = existingScrap?.metadata?.latitude;
        let longitude = existingScrap?.metadata?.longitude;

        if (!location) {
          const locationData = await limiter.schedule(() =>
            extractLocation(summary)
          );
          location = locationData.location;
          latitude = locationData.latitude;
          longitude = locationData.longitude;
        }

        let tags = await limiter.schedule(() => metaSummaryToTags(summary));
        tags = tags.split("\n").map((tag) => tag.trim());
        const combinedTags = [...new Set([...tags, ...bookmark.tags])];

        let screenshotUrl = existingScrap?.metadata?.screenshotUrl;
        if (!screenshotUrl) {
          await browserLimiter.schedule(async () => {
            screenshotUrl = await generateWebpageScreenshot(bookmark.href);
          });
        }

        let bookmarkObj = {
          // title: bookmark.title,
          scrap_id: scrapId,
          source: "pinboard",
          content: bookmark.description,
          created_at: bookmark.time,
          updated_at: new Date().toISOString(),
          summary: summary,
          tags: combinedTags,
          metadata: {
            title: bookmark.title,
            href: bookmark.href,
            screenshotUrl: screenshotUrl,
            location: location,
            latitude: latitude,
            longitude: longitude,
          },
        };

        // Extract and add relationships
        bookmarkObj = await extractAndAddRelationships(bookmarkObj);

        await upsertLimiter.schedule(() => upsertScrap(bookmarkObj, newOnly));
      }
    }

    console.log(
      `${pinboardBookmarks.length} Pinboard bookmarks processed and upserted.`
    );

    return new Date().toISOString();
  } catch (error) {
    console.error("Error in fetchAndUpsertPinboardBookmarks:", error);
  }
}

async function fetchAndUpsertMastodonStatuses(lastScrapTime) {
  try {
    console.log("Fetching Mastodon statuses...");
    const userId = await fetchUserId();
    const statuses = await fetchStatuses(userId);
    log(`Fetched ${statuses.length} Mastodon statuses`);

    if (isShuttingDown) return lastScrapTime;

    if (statuses) {
      await updateManifest("mastodon", { lastFetch: new Date().toISOString() });
    }

    for (const status of statuses) {
      if (isShuttingDown) {
        console.log("Shutting down, skipping status processing");
        break;
      }

      if (
        !lastScrapTime ||
        new Date(status.created_at) > new Date(lastScrapTime)
      ) {
        const statusObj = {
          scrap_id: helpers.scrapToUUID("mastodon" + status.id),
          // title: status.content,
          source: "mastodon",
          content: status.content,
          created_at: status.created_at,
          updated_at: new Date().toISOString(),
          tags: status.tags.map((tag) => tag.name),
          metadata: {
            url: status.url,
            visibility: status.visibility,
            favourites_count: status.favourites_count,
            reblogs_count: status.reblogs_count,
          },
        };

        await upsertLimiter.schedule(() => upsertScrap(statusObj));
      }
    }

    console.log(`${statuses.length} Mastodon statuses processed and upserted.`);

    return new Date().toISOString();
  } catch (error) {
    console.error("Error in fetchAndUpsertMastodonStatuses:", error);
  }
}

async function fetchAndUpsertArenaBlocks(lastScrapTime) {
  try {
    console.log("Fetching Are.na blocks...");
    const blocks = await fetchAllBlocks();
    log(`Fetched ${blocks.length} Are.na blocks`);

    if (isShuttingDown) return lastScrapTime;

    if (blocks) {
      await updateManifest("arena", { lastFetch: new Date().toISOString() });
    }

    for (const block of blocks) {
      if (isShuttingDown) {
        console.log("Shutting down, skipping block processing");
        break;
      }

      if (
        !lastScrapTime ||
        new Date(block.created_at) > new Date(lastScrapTime)
      ) {
        const blockObj = {
          scrap_id: helpers.scrapToUUID("arena" + block.id),
          // title: block.title,
          source: "arena",
          content: block.content,
          created_at: block.created_at,
          updated_at: new Date().toISOString(),
          tags: block.tags,
          metadata: {
            title: block.title,
            description: block.description,
            source: block.source,
            image: block.image,
          },
          relationships: [], // We'll populate this next
        };

        // Extract relationships based on channels
        if (
          block.connected_to_channels &&
          block.connected_to_channels.length > 0
        ) {
          blockObj.relationships = block.connected_to_channels.map(
            (channel) => ({
              source: {
                type: "Block",
                name: block.title || `Block ${block.id}`,
              },
              target: { type: "Channel", name: channel.title },
              type: "BELONGS_TO",
            })
          );
        }

        await upsertLimiter.schedule(() => upsertScrap(blockObj));
      }
    }

    console.log(`${blocks.length} Are.na blocks processed and upserted.`);

    return new Date().toISOString();
  } catch (error) {
    console.error("Error in fetchAndUpsertArenaBlocks:", error);
  }
}

async function fetchAndUpsertGithubData() {
  try {
    console.log("Fetching GitHub data...");
    const githubData = await fetchGithubData();
    console.log(`Fetched GitHub data`);

    if (githubData) {
      await updateManifest("github", { lastFetch: new Date().toISOString() });
    }

    const allScraps = [
      ...githubData.userRepos.map((repo) => ({ ...repo, repository: true })),
      ...githubData.userPRs.map((pr) => ({ ...pr, pull_request: true })),
      ...githubData.userIssues.map((issue) => ({ ...issue, issue: true })),
      ...githubData.userGists.map((gist) => ({ ...gist, gist: true })),
      ...githubData.userReleases.map((release) => ({
        ...release,
        release: true,
      })),
      ...githubData.starredRepos.map((starred) => ({
        ...starred,
        starred: true,
      })),
    ];

    for (const scrap of allScraps) {
      if (isShuttingDown) {
        console.log("Shutting down, skipping GitHub data processing");
        break;
      }

      if (scrap.pull_request) {
        console.log(
          `Processing GitHub scrap: ${scrap.name} \n ${JSON.stringify(scrap)}`
        );
      }

      const repoObj = {
        scrap_id: helpers.scrapToUUID("github" + scrap.id),
        source: "github",
        content: helpers.getHumanReadableContent(scrap),
        created_at: scrap.created_at || scrap.created,
        updated_at: scrap.updated_at || scrap.updated,
        tags: scrap.topics || [],
        metadata: {
          name: scrap.name,
          full_name: scrap.full_name,
          href: scrap.html_url,
          image: scrap.hero || null,
          language: scrap.language,
          stargazers_count: scrap.stargazers_count,
          forks_count: scrap.forks_count,
          hero: scrap.hero || null,
        },
      };

      await upsertLimiter.schedule(() => upsertScrap(repoObj));
    }

    console.log(`GitHub data processed and upserted.`);

    return new Date().toISOString();
  } catch (error) {
    console.error("Error in fetchAndUpsertGithubData:", error);
  }
}

function cleanAndFormatFilename(url) {
  let cleanedFilename = url.replace(/[:/]/g, "");
  cleanedFilename = cleanedFilename.replace(/[^\w\s]/gi, "");
  cleanedFilename = cleanedFilename.replace(/\./g, "");
  cleanedFilename = cleanedFilename.replace(/\s+/g, "_");
  return cleanedFilename;
}

function splitQueryParams(url) {
  const [baseUrl, queryParams] = url.split("?");
  return { baseUrl, queryParams };
}

async function generateWebpageScreenshot(webUrl) {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });

  try {
    console.log(`Navigating to: ${webUrl}`);
    await page.goto(webUrl, { waitUntil: "networkidle0", timeout: 60000 });

    const { baseUrl } = splitQueryParams(webUrl);
    const filename = cleanAndFormatFilename(baseUrl);
    const screenshotDir = "./screenshots";
    await ensureDirectoryExists(screenshotDir);
    const screenshotPath = path.join(screenshotDir, `${filename}.png`);

    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved: ${screenshotPath}`);

    // Display screenshot in terminal (if running in a terminal that supports it)
    try {
      console.log(await terminalImage.file(screenshotPath, { width: "50%" }));
    } catch (error) {
      console.log("Unable to display screenshot in terminal.");
    }

    // Upload screenshot to Supabase
    const screenshotBuffer = await fs.readFile(screenshotPath);
    const { data, error } = await supabase.storage
      .from("scrap_screenshots")
      .upload(`${filename}.png`, screenshotBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
        // upsert: true,
      });

    if (error) {
      throw new Error(
        `Error uploading screenshot to Supabase: ${error.message}`
      );
    }

    const { data: urlData } = supabase.storage
      .from("scrap_screenshots")
      .getPublicUrl(`${filename}.png`);

    console.log(`Screenshot URL: ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (error) {
    console.error(`Error capturing screenshot for ${webUrl}:`, error);
    return null;
  } finally {
    await browser.close();
  }
}

async function gracefulShutdown() {
  console.log("\nInitiating graceful shutdown...");
  isShuttingDown = true;

  // Cancel any pending limiter jobs
  limiter.stop({ dropWaitingJobs: true });
  upsertLimiter.stop({ dropWaitingJobs: true });
  browserLimiter.stop({ dropWaitingJobs: true });

  // Wait for ongoing operations to complete
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("Shutdown complete.");
  process.exit(0);
}

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  gracefulShutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown();
});

async function main(options = {}) {
  options = {
    useManifest: true,
    newOnly: true,
    ...options,
  };

  console.log("🚀 Scrapbook Core: Main function started");
  console.log("📊 Options:", JSON.stringify(options, null, 2));

  const checkpoint = await loadCheckpoint();
  console.log("📍 Loaded checkpoint:", JSON.stringify(checkpoint, null, 2));

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  const sources = [
    { name: "pinboard", func: fetchAndUpsertPinboardBookmarks },
    { name: "mastodon", func: fetchAndUpsertMastodonStatuses },
    { name: "arena", func: fetchAndUpsertArenaBlocks },
    { name: "github", func: fetchAndUpsertGithubData },
  ];

  for (const source of sources) {
    if (options[source.name] || options.all) {
      console.log(`\n📦 Processing ${source.name.toUpperCase()}...`);
      try {
        console.time(`${source.name} processing time`);
        const result = await source.func(
          checkpoint[source.name],
          options.newOnly
        );
        checkpoint[source.name] = result;
        console.timeEnd(`${source.name} processing time`);
        console.log(
          `✅ ${source.name.toUpperCase()} processing completed successfully`
        );
      } catch (error) {
        console.error(
          `❌ Error processing ${source.name.toUpperCase()}:`,
          error
        );
      }
    } else {
      console.log(`⏭️  Skipping ${source.name.toUpperCase()} (not selected)`);
    }
  }

  await saveCheckpoint(checkpoint);
  console.log("\n📍 Updated checkpoint:", JSON.stringify(checkpoint, null, 2));

  console.log("\n🏁 Scrapbook Core: Main function completed");
  console.log("📊 Summary:");
  sources.forEach((source) => {
    console.log(
      `  - ${source.name.toUpperCase()}: ${
        options[source.name] || options.all ? "✅ Processed" : "⏭️  Skipped"
      }`
    );
  });
}

program
  .option("-p, --pinboard", "Fetch and upsert Pinboard bookmarks")
  .option("-m, --mastodon", "Fetch and upsert Mastodon statuses")
  .option("-a, --arena", "Fetch and upsert Are.na blocks")
  .option("-g, --github", "Fetch and upsert GitHub data")
  .option("--all", "Fetch and upsert all data sources")
  .option("--new-only", "Only upload new entries, don't update existing ones")
  .option("--debug", "Enable debug mode")
  .parse(process.argv);

const options = program.opts();

if (options.debug) {
  console.log("Debug mode is on.");
  DEBUG = true;
}

if (
  !options.pinboard &&
  !options.mastodon &&
  !options.arena &&
  !options.github &&
  !options.all
) {
  console.error("Please specify at least one data source or use --all");
  process.exit(1);
}

main(options).catch((error) => {
  console.error("Unhandled error in main:", error);
  process.exit(1);
});
