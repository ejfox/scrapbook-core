import { fetchAllBlocks } from "./dl_arena.mjs";
import { fetchStatuses, fetchUserId } from "./dl_mastodon.mjs";
import { fetchBookmarksWithCache } from "./dl_pinboard.mjs";
import * as helpers from "../helpers.js";
import { updateManifest } from "./manifestHelpers.mjs";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";
import Bottleneck from "bottleneck";
import fs from "fs/promises";
import axios from "axios";
import { summarizeContent } from "./aiSummarization.mjs";
import path from "path";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// This is a limiter for the local API requests and upserts
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 500,
});

const upsertLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 1000,
});

// This is a limiter for the browser requests and headless chrome instances
// which will quickly crash your computer if you don't limit them
const browserLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

async function fetchAndUpsertScraps() {
  const checkpoint = await loadCheckpoint();

  try {
    await fetchAndUpsertPinboardBookmarks(checkpoint.pinboard);
    // await fetchAndUpsertMastodonStatuses(checkpoint.mastodon);
    // await fetchAndUpsertArenaBlocks(checkpoint.arena);

    console.log("All scraps fetched and upserted.");
  } catch (error) {
    console.error("Error in fetchAndUpsertScraps:", error);
  }
}

// This checkpoint file keeps track of the data fetched from each source
const CHECKPOINT_FILE = "./data/checkpoint.json";

// Determine when the last time we fetched data was
async function loadCheckpoint() {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.log(
      "No checkpoint file found, starting from the beginning of time."
    );

    const checkpoint = {
      pinboard: new Date(0).toISOString(),
      mastodon: new Date(0).toISOString(),
      arena: new Date(0).toISOString(),
    };

    await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));

    return checkpoint;
  }
}

// Save the checkpoint file
async function saveCheckpoint(checkpoint) {
  try {
    // Create the directory if it doesn't exist
    const directory = path.dirname(CHECKPOINT_FILE);
    await fs.mkdir(directory, { recursive: true });

    // Write the checkpoint file
    await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
    console.log("Checkpoint saved.");
  } catch (error) {
    console.error("Error saving checkpoint:", error);
  }
}

// Upsert a scrap into the database
async function upsertScrap(scrap) {
  try {
    const { data, error } = await supabase
      .from("scraps")
      .upsert(scrap, { onConflict: "scrap_id" });

    if (error) {
      console.error("Error upserting scrap:", error);
    } else {
      console.log(`${JSON.stringify(scrap)} upserted`);
    }
  } catch (error) {
    console.error("Error in upsertScrap:", error);
  }
}

// Generate a screenshot of a webpage
async function generateWebpageScreenshot(webUrl) {
  try {
    // if the origin is reddit or twitter or medium, skip it, fuck those sites
    if (
      webUrl.includes("reddit") ||
      webUrl.includes("twitter") ||
      webUrl.includes("medium")
    ) {
      console.log(
        "Skipping, these sites block our browser and are annoying",
        webUrl
      );
      return null;
    }

    // kinda different- but if it's youtube we can follow this format
    /*
    https://img.youtube.com/vi/<insert-youtube-video-id-here>/0.jpg
    https://img.youtube.com/vi/<insert-youtube-video-id-here>/1.jpg
    https://img.youtube.com/vi/<insert-youtube-video-id-here>/2.jpg
    https://img.youtube.com/vi/<insert-youtube-video-id-here>/3.jpg

    so we can just extract the video ID and use that
    */

    if (webUrl.includes("youtube")) {
      let videoId = webUrl.split("v=")[1];
      console.log(`YouTube video with ID: ${videoId}`);
      // trim any extra shit off the end
      videoId = videoId.split("&")[0];
      const imageUrl = `https://img.youtube.com/vi/${videoId}/0.jpg`;
      console.log(`Grabbing thumbnail image from ${imageUrl}`);

      // now we need to get the image
      const imageResponse = await axios.get(imageUrl);
      const imageBuffer = imageResponse.data;

      // if the image is not found, return null
      if (!imageBuffer) {
        console.error(
          `Image not found / fetchable for ${videoId}.jpg\n<${imageUrl}>`
        );
        return null;
      }

      console.log("YouTube thumbnail image", imageUrl);

      const { data, error } = await supabase.storage
        .from("scrap_screenshots")
        .upload(`${videoId}.jpg`, imageBuffer);

      if (error) {
        console.error(`Error uploading screenshot: ${videoId}.jpg`, error);
        return null;
      }

      // return the public URL
      const { publicURL, error: publicURLError } = supabase.storage
        .from("scrap_screenshots")
        .getPublicUrl(`${videoId}.jpg`);

      if (publicURLError) {
        console.error(
          `Error getting public URL: ${videoId}.jpg`,
          publicURLError
        );
        return null;
      }

      return publicURL;
    }

    let screenshotBuffer = null;
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    // await page.setViewport({ width: 1024, height: 1024 });
    // set it to 1920x1080
    await page.setViewport({ width: 1080, height: 1920 });

    // set device emulation to iPhone
    // await page.emulate({
    //   userAgent:
    //     "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3 like Mac OS X) AppleWebKit/602.1.50 (KHTML, like Gecko) CriOS/56.0.2924.75 Mobile/14E5239e Safari/602.1",
    //   viewport: {
    //     // width: 1920,
    //     // height: 1080,
    //     width: 1080,
    //     height: 1920,
    //     // deviceScaleFactor: 2,
    //     isMobile: true,
    //     hasTouch: true,
    //     isLandscape: false,
    //   },
    // });

    // choose an ios user agent
    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3 like Mac OS X) AppleWebKit/602.1.50 (KHTML, like Gecko) CriOS/56.0.2924.75 Mobile/14E5239e Safari/602.1"
    );

    console.log("Navigating to:", webUrl);

    // await page.goto(url, { waitUntil: "domcontentloaded" });
    // no waitUntil, it's kinda ruining things
    await page.goto(webUrl);

    // wait an extra moment for the page to load
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // await page.waitForNavigation({
    //   // waitUntil: "networkidle0",
    //   waitUntil: "domcontentloaded",
    // });

    // wait a second for the page to load and then take a screenshot
    screenshotBuffer = await page.screenshot({ type: "png" });
    console.log("Screenshot taken.");

    await browser.close();

    let urlWithoutQueryParams = webUrl.split("?")[0];
    // let filename = new URL(urlWithoutQueryParams).pathname.split("/").pop();
    // that's not right, it's just the lasdt part of the url
    // we want the entire URL with no slashes
    let filename = urlWithoutQueryParams.split("/").join("");

    // remove any : or / or ? from the filename
    filename = filename.replace(/[:/]/g, "");

    if (!filename || filename.length === 0) {
      filename = Date.now().toString();
    }

    const { data, error } = await supabase.storage
      .from("scrap_screenshots")
      .upload(`${filename}.png`, screenshotBuffer);

    if (error) {
      console.error(`Error uploading screenshot: ${filename}.png`, error);
      return null;
    }

    const { publicURL, error: publicURLError } = supabase.storage
      .from("scrap_screenshots")
      .getPublicUrl(data.path);

    if (publicURLError) {
      console.error("Error getting public URL:", publicURLError);
      return null;
    }

    return publicURL;
  } catch (error) {
    console.error("Error in generateWebpageScreenshot:", error);
    return null;
  }
}

async function fetchAndUpsertPinboardBookmarks(lastScrapTime) {
  try {
    console.log("Fetching Pinboard bookmarks...");
    const pinboardBookmarks = await fetchBookmarksWithCache();

    if (pinboardBookmarks) {
      await updateManifest("pinboard", { lastFetch: new Date().toISOString() });
    }

    for (const bookmark of pinboardBookmarks) {
      if (!lastScrapTime || bookmark.time > lastScrapTime) {
        // wait 1s before fetching the page content
        await new Promise((resolve) => setTimeout(resolve, 1000));

        let pageContent = "";
        let summary = "";

        // check if a summary exists for this scrap already
        const { data, error } = await supabase
          .from("scraps")
          .select("summary")
          .eq("scrap_id", helpers.scrapToUUID(bookmark.href));

        const existingSummary = data[0]?.summary;

        // if a summary for this bookmark already exists, skip it
        // if (data[0] && data[0].summary) {
        if (existingSummary) {
          console.log(`Summary already exists for ${bookmark.href}...`);
          console.log(JSON.stringify(data));
          console.log("Skipping...");
          // return;
          // continue;
          summary = existingSummary;
        } else {
          try {
            pageContent = await browserLimiter.schedule(() =>
              helpers.fetchPageContent(bookmark.href)
            );
          } catch (error) {
            console.error("Error fetching page content:", error);
          }

          try {
            await limiter.schedule(async () => {
              console.log(`Summarizing content for ${bookmark.href}...`);
              summary = await summarizeContent(pageContent, {
                metaSummary: true,
              });
            });
          } catch (error) {
            console.error("Error summarizing content:", error);
          }
        }

        console.log(`Summary: ${JSON.stringify(summary)}`);

        const bookmarkObj = {
          scrap_id: helpers.scrapToUUID(bookmark.href),
          source: "pinboard",
          content: bookmark.description,
          created_at: bookmark.time,
          // update the updated_at time to now
          updated_at: new Date().toISOString(),
          summary: summary,
          tags: bookmark.tags,
          relationships: {},
          metadata: {
            href: bookmark.href,
            screenshotUrl: await browserLimiter.schedule(() =>
              generateWebpageScreenshot(bookmark.href)
            ),
          },
        };

        await upsertLimiter.schedule(() => upsertScrap(bookmarkObj));
      }
    }

    console.log(
      `${pinboardBookmarks.length} Pinboard bookmarks processed and upserted.`
    );

    await saveCheckpoint({ ...checkpoint, pinboard: new Date().toISOString() });
  } catch (error) {
    console.error("Error in fetchAndUpsertPinboardBookmarks:", error);
  }
}

async function fetchAndUpsertMastodonStatuses(lastScrapTime) {
  try {
    console.log("Fetching Mastodon statuses...");
    const mastodonUserId = await fetchUserId();
    const mastodonStatuses = await fetchStatuses(mastodonUserId);

    if (mastodonStatuses) {
      await updateManifest("mastodon", { lastFetch: new Date().toISOString() });
    }

    const processedMastodonStatuses = mastodonStatuses
      .filter((status) => !lastScrapTime || status.created_at > lastScrapTime)
      .map((status) => {
        return {
          scrap_id: helpers.scrapToUUID(status.id),
          source: "mastodon",
          content: status.content.replace(/&[^;]+;/g, ""),
          summary: "",
          created_at: status.created_at,
          tags: [],
          relationships: {},
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
      `${processedMastodonStatuses.length} Mastodon statuses processed and upserted.`
    );

    await saveCheckpoint({ ...checkpoint, mastodon: new Date().toISOString() });
  } catch (error) {
    console.error("Error in fetchAndUpsertMastodonStatuses:", error);
  }
}

async function fetchAndUpsertArenaBlocks(lastScrapTime) {
  try {
    console.log("Fetching Are.na blocks...");
    const arenaBlocks = await helpers.safeFetch(fetchAllBlocks());

    if (arenaBlocks) {
      await updateManifest("arena", { lastFetch: new Date().toISOString() });
    }

    const processedArenaBlocks = arenaBlocks
      .filter((block) => !lastScrapTime || block.created_at > lastScrapTime)
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
          summary: "",
          created_at: block.created_at,
          tags: [],
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
      `${processedArenaBlocks.length} Are.na blocks processed and upserted.`
    );

    await saveCheckpoint({ ...checkpoint, arena: new Date().toISOString() });
  } catch (error) {
    console.error("Error in fetchAndUpsertArenaBlocks:", error);
  }
}

async function main() {
  try {
    const checkpoint = await loadCheckpoint();
    await fetchAndUpsertScraps(checkpoint);
  } catch (error) {
    console.error("Error in main:", error);
  }
}

main().catch((error) => console.error("Error in main:", error));
