// aiGeolocation.mjs

import OpenAI from "openai";
import axios from "axios";
import Bottleneck from "bottleneck";
import llamaTokenizer from "llama-tokenizer-js";
import { breakContentIntoChunks } from "../helpers.js";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

function chooseLLMService() {
  return process.env.USE_OPENAI === "true" ? "openai" : "local";
}

export default async function extractLocation(content, options = {}) {
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

  const locations = await Promise.all(
    flatChunks.map(async (chunk) => {
      return await extractLocationFromString(chunk);
    })
  );

  console.log("⚡️ Locations:");
  console.log(locations);

  // if either of the locations is null, or N/A, or "unknown", return null for everything
  if (locations[0] === null)
    return { location: null, latitude: null, longitude: null };
  if (locations[0] === "null")
    return { location: null, latitude: null, longitude: null };
  if (locations[0] === "N/A")
    return { location: null, latitude: null, longitude: null };
  if (locations[0] === "unknown")
    return { location: null, latitude: null, longitude: null };

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
  const llmService = chooseLLMService();

  if (llmService === "openai") {
    return await extractLocationOpenAI(content);
  } else {
    return await extractLocationLocal(content);
  }
}

async function extractLocationOpenAI(content) {
  const messages = [
    {
      role: "user",
      content: `Extract a single geographic location from this content. If there is no location, simply return null. 
      # Content
      ${content}`,
    },
  ];
  const tools = [
    {
      type: "function",
      function: {
        name: "extractSingleLocation",
        description: "Extract a single location from the given content",
        parameters: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description: "The name of the city",
            },
            state: {
              type: "string",
              description: "The name of the state or province (if applicable)",
            },
            country: {
              type: "string",
              description: "The name of the country",
            },
          },
          required: ["city", "country"],
        },
      },
    },
  ];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      tools: tools,
      tool_choice: "auto",
    });

    const responseMessage = response.choices[0].message;
    const toolCalls = responseMessage.tool_calls;

    if (toolCalls) {
      const toolCall = toolCalls[0]; // We expect only one tool call
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);

      if (functionName === "extractSingleLocation") {
        const { city, state, country } = functionArgs;

        if (city === "null" && country === "null") {
          return null;
        }

        if (city === "unknown" || city === "n/a") {
          city = null;
        }

        if (country === "unknown" || country === "n/a") {
          country = null;
        }

        let formattedLocation = city;
        if (state && state !== "null") {
          formattedLocation += `, ${state}`;
        }
        formattedLocation += `, ${country}`;

        return formattedLocation;
      }
    }

    return null; // If no location was extracted
  } catch (error) {
    console.error("Error in OpenAI API call:", error);
    return null;
  }
}

async function extractLocationLocal(content) {
  const messages = [
    {
      role: "system",
      content:
        "You need to extract a single geographic location from this content. If multiple locations are found, return the first one. The location should be in the format: 'City, State, Country' or 'City, Country'. If no location is found, return 'null'. These must be real, existing locations on earth. If they aren't, return 'null'. If no locations are mentioned, return 'null'. Respond with ONLY the location, no other chatter, introduction, or conclusion.",
    },
    {
      role: "user",
      content: `${content}\nCan you extract a geographic location from this content?`,
    },
  ];

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
    console.error("Error in local LLM service:", error);
    return `Error: ${error.message}`;
  }
}

async function reverseGeocode(location) {
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
