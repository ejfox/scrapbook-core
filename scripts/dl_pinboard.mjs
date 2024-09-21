#!/usr/bin/env node
import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";

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

const fetchBookmarks = async () => {
  log("Fetching bookmarks from Pinboard API");
  let allBookmarks = [];
  let start = 0;
  let fetching = true;

  const resultCount = 100;
  while (fetching) {
    try {
      log(`Fetching bookmarks starting from index ${start}`);
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
      log(`Fetched ${response.data.length} bookmarks`);
      allBookmarks = allBookmarks.concat(response.data);
      start += resultCount;
      fetching = response.data.length === resultCount;
    } catch (error) {
      console.error("Error fetching bookmarks:", error.message);
      console.error("Full error:", error);
      break; // Stop fetching on error, but don't throw
    }
  }

  log(`Total bookmarks fetched: ${allBookmarks.length}`);
  return allBookmarks;
};

export async function fetchBookmarksWithCache() {
  // This function name is kept for compatibility, but it no longer caches
  log("Fetching bookmarks");
  try {
    return await fetchBookmarks();
  } catch (error) {
    console.error("Error in fetchBookmarksWithCache:", error);
    return []; // Return empty array if everything fails
  }
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
