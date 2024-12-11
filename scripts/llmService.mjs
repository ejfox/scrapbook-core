import dotenv from "dotenv";
import axios from "axios";
import { PROMPTS } from "./prompts.mjs";
import chalk from "chalk";
import sharp from "sharp";
import { FormData } from "@web-std/form-data";
import { File, Blob } from "node:buffer";
import { processImagesForScrap, getImageEmbedding } from "./imageEmbedding.mjs";

dotenv.config();

// Add DEBUG constant
const DEBUG = process.env.DEBUG === "true";

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
  // Claude models
  CLAUDE_3_OPUS: "anthropic/claude-3-opus-20240229",
  CLAUDE_3_SONNET: "anthropic/claude-3-sonnet-20240229",
  CLAUDE_2: "anthropic/claude-2.1",
  CLAUDE_INSTANT: "anthropic/claude-instant-1.2",

  // GPT-4 models
  GPT_4_TURBO: "openai/gpt-4-turbo-preview",
  GPT_4: "openai/gpt-4",

  // GPT-3.5 models
  GPT_3_5_TURBO: "openai/gpt-3.5-turbo",

  // Mistral models
  MISTRAL_LARGE: "mistral/mistral-large-latest",
  MISTRAL_MEDIUM: "mistral/mistral-medium-latest",
  MISTRAL_SMALL: "mistral/mistral-small-latest",

  // Nomic embedding models
  NOMIC_EMBED_TEXT: "nomic-embed-text-v1",
  NOMIC_EMBED_IMAGE: "nomic-embed-image-v1",
};

// Define model tiers for fallback with better organization
const MODEL_TIERS = [
  // Tier 1: Most capable, best quality (but expensive)
  [MODELS.CLAUDE_3_OPUS, MODELS.GPT_4, MODELS.MISTRAL_LARGE],

  // Tier 2: Good balance of capability and cost
  [MODELS.CLAUDE_3_SONNET, MODELS.GPT_4_TURBO, MODELS.MISTRAL_MEDIUM],

  // Tier 3: Fast and cost-effective
  [MODELS.CLAUDE_INSTANT, MODELS.GPT_3_5_TURBO, MODELS.MISTRAL_SMALL],
];

// Add dedicated embedding model configuration
const EMBEDDING_MODELS = {
  text: MODELS.NOMIC_EMBED_TEXT,
  image: MODELS.NOMIC_EMBED_IMAGE,
};

// Export the embedding models configuration
export { MODEL_TIERS, EMBEDDING_MODELS };

// Default to a good balance of capability and cost
const DEFAULT_COMPLETION_MODEL = MODELS.CLAUDE_3_SONNET;
const DEFAULT_TEXT_EMBEDDING_MODEL = MODELS.NOMIC_EMBED_TEXT;
const DEFAULT_IMAGE_EMBEDDING_MODEL = MODELS.NOMIC_EMBED_IMAGE;

// Add token tracking
const tokenUsage = {
  total: 0,
  byModel: {},
  byEndpoint: {},
};

// Add embedding dimension constants
const EMBEDDING_DIMENSIONS = {
  NOMIC_TEXT: 768,
  NOMIC_IMAGE: 768,
  OPENAI: 1536,
};

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

    // Early validation and logging
    if (DEBUG) {
      console.log(chalk.cyan("\n🔍 Validating completion request:"));
      console.log(
        chalk.gray("Prompt:"),
        prompt ? `${prompt.substring(0, 100)}...` : "undefined"
      );
      console.log(
        chalk.gray("Messages:"),
        messages ? JSON.stringify(messages, null, 2) : "undefined"
      );
      console.log(chalk.gray("Model:"), model);
      console.log(chalk.gray("Temperature:"), temperature);
      console.log(chalk.gray("Max Tokens:"), maxTokens);
    }

    // Validate input before any API calls
    if (!prompt && (!messages || !Array.isArray(messages))) {
      const error = new Error(
        "Invalid input: Must provide either 'prompt' or 'messages' array"
      );
      console.error(chalk.red("\n❌ Validation Error:"));
      console.error(chalk.red("Error:"), error.message);
      console.error(chalk.yellow("Stack trace:"), error.stack);
      console.error(
        chalk.yellow("Called from:"),
        new Error().stack.split("\n")[2]
      );
      throw error;
    }

    // Check credits before making the API call
    const sufficientCredits = await this.checkOpenRouterCredits();
    if (!sufficientCredits) {
      return null;
    }

    try {
      // Validate and format messages according to OpenRouter's schema
      let finalMessages;
      if (messages && Array.isArray(messages)) {
        // Validate each message in the array has required properties
        finalMessages = messages.map((msg, index) => {
          if (!msg.role || !msg.content) {
            const error = new Error(
              `Message at index ${index} missing required properties. Got: ${JSON.stringify(
                msg
              )}`
            );
            if (DEBUG) {
              console.error(chalk.red("\n❌ Message Validation Error:"));
              console.error(
                chalk.yellow("Full messages array:"),
                JSON.stringify(messages, null, 2)
              );
            }
            throw error;
          }
          if (!["user", "assistant", "system"].includes(msg.role)) {
            const error = new Error(
              `Invalid role "${msg.role}" at index ${index}. Must be "user", "assistant", or "system"`
            );
            if (DEBUG) {
              console.error(chalk.red("\n❌ Role Validation Error:"));
              console.error(
                chalk.yellow("Invalid message:"),
                JSON.stringify(msg, null, 2)
              );
            }
            throw error;
          }
          return {
            role: msg.role,
            content: String(msg.content),
          };
        });
      } else if (prompt) {
        finalMessages = [
          {
            role: "user",
            content: String(prompt),
          },
        ];
      }

      if (DEBUG) {
        console.log(chalk.cyan("\n📤 Sending to OpenRouter API:"));
        console.log(
          chalk.gray("Final Messages:"),
          JSON.stringify(finalMessages, null, 2)
        );
      }

      if (DEBUG) {
        console.log(chalk.gray("\nRequest payload:"));
        console.log(
          chalk.gray(
            JSON.stringify(
              {
                model,
                messages: finalMessages,
                temperature,
                max_tokens: maxTokens,
              },
              null,
              2
            )
          )
        );
      }

      // Find current model tier
      const currentTierIndex = MODEL_TIERS.findIndex((tier) =>
        tier.includes(model)
      );

      // Get available fallback models
      const getFallbackModels = (currentModel) => {
        const currentTierIndex = MODEL_TIERS.findIndex((tier) =>
          tier.includes(currentModel)
        );

        // Get all models from current tier (except the current one)
        // plus all models from next tiers
        const fallbacks = [];

        // First try other models in current tier
        if (currentTierIndex >= 0) {
          fallbacks.push(
            ...MODEL_TIERS[currentTierIndex].filter((m) => m !== currentModel)
          );
        }

        // Then try models from next tiers
        for (let i = currentTierIndex + 1; i < MODEL_TIERS.length; i++) {
          fallbacks.push(...MODEL_TIERS[i]);
        }

        return fallbacks;
      };

      const tryCompletion = async (currentModel, attempt = 1) => {
        try {
          const response = await axios.post(
            `${OPENROUTER_API_URL}/chat/completions`,
            {
              model: currentModel,
              messages: finalMessages,
              temperature,
              max_tokens: maxTokens,
              stream: false,
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": process.env.SITE_URL || "http://localhost:3000",
                "X-Title": "Scrapbook Core",
                "Content-Type": "application/json",
              },
            }
          );

          // Check for overloaded error
          if (response.data?.choices?.[0]?.error?.code === 502) {
            const error = response.data.choices[0].error;
            console.error(
              chalk.yellow(
                `\n⚠️ Model ${currentModel} overloaded (attempt ${attempt})`
              )
            );

            // Get fallback models
            const fallbacks = getFallbackModels(currentModel);

            if (fallbacks.length > 0) {
              const nextModel = fallbacks[0];
              console.log(chalk.blue(`Trying fallback model: ${nextModel}`));
              return tryCompletion(nextModel, attempt + 1);
            } else {
              console.error(chalk.red("❌ No more fallback models available"));
              throw new Error(`All models overloaded or unavailable`);
            }
          }

          // Track token usage from response
          if (response.data?.usage) {
            const { prompt_tokens, completion_tokens, total_tokens } =
              response.data.usage;

            tokenUsage.total += total_tokens;
            tokenUsage.byModel[model] =
              (tokenUsage.byModel[model] || 0) + total_tokens;
            tokenUsage.byEndpoint["chat/completions"] =
              (tokenUsage.byEndpoint["chat/completions"] || 0) + total_tokens;

            if (DEBUG) {
              console.log(chalk.cyan("\n📊 Token Usage for this request:"));
              console.log(chalk.gray(`Prompt tokens: ${prompt_tokens}`));
              console.log(
                chalk.gray(`Completion tokens: ${completion_tokens}`)
              );
              console.log(chalk.gray(`Total tokens: ${total_tokens}`));
              console.log(chalk.gray(`Model: ${model}`));
            }
          }

          if (!response.data?.choices?.[0]?.message?.content) {
            throw new Error(
              `Invalid response format from OpenRouter API: ${JSON.stringify(
                response.data,
                null,
                2
              )}`
            );
          }

          return response.data.choices[0].message.content;
        } catch (error) {
          if (error.response?.data?.choices?.[0]?.error?.code === 502) {
            const fallbacks = getFallbackModels(currentModel);
            if (fallbacks.length > 0) {
              const nextModel = fallbacks[0];
              console.log(
                chalk.blue(`Model ${currentModel} failed, trying: ${nextModel}`)
              );
              return tryCompletion(nextModel, attempt + 1);
            }
          }
          throw error;
        }
      };

      // Start with requested model
      return tryCompletion(model);
    } catch (error) {
      if (DEBUG) {
        console.error(chalk.red("\nOpenRouter API error details:"));
        if (error.response) {
          console.error(chalk.yellow("Status:"), error.response.status);
          console.error(
            chalk.yellow("Response data:"),
            JSON.stringify(error.response.data, null, 2)
          );
          console.error(
            chalk.yellow("Request payload:"),
            JSON.stringify(
              {
                model,
                messages: finalMessages,
                temperature,
                max_tokens: maxTokens,
              },
              null,
              2
            )
          );
          console.error(
            chalk.yellow("Headers:"),
            JSON.stringify(error.response.headers, null, 2)
          );
        } else if (error.request) {
          console.error(
            chalk.yellow("No response received. Request:"),
            error.request
          );
        }
        console.error(chalk.yellow("Full error:"), error);
      }

      // Check if it's an overloaded error from the API response
      if (error.response?.data?.choices?.[0]?.error?.code === 502) {
        const apiError = error.response.data.choices[0].error;
        throw new Error(`OpenRouter API Overloaded: ${apiError.message}`);
      }

      throw new Error(
        `OpenRouter API error: ${JSON.stringify(
          error.response?.data || error.message
        )}`
      );
    }
  },

  async embedding(input, options = {}) {
    if (!process.env.NOMIC_API_KEY) {
      console.warn("Nomic API key not configured - please set NOMIC_API_KEY");
      return null;
    }

    const { type = "text", model } = options;
    const defaultModel =
      type === "image" ? "nomic-embed-vision-v1.5" : "nomic-embed-text-v1.5";

    try {
      let response;

      if (type === "image") {
        // Handle image input
        let imageBuffer;

        if (input.startsWith("http")) {
          // Fetch image from URL
          const imageResponse = await axios.get(input, {
            responseType: "arraybuffer",
          });
          imageBuffer = Buffer.from(imageResponse.data);
        } else {
          // Handle base64 input
          imageBuffer = Buffer.from(input, "base64");
        }

        // Resize image before embedding
        const resizedBuffer = await resizeImageForEmbedding(imageBuffer);

        // Check if resizedBuffer is empty
        if (resizedBuffer.length === 0) {
          console.error("Resized image buffer is empty. Aborting upload.");
          return null; // Handle empty buffer case
        }

        // Create form data
        const form = new FormData();
        form.append("model", model || defaultModel);

        // Create a proper Blob from the buffer
        const blob = new Blob([resizedBuffer], { type: "image/jpeg" });
        form.append("images", blob, "image.jpg");

        if (DEBUG) {
          console.log(
            "Image size after processing:",
            `${(resizedBuffer.length / 1024).toFixed(2)}KB`
          );
        }

        response = await axios.post(
          "https://api-atlas.nomic.ai/v1/embedding/image",
          form,
          {
            headers: {
              "Content-Type": "multipart/form-data",
              Authorization: `Bearer ${process.env.NOMIC_API_KEY}`,
            },
          }
        );
      } else {
        // Text embeddings
        response = await axios.post(
          "https://api-atlas.nomic.ai/v1/embedding/text",
          {
            model: model || defaultModel,
            texts: Array.isArray(input) ? input : [input],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.NOMIC_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (DEBUG) {
        console.log(`📊 ${type.toUpperCase()} Embedding Response:`, {
          model: model || defaultModel,
          dimensions: response.data.embeddings[0]?.length,
          usage: response.data.usage,
        });
      }

      return response.data.embeddings[0];
    } catch (error) {
      console.error(
        `Nomic ${type} embedding error:`,
        error.response?.data || error.message
      );
      if (DEBUG) {
        console.error("Full error:", error);
      }
      return null;
    }
  },

  async checkOpenRouterCredits() {
    if (!this.enabled) {
      return true;
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

      const { usage, limit, is_free_tier, rate_limit } = response.data.data;

      if (usage >= limit) {
        console.error(
          chalk.redBright(
            `OpenRouter credit limit exceeded! Usage: ${usage}, Limit: ${limit}. Processing stopped.`
          )
        );
        return false;
      }

      // Log rate limit info as well
      console.log(
        `OpenRouter credits - Usage: ${usage}, Limit: ${limit}, Type: ${
          is_free_tier ? "Free" : "Paid"
        }, Rate Limit: ${rate_limit?.requests}/${rate_limit?.interval}`
      );
      return true;
    } catch (error) {
      console.error(
        `Error checking OpenRouter credits: ${error.message}. Processing stopped.`
      );
      return false;
    }
  },

  // Add method to get token usage stats
  getTokenUsage() {
    return {
      ...tokenUsage,
      timestamp: new Date().toISOString(),
    };
  },

  // Add method to reset token usage stats
  resetTokenUsage() {
    tokenUsage.total = 0;
    tokenUsage.byModel = {};
    tokenUsage.byEndpoint = {};
  },
};

export async function completion(promptOrOptions, options = {}) {
  // If first argument is a string, treat it as a prompt
  if (typeof promptOrOptions === "string") {
    return service.completion({
      messages: [
        {
          role: "user",
          content: promptOrOptions,
        },
      ],
      ...options,
    });
  }

  // If it's an object with messages, pass it through
  if (promptOrOptions.messages) {
    return service.completion(promptOrOptions);
  }

  // If it's an object with prompt, convert to messages
  if (promptOrOptions.prompt) {
    return service.completion({
      ...promptOrOptions,
      messages: [
        {
          role: "user",
          content: promptOrOptions.prompt,
        },
      ],
    });
  }

  throw new Error(
    "completion() requires either a string prompt or an object with messages/prompt"
  );
}

// Add PROMPTS to exports
export { PROMPTS };

// Export token usage methods
export const getTokenUsage = () => service.getTokenUsage();
export const resetTokenUsage = () => service.resetTokenUsage();

// Export dimensions for use in other files
export { EMBEDDING_DIMENSIONS };

async function resizeImageForEmbedding(imageBuffer) {
  try {
    const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB limit

    // Resize to 1024px width while preserving aspect ratio
    const resized = await sharp(imageBuffer)
      .resize(1024, null, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 95, // Higher quality since we're already at a small size
        progressive: true,
      })
      .toBuffer();

    // If still too large, compress progressively until under limit
    if (resized.length > MAX_FILE_SIZE) {
      let quality = 90;
      let compressed = resized;

      while (compressed.length > MAX_FILE_SIZE && quality > 40) {
        compressed = await sharp(compressed)
          .jpeg({
            quality: quality,
            progressive: true,
          })
          .toBuffer();

        quality -= 10;
      }

      if (compressed.length > MAX_FILE_SIZE) {
        throw new Error(
          `Image too large (${compressed.length} bytes) even after compression`
        );
      }

      if (DEBUG) {
        console.log(
          chalk.gray(
            `Image compressed from ${resized.length} to ${
              compressed.length
            } bytes (quality: ${quality + 10})`
          )
        );
      }

      return compressed;
    }

    return resized;
  } catch (error) {
    console.error("Error resizing image:", error);
    throw error;
  }
}

// Consolidated embedding functions
export async function generateEmbedding(input, options = {}) {
  const { type = "text", maxRetries = 3 } = options;

  if (!process.env.NOMIC_API_KEY) {
    logger.warn("Nomic API key not configured - please set NOMIC_API_KEY");
    return null;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (type === "image") {
        return await getImageEmbedding(input);
      }

      // Text embedding
      const response = await axios.post(
        "https://api-atlas.nomic.ai/v1/embedding/text",
        {
          model: "nomic-embed-text-v1.5",
          texts: Array.isArray(input) ? input : [input],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.NOMIC_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.data?.embeddings?.[0]) {
        throw new Error("Invalid embedding response");
      }

      return response.data.embeddings[0];
    } catch (error) {
      logger.warn(`Embedding attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        logger.error(
          `Failed to generate ${type} embedding after ${maxRetries} attempts`
        );
        return null;
      }

      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.pow(2, attempt - 1))
      );
    }
  }
}
