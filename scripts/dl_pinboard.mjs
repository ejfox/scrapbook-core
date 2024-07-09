#!/usr/bin/env node
import * as fs from "fs/promises";
import path from "path";
import axios from "axios";
import ora from "ora";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";

console.log("Script started");

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

const fetchBookmarks = async () => {
  log("Fetching bookmarks from Pinboard API");
  const spinner = ora("Initializing download...").start();
  let allBookmarks = [];
  let start = 0;
  let fetching = true;

  const resultCount = 100;
  while (fetching) {
    try {
      log(`Fetching bookmarks starting from index ${start}`);
      const response = await limiter.schedule(() =>
        axios.get("https://api.pinboard.in/v1/posts/all", {
          params: {
            auth_token: apiToken,
            format: "json",
            start,
            results: resultCount,
          },
        })
      );
      allBookmarks = allBookmarks.concat(response.data);
      start += resultCount;
      fetching = response.data.length === resultCount;
      spinner.text = `Fetched ${allBookmarks.length} bookmarks...`;
    } catch (error) {
      console.error("Error fetching bookmarks:", error.message);
      spinner.fail("Failed to fetch bookmarks");
      throw error;
    }
  }

  try {
    log("Saving fetched bookmarks to file");
    const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
    await fs.mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, "bookmarks.json");
    await fs.writeFile(filePath, JSON.stringify(allBookmarks, null, 2));
    spinner.succeed(`Downloaded and saved ${allBookmarks.length} bookmarks`);
  } catch (error) {
    console.error("Error saving bookmarks:", error.message);
    spinner.fail("Failed to save bookmarks");
    throw error;
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
  const spinner = ora("Initializing...").start();
  try {
    const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
    await fs.mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, "bookmarks.json");

    const manifest = await readManifest();
    const lastUpdateTimestamp = manifest.lastUpdateTimestamp || 0;
    const currentTimestamp = Date.now();

    if (
      !forceUpdate &&
      (await fs.stat(filePath).catch(() => false)) &&
      currentTimestamp - lastUpdateTimestamp <= 24 * 60 * 60 * 1000
    ) {
      log("Using cached bookmarks");
      spinner.text = "Loading cached bookmarks...";
      const bookmarksData = await fs.readFile(filePath, "utf8");
      const existingBookmarks = JSON.parse(bookmarksData);
      spinner.succeed("Loaded bookmarks from cache.");
      return existingBookmarks;
    } else {
      log("Fetching new bookmarks");
      spinner.text = "Fetching new bookmarks from API...";
      const bookmarks = await fetchBookmarks();
      await fs.writeFile(filePath, JSON.stringify(bookmarks, null, 2));
      manifest.lastUpdateTimestamp = currentTimestamp;
      await writeManifest(manifest);
      spinner.succeed("Bookmarks fetched and saved.");
      return bookmarks;
    }
  } catch (error) {
    spinner.fail("Failed to process bookmarks.");
    console.error("Error in fetchBookmarksWithCache:", error);
    throw error;
  }
}

async function main(forceUpdate = false) {
  log("Entering main function");
  console.time("Time elapsed");
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
