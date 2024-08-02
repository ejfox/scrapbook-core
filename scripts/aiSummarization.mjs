import axios from "axios";
import Bottleneck from "bottleneck";
import llamaTokenizer from "llama-tokenizer-js";
import { breakContentIntoChunks } from "../helpers.js";
import OpenAI from "openai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Fetch latest tags from ejfox.com/tags.json
const tagData = await axios
  .get("https://ejfox.com/tags.json")
  .then((res) => res.data);
const tags = tagData.filter((d) => {
  // filter out tags that start with !
  return !d.startsWith("!");
})

// Configure rate limiter
const limiter = new Bottleneck({
  maxConcurrent: 1,
  // minTime: 1000,
});

// Helper function to choose LLM service based on flag or env variable
function chooseLLMService() {
  return process.env.USE_OPENAI === "true" ? "openai" : "local";
}

export async function summarizeContent(content, options = {}) {
  const chunkSizeTokens = 6144;
  const flatChunks = breakContentIntoChunks(content, chunkSizeTokens);

  console.log(
    `Broke ${content.length} characters into ${flatChunks.length} chunks...`
  );

  const avgTokensPerChunk = flatChunks.reduce(
    (acc, chunk) => acc + llamaTokenizer.encode(chunk).length,
    0
  );
  const avgTokensPerChunkAvg = avgTokensPerChunk / flatChunks.length;
  console.log(`Avg tokens per chunk: ${avgTokensPerChunkAvg}`);
  console.log("\n");
  console.log(flatChunks[0].substring(0, 1000) + "...");

  const summaries = await Promise.all(
    flatChunks.map((chunk) => limiter.schedule(() => summarizeString(chunk)))
  );

  let summary = summaries.join("\n");
  console.log("Summary:", summary);

  if (options.metaSummary) {
    console.log("Generating meta summary...");
    const metaSummary = await summarizeString(summary);
    return metaSummary;
  }

  return summary;
}

export async function summarizeString(content) {
  const messages = [
    {
      role: "system",
      content: `When analyzing this portion of a webpage, your goal is to distill its content into concise, standalone bullet points. Each point should encapsulate a key piece of information, complete in itself, and easily understandable without needing further context. Pay special attention to precise details, especially if they involve code or search queries - accuracy in phrasing is crucial here. It's important to include relevant URLs or specific search queries that are associated with these facts, as they can serve as gateways for deeper exploration later on. Strive for clarity and brevity in each bullet point, ensuring that the most crucial information is presented first. The bullet points should not depend on each other for context, and each should be as self-contained as possible. Remember, less is more in this task; prioritize quality and relevance over quantity.`,
    },
    {
      role: "user",
      content: `${content}\nCan you summarize this into a list of facts? Start with fact 1, no introduction or confirmation. Do not say "Here is the summary:". Just start with the first fact. Try to keep the total list of facts under 10 items. Keep the most important / unique facts. Include URLs or search queries, specific keywords, names, etc. if they are important to the fact. Be sure every single fact stands alone and is not dependent on any other fact.`,
    },
  ];

  const llmService = chooseLLMService();

  try {
    if (llmService === "openai") {
      const response = await openai.chat.completions.create({
        // model: "gpt-3.5-turbo",
        model: "gpt-4o",
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      });
      return response.choices[0].message.content;
    } else {
      const payload = {
        model: "Meta-Llama-3-8B-Instruct-imatrix",
        messages,
        temperature: 0.7,
        max_tokens: -1,
        stream: false,
      };
      const response = await axios.post(
        "http://localhost:1234/v1/chat/completions",
        payload
      );
      return response.data.choices[0].message.content;
    }
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

export async function metaSummaryToTags(metaSummaryContent) {
  const messages = [
    {
      role: "system",
      content: `You are an expert at applying the correct tags to page summaries. Please provide one tag per line. Respond with ONLY the tags, no other chatter, introduction, or conclusion.`,
    },
    {
      role: "user",
      content: `Can you apply tags to this summary? (summary trimmed)`,
    },
    {
      role: "assistant",
      content: `tag1
tag2
tag3`,
    },
    {
      role: "user",
      content: `Perfect! Now let's apply tags most relevant to this summary content. Apply the tags very sparingly, usually only 2-3 tags per summary. Choose the most relevant tags. Only special tags have exclamation points. These are the default tags, use them exactly as they are written:
${tags.join("\n")}
What tags best apply to this summary?
${metaSummaryContent}`,
    },
  ];

  const llmService = chooseLLMService();

  try {
    if (llmService === "openai") {
      const response = await openai.chat.completions.create({
        // model: "gpt-3.5-turbo",
        model: "gpt-4o",
        messages,
        temperature: 0.2,
        max_tokens: 32,
      });
      return response.choices[0].message.content;
    } else {
      const payload = {
        model: "Meta-Llama-3-8B-Instruct-imatrix",
        messages,
        temperature: 0.2,
        max_tokens: 32,
        stream: false,
      };
      const response = await axios.post(
        "http://localhost:1234/v1/chat/completions",
        payload
      );
      return response.data.choices[0].message.content;
    }
  } catch (error) {
    return `Error: ${error.message}`;
  }
}
