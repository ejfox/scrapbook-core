#!/usr/bin/env node
import Arena from "are.na";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";

dotenv.config();

const DEBUG = process.env.DEBUG === "true";

function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

log("Debug mode is on");

const limiter = new Bottleneck({ minTime: 333 });
const USER_SLUG = process.env.USER_SLUG || "ej-fox";
const ARENA_ACCESS_TOKEN = process.env.ARENA_ACCESS_TOKEN;

if (!ARENA_ACCESS_TOKEN) {
  console.error("ARENA_ACCESS_TOKEN is not set in the environment variables.");
  process.exit(1);
}

log("Initializing Arena client");
const arena = new Arena({ accessToken: ARENA_ACCESS_TOKEN });

export const fetchAllBlocks = async () => {
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
        try {
          log(`Fetching page ${page} of channel ${channel.title}`);
          const response = await limiter.schedule(() =>
            arena.channel(channel.id).contents({
              page,
              per: 100,
              sort: "updated_at",
              direction: "desc",
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
    return allBlocks;
  } catch (error) {
    console.error("An error occurred while fetching blocks:", error);
    throw error;
  }
};

if (require.main === module) {
  log("Starting main execution");
  fetchAllBlocks()
    .then((blocks) => {
      console.log(`Total blocks fetched: ${blocks.length}`);
    })
    .catch((error) => {
      console.error("Unhandled error in main:", error);
      process.exit(1);
    });
}
