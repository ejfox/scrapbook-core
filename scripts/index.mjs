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
// import fs, { mkdir } from "fs/promises";
import { summarizeContent, metaSummaryToTags } from "./aiSummarization.mjs";
import {
  summarizeGitHubActivity,
  gitHubSummaryToTags,
} from "./aiGithubSummarization.mjs";
import { generateMastodonTags } from "./aiMastodonSummarization.mjs";
import extractLocation from "./aiGeolocation.mjs";
import { extractRelationships } from "./aiRelationshipExtraction.mjs";
import dotenv from "dotenv";

process.on("unhandledRejection", (reason, promise) => {
  console.log("Unhandled Rejection at:", promise, "reason:", reason);
});

dotenv.config();

const NODE_ENV = process.env.NODE_ENV;
const CHROME_EXECUTABLE_PATH = "/usr/bin/chromium-browser";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  minTime: 1500,
});

const upsertLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 1500,
});

const browserLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1500,
});

async function generateEmbedding(text) {
  if (process.env.USE_OPENAI !== "true") {
    console.log("OpenAI is not enabled, skipping embedding generation.");
    return null;
  }

  try {
    return await limiter.schedule(async () => {
      const response = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: text,
      });
      return response.data[0].embedding;
    });
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

    const relationshipsData = await limiter.schedule(async () => {
      const extractedRelationships = await extractRelationships(content, {
        isRawText: !scrapObj.summary,
      });
      return extractedRelationships;
    });

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

async function fetchAndUpsertPinboardBookmarks(newOnly) {
  try {
    console.log("Fetching Pinboard bookmarks...");
    const pinboardBookmarks = await fetchBookmarksWithCache(false);
    console.log(`Fetched ${pinboardBookmarks.length} Pinboard bookmarks`);

    if (isShuttingDown) return;

    for (const bookmark of pinboardBookmarks) {
      console.log("Processing bookmark:", bookmark.href);
      if (isShuttingDown) {
        console.log("Shutting down, skipping bookmark processing");
        break;
      }

      const scrapId = helpers.scrapToUUID("pinboard" + bookmark.href);
      console.log("Scrap ID:", scrapId);
      console.log("Checking for existing scrap...");
      const existingScrap = await getExistingScrap(scrapId);
      console.log("Existing scrap check complete");

      if (newOnly && existingScrap) {
        console.log(`Scrap ${scrapId} already exists, skipping.`);
        continue;
      }

      console.log("Preparing to fetch page content...");
      let pageContent = "";
      let summary = existingScrap?.summary || "";

      if (!summary) {
        try {
          console.log("Fetching page content...");
          pageContent = await browserLimiter.schedule(() =>
            helpers.fetchPageContent(bookmark.href)
          );
          console.log(`Fetched ${pageContent.length} characters of content`);

          if (pageContent.length > 100000) {
            pageContent = pageContent.substring(0, 100000);
            console.log("Content truncated to 100000 characters");
          }
          console.log("Summarizing content...");
          summary = await limiter.schedule(() =>
            summarizeContent(pageContent, { metaSummary: true })
          );
          console.log("Content summarized");
        } catch (error) {
          console.error("Error processing bookmark:", error);
        }
      }

      console.log("Summary length:", summary.length);

      console.log("Extracting location...");
      let location = existingScrap?.metadata?.location;
      let latitude = existingScrap?.metadata?.latitude;
      let longitude = existingScrap?.metadata?.longitude;

      if (!location) {
        console.log("Location not found, extracting from summary...");
        const locationData = await limiter.schedule(() =>
          extractLocation(summary)
        );
        location = locationData.location;
        latitude = locationData.latitude;
        longitude = locationData.longitude;
        console.log("Location extracted:", location);
      }

      console.log("Generating tags for summary...");
      let tags = await limiter.schedule(() => metaSummaryToTags(summary));
      tags = tags.split("\n").map((tag) => tag.trim());
      const combinedTags = [...new Set([...tags, ...bookmark.tags])];
      console.log("Tags generated:", combinedTags);

      console.log("Checking for existing screenshot...");
      let screenshotUrl = existingScrap?.metadata?.screenshotUrl;
      if (!screenshotUrl) {
        console.log("Generating screenshot for bookmark...");
        await browserLimiter.schedule(async () => {
          screenshotUrl = await generateWebpageScreenshot(bookmark.href);
        });
        console.log("Screenshot generated");
      }

      console.log("Preparing bookmark object...");
      let bookmarkObj = {
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

      console.log("Extracting relationships for bookmark...");
      bookmarkObj = await extractAndAddRelationships(bookmarkObj);
      console.log("Relationships extracted");

      console.log("Upserting bookmark...");
      await upsertLimiter.schedule(() => upsertScrap(bookmarkObj, newOnly));
      console.log("Bookmark upserted");
    }

    console.log(
      `${pinboardBookmarks.length} Pinboard bookmarks processed and upserted.`
    );
  } catch (error) {
    console.error("Error in fetchAndUpsertPinboardBookmarks:", error);
  }
}

async function fetchAndUpsertMastodonStatuses(newOnly) {
  try {
    console.log("Fetching Mastodon statuses...");
    const userId = await fetchUserId();
    const statuses = await fetchStatuses(userId);
    log(`Fetched ${statuses.length} Mastodon statuses`);

    if (isShuttingDown) return;

    for (const status of statuses) {
      console.log("Processing Mastodon status:", status.content);
      if (isShuttingDown) {
        console.log("Shutting down, skipping status processing");
        break;
      }

      const scrapId = helpers.scrapToUUID("mastodon" + status.id);
      const existingScrap = await getExistingScrap(scrapId);

      if (newOnly && existingScrap) {
        console.log(`Scrap ${scrapId} already exists, skipping.`);
        continue;
      }

      const images = status.media_attachments
        .filter((attachment) => attachment.type === "image")
        .map((attachment) => ({
          url: attachment.url,
          preview_url: attachment.preview_url,
          description: attachment.description,
        }));

      // Generate tags
      const aiGeneratedTags = await generateMastodonTags(status);

      const statusObj = {
        scrap_id: scrapId,
        source: "mastodon",
        content: status.content,
        created_at: status.created_at,
        updated_at: new Date().toISOString(),
        tags: [
          ...new Set([
            ...status.tags.map((tag) => tag.name),
            ...aiGeneratedTags,
          ]),
        ],
        metadata: {
          url: status.url,
          visibility: status.visibility,
          favourites_count: status.favourites_count,
          reblogs_count: status.reblogs_count,
          images: images,
        },
      };

      await upsertLimiter.schedule(() => upsertScrap(statusObj, newOnly));
    }

    console.log(`${statuses.length} Mastodon statuses processed and upserted.`);
  } catch (error) {
    console.error("Error in fetchAndUpsertMastodonStatuses:", error);
  }
}

async function fetchAndUpsertArenaBlocks(newOnly) {
  try {
    console.log("Fetching Are.na blocks...");
    const blocks = await fetchAllBlocks();
    log(`Fetched ${blocks.length} Are.na blocks`);

    if (isShuttingDown) return;

    for (const block of blocks) {
      console.log("Processing block:", block.title);
      if (isShuttingDown) {
        console.log("Shutting down, skipping block processing");
        break;
      }

      const scrapId = helpers.scrapToUUID("arena" + block.id);
      const existingScrap = await getExistingScrap(scrapId);

      if (newOnly && existingScrap) {
        console.log(`Scrap ${scrapId} already exists, skipping.`);
        continue;
      }

      const blockObj = {
        scrap_id: scrapId,
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
        relationships: [],
      };

      // Extract relationships based on channels
      if (
        block.connected_to_channels &&
        block.connected_to_channels.length > 0
      ) {
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

    console.log(`${blocks.length} Are.na blocks processed and upserted.`);
  } catch (error) {
    console.error("Error in fetchAndUpsertArenaBlocks:", error);
  }
}
async function fetchAndUpsertGithubData(newOnly) {
  try {
    console.log("Fetching GitHub data...");
    const githubData = await fetchGithubData();
    console.log(`Fetched GitHub data`);

    if (isShuttingDown) return;

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
      console.log("Processing github scrap:", scrap.title || scrap.name);
      if (isShuttingDown) {
        console.log("Shutting down, skipping GitHub data processing");
        break;
      }

      const scrapId = helpers.scrapToUUID("github" + scrap.id);
      const existingScrap = await getExistingScrap(scrapId);

      if (newOnly && existingScrap) {
        console.log(`Scrap ${scrapId} already exists, skipping.`);
        continue;
      }

      let content = "";
      if (scrap.type === "pull_request" || scrap.type === "issue") {
        content = scrap.body || "";
      } else if (scrap.type === "repository") {
        content = scrap.description || "";
      } else if (scrap.type === "gist") {
        content = scrap.description || "";
      } else if (scrap.type === "release") {
        content = scrap.body || "";
      } else if (scrap.type === "starred") {
        content = scrap.description || "";
      }

      if (scrap.type === "repository") {
        const [owner, repo] = scrap.full_name.split("/");
        const readmeText = await getRepoReadme(owner, repo);
        scrap.readme = readmeText;
      }

      let summary = "";
      let aiGeneratedTags = [];
      try {
        summary = await summarizeGitHubActivity(scrap);
        aiGeneratedTags = await gitHubSummaryToTags(summary);
      } catch (error) {
        console.error("Error in generating summary and tags:", error);
      }

      const scrapObj = {
        scrap_id: scrapId,
        source: "github",
        content: content,
        summary: summary,
        created_at: scrap.created_at,
        updated_at: scrap.updated_at,
        tags: [...new Set([...(scrap.topics || []), ...aiGeneratedTags])],
        metadata: {
          type: scrap.type,
          name: scrap.name || scrap.title,
          full_name:
            scrap.full_name || (scrap.repo && scrap.repo.full_name) || null,
          repo: scrap.repo || null,
          href: scrap.html_url,
          images: scrap.images || [],
          language: scrap.language,
          stargazers_count: scrap.stargazers_count,
          forks_count: scrap.forks_count,
          number: scrap.number,
          state: scrap.state,
          user: scrap.user,
        },
      };

      try {
        await upsertLimiter.schedule(() => upsertScrap(scrapObj, newOnly));
        console.log(
          `Scrap processed: ${scrapObj.scrap_id} ${scrapObj.content.substring(
            0,
            50
          )}... ${scrap.type}`
        );
      } catch (error) {
        console.error(`Error processing scrap:`, error);
      }
    }

    console.log(`GitHub data processed.`);
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
  const browser = await puppeteer.launch({
    executablePath:
      NODE_ENV !== "development"
        ? CHROME_EXECUTABLE_PATH || "/usr/bin/chromium"
        : undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
    // @ts-ignore
    headless: "new",
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });

  try {
    console.log(`Navigating to: ${webUrl}`);
    await page.goto(webUrl, { waitUntil: "networkidle0", timeout: 60000 });

    const screenshot = await page.screenshot({ encoding: "base64" });
    console.log(`Screenshot captured for ${webUrl}`);

    return `data:image/png;base64,${screenshot}`;
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
    useManifest: false, // Changed to false
    newOnly: true,
    ...options,
  };

  console.log("🚀 Scrapbook Core: Main function started");
  console.log(
    "📊 Options:\n" +
      Object.entries(options)
        .map(([key, value]) => `  ${key.padEnd(15)} ${value}`)
        .join("\n")
  );

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
        await source.func(options.newOnly);
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
  .option("--print-screenshot", "Print screenshots to terminal")
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
