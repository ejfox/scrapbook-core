import axios from "axios";
import Bottleneck from "bottleneck";
import llamaTokenizer from "llama-tokenizer-js";
import { breakContentIntoChunks } from "../helpers.js";
import dotenv from "dotenv";
dotenv.config();

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

export async function extractLocation(content, options = {}) {
  const chunkSizeTokens = 6144;

  if (!content) {
    console.error("No content provided");
    return { location: null, latitude: null, longitude: null };
  }
  const flatChunks = breakContentIntoChunks(content, chunkSizeTokens);

  console.log(
    `Broke ${content.length} characters into ${flatChunks.length} chunks...`
  );

  const avgTokensPerChunk = flatChunks.reduce((acc, chunk) => {
    return acc + llamaTokenizer.encode(chunk).length;
  }, 0);
  const avgTokensPerChunkAvg = avgTokensPerChunk / flatChunks.length;
  console.log(`Avg tokens per chunk: ${avgTokensPerChunkAvg}`);
  console.log("\n");
  console.log(flatChunks[0].substring(0, 1000) + "...");

  const locations = await Promise.all(
    flatChunks.map(async (chunk) => {
      return await extractLocationFromString(chunk);
    })
  );

  console.log("⚡️ Locations:");
  console.log(locations);

  const filteredLocations = locations.filter((location) => location !== null);

  if (filteredLocations.length === 0) {
    console.log("No location found in the content.");
    return { location: null, latitude: null, longitude: null };
  }

  const location = filteredLocations[0];
  console.log("Extracted Location:", location);

  const { latitude, longitude } = await limiter.schedule(() =>
    reverseGeocode(location)
  );
  console.log(`Latitude: ${latitude}, Longitude: ${longitude}`);

  return { location, latitude, longitude };
}

export async function extractLocationFromString(content) {
  const messages = [];

  messages.push({
    role: "system",
    content:
      "You need to extract a single geographic location from this content. If multiple locations are found, return the first one. The location should be in the format: 'City, State, Country' or 'City, Country'. If no location is found, return 'null'. These must be real, existing locations on earth. If they aren't, return 'null'. If no locations are mentioned, return 'null'. Respond with ONLY the locationo, no other chatter, introduction, or conclusion.",
  });

  messages.push({
    role: "user",
    content: `${content}\nCan you extract a geographic location from this content?`,
  });

  const payload = {
    model: "Meta-Llama-3-8B-Instruct-imatrix",
    messages,
    temperature: 0.7,
    max_tokens: -1,
    stream: false,
  };

  try {
    const response = await axios.post(
      "http://localhost:1234/v1/chat/completions",
      payload
    );

    const extractedLocation = response.data.choices[0].message.content.trim();
    return extractedLocation === "null" ? null : extractedLocation;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

async function reverseGeocode(location) {
  // const apiKey = "";
  const apiKey = process.env.OPENCAGE_API_KEY;
  const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(
    location
  )}&key=${apiKey}`;

  try {
    const response = await axios.get(url);
    const { lat, lng } = response.data.results[0].geometry;
    return { latitude: lat, longitude: lng };
  } catch (error) {
    console.error("Error in reverseGeocode:", error);
    return { latitude: null, longitude: null };
  }
}
