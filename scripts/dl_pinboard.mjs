import * as fs from "fs";
import path from "path";
import axios from "axios";
import ora from "ora";
import inquirer from "inquirer";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";

dotenv.config();

const limiter = new Bottleneck({ minTime: 333 });
const apiToken = process.env.PINBOARD_TOKEN;

const fetchBookmarks = async () => {
  const spinner = ora("Initializing download...").start();
  let allBookmarks = [];
  let start = 0;
  let fetching = true;

  const resultCount = 100;
  while (fetching) {
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
  }

  // try writing to the json file
  const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
  await fs.mkdir(dirPath, { recursive: true }, () => {}); // Ensure directory exists
  const filePath = path.join(dirPath, "bookmarks.json");
  await fs.writeFile(filePath, JSON.stringify(allBookmarks, null, 2), () => {});

  spinner.succeed(`Downloaded ${allBookmarks.length} bookmarks`);
  return allBookmarks;
};

const isCI = process.env.CI === "true";

const processBookmarks = async () => {
  const spinner = ora("Initializing download...").start();
  try {
    const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
    await fs.mkdir(dirPath, { recursive: true }, () => {}); // Ensure directory exists
    const filePath = path.join(dirPath, "bookmarks.json");
    const manifestPath = path.join(dirPath, "manifest.json");

    let manifest = {};
    try {
      const manifestData = await fs.readFile(manifestPath, "utf8", () => {});
      console.log("Manifest data:", manifestData);
      manifest = JSON.parse(manifestData);
    } catch (error) {
      console.error("Failed to read manifest, assuming empty.", error);
    }

    const lastUpdateTimestamp = manifest.pinboard.lastFetch || 0;
    const currentTimestamp = Date.now();

    console.log(`Last update: ${lastUpdateTimestamp}`);
    console.log(`Current time: ${currentTimestamp}`);

    // Check if cached bookmarks exist and were fetched within the last 24 hours
    if (
      fs.existsSync(filePath) &&
      currentTimestamp - lastUpdateTimestamp <= 24 * 60 * 60 * 1000
    ) {
      console.log(`Using cached bookmarks from ${filePath}...`);

      // Use cached bookmarks
      let existingBookmarks = [];
      try {
        console.log("Reading existing bookmarks...");
        const bookmarksData = await fs.readFile(filePath, "utf8", () => {});
        console.log("Existing bookmarks data:", bookmarksData);
        existingBookmarks = JSON.parse(bookmarksData);
      } catch (error) {
        console.error(
          "Failed to read existing bookmarks, assuming none.",
          error
        );
      }
      spinner.succeed("Loaded bookmarks from cache.");
      return existingBookmarks;
    } else {
      console.log(`No cached bookmarks found, fetching new bookmarks...`);
      // Fetch new bookmarks from API
      spinner.text = "Fetching new bookmarks from API...";
      const bookmarks = await fetchBookmarks();
      await fs.writeFile(
        filePath,
        JSON.stringify(bookmarks, null, 2),
        () => {}
      );
      manifest.lastUpdateTimestamp = currentTimestamp;
      console.log(`Updating manifest with timestamp ${currentTimestamp}...`);
      try {
        await fs.writeFile(
          manifestPath,
          JSON.stringify(manifest, null, 2),
          () => {}
        );
        console.log(`Manifest updated with timestamp ${currentTimestamp}`);
      } catch (error) {
        console.error("Failed to update manifest.", error);
        throw error;
      }
      spinner.succeed("Bookmarks fetched and saved.");
      return bookmarks;
    }
  } catch (error) {
    spinner.fail("Failed to process bookmarks.");
    console.error(error);
    throw error; // Rethrow or handle as needed
  }
};

// fetch bookmarks but with cacheing / manifest checking
export async function fetchBookmarksWithCache(forceUpdate = false) {
  const spinner = ora("Initializing download...").start();
  try {
    const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
    await fs.promises.mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, "bookmarks.json");
    const manifestPath = path.join(dirPath, "manifest.json");

    let manifest = {};
    try {
      const manifestData = await fs.promises.readFile(manifestPath, "utf8");
      manifest = JSON.parse(manifestData);
    } catch (error) {
      console.error("Failed to read manifest, assuming empty.", error);
    }

    const lastUpdateTimestamp = manifest.lastUpdateTimestamp || 0;
    const currentTimestamp = Date.now();

    if (
      !forceUpdate &&
      fs.existsSync(filePath) &&
      currentTimestamp - lastUpdateTimestamp <= 24 * 60 * 60 * 1000
    ) {
      console.log(`Using cached bookmarks from ${filePath}...`);
      const bookmarksData = await fs.promises.readFile(filePath, "utf8");
      const existingBookmarks = JSON.parse(bookmarksData);
      spinner.succeed("Loaded bookmarks from cache.");
      return existingBookmarks;
    } else {
      console.log(`Fetching new bookmarks...`);
      spinner.text = "Fetching new bookmarks from API...";
      const bookmarks = await fetchBookmarks();
      await fs.promises.writeFile(filePath, JSON.stringify(bookmarks, null, 2));
      manifest.lastUpdateTimestamp = currentTimestamp;
      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2)
      );
      spinner.succeed("Bookmarks fetched and saved.");
      return bookmarks;
    }
  } catch (error) {
    spinner.fail("Failed to process bookmarks.");
    console.error(error);
    throw error;
  }
}

if (isCI) {
  console.time("Time elapsed");
  processBookmarks()
    .then((bookmarks) => {
      console.timeEnd("Time elapsed");
      console.log("Bookmarks processed:", bookmarks.length);
    })
    .catch(console.error);
} else {
  inquirer
    .prompt([
      {
        type: "confirm",
        name: "fetchAll",
        message: "Would you like to fetch all bookmarks?",
        default: true,
      },
    ])
    .then(async (answers) => {
      if (answers.fetchAll) {
        console.time("Time elapsed");
        const mergedBookmarks = await processBookmarks();
        console.log("Bookmarks processed:", mergedBookmarks.length);
        console.timeEnd("Time elapsed");
      } else {
        console.log("Fetching canceled.");
      }
    });
}
