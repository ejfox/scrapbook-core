import axios from "axios";
import Bottleneck from "bottleneck";
import llamaTokenizer from "llama-tokenizer-js";
import { breakContentIntoChunks } from "../helpers.js";

const tags = [
  "3d",
  "3dmodel",
  "aboutme",
  "activism",
  "advice",
  "america",
  "analog",
  "anarchism",
  "api",
  "ar15",
  "arduino",
  "art",
  "audio",
  "automation",
  "beacon",
  "blender",
  "book",
  "callofduty",
  "camping",
  "cannabis",
  "cheatsheet",
  "chess",
  "cli",
  "climatechange",
  "clothes",
  "cms",
  "code",
  "coding",
  "comedy",
  "cooking",
  "covid",
  "crypto",
  "cryptocurrency",
  "css",
  "culture",
  "d3",
  "data",
  "database",
  "datajournalism",
  "dataset",
  "dataviz",
  "demo",
  "design",
  "dj",
  "documentary",
  "drama",
  "ecology",
  "editing",
  "education",
  "elections",
  "electronics",
  "event",
  "exercise",
  "Fashion",
  "food",
  "funny",
  "game",
  "games",
  "generative",
  "git",
  "github",
  "gpt3",
  "guns",
  "hackers",
  "hacking",
  "hardware",
  "health",
  "howto",
  "html",
  "hudsonvalley",
  "infographic",
  "inspiration",
  "internet",
  "ios",
  "irc",
  "javascript",
  "jiujitsu",
  "journalism",
  "jquery",
  "js",
  "json",
  "lackofdata",
  "legal",
  "linocut",
  "livestream",
  "machinelearning",
  "mapping",
  "maps",
  "markdown",
  "mastodon",
  "media",
  "meditation",
  "military",
  "militias",
  "minecraft",
  "motorcycle",
  "movies",
  "music",
  "nature",
  "network",
  "nft",
  "node",
  "nodejs",
  "ny",
  "nypd",
  "oakland",
  "occupy",
  "occupyoakland",
  "opensource",
  "opinion",
  "osint",
  "osx",
  "pdf",
  "People",
  "personal",
  "photography",
  "photojournalism",
  "pico8",
  "podcast",
  "police",
  "politics",
  "pottery",
  "process",
  "product",
  "programming",
  "project",
  "protest",
  "psychedelics",
  "qgis",
  "quantifiedself",
  "quote",
  "R",
  "raspberrypi",
  "recipe",
  "reference",
  "research",
  "resource",
  "security",
  "sex",
  "shapefile",
  "shortcut",
  "soap",
  "sqlite",
  "startups",
  "study",
  "systemsthinking",
  "tactics",
  "teaching",
  "tech",
  "technique",
  "tool",
  "travel",
  "tributary",
  "tv",
  "twitter",
  "typography",
  "ui",
  "utility",
  "ux",
  "video",
  "videogames",
  "vim",
  "vinyl",
  "visualization",
  "visuals",
  "vj",
  "vr",
  "vue",
  "watercolor",
  "webdesign",
  "woodworking",
  "writing",
  "youtube",
];

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
    content: `These are our default tags:
${tags.join("\n")}
What tags can you extract from this summary?
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
