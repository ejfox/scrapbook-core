#!/usr/bin/env node

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

async function ensureDirectoryExists(dirPath) {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
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
      // Check if the scrap already exists
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

    const { data, error } = await supabase
      .from("scraps")
      .upsert(scrap, { onConflict: "scrap_id" });

    if (error) {
      console.error("Error upserting scrap:", error);
    } else {
      console.log(
        `Scrap ${newOnly ? "inserted" : "upserted"}: ${scrap.scrap_id}`
      );
    }
  } catch (error) {
    console.error("Error in upsertScrap:", error);
  }
}

async function fetchAndUpsertPinboardBookmarks(lastScrapTime, newOnly) {
  try {
    console.log("Fetching Pinboard bookmarks...");
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

        if (newOnly) {
          const exists = await scrapExists(scrapId);
          if (exists) {
            console.log(`Scrap ${scrapId} already exists, skipping.`);
            continue;
          }
        }

        let pageContent = "";
        let summary = "";

        const { data } = await supabase
          .from("scraps")
          .select("summary")
          .eq("scrap_id", scrapId);

        const existingSummary = data?.[0]?.summary;

        if (existingSummary) {
          summary = existingSummary;
        } else {
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

        const { location, latitude, longitude } = await limiter.schedule(() =>
          extractLocation(summary)
        );

        let tags = await limiter.schedule(() => metaSummaryToTags(summary));
        tags = tags.split(",").map((tag) => tag.trim());
        const combinedTags = [...new Set([...tags, ...bookmark.tags])];

        let screenshotUrl = null;
        await browserLimiter.schedule(async () => {
          screenshotUrl = await generateWebpageScreenshot(bookmark.href);
        });

        // Extract relationships
        const relationshipsData = await limiter.schedule(() =>
          extractRelationships(pageContent || summary)
        );

        const bookmarkObj = {
          scrap_id: scrapId,
          source: "pinboard",
          content: bookmark.description,
          created_at: bookmark.time,
          updated_at: new Date().toISOString(),
          summary: summary,
          tags: combinedTags,
          metadata: {
            href: bookmark.href,
            screenshotUrl: screenshotUrl,
            location: location,
            latitude: latitude,
            longitude: longitude,
          },
          relationships: relationshipsData.relationships, // Add the relationships here
        };

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
    log(`Fetched GitHub data`);

    if (githubData) {
      await updateManifest("github", { lastFetch: new Date().toISOString() });
    }

    for (const repo of githubData.repos) {
      if (isShuttingDown) {
        console.log("Shutting down, skipping GitHub data processing");
        break;
      }

      const repoObj = {
        scrap_id: helpers.scrapToUUID("github" + repo.id),
        source: "github",
        content: repo.description,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
        tags: repo.topics,
        metadata: {
          name: repo.name,
          full_name: repo.full_name,
          html_url: repo.html_url,
          language: repo.language,
          stargazers_count: repo.stargazers_count,
          forks_count: repo.forks_count,
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
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(webUrl, { waitUntil: "networkidle0", timeout: 60000 });
    const { baseUrl } = splitQueryParams(webUrl);
    const filename = cleanAndFormatFilename(baseUrl);
    const screenshotDir = "./screenshots";
    await ensureDirectoryExists(screenshotDir);
    const screenshotPath = `${screenshotDir}/${filename}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved: ${screenshotPath}`);
    return screenshotPath;
  } catch (error) {
    console.error(`Error capturing screenshot for ${webUrl}:`, error);
    return null;
  } finally {
    await browser.close();
  }
}

async function main(options) {
  console.log("Main function started");
  const checkpoint = await loadCheckpoint();

  process.on("SIGINT", async () => {
    console.log("\nGracefully shutting down...");
    isShuttingDown = true;

    // Give ongoing operations a chance to complete
    await new Promise((resolve) => setTimeout(resolve, 2500));

    console.log("Shutdown complete.");
    process.exit(0);
  });

  if (options.pinboard || options.all) {
    checkpoint.pinboard = await fetchAndUpsertPinboardBookmarks(
      checkpoint.pinboard,
      options.newOnly
    );
  }

  if (options.mastodon || options.all) {
    checkpoint.mastodon = await fetchAndUpsertMastodonStatuses(
      checkpoint.mastodon
    );
  }

  if (options.arena || options.all) {
    checkpoint.arena = await fetchAndUpsertArenaBlocks(checkpoint.arena);
  }

  if (options.github || options.all) {
    checkpoint.github = await fetchAndUpsertGithubData();
  }

  await saveCheckpoint(checkpoint);
  console.log("Main function completed");
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
