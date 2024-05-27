import { fetchAllBlocks } from "./dl_arena.mjs";
import { fetchStatuses, fetchUserId } from "./dl_mastodon.mjs";
import { fetchBookmarks } from "./dl_pinboard.mjs";
import * as helpers from "../helpers.js";

import { updateManifest } from "./manifestHelpers.mjs";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";
import Bottleneck from "bottleneck";

// Initialize Bottleneck
const limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 500,
});

// import { analyzeEntities } from "./googleEntityExtraction.js";
import { summarizeContent } from "./aiSummarization.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function upsertScrap(scrap) {
  await limiter.schedule(async () => {
    const { data, error } = await supabase
      .from("scraps")
      .upsert(scrap, { onConflict: "id" });

    if (error) {
      console.error("Error upserting scrap:", error);
    }
  });
}

async function getLatestScrapTime() {
  const { data, error } = await supabase
    .from("scraps")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Error fetching latest scrap time:", error);
    return null;
  }

  return data.length > 0 ? data[0].created_at : null;
}

async function generateWebpageScreenshot(url) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 1024 });
  await page.goto(url);
  const screenshotBuffer = await page.screenshot({ type: "png" });
  await browser.close();

  const urlWithoutQueryParams = url.split("?")[0];
  let filename = new URL(urlWithoutQueryParams).pathname.split("/").pop();

  // do some lightweight checking to make sure the filename is valid
  if (!filename || filename.length === 0) {
    // just make it the time in milliseconds
    filename = Date.now().toString();
  }

  const { data, error } = await supabase.storage
    .from("scrap-images")
    .upload(`screenshots/${filename}.png`, screenshotBuffer);

  if (error) {
    console.error("Error uploading screenshot:", error);
    return null;
  }

  const { publicURL, error: publicURLError } = supabase.storage
    .from("scrap-images")
    .getPublicUrl(data.path);

  if (publicURLError) {
    console.error("Error getting public URL:", publicURLError);
    return null;
  }

  return publicURL;
}

async function fetchAndUpsertScraps() {
  const latestScrapTime = await getLatestScrapTime();

  await fetchAndUpsertPinboardBookmarks(latestScrapTime);
  await fetchAndUpsertMastodonStatuses(latestScrapTime);
  await fetchAndUpsertArenaBlocks(latestScrapTime);

  console.log("All scraps fetched and upserted.");
}

async function fetchAndUpsertPinboardBookmarks(latestScrapTime) {
  const pinboardBookmarks = await fetchBookmarks();

  // Update manifest for successful fetch
  const now = new Date().toISOString();
  if (pinboardBookmarks) await updateManifest("pinboard", { lastFetch: now });

  // Process pinboard bookmarks
  const processedPinboardBookmarks = await Promise.all(
    pinboardBookmarks
      .filter((bookmark) => !latestScrapTime || bookmark.time > latestScrapTime)
      .map(async (bookmark) => {
        const pageContent = await helpers.fetchPageContent(bookmark.href);
        // const entities = await analyzeEntities(pageContent);
        // const summary = await summarizeContent(pageContent);

        return {
          scrap_id: helpers.scrapToUUID(bookmark.href),
          source: "pinboard",
          content: bookmark.description,
          // summary: summary,
          created_at: bookmark.time,
          tags: bookmark.tags,
          relationships: {}, // Placeholder for relationships
          metadata: {
            href: bookmark.href,
            screenshotUrl: await generateWebpageScreenshot(bookmark.href),
          },
        };
      })
  );

  for (const scrap of processedPinboardBookmarks) {
    await upsertScrap(scrap);
  }

  console.log(
    `${processedPinboardBookmarks.length} pinboard bookmarks processed and upserted.`
  );
}

async function fetchAndUpsertMastodonStatuses(latestScrapTime) {
  const mastodonUserId = await fetchUserId();
  const mastodonStatuses = await fetchStatuses(mastodonUserId);

  // Update manifest for successful fetch
  const now = new Date().toISOString();
  if (mastodonStatuses) await updateManifest("mastodon", { lastFetch: now });

  // Process mastodon statuses
  const processedMastodonStatuses = mastodonStatuses
    .filter((status) => !latestScrapTime || status.created_at > latestScrapTime)
    .map((status) => {
      return {
        scrap_id: helpers.scrapToUUID(status.id),
        source: "mastodon",
        content: status.content.replace(/&[^;]+;/g, ""),
        summary: "", // Placeholder for summary
        created_at: status.created_at,
        tags: [], // Placeholder for tags
        relationships: {}, // Placeholder for relationships
        metadata: {
          href: status.url,
          images: status.media_attachments
            .filter((attachment) => attachment.type === "image")
            .map((attachment) => attachment.preview_url),
          videos: status.media_attachments
            .filter((attachment) => attachment.type === "video")
            .map((attachment) => attachment.url),
        },
      };
    });

  for (const scrap of processedMastodonStatuses) {
    await upsertScrap(scrap);
  }

  console.log(
    `${processedMastodonStatuses.length} mastodon statuses processed and upserted.`
  );
}

async function fetchAndUpsertArenaBlocks(latestScrapTime) {
  const arenaBlocks = await helpers.safeFetch(fetchAllBlocks());

  // Update manifest for successful fetch
  const now = new Date().toISOString();
  if (arenaBlocks) await updateManifest("arena", { lastFetch: now });

  // Process are.na blocks
  const processedArenaBlocks = arenaBlocks
    .filter((block) => !latestScrapTime || block.created_at > latestScrapTime)
    .map((block) => {
      const relationships = block.channels.map((channel) => ({
        type: "belongs_to",
        target: {
          scrap_id: helpers.scrapToUUID(channel.id),
          type: "channel",
          name: channel.title,
        },
      }));

      return {
        scrap_id: helpers.scrapToUUID(block.id),
        source: "arena",
        content: block.description,
        summary: "", // Placeholder for summary
        created_at: block.created_at,
        tags: [], // Placeholder for tags
        relationships: relationships,
        metadata: {
          href: `https://www.are.na/block/${block.id}`,
          images: block.image ? [block.image.display.url] : [],
        },
      };
    });

  for (const scrap of processedArenaBlocks) {
    await upsertScrap(scrap);
  }

  console.log(
    `${processedArenaBlocks.length} are.na blocks processed and upserted.`
  );
}

fetchAndUpsertScraps();
