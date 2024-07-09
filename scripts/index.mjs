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
import fs from "fs/promises";
import axios from "axios";
import { summarizeContent, metaSummaryToTags } from "./aiSummarization.mjs";
import path from "path";
import terminalImage from "terminal-image";
import { extractLocation } from "./aiGeolocation.mjs";
import dotenv from "dotenv";

console.log("Script started");

process.on("unhandledRejection", (reason, promise) => {
  console.log("Unhandled Rejection at:", promise, "reason:", reason);
});

dotenv.config();

const CHECKPOINT_FILE = "./data/checkpoint.json";
let DEBUG = false;

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

async function upsertScrap(scrap) {
  try {
    const { data, error } = await supabase
      .from("scraps")
      .upsert(scrap, { onConflict: "scrap_id" });

    if (error) {
      console.error("Error upserting scrap:", error);
    } else {
      console.log(`Scrap upserted: ${scrap.scrap_id}`);
    }
  } catch (error) {
    console.error("Error in upsertScrap:", error);
  }
}

async function fetchAndUpsertPinboardBookmarks(lastScrapTime) {
  try {
    console.log("Fetching Pinboard bookmarks...");
    const pinboardBookmarks = await fetchBookmarksWithCache();
    log(`Fetched ${pinboardBookmarks.length} Pinboard bookmarks`);

    if (pinboardBookmarks) {
      await updateManifest("pinboard", { lastFetch: new Date().toISOString() });
    }

    for (const bookmark of pinboardBookmarks) {
      if (!lastScrapTime || bookmark.time > lastScrapTime) {
        let pageContent = "";
        let summary = "";

        const { data } = await supabase
          .from("scraps")
          .select("summary")
          .eq("scrap_id", helpers.scrapToUUID("pinboard" + bookmark.href));

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
        const combinedTags = [...tags, ...bookmark.tags];

        let screenshotUrl = null;
        await browserLimiter.schedule(async () => {
          screenshotUrl = await generateWebpageScreenshot(bookmark.href);
        });

        const bookmarkObj = {
          scrap_id: helpers.scrapToUUID("pinboard" + bookmark.href),
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
        };

        await upsertLimiter.schedule(() => upsertScrap(bookmarkObj));
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

// ... (other functions like fetchAndUpsertGithubData, fetchAndUpsertMastodonStatuses, fetchAndUpsertArenaBlocks remain the same)

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
  // ... (implementation remains the same)
}

async function main(options) {
  console.log("Main function started");
  const checkpoint = await loadCheckpoint();

  if (options.pinboard || options.all) {
    checkpoint.pinboard = await fetchAndUpsertPinboardBookmarks(
      checkpoint.pinboard
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
