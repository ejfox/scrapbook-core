import axios from "axios";
import Bottleneck from "bottleneck";
import llamaTokenizer from "llama-tokenizer-js";

const limiter = new Bottleneck({
  maxConcurrent: 1,
  // minTime: 1000,
});

// this breaks the large content into smaller chunks
function breakContentIntoChunks(content, chunkSizeTokens) {
  // Split the content into sentences using a regular expression
  // The regular expression matches common sentence delimiters: periods, exclamation marks, and question marks
  // It accounts for common abbreviations and edge cases to avoid splitting on false sentence boundaries
  const sentences = content.match(/[^.!?]+[.!?]+/g);

  // Initialize an empty array to store the chunks
  const chunks = [];

  // Initialize a variable to keep track of the current chunk being built
  let currentChunk = "";

  // Iterate over each sentence
  for (const sentence of sentences) {
    // Calculate the token count of the current sentence
    const sentenceTokenCount = llamaTokenizer.encode(sentence).length;

    // Check if adding the current sentence to the current chunk would exceed the chunk size limit
    if (
      llamaTokenizer.encode(currentChunk + sentence).length > chunkSizeTokens
    ) {
      // If the chunk size limit is exceeded, add the current chunk to the chunks array
      chunks.push(currentChunk.trim());

      // Reset the current chunk to start building a new chunk
      currentChunk = "";
    }

    // Append the current sentence to the current chunk
    currentChunk += sentence + " ";
  }

  // After processing all sentences, add the remaining current chunk to the chunks array
  if (currentChunk.trim() !== "") {
    chunks.push(currentChunk.trim());
  }

  // Return the array of chunks
  return chunks;
}

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
    content: `You need to summarize this content into facts. Please provide one fact per line. Remember this is the raw contents of a webpage, so it may contain some erroneous text from buttons, navigation, footers, etc.Return ONLY the facts, no other text.`,
  });

  // content input via user request
  messages.push({
    role: "user",
    content: `${content}\nCan you summarize this into a list of facts? Start with fact 1, no introduction or confrimation.`,
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
    content: `You need to extract tags from this summary. Please provide one tag per line.`,
  });

  messages.push({
    role: "user",
    content:
      metaSummaryContent +
      "\n" +
      "What tags can you extract from this summary?" +
      "\n" +
      "These are our default tags:  data, dataviz, politics, howto, design, art, journalism, research, cli, reference, elections, tool, javascript, vj, d3, webdesign, mapping, music, police, tech, resource, visualization, video, 3d, protest, crypto, cooking, datajournalism, maps, twitter, food, election2020, arduino, programming, writing, inspiration, dataset, photography, recipe, games, pico8, occupy, hacking, code, activism, node, machinelearning, streaming, pandemic, youtube.",
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

    return response.data.choices[0].message.content;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}
