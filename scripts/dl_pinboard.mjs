#!/usr/bin/env node

import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { readManifest, updateManifest } from "./manifestHelpers.mjs";

dotenv.config();

const DEBUG = process.env.DEBUG === "true";

function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

const limiter = new Bottleneck({ minTime: 333 });
const apiToken = process.env.PINBOARD_TOKEN;

if (!apiToken) {
  console.error("PINBOARD_TOKEN is not set in the environment variables.");
  process.exit(1);
}

// Define the path to store cached bookmarks
const bookmarksCachePath = path.join(process.cwd(), "data", "pinboard.json");

async function fetchLastUpdateTime() {
  const params = {
    auth_token: apiToken,
    format: "json",
  };
  const response = await limiter.schedule(() =>
    axios.get("https://api.pinboard.in/v1/posts/update", { params })
  );
  return response.data.update_time;
}

export async function fetchBookmarksWithCache() {
  console.log("Starting fetchBookmarksWithCache function");
  try {
    const lastUpdateTime = await fetchLastUpdateTime();
    log("Last update time from Pinboard:", lastUpdateTime);

    const manifest = await readManifest();
    const cachedUpdateTime = manifest.pinboard.lastFetch;
    log("Cached last update time:", cachedUpdateTime);

    let bookmarks = [];

    if (lastUpdateTime !== cachedUpdateTime) {
      console.log("Bookmarks have been updated. Fetching new bookmarks.");
      bookmarks = await fetchBookmarks();
      // Save bookmarks to cache
      await fs.writeFile(
        bookmarksCachePath,
        JSON.stringify(bookmarks, null, 2)
      );
      // Update manifest
      await updateManifest("pinboard", { lastFetch: lastUpdateTime });
    } else {
      console.log("No new updates. Using cached bookmarks.");
      try {
        const data = await fs.readFile(bookmarksCachePath, "utf-8");
        bookmarks = JSON.parse(data);
      } catch (error) {
        console.error("Failed to read cached bookmarks:", error);
        console.log("Fetching bookmarks from API as a fallback.");
        bookmarks = await fetchBookmarks();
        // Save bookmarks to cache
        await fs.writeFile(
          bookmarksCachePath,
          JSON.stringify(bookmarks, null, 2)
        );
        // Update manifest
        await updateManifest("pinboard", { lastFetch: lastUpdateTime });
      }
    }

    console.log(`Processing ${bookmarks.length} bookmarks`);
    // You can add your processing logic here

    console.log("Finished processing all bookmarks");
    return bookmarks;
  } catch (error) {
    console.error("Error in fetchBookmarksWithCache:", error);
    console.error("Stack trace:", error.stack);
    return []; // Return empty array if everything fails
  } finally {
    console.log("Exiting fetchBookmarksWithCache function");
  }
}

async function fetchBookmarks() {
  console.log("Starting fetchBookmarks function");
  let allBookmarks = [];
  let start = 0;
  let fetching = true;

  const resultCount = 100;
  while (fetching) {
    try {
      console.log(`Fetching bookmarks batch starting from index ${start}`);
      const params = {
        auth_token: apiToken,
        format: "json",
        start,
        results: resultCount,
      };
      const response = await limiter.schedule(() =>
        axios.get("https://api.pinboard.in/v1/posts/all", {
          params,
          timeout: 30000,
        })
      );
      console.log(
        `Successfully fetched ${response.data.length} bookmarks in this batch`
      );
      allBookmarks = allBookmarks.concat(response.data);
      start += resultCount;
      fetching = response.data.length === resultCount;
      console.log(`Total bookmarks fetched so far: ${allBookmarks.length}`);
    } catch (error) {
      console.error("Error fetching bookmarks batch:", error.message);
      console.error("Full error:", error);
      console.error("Stack trace:", error.stack);
      break; // Stop fetching on error, but don't throw
    }
  }

  console.log(
    `Finished fetching all bookmarks. Total count: ${allBookmarks.length}`
  );
  return allBookmarks;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  log("Starting main execution");
  fetchBookmarksWithCache()
    .then((bookmarks) => {
      console.log("Bookmarks fetched:", bookmarks.length);
    })
    .catch((error) => {
      console.error("Unhandled error in main:", error);
      process.exit(1);
    });
}
