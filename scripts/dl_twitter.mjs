import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import * as helpers from "../helpers.js"; // Assuming you have helper functions for UUID conversion and more
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import * as d3 from "d3";

dotenv.config();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Initialize Bottleneck
const limiter = new Bottleneck({
  maxConcurrent: 3, // Maximum 3 concurrent upserts
  minTime: 100, // Minimum 1 second between each upsert
});

async function upsertScrap(scrap) {
  const { data, error } = await supabase
    .from("scraps")
    .upsert(scrap, { onConflict: "scrap_id" });

  console.log(`${JSON.stringify(scrap)} upserted`);

  console.log(`-- ${JSON.stringify(data)}`);

  if (error) {
    console.error("Error upserting scrap:", error);
  }
}

function parseTweets(filePath) {
  const rawData = fs.readFileSync(filePath, "utf-8");
  console.log("Parsing tweets data");
  console.log("Data length: ", rawData.length);
  const tweetsData = JSON.parse(rawData);
  return tweetsData.tweets;
}

function processTweet(tweet, allTweets) {
  const tweetId = tweet.id;
  const threadTweets = allTweets.filter((t) => t.reply_to_tweet_id === tweetId);

  // Capture thread relationships
  const relationships = threadTweets.map((t) => ({
    type: "thread",
    target: {
      scrap_id: helpers.scrapToUUID("twitter" + t.id),
      source: "twitter",
      type: "scrap",
    },
  }));

  return {
    scrap_id: helpers.scrapToUUID("twitter" + tweetId),
    source: "twitter",
    content: tweet.text,
    summary: "", // Placeholder for summary
    created_at: tweet.created_at,
    tags: [], // Placeholder for tags
    relationships: relationships,
    metadata: {
      href: `https://twitter.com/i/web/status/${tweetId}`,
      user: tweet.reply_to_username,
    },
  };
}

async function importTweets(filePath) {
  const tweets = parseTweets(filePath);

  // console.log({ tweets });
  console.log(`Importing ${tweets.length} tweets`);

  const scraps = tweets.map((tweet) => processTweet(tweet, tweets));

  console.log(`${scraps.length} tweets to upsert`);

  const upsertPromises = scraps.map((scrap) =>
    limiter.schedule(() => upsertScrap(scrap))
  );

  await Promise.all(upsertPromises);

  console.log("Tweets have been imported and upserted into Supabase.");
}

// Path to your tweets.json file
const tweetsFilePath = path.resolve("data/tweets.json");

importTweets(tweetsFilePath).catch(console.error);
