#!/usr/bin/env node
import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";

let isShuttingDown = false;
let cachedBookmarks = null;
let lastUpdateTimestamp = 0;

process.on("unhandledRejection", (reason, promise) => {
  console.log("Unhandled Rejection at:", promise, "reason:", reason);
});

dotenv.config();

const DEBUG = process.env.DEBUG === "true";

function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

log("Debug mode is on");

const limiter = new Bottleneck({ minTime: 333 });
const apiToken = process.env.PINBOARD_TOKEN;

if (!apiToken) {
  console.error("PINBOARD_TOKEN is not set in the environment variables.");
  process.exit(1);
}

const fetchBookmarks = async (fromdt = null) => {
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
      if (fromdt) {
        params.fromdt = fromdt;
      }
      const response = await limiter.schedule(() =>
        axios.get("https://api.pinboard.in/v1/posts/all", { params })
      );
      allBookmarks = allBookmarks.concat(response.data);
      start += resultCount;
      fetching = response.data.length === resultCount;
    } catch (error) {
      console.error("Error fetching bookmarks:", error.message);
      break; // Stop fetching on error, but don't throw
    }
  }

  return allBookmarks;
};

export async function fetchBookmarksWithCache(forceUpdate = false) {
  log("Fetching bookmarks with cache");
  try {
    const currentTimestamp = Date.now();
    const cacheIsValid =
      currentTimestamp - lastUpdateTimestamp <= 24 * 60 * 60 * 1000;

    if (!forceUpdate && cachedBookmarks && cacheIsValid) {
      log("Using cached bookmarks");
      return cachedBookmarks;
    } else {
      log("Fetching new bookmarks");
      const fromdt = new Date(lastUpdateTimestamp).toISOString();
      const newBookmarks = await fetchBookmarks(fromdt);

      if (cachedBookmarks) {
        cachedBookmarks = [...newBookmarks, ...cachedBookmarks];
      } else {
        cachedBookmarks = newBookmarks;
      }

      lastUpdateTimestamp = currentTimestamp;
      return cachedBookmarks;
    }
  } catch (error) {
    console.error("Error in fetchBookmarksWithCache:", error);
    if (cachedBookmarks) {
      console.log("Falling back to cached bookmarks");
      return cachedBookmarks;
    }
    return []; // Return empty array if everything fails
  }
}

async function main(forceUpdate = false) {
  log("Entering main function");
  console.time("Time elapsed");

  process.on("SIGINT", async () => {
    console.log("\nGracefully shutting down...");
    isShuttingDown = true;
    process.exit(0);
  });

  try {
    const bookmarks = await fetchBookmarksWithCache(forceUpdate);
    console.timeEnd("Time elapsed");
    console.log("Bookmarks processed:", bookmarks.length);
  } catch (error) {
    console.error("Error in main:", error);
    process.exit(1);
  }
}

log("Starting main execution");
main(true).catch((error) => console.error("Unhandled error in main:", error));
