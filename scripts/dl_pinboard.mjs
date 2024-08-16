#!/usr/bin/env node
import * as fs from "fs/promises";
import path from "path";
import axios from "axios";
import ora from "ora";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";

let isShuttingDown = false;

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

const readManifest = async () => {
  log("Reading manifest");
  const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
  const manifestPath = path.join(dirPath, "manifest.json");
  try {
    const manifestData = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(manifestData);
  } catch (error) {
    log("Failed to read manifest, assuming empty.");
    return {};
  }
};

const writeManifest = async (manifest) => {
  log("Writing manifest");
  const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
  const manifestPath = path.join(dirPath, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
};

export async function fetchBookmarksWithCache(forceUpdate = false) {
  log("Fetching bookmarks with cache");
  try {
    const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
    await fs.mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, "bookmarks.json");

    const manifest = await readManifest();
    const lastUpdateTimestamp = manifest.lastUpdateTimestamp || 0;
    const currentTimestamp = Date.now();

    const cacheExists = await fs.stat(filePath).catch(() => false);
    const cacheIsValid =
      currentTimestamp - lastUpdateTimestamp <= 24 * 60 * 60 * 1000;

    if (!forceUpdate && cacheExists && cacheIsValid) {
      log("Using cached bookmarks");
      const bookmarksData = await fs.readFile(filePath, "utf8");
      return JSON.parse(bookmarksData);
    } else {
      log("Fetching new bookmarks");
      const fromdt = new Date(lastUpdateTimestamp).toISOString();
      const newBookmarks = await fetchBookmarks(fromdt);

      if (cacheExists) {
        const existingBookmarksData = await fs.readFile(filePath, "utf8");
        const existingBookmarks = JSON.parse(existingBookmarksData);
        const updatedBookmarks = [...newBookmarks, ...existingBookmarks];
        await fs.writeFile(filePath, JSON.stringify(updatedBookmarks, null, 2));
        manifest.lastUpdateTimestamp = currentTimestamp;
        await writeManifest(manifest);
        return updatedBookmarks;
      } else {
        await fs.writeFile(filePath, JSON.stringify(newBookmarks, null, 2));
        manifest.lastUpdateTimestamp = currentTimestamp;
        await writeManifest(manifest);
        return newBookmarks;
      }
    }
  } catch (error) {
    console.error("Error in fetchBookmarksWithCache:", error);
    // Attempt to return cached data even if there's an error
    const filePath = path.join(
      process.cwd(),
      "public",
      "data",
      "scrapbook",
      "bookmarks.json"
    );
    try {
      const bookmarksData = await fs.readFile(filePath, "utf8");
      console.log("Falling back to cached bookmarks");
      return JSON.parse(bookmarksData);
    } catch (cacheError) {
      console.error("Failed to read cache:", cacheError);
      return []; // Return empty array if everything fails
    }
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
