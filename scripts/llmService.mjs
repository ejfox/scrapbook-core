import dotenv from "dotenv";
import axios from "axios";
import { PROMPTS } from "./prompts.mjs";
import chalk from "chalk";

dotenv.config();

// API configurations
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
const NOMIC_API_URL = "https://api-atlas.nomic.ai/v1";

// Add loadCoreTags function that fetches from ejfox.com
export async function loadCoreTags() {
  try {
    const response = await axios.get("https://ejfox.com/tags.json");
    return response.data;
  } catch (error) {
    console.warn("Failed to load core tags:", error.message);
    // Return empty array if fetch fails
    return [];
  }
}

// Model configurations
export const MODELS = {
  // Claude models for completion
  CLAUDE_INSTANT: "anthropic/claude-instant-1.2",
  CLAUDE_2: "anthropic/claude-2.1",
  CLAUDE_3_OPUS: "anthropic/claude-3-opus-20240229",
  CLAUDE_3_SONNET: "anthropic/claude-3-sonnet-20240229",

  // GPT models for completion
  GPT_3_5_TURBO: "openai/gpt-3.5-turbo",
  GPT_4: "openai/gpt-4",
  GPT_4_TURBO: "openai/gpt-4-turbo-preview",

  // Nomic embedding models
  NOMIC_EMBED_TEXT: "nomic-embed-text-v1",
  NOMIC_EMBED_IMAGE: "nomic-embed-image-v1",
};

// Default model configuration
const DEFAULT_COMPLETION_MODEL = MODELS.CLAUDE_3_SONNET;
const DEFAULT_TEXT_EMBEDDING_MODEL = MODELS.NOMIC_EMBED_TEXT;
const DEFAULT_IMAGE_EMBEDDING_MODEL = MODELS.NOMIC_EMBED_IMAGE;

const service = {
  enabled: !!process.env.OPENROUTER_API_KEY,

  async completion({
    prompt,
    messages,
    temperature = 0.7,
    maxTokens = 1000,
    model = DEFAULT_COMPLETION_MODEL,
  }) {
    if (!this.enabled) {
      throw new Error(
        "OpenRouter API key not configured - please set OPENROUTER_API_KEY"
      );
    }

    // Check credits before making the API call
    const sufficientCredits = await this.checkOpenRouterCredits();
    if (!sufficientCredits) {
      return null; // Return null to indicate insufficient credits
    }

    try {
      // Handle both prompt string and messages array
      const finalMessages = messages || [{ role: "user", content: prompt }];

      const response = await axios.post(
        `${OPENROUTER_API_URL}/chat/completions`,
        {
          model: model,
          messages: finalMessages,
          temperature,
          max_tokens: maxTokens,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "HTTP-Referer": process.env.SITE_URL || "http://localhost:3000",
            "X-Title": "Scrapbook Core",
          },
        }
      );

      // More robust response validation
      if (
        !response.data ||
        !response.data.choices ||
        !response.data.choices.length ||
        !response.data.choices[0].message ||
        !response.data.choices[0].message.content
      ) {
        const errorData = {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data,
        };

        // Check for specific token error
        if (
          response.data?.error?.message?.includes("max_tokens limit exceeded")
        ) {
          console.warn(
            chalk.yellowBright(
              "\n⚠️  OpenRouter API token limit exceeded!  Please add more tokens.\n"
            )
          );
          return null; // Return null to indicate token exhaustion
        } else {
          throw new Error(
            `Invalid response format from OpenRouter API: ${JSON.stringify(
              errorData,
              null,
              2
            )}`
          );
        }
      }

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error(
        "OpenRouter API error:",
        error.response?.data || error.message
      );
      console.error("Full error object:", error); // Log the full error object for debugging
      throw new Error(`OpenRouter API error: ${error.message}`);
    }
  },

  async embedding(input, options = {}) {
    if (!process.env.NOMIC_API_KEY) {
      console.warn("Nomic API key not configured - please set NOMIC_API_KEY");
      return null;
    }

    const { type = "text", model } = options;
    const defaultModel =
      type === "image"
        ? DEFAULT_IMAGE_EMBEDDING_MODEL
        : DEFAULT_TEXT_EMBEDDING_MODEL;
    const endpoint = type === "image" ? "embedding/image" : "embedding/text";

    try {
      const payload =
        type === "image"
          ? {
              model: model || defaultModel,
              images: Array.isArray(input) ? input : [input], // Base64 encoded images
            }
          : {
              model: model || defaultModel,
              texts: Array.isArray(input) ? input : [input],
            };

      const response = await axios.post(
        `${NOMIC_API_URL}/${endpoint}`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${process.env.NOMIC_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      return Array.isArray(input)
        ? response.data.embeddings
        : response.data.embeddings[0];
    } catch (error) {
      console.error(
        "Nomic embedding error:",
        error.response?.data || error.message
      );
      return null;
    }
  },

  async checkOpenRouterCredits() {
    if (!this.enabled) {
      return true; // Assume sufficient credits if key is not set
    }

    try {
      const response = await axios.get(`${OPENROUTER_API_URL}/auth/key`, {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!response.data?.data) {
        throw new Error("Invalid response format from OpenRouter API");
      }

      const { usage, limit, is_free_tier } = response.data.data;

      if (usage >= limit) {
        console.error(
          chalk.redBright(
            `OpenRouter credit limit exceeded! Usage: ${usage}, Limit: ${limit}. Processing stopped.`
          )
        );
        return false;
      }

      console.log(
        `OpenRouter credits - Usage: ${usage}, Limit: ${limit}, Type: ${
          is_free_tier ? "Free" : "Paid"
        }`
      );
      return true;
    } catch (error) {
      console.error(
        `Error checking OpenRouter credits: ${error.message}. Processing stopped.`
      );
      return false;
    }
  },
};

export async function completion(promptOrMessages, options = {}) {
  // Handle both string prompts and message arrays
  const payload =
    typeof promptOrMessages === "string"
      ? { prompt: promptOrMessages, ...options }
      : { messages: promptOrMessages, ...options };

  return service.completion(payload);
}

export async function generateEmbedding(input, options = {}) {
  return service.embedding(input, options);
}

// Helper function to generate image embedding
export async function generateImageEmbedding(imageBase64) {
  return service.embedding(imageBase64, { type: "image" });
}

// Add PROMPTS to exports
export { PROMPTS };
