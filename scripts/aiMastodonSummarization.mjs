import axios from "axios";
import Bottleneck from "bottleneck";
import OpenAI from "openai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configure rate limiter
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

// Helper function to choose LLM service based on flag or env variable
function chooseLLMService() {
  return process.env.USE_OPENAI === "true" ? "openai" : "local";
}

export async function generateMastodonTags(status) {
  const content = formatMastodonStatusForTagging(status);
  return await limiter.schedule(() => generateTagsForMastodonStatus(content));
}

export function formatMastodonStatusForTagging(status) {
  let formattedContent = `Status: ${status.content}\n`;
  formattedContent += `Created at: ${status.created_at}\n`;

  if (status.media_attachments && status.media_attachments.length > 0) {
    formattedContent += "Media attachments:\n";
    status.media_attachments.forEach((media, index) => {
      formattedContent += `  ${index + 1}. Type: ${media.type}, Description: ${
        media.description || "No description"
      }\n`;
    });
  }

  if (status.tags && status.tags.length > 0) {
    formattedContent +=
      "Existing tags: " + status.tags.map((tag) => tag.name).join(", ") + "\n";
  }

  return formattedContent;
}

export async function generateTagsForMastodonStatus(content) {
  const messages = [
    {
      role: "system",
      content: `You are an expert at applying relevant tags to Mastodon statuses. Your goal is to generate a small set of highly relevant tags based on the content of the status. These tags should capture the main topics, themes, or sentiments expressed in the status. Pay attention to any media attachments or existing tags, but don't simply repeat them - use them as context to inform your tag choices. Provide one tag per line. Respond with ONLY the tags, no other text.`,
    },
    {
      role: "user",
      content: `Please generate relevant tags for this Mastodon status. Aim for 3-5 tags, but you can provide fewer if the content is very specific or more if it covers multiple distinct topics. Here's the status content:

${content}

What tags would you suggest for this status?`,
    },
  ];

  const llmService = chooseLLMService();

  try {
    if (llmService === "openai") {
      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages,
        temperature: 0.3,
        max_tokens: 100,
      });
      return response.choices[0].message.content
        .split("\n")
        .filter((tag) => tag.trim() !== "");
    } else {
      const payload = {
        model: "Meta-Llama-3-8B-Instruct-imatrix",
        messages,
        temperature: 0.3,
        max_tokens: 100,
        stream: false,
      };
      const response = await axios.post(
        "http://localhost:1234/v1/chat/completions",
        payload
      );
      return response.data.choices[0].message.content
        .split("\n")
        .filter((tag) => tag.trim() !== "");
    }
  } catch (error) {
    console.error("Error generating tags:", error);
    return [];
  }
}
