import axios from "axios";
import * as helpers from "../helpers.js";

async function fetchTweets(url) {
  try {
    const response = await axios.get(url);
    return response.data.tweets;
  } catch (error) {
    console.error("Error fetching tweets:", error);
    throw error;
  }
}

function processTweet(tweet, allTweets) {
  const tweetId = tweet.id;
  const threadTweets = allTweets.filter((t) => t.reply_to_tweet_id === tweetId);

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
    summary: "",
    created_at: new Date(tweet.created_at).toISOString(),
    tags: tweet.hashtags || [],
    relationships: relationships,
    metadata: {
      href: `https://twitter.com/i/web/status/${tweetId}`,
      rts: tweet.retweet_count,
      likes: tweet.favorite_count,
      user: tweet.user?.screen_name || tweet.reply_to_username,
      reply_to_tweet_id: tweet.reply_to_tweet_id,
    },
  };
}

async function fetchAndProcessTweets(url) {
  try {
    console.log("Fetching tweets...");
    const tweets = await fetchTweets(url);
    console.log(`Fetched ${tweets.length} tweets`);

    const processedTweets = tweets.map((tweet) => processTweet(tweet, tweets));
    console.log(`${processedTweets.length} tweets processed`);

    return processedTweets;
  } catch (error) {
    console.error("Error in fetchAndProcessTweets:", error);
    throw error;
  }
}

export { fetchAndProcessTweets };
