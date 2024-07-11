#!/usr/bin/env node
import Arena from "are.na";
import * as fs from "fs/promises";
import path from "path";
import ora from "ora";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import { readManifest, updateManifest } from "./manifestHelpers.mjs";

dotenv.config();

const DEBUG = process.env.DEBUG === "true";

function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

log("Debug mode is on");

let isShuttingDown = false;

const limiter = new Bottleneck({ minTime: 333 });
const USER_SLUG = process.env.USER_SLUG || "ej-fox";
const ARENA_ACCESS_TOKEN = process.env.ARENA_ACCESS_TOKEN;

if (!ARENA_ACCESS_TOKEN) {
  console.error("ARENA_ACCESS_TOKEN is not set in the environment variables.");
  process.exit(1);
}

log("Initializing Arena client");
const arena = new Arena({ accessToken: ARENA_ACCESS_TOKEN });

const fetchAllBlocks = async () => {
  // const spinner = ora("Initializing download...").start();
  let manifest;
  try {
    log("Reading manifest");
    manifest = await readManifest();
  } catch (error) {
    console.warn(
      "Failed to read manifest, using default values:",
      error.message
    );
    manifest = { arena: {} };
  }
  let lastFetch = manifest.arena?.lastFetch || new Date(0).toISOString();
  let allBlocks = [];

  try {
    log("Fetching user channels");
    const userChannels = await arena.user(USER_SLUG).channels();
    log(`Found ${userChannels.length} channels`);

    for (const channel of userChannels) {
      log(`Processing channel: ${channel.title}`);
      let page = 1;
      let fetching = true;

      while (fetching) {
        if (isShuttingDown) {
          console.log("Shutting down, saving progress...");
          break;
        }
        try {
          log(`Fetching page ${page} of channel ${channel.title}`);
          const response = await limiter.schedule(() =>
            arena
              .channel(channel.id)
              // .contents({ page, per: 100, updated_after: lastFetch })
              .contents({
                page,
                per: 100,
                sort: "updated_at",
                direction: "desc",
                updated_after: lastFetch,
              })
          );
          const blocks = response || [];
          allBlocks = allBlocks.concat(
            blocks.map((block) => ({
              ...block,
              channel: channel.title,
              connected_to_channels: [
                {
                  id: channel.id,
                  title: channel.title,
                },
                ...(block.connected_to_channels || []),
              ],
            }))
          );
          fetching = blocks.length > 0;
          page += 1;
        } catch (error) {
          console.error(
            `Error fetching page ${page} of channel ${channel.title}:`,
            error.message
          );
          fetching = false;
        }
      }
    }

    log(`Fetched ${allBlocks.length} blocks`);

    // spinner.succeed(`Downloaded ${allBlocks.length} blocks`);
    log("Updating manifest");
    await updateManifest("arena", { lastFetch: new Date().toISOString() });
    return allBlocks;
  } catch (error) {
    // spinner.fail("An error occurred");
    console.error(error);
    throw error;
  }
};

const saveBlocks = async (blocks) => {
  log("Saving blocks");
  const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
  await fs.mkdir(dirPath, { recursive: true });
  const filePath = path.join(dirPath, "arena.json");
  await fs.writeFile(filePath, JSON.stringify(blocks, null, 2));
  log("Blocks saved successfully");
};

async function main() {
  log("Entering main function");

  process.on("SIGINT", async () => {
    console.log("\nGracefully shutting down...");
    isShuttingDown = true;

    // Give ongoing operations a chance to complete
    await new Promise((resolve) => setTimeout(resolve, 2500));

    console.log("Shutdown complete.");
    process.exit(0);
  });

  try {
    const blocks = await fetchAllBlocks();
    await saveBlocks(blocks);
    console.log("Blocks saved successfully.");
  } catch (error) {
    console.error("An error occurred:", error);
    process.exit(1);
  }
}

log("Starting main execution");
main().catch((error) => console.error("Unhandled error in main:", error));

export { fetchAllBlocks };
