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

export const fetchAllBlocks = async (testMode = false) => {
  let allBlocks = [];

  try {
    log("Fetching user channels");
    const userChannels = await arena.user(USER_SLUG).channels();
    log(`Found ${userChannels.length} channels`);

    const channelsToProcess = testMode ? [userChannels[0]] : userChannels;

    for (const channel of channelsToProcess) {
      log(`Processing channel: ${channel.title}`);
      
      const response = await limiter.schedule(() =>
        arena.channel(channel.id).contents({
          page: 1,
          per: testMode ? 5 : 100,
          sort: "updated_at",
          direction: "desc",
        })
      );
      
      const blocks = response || [];
      const processedBlocks = await Promise.all(blocks.map(block => {
        const enrichedBlock = {
          ...block,
          channel: channel.title,
          connected_to_channels: [
            {
              id: channel.id,
              title: channel.title,
            },
            ...(block.connected_to_channels || []),
          ],
        };
        return processBlock(enrichedBlock);
      }));

      allBlocks = allBlocks.concat(processedBlocks.filter(Boolean));

      if (testMode && allBlocks.length >= 5) break;

      if (!testMode) {
        let page = 2;
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
            if (!blocks.length) break;
            
            const processedBlocks = await Promise.all(blocks.map(block => {
              const enrichedBlock = {
                ...block,
                channel: channel.title,
                connected_to_channels: [
                  {
                    id: channel.id,
                    title: channel.title,
                  },
                  ...(block.connected_to_channels || []),
                ],
              };
              return processBlock(enrichedBlock);
            }));

            allBlocks = allBlocks.concat(processedBlocks.filter(Boolean));
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
  if (!block || !block.id) {
    console.error('Invalid block:', block);
    return null;
  }

  try {
    // Handle different block classes (Image, Text, Media, Link, etc)
    const content = (() => {
      if (!block.class) return 'No content';

      switch(block.class.toLowerCase()) {
        case 'image':
          return block.description || block.title || block.generated_title || 'Untitled image';
        case 'text':
          return block.content || block.description || 'Empty text block';
        case 'link':
          return block.description || block.source?.title || 'Untitled link';
        case 'attachment':
          return block.description || block.title || 'Untitled attachment';
        case 'media':
          return block.description || block.embed?.title || 'Untitled media';
        default:
          return block.content || block.description || 'No content';
      }
    })();

    // Get best available URL
    const url = (() => {
      if (block.source?.url) return block.source.url;
      if (block.attachment?.url) return block.attachment.url;
      if (block.embed?.url) return block.embed.url;
      return `https://www.are.na/block/${block.id}`;
    })();

    // Get best available image URL
    const screenshot_url = (() => {
      if (block.image?.display?.url) return block.image.display.url;
      if (block.attachment?.url) return block.attachment.url;
      if (block.embed?.thumbnail_url) return block.embed.thumbnail_url;
      return null;
    })();

    // Parse dates safely
    const created = block.created_at ? new Date(block.created_at) : new Date();
    const updated = block.updated_at ? new Date(block.updated_at) : created;
    
    const scrap = {
      id: generateScrapId('arena', block.id),
      source: "arena",
      type: "block",
      url,
      title: block.title || block.generated_title || 'Untitled Block',
      content,
      screenshot_url,
      published_at: created.toISOString(),
      created_at: created.toISOString(),
      updated_at: updated.toISOString(),
      shared: false,  // Always false by default
      tags: [
        block.class?.toLowerCase(),
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
          provider: block.source.provider?.name,
          url: block.source.url,
          title: block.source.title
        },
        image_data: block.image && {
          thumb: block.image.thumb?.url,
          square: block.image.square?.url,
          display: block.image.display?.url
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

    // Validate required fields before returning
    const required = ['id', 'source', 'type', 'url', 'title', 'content', 'published_at', 'created_at', 'updated_at', 'shared', 'tags', 'metadata'];
    const missing = required.filter(field => scrap[field] === undefined);
    
    if (missing.length > 0) {
      console.error(`Block ${block.id} missing required fields:`, missing);
      return null;
    }

    return scrap;

  } catch (error) {
    console.error(`Error processing block ${block?.id}:`, error);
    return null;
  }
}
