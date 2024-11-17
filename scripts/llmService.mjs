import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import winston from "winston";

dotenv.config();

// Setup Winston logger with better formatting
const logger = winston.createLogger({
  level: process.env.DEBUG === "true" ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: "logs/llm.log",
      format: winston.format.uncolorize()
    })
  ],
});

// Separate rate limits for different services
const rateLimits = {
  openrouter: new Bottleneck({
    maxConcurrent: 5,
    minTime: 1000
  }),
  local: new Bottleneck({
    maxConcurrent: 1,
    minTime: 200
  })
};

// Service configurations with better error handling
const SERVICES = {
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    getHeaders: () => ({
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': process.env.APP_NAME || 'Scrapbook Core'
    }),
    validateResponse: (response) => {
      if (!response.data?.choices?.[0]?.message?.content) {
        throw new Error('Invalid response format from OpenRouter');
      }
    }
  },
  local: {
    baseURL: process.env.LOCAL_LLM_URL || 'http://localhost:1234/v1',
    model: process.env.LOCAL_LLM_MODEL || "Meta-Llama-3-8B-Instruct-imatrix",
    validateResponse: (response) => {
      if (!response.data?.choices?.[0]?.message?.content) {
        throw new Error('Invalid response format from local LLM');
      }
    }
  }
};

// Choose service with fallback support
function chooseService() {
  if (process.env.USE_LOCAL_LLM === "true") {
    try {
      // Test local service availability
      axios.get(SERVICES.local.baseURL + '/health')
      logger.debug("Using local LLaMA model");
      return 'local';
    } catch (error) {
      logger.warn("Local LLM unavailable, falling back to OpenRouter");
      return 'openrouter';
    }
  }
  if (process.env.OPENROUTER_API_KEY) {
    logger.debug("Using OpenRouter");
    return 'openrouter';
  }
  throw new Error("No LLM service configured");
}

// Cache for tags
let cachedTags = null;

// Fetch and cache tags
export async function loadCoreTags() {
  if (cachedTags) return cachedTags;
  
  try {
    const response = await axios.get('https://ejfox.com/tags.json');
    cachedTags = response.data.filter(tag => !tag.startsWith('!')); // Filter out special tags
    logger.debug(`Loaded ${cachedTags.length} core tags`);
    return cachedTags;
  } catch (error) {
    logger.error('Error loading core tags:', error);
    return []; // Return empty array as fallback
  }
}

/**
 * Unified LLM completion function with better error handling and retries
 */
export async function completion({
  messages,
  model = "anthropic/claude-3-sonnet",
  temperature = 0.7,
  max_tokens = 500,
  stream = false,
  retries = 2
}) {
  const service = chooseService();
  
  // Handle async prompts
  const processedMessages = await Promise.all(messages.map(async msg => {
    if (typeof msg.content === 'function') {
      msg.content = await msg.content();
    }
    return msg;
  }));

  logger.debug(`LLM Request (${service}): ${JSON.stringify({ model, temperature, max_tokens })}`);
  
  const config = SERVICES[service];
  const limiter = rateLimits[service];

  async function attempt(retryCount = 0) {
    try {
      const response = await limiter.schedule(() => 
        axios.post(`${config.baseURL}/chat/completions`, {
          messages: processedMessages,
          temperature,
          max_tokens,
          stream,
          model: service === 'local' ? config.model : model
        }, {
          headers: service === 'openrouter' ? config.getHeaders() : {},
          timeout: 30000
        })
      );

      config.validateResponse(response);
      logger.debug(`LLM Response: ${JSON.stringify(response.data)}`);
      return response.data.choices[0].message.content;

    } catch (error) {
      if (retryCount < retries && isRetryableError(error)) {
        logger.warn(`Retry ${retryCount + 1}/${retries} after error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return attempt(retryCount + 1);
      }
      throw enhanceError(error);
    }
  }

  return attempt();
}

// Improved model constants with clear categorization
export const MODELS = {
  SUMMARIZE: {
    default: "anthropic/claude-3-sonnet",
    fast: "anthropic/claude-3-haiku",
    local: "Meta-Llama-3-8B-Instruct-imatrix"
  },
  EXTRACT_LOCATION: {
    default: "anthropic/claude-3-haiku",
    precise: "anthropic/claude-3-opus",
    local: "Meta-Llama-3-8B-Instruct-imatrix"
  },
  EXTRACT_RELATIONSHIPS: {
    default: "anthropic/claude-3-sonnet",
    local: "Meta-Llama-3-8B-Instruct-imatrix"
  },
  GENERATE_TAGS: {
    default: "openai/gpt-3.5-turbo",
    precise: "anthropic/claude-3-haiku",
    local: "Meta-Llama-3-8B-Instruct-imatrix"
  }
};

// Helper functions
function isRetryableError(error) {
  return (
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT' ||
    error.response?.status === 429 ||
    error.response?.status === 503
  );
}

function enhanceError(error) {
  const enhanced = new Error(`LLM Error: ${error.message}`);
  enhanced.originalError = error;
  enhanced.response = error.response?.data;
  enhanced.status = error.response?.status;
  return enhanced;
}

// Export prompts object for reuse
export const PROMPTS = {
  SUMMARIZE: `When analyzing content, your goal is to:
- Extract key information into standalone bullet points
- Preserve technical details, URLs, and specific references
- Focus on unique or significant points
- Keep each point self-contained
- Be concise but precise`,

  EXTRACT_LOCATION: `Extract the most relevant geographic location from the text. 
Return only the location in 'City, State/Region, Country' format. 
If no location is found, return null. 
Be conservative - only return locations you're confident about.`,

  GENERATE_TAGS: async (content) => {
    const tags = await loadCoreTags();
    return `You are tagging content. Choose 2-3 most relevant tags from this list:
${tags.join('\n')}

Content to tag:
${content}

Return only valid tags from the list above, one per line, no explanations.`;
  }
}; 