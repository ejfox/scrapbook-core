import axios from "axios";
import Bottleneck from "bottleneck";
import llamaTokenizer from "llama-tokenizer-js";
import { breakContentIntoChunks } from "../helpers.js";

// dl latest tags from ejfox.com/tags.json
const tagData = await axios
  .get("https://ejfox.com/tags.json")
  .then((res) => res.data);

const tags = tagData;

const limiter = new Bottleneck({
  maxConcurrent: 1,
  // minTime: 1000,
});

export async function summarizeContent(content, options = {}) {
  const chunkSizeTokens = 6144;

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

  const summaries = await Promise.all(
    flatChunks.map(async (chunk) => {
      return await summarizeString(chunk);
    })
  );

  console.log("⚡️ Summaries:");
  console.log(summaries);

  let summary = summaries.map((s) => s.content).join("\n");

  summary = summaries.join("\n");
  console.log("Summary:", summary);

  // summaries is an array of promise return values so we need to c

  if (options.metaSummary) {
    console.log("Generating meta summary...");
    const metaSummary = await summarizeString(summary);
    return metaSummary;
  }

  return summary;
}

// this summarizes individual chunks of text into facts
export async function summarizeString(content) {
  // first we create our messages array out of the content
  const messages = [];

  // system prompt
  messages.push({
    role: "system",
    content: `When analyzing this portion of a webpage, your goal is to distill its content into concise, standalone bullet points. Each point should encapsulate a key piece of information, complete in itself, and easily understandable without needing further context. Pay special attention to precise details, especially if they involve code or search queries - accuracy in phrasing is crucial here. It's important to include relevant URLs or specific search queries that are associated with these facts, as they can serve as gateways for deeper exploration later on. Strive for clarity and brevity in each bullet point, ensuring that the most crucial information is presented first. The bullet points should not depend on each other for context, and each should be as self-contained as possible. Remember, less is more in this task; prioritize quality and relevance over quantity.`,
  });

  // content input via user request
  messages.push({
    role: "user",
    content: `${content}\nCan you summarize this into a list of facts? Start with fact 1, no introduction or confrimation. Do not say "Here is the summary:". Just start with the first fact.`,
  });

  const payload = {
    // model: "model-identifier",
    model: "Meta-Llama-3-8B-Instruct-imatrix",
    messages,
    temperature: 0.7,
    max_tokens: -1,
    stream: false,
  };

  try {
    // send the messages to the local llama
    // const response = await axios.post(localLlamaUrl, { messages });
    const response = await axios.post(
      "http://localhost:1234/v1/chat/completions",
      payload
    );

    // return the response
    return response.data.choices[0].message.content;
  } catch (error) {
    // handle the error and return an error message
    return `Error: ${error.message}`;
  }
}

export async function metaSummaryToTags(metaSummaryContent) {
  const messages = [];

  messages.push({
    role: "system",
    content: `You are an expert at applying the correct tags to page summaries. Please provide one tag per line. Respond with ONLY the tags, no other chatter, introduction, or conclusion.`,
  });

  messages.push({
    role: "user",
    content: `Apply tags most relevant to this summary content. Apply the tags very sparingly, usually only 2-3 tags per summary. Choose the most relevant tags. Only special tags have exclamation points. These are the default tags, use them exactly as they are written:
${tags.join("\n")}
What tags best apply to this summary?
${metaSummaryContent}`,
  });

  const payload = {
    model: "Meta-Llama-3-8B-Instruct-imatrix",
    messages,
    temperature: 0.2,
    max_tokens: 32,
    stream: false,
  };

  try {
    const response = await axios.post(
      "http://localhost:1234/v1/chat/completions",
      payload
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}
