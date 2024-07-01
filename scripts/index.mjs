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
import { extractRelationships } from "./aiRelationshipExtraction.mjs";

// This checkpoint file keeps track of the data fetched from each source
const CHECKPOINT_FILE = "./data/checkpoint.json";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// This is a limiter for the local API requests and upserts
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 500,
});

// Limiter for summary generation
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

// Determine when the last time we fetched data was
// by checking our checkpoint file that we save to
// at the end of each run
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

// Await all the various fetches and upserts
async function fetchAndUpsertScraps() {
  const checkpoint = await loadCheckpoint();
  if (!checkpoint) {
    console.error("No checkpoint found, exiting...");
    return;
  }

  try {
    await fetchAndUpsertPinboardBookmarks(checkpoint.pinboard);
    await fetchAndUpsertMastodonStatuses(checkpoint.mastodon);
    await fetchAndUpsertArenaBlocks(checkpoint.arena);
    await fetchAndUpsertGithubData();
    console.log("All scraps fetched and upserted.");
  } catch (error) {
    console.error("Error in fetchAndUpsertScraps:", error);
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

// Fetch and upsert Pinboard bookmarks
async function fetchAndUpsertPinboardBookmarks(lastScrapTime) {
  try {
    console.log("Fetching Pinboard bookmarks...");
    const pinboardBookmarks = await fetchBookmarksWithCache();

    if (pinboardBookmarks) {
      await updateManifest("pinboard", { lastFetch: new Date().toISOString() });
    }

    for (const bookmark of pinboardBookmarks) {
      if (!lastScrapTime || bookmark.time > lastScrapTime) {
        let pageContent = "";
        let summary = "";

        // check if a summary exists for this scrap already
        const { data, error } = await supabase
          .from("scraps")
          .select("summary")
          .eq("scrap_id", helpers.scrapToUUID("pinboard" + bookmark.href));

        const existingSummary = data[0]?.summary;

        if (existingSummary) {
          console.log(`Summary already exists for ${bookmark.href}...`);
          console.log(JSON.stringify(data));
          console.log("Skipping...");
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
                metaSummary: true, // Re-summarizes the summary as a final step
              });
            });
          } catch (error) {
            console.error("Error summarizing content:", error);
          }
        }

        console.log(`Summary: ${JSON.stringify(summary)}`);

        // since we have the summary already, lets use it to geocode and build relationships from the content
        const { location, latitude, longitude } = await limiter.schedule(() => {
          // return extractLocation(pageContent);
          return extractLocation(summary);
        });

        if (location) {
          console.log(`Location: ${location}`);
          console.log(`Latitude: ${latitude}, Longitude: ${longitude}`);
        }

        // const relationships = await limiter.schedule(() => {
        //   return extractRelationships(pageContent);
        // });

        let tags = await limiter.schedule(() => metaSummaryToTags(summary));

        console.log(`Tags: ${tags}`);

        let screenshotUrl = null;
        await browserLimiter.schedule(async () => {
          screenshotUrl = await generateWebpageScreenshot(bookmark.href);
          console.log(`⚡️ Screenshot URL (inside limiter): ${screenshotUrl}`);
        });

        tags = tags.split(",").map((tag) => tag.trim());
        const combinedTags = [...tags, ...bookmark.tags];

        // Now that we have assembled a screenshot and a summary, we can upsert the bookmark scrap
        const bookmarkObj = {
          scrap_id: helpers.scrapToUUID("pinboard" + bookmark.href),
          source: "pinboard",
          content: bookmark.description,
          created_at: bookmark.time,
          // update the updated_at time to now
          updated_at: new Date().toISOString(),
          summary: summary,
          // tags: bookmark.tags,
          tags: combinedTags,
          // relationships: relationships,
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

    await saveCheckpoint({ ...checkpoint, pinboard: new Date().toISOString() });
  } catch (error) {
    console.error("Error in fetchAndUpsertPinboardBookmarks:", error);
  }
}

// fetch and upsert github data
async function fetchAndUpsertGithubData() {
  const checkpoint = await loadCheckpoint();

  try {
    const githubData = await fetchGithubData();
    // we have starredRepos, userRepos, userIssues, and userGists

    const allGithubData = [];
    githubData.starredRepos.forEach((repo) => {
      const starredRepo = {
        scrap_id: helpers.scrapToUUID("github" + repo.id),
        source: "github",
        content: `Starred Repository: ${repo.description}`,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
        metadata: {
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          language: repo.language,
          owner: repo.owner.login,
        },
      };
      allGithubData.push(starredRepo);
    });

    githubData.userRepos.forEach((repo) => {
      const userRepo = {
        scrap_id: helpers.scrapToUUID("github" + repo.id),
        source: "github",
        content: `User Repository: ${repo.description}`,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
        metadata: {
          language: repo.language,

          size: repo.size,
          open_issues: repo.open_issues_count,
        },
      };
      allGithubData.push(userRepo);
    });

    githubData.userIssues.forEach((issue) => {
      const userIssue = {
        scrap_id: helpers.scrapToUUID("github" + issue.id),
        source: "github",
        content: `GitHub Issue: ${issue.title}`,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        metadata: {
          number: issue.number,
          isPullRequest: issue.pull_request !== undefined,
          body: issue.body,
        },
      };
      allGithubData.push(userIssue);
    });

    githubData.userGists.forEach((gist) => {
      const userGist = {
        scrap_id: helpers.scrapToUUID("github" + gist.id),
        source: "github",
        content: `User Gist: ${gist.description}`,
        created_at: gist.created_at,
        updated_at: gist.updated_at,
        metadata: {
          files: gist.files,
        },
      };
      allGithubData.push(userGist);
    });

    await upsertLimiter.schedule(() => upsertScrap(allGithubData));

    console.log(`${allGithubData.length} GitHub data processed and upserted.`);

    await saveCheckpoint({ ...checkpoint, github: new Date().toISOString() });
  } catch (error) {
    console.error("Error in fetchAndUpsertGithubData:", error);
  }
}

// Fetch and upsert Mastodon statuses
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
      .map(async (status) => {
        return {
          scrap_id: helpers.scrapToUUID("mastodon" + status.id),
          source: "mastodon",
          content: status.content,
          summary: "",
          created_at: status.created_at,
          // tags: [],
          tags: await limiter.schedule(() => metaSummaryToTags(status.content)),
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

// Fetch and upsert Are.na blocks
async function fetchAndUpsertArenaBlocks(lastScrapTime) {
  try {
    console.log("Fetching Are.na blocks...");
    const arenaBlocks = await helpers.safeFetch(fetchAllBlocks());

    if (arenaBlocks) {
      await updateManifest("arena", { lastFetch: new Date().toISOString() });
    }

    const processedArenaBlocks = arenaBlocks
      .filter((block) => !lastScrapTime || block.created_at > lastScrapTime)
      .map(async (block) => {
        const relationships = block.channels.map((channel) => ({
          type: "belongs_to",
          target: {
            scrap_id: helpers.scrapToUUID("arena" + channel.id),
            type: "channel",
            name: channel.title,
          },
        }));

        let images = [];
        if (block.image) {
          const imageUrl = block.image.display.url;
          const imageFilename = cleanAndFormatFilename(imageUrl);
          const { data, error } = await supabase.storage
            .from("arena_block_images")
            .upload(
              `${imageFilename}.png`,
              await axios
                .get(imageUrl, { responseType: "arraybuffer" })
                .then((response) => response.data),
              {
                contentType: "image/png",
              }
            );
          if (error) {
            console.error("Error uploading image:", error);
          } else {
            const imagePublicURL = await supabase.storage
              .from("arena_block_images")
              .getPublicUrl(`${imageFilename}.png`);
            if (imagePublicURL) {
              images = [imagePublicURL.data.publicUrl];
            }
          }
        }

        return {
          scrap_id: helpers.scrapToUUID("arena" + block.id),
          source: "arena",
          content: block.description,
          summary: "",
          created_at: block.created_at,
          tags: [],
          relationships: relationships,
          metadata: {
            href: `https://www.are.na/block/${block.id}`,
            // use the first image as the primary image
            image: images[0],
            images: images,
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

// Function to clean and format the filename
function cleanAndFormatFilename(url) {
  // Remove any : or / or ? from the filename
  let cleanedFilename = url.replace(/[:/]/g, "");

  // Remove any special characters and spaces
  cleanedFilename = cleanedFilename.replace(/[^\w\s]/gi, "");

  // remove any dots: .
  cleanedFilename = cleanedFilename.replace(/\./g, "");

  // Replace spaces with underscores
  cleanedFilename = cleanedFilename.replace(/\s+/g, "_");

  return cleanedFilename;
}

// New function to split out the query parameters from the webUrl
function splitQueryParams(url) {
  const [baseUrl, queryParams] = url.split("?");
  return { baseUrl, queryParams };
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
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
      });

      const imageBuffer = Buffer.from(imageResponse.data, "binary");

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
        .upload(`${videoId}.jpg`, imageBuffer, {
          contentType: "image/jpeg",
        });

      if (error) {
        console.error(
          `Error uploading YouTube screenshot: ${videoId}.jpg`,
          error
        );
        // return null;
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

    // TODO: Would be cool to use a CLI tool to render the screenshot
    // in the terminal
    console.log(await terminalImage.buffer(screenshotBuffer, { height: 50 }));

    await browser.close();

    let urlWithoutQueryParams = webUrl.split("?")[0];
    let filename = cleanAndFormatFilename(urlWithoutQueryParams);

    if (!filename || filename.length === 0) {
      filename = Date.now().toString();
    }

    const { baseUrl } = splitQueryParams(webUrl);
    const formattedFilename = cleanAndFormatFilename(baseUrl);

    if (!formattedFilename || formattedFilename.length === 0) {
      filename = Date.now().toString();
    } else {
      filename = formattedFilename;
    }

    const { data, error } = await supabase.storage
      .from("scrap_screenshots")
      .upload(`${filename}.png`, screenshotBuffer, {
        contentType: "image/png",
      });

    if (error) {
      console.error(`Error uploading screenshot: ${filename}.png`, error);
    }

    // const { publicURL, error: publicURLError } = supabase.storage
    const screenshotData = await supabase.storage
      .from("scrap_screenshots")
      .getPublicUrl(`${filename}.png`);

    console.log("screenshotData!");
    console.log(screenshotData);

    if (!screenshotData) {
      console.error("Error getting public URL");
      return null;
    }

    const publicURL = screenshotData.data.publicUrl;

    console.log("Returning public URL:", publicURL);
    return publicURL;
  } catch (error) {
    console.error("Error in generateWebpageScreenshot:", error);
    return null;
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
