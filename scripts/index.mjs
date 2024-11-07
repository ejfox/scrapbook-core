#!/usr/bin/env node
import OpenAI from "openai";
import { program } from "commander";
import { fetchAllBlocks } from "./dl_arena.mjs";
import { fetchStatuses, fetchUserId } from "./dl_mastodon.mjs";
import { fetchBookmarksWithCache } from "./dl_pinboard.mjs";
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
import { addSeconds, parseISO } from "date-fns";

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

// Bottleneck limiters for rate-limiting async tasks
const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 1500 });
const upsertLimiter = new Bottleneck({ maxConcurrent: 3, minTime: 1500 });
const browserLimiter = new Bottleneck({ maxConcurrent: 1, minTime: 1500 });

const MACHINE_ID = process.env.FLY_MACHINE_ID || 'local';

function log(...args) {
  if (DEBUG) console.log(`[${MACHINE_ID}]`, ...args);
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
process.on("uncaughtException", gracefulShutdown);
process.on("unhandledRejection", gracefulShutdown);
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
async function getExistingScrap(scrapId) {
  const { data, error } = await supabase
    .from("scraps")
    .select("*")
    .eq("scrap_id", scrapId)
    .single();
  if (error)
    log(
      `Failed to retrieve scrap with ID: ${scrapId}, error: ${error.message}`
    );
  return data;
}

// Upsert a scrap into the database
async function upsertScrap(scrap, newOnly = false) {
  if (newOnly && (await getExistingScrap(scrap.scrap_id))) return;
  if (scrap.summary && process.env.USE_OPENAI)
    scrap.embedding = await generateEmbedding(scrap.summary);

  const { error } = await supabase
    .from("scraps")
    .upsert(scrap, { onConflict: "scrap_id" });
  if (error)
    log(`Failed to upsert scrap: ${scrap.scrap_id}, error: ${error.message}`);
}

// Extract and add relationships to scrap
async function extractAndAddRelationships(scrapObj) {
  const content = scrapObj.summary || scrapObj.content;
  if (!content) return scrapObj;

  try {
    const relationshipsData = await limiter.schedule(() =>
      extractRelationships(content, { isRawText: !scrapObj.summary })
    );
    scrapObj.relationships = relationshipsData.relationships;
  } catch (error) {
    log(
      `Failed to extract relationships for ${scrapObj.scrap_id}:`,
      error.message
    );
  }

  return scrapObj;
}

// Generate a webpage screenshot using Puppeteer
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
    const screenshot = await page.screenshot({ encoding: "base64" });
    log(`Screenshot captured for ${webUrl}`);
    return `data:image/png;base64,${screenshot}`;
  } catch (error) {
    log(`Failed to capture screenshot for ${webUrl}:`, error.message);
    return null;
  } finally {
    await browser.close();
  }
}

// Modify the acquireLock function to use scraps table
async function acquireLock(lockName, ttlSeconds = 300) {
  const now = new Date();
  const expires = addSeconds(now, ttlSeconds);
  const lockId = `lock_${lockName}`;

  // Try to insert or update lock
  const { data, error } = await supabase
    .from('scraps')
    .upsert({
      scrap_id: lockId,
      source: 'lock',
      content: 'Lock record',
      metadata: {
        machine_id: MACHINE_ID,
        expires_at: expires.toISOString(),
        lock_type: lockName
      },
      updated_at: now.toISOString()
    }, {
      onConflict: 'scrap_id'
    })
    .select()
    .single();

  if (error) {
    log(`Failed to acquire lock: ${lockName}`, error);
    return false;
  }

  // Check if lock is expired
  const existingLock = data?.metadata?.expires_at;
  if (existingLock && new Date(existingLock) > now) {
    log(`Lock ${lockName} is held by ${data.metadata.machine_id}`);
    return false;
  }

  return true;
}

async function releaseLock(lockName) {
  const lockId = `lock_${lockName}`;
  const { error } = await supabase
    .from('scraps')
    .delete()
    .eq('scrap_id', lockId)
    .eq('metadata->machine_id', MACHINE_ID); // Only delete if we own the lock
    
  if (error) log(`Failed to release lock: ${lockName}`, error);
}

// Fetch and process Pinboard bookmarks
async function fetchAndUpsertPinboardBookmarks(newOnly) {
  const lockName = 'pinboard_sync';
  if (!await acquireLock(lockName)) {
    log('Another process is syncing Pinboard');
    return;
  }

  try {
    const pinboardBookmarks = await fetchBookmarksWithCache(false);
    log(`Fetched ${pinboardBookmarks.length} Pinboard bookmarks`);

    for (const bookmark of pinboardBookmarks) {
      if (isShuttingDown) break;

      const scrapId = helpers.scrapToUUID("pinboard" + bookmark.href);
      if (newOnly && (await getExistingScrap(scrapId))) continue;

      let summary = "";
      let pageContent = "";

      try {
        pageContent = await browserLimiter.schedule(() =>
          helpers.fetchPageContent(bookmark.href)
        );
        summary = await limiter.schedule(() =>
          summarizeContent(pageContent.slice(0, 100000), { metaSummary: true })
        );
      } catch (error) {
        log(
          `Failed to process bookmark: ${bookmark.href}, error: ${error.message}`
        );
      }

      const locationData = await limiter.schedule(() => extractLocation(summary));
      const tags = [
        ...new Set([
          ...bookmark.tags,
          ...metaSummaryToTags(summary)
            .split("\n")
            .map((tag) => tag.trim()),
        ]),
      ];

      const bookmarkObj = {
        scrap_id: scrapId,
        source: "pinboard",
        content: bookmark.description,
        summary,
        tags,
        metadata: {
          title: bookmark.title,
          href: bookmark.href,
          location: locationData.location,
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          screenshotUrl: await browserLimiter.schedule(() =>
            generateWebpageScreenshot(bookmark.href)
          ),
        },
      };

      bookmarkObj = await extractAndAddRelationships(bookmarkObj);
      await upsertLimiter.schedule(() => upsertScrap(bookmarkObj, newOnly));
    }
  } finally {
    await releaseLock(lockName);
  }
}

// Fetch and process Mastodon statuses
async function fetchAndUpsertMastodonStatuses(newOnly) {
  const userId = await fetchUserId();
  const statuses = await fetchStatuses(userId);
  log(`Fetched ${statuses.length} Mastodon statuses`);

  for (const status of statuses) {
    if (isShuttingDown) break;

    const scrapId = helpers.scrapToUUID("mastodon" + status.id);
    if (newOnly && (await getExistingScrap(scrapId))) continue;

    const images = status.media_attachments
      .filter((a) => a.type === "image")
      .map((a) => ({
        url: a.url,
        preview_url: a.preview_url,
        description: a.description,
      }));

    const statusObj = {
      scrap_id: scrapId,
      source: "mastodon",
      content: status.content,
      tags: [
        ...new Set([
          ...status.tags.map((tag) => tag.name),
          ...(await generateMastodonTags(status)),
        ]),
      ],
      metadata: {
        url: status.url,
        images,
        visibility: status.visibility,
        favourites_count: status.favourites_count,
        reblogs_count: status.reblogs_count,
      },
    };

    await upsertLimiter.schedule(() => upsertScrap(statusObj, newOnly));
  }
}

// Fetch and process Are.na blocks
async function fetchAndUpsertArenaBlocks(newOnly) {
  const blocks = await fetchAllBlocks();
  log(`Fetched ${blocks.length} Are.na blocks`);

  for (const block of blocks) {
    if (isShuttingDown) break;

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

    await upsertLimiter.schedule(() => upsertScrap(blockObj, newOnly));
  }
}

// Fetch and process GitHub data
async function fetchAndUpsertGithubData(newOnly) {
  const githubData = await fetchGithubData();
  log(`Fetched GitHub data`);

  const allScraps = [
    ...githubData.userRepos.map((repo) => ({ ...repo, type: "repository" })),
    ...githubData.userPRs.map((pr) => ({ ...pr, type: "pull_request" })),
    ...githubData.userIssues.map((issue) => ({ ...issue, type: "issue" })),
    ...githubData.userGists.map((gist) => ({ ...gist, type: "gist" })),
    ...githubData.userReleases.map((release) => ({
      ...release,
      type: "release",
    })),
    ...githubData.starredRepos.map((starred) => ({
      ...starred,
      type: "starred",
    })),
  ];

  for (const scrap of allScraps) {
    if (isShuttingDown) break;

    const scrapId = helpers.scrapToUUID("github" + scrap.id);
    if (newOnly && (await getExistingScrap(scrapId))) continue;

    let content = scrap.body || scrap.description || "";

    if (scrap.type === "repository") {
      const [owner, repo] = scrap.full_name.split("/");
      scrap.readme = await getRepoReadme(owner, repo);
    }

    let summary = "";
    let aiGeneratedTags = [];
    try {
      summary = await summarizeGitHubActivity(scrap);
      aiGeneratedTags = await gitHubSummaryToTags(summary);
    } catch (error) {
      log(
        `Failed to generate GitHub summary and tags for ${scrapId}:`,
        error.message
      );
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
      },
    };

    await upsertLimiter.schedule(() => upsertScrap(scrapObj, newOnly));
  }
}

// Main function orchestrating the whole process
async function main(options = {}) {
  options = { newOnly: true, ...options };
  log("Starting processing...");

  if (options.pinboard) await fetchAndUpsertPinboardBookmarks(options.newOnly);
  if (options.mastodon) await fetchAndUpsertMastodonStatuses(options.newOnly);
  if (options.arena) await fetchAndUpsertArenaBlocks(options.newOnly);
  if (options.github) await fetchAndUpsertGithubData(options.newOnly);

  log("Processing completed.");
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
