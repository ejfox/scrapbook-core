#!/usr/bin/env node
import Arena from "are.na";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import { generateScrapId } from '../helpers.js';
import { generateScreenshot } from './generateScreenshot.mjs';

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
          const processedBlocks = blocks.map(block => ({
            ...block,
            channel: channel.title,
            connected_to_channels: [
              {
                id: channel.id,
                title: channel.title,
              },
              ...(block.connected_to_channels || []),
            ],
          })).map(processBlock);

          allBlocks = allBlocks.concat(processedBlocks);
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

if (import.meta.url === `file://${process.argv[1]}`) {
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

export async function processBlock(block) {
  const content = (() => {
    switch(block.class) {
      case 'Image':
        return block.description || block.title || '';
      case 'Text':
        return block.content || '';
      case 'Link':
        return block.description || block.source?.title || '';
      case 'Attachment':
        return block.description || block.title || '';
      case 'Media':
        return block.description || block.embed?.title || '';
      default:
        return block.content || block.description || '';
    }
  })();

  const screenshot_url = (() => {
    if (block.image?.display?.url) return block.image.display.url;
    if (block.attachment?.url) return block.attachment.url;
    if (block.embed?.thumbnail_url) return block.embed.thumbnail_url;
    return null;
  })();

  return {
    id: generateScrapId('arena', block.id),
    source: "arena",
    type: "block",
    
    url: block.source?.url || block.attachment?.url || block.embed?.url,
    title: block.title || block.generated_title,
    content,
    screenshot_url,
    
    published_at: block.created_at,
    created_at: block.created_at,
    updated_at: block.updated_at,
    
    shared: block.status !== "private",
    
    tags: [
      ...(block.tags || []),
      block.class.toLowerCase(),
      block.base_class?.toLowerCase()
    ].filter(Boolean),
    
    metadata: {
      class: block.class,
      base_class: block.base_class,
      
      channel: block.channel,
      connected_to_channels: block.connected_to_channels?.map(c => ({
        id: c.id,
        title: c.title
      })),
      
      source_data: block.source && {
        provider: block.source.provider,
        url: block.source.url,
        title: block.source.title
      },
      
      image_data: block.image && {
        thumb: block.image.thumb,
        square: block.image.square,
        display: block.image.display
      },
      
      embed: block.embed && {
        type: block.embed.type,
        title: block.embed.title,
        author_name: block.embed.author_name,
        author_url: block.embed.author_url,
        thumbnail_url: block.embed.thumbnail_url
      },
      
      attachment: block.attachment && {
        file_name: block.attachment.file_name,
        extension: block.attachment.extension,
        content_type: block.attachment.content_type,
        file_size: block.attachment.file_size
      }
    }
  };
}
