import dotenv from 'dotenv'
import axios from 'axios'
import { PROMPTS } from './prompts.mjs'
import chalk from 'chalk'
import sharp from 'sharp'
import { FormData } from '@web-std/form-data'
import { File, Blob } from 'node:buffer'
import { processImagesForScrap, getImageDescription } from './imageDescriptions.mjs'
import winston from 'winston'
import sgMail from '@sendgrid/mail'
import puppeteer from 'puppeteer'
import {
  loadConfig,
  getModelConfig,
  getModelForTask,
  getFallbackModels,
  getRateLimitConfig,
  getApiEndpoint,
  getMediaConfig,
  getTimeoutConfig,
  getRetryConfig,
} from '../lib/config.mjs'
import Bottleneck from 'bottleneck'
import { SmartRateLimiter, withSmartRateLimit } from './shared/smartRateLimiter.mjs'
import { trackCost } from './costTracking.mjs'

dotenv.config()

// Setup logger
const logger = winston.createLogger({
  level: process.env.DEBUG === 'true' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`
    }),
  ),
  transports: [new winston.transports.Console()],
})

// Only set SendGrid API key if it's configured
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
}

// Add DEBUG constant
const DEBUG = process.env.DEBUG === 'true'

// Load configuration
const config = loadConfig()

// Initialize smart rate limiters
const openRouterLimiter = new SmartRateLimiter('aiServices', {
  name: 'OpenRouter',
})
const nomicLimiter = new SmartRateLimiter('nomic', {
  name: 'Nomic',
})
const openAILimiter = new SmartRateLimiter('aiServices', {
  name: 'OpenAI',
})

// API configurations from config
const OPENROUTER_API_URL = getApiEndpoint('openrouter')
const NOMIC_API_URL = getApiEndpoint('nomic')

// Add loadCoreTags function that fetches from ejfox.com
export async function loadCoreTags() {
  try {
    const response = await axios.get(getApiEndpoint('coreTags'))
    return response.data
  } catch (error) {
    console.warn('Failed to load core tags:', error.message)
    // Return empty array if fetch fails
    return []
  }
}

// Get default models from config
const DEFAULT_COMPLETION_MODEL = getModelForTask('contentAnalysis')
const DEFAULT_TEXT_EMBEDDING_MODEL = getModelForTask('textEmbedding')
const DEFAULT_IMAGE_EMBEDDING_MODEL = getModelForTask('imageEmbedding')

// Backward compatibility - export legacy MODELS object
export const MODELS = {
  CLAUDE_3_SONNET: DEFAULT_COMPLETION_MODEL,
  NOMIC_EMBED_TEXT: DEFAULT_TEXT_EMBEDDING_MODEL,
  NOMIC_EMBED_IMAGE: DEFAULT_IMAGE_EMBEDDING_MODEL,
}

// Add token tracking
const tokenUsage = {
  total: 0,
  byModel: {},
  byEndpoint: {},
}

// Add embedding dimension constants
const EMBEDDING_DIMENSIONS = {
  NOMIC_TEXT: 768,
  NOMIC_IMAGE: 768,
  OPENAI: 1536,
}

const service = {
  enabled: !!process.env.OPENROUTER_API_KEY,

  async completion({
    prompt,
    messages,
    temperature = 0.7,
    maxTokens = 1000,
    model = DEFAULT_COMPLETION_MODEL,
    scrapId,
    taskType = 'completion',
  }) {
    if (!this.enabled) {
      console.warn(chalk.yellow('OpenRouter API key not configured - skipping AI processing'))
      return null // Gracefully skip instead of crashing
    }

    // Early validation and logging
    if (DEBUG) {
      console.log(chalk.cyan('\n🔍 Validating completion request:'))
      console.log(
        chalk.gray('Prompt:'),
        prompt ? `${prompt.substring(0, 100)}...` : 'undefined',
      )
      console.log(
        chalk.gray('Messages:'),
        messages ? JSON.stringify(messages, null, 2) : 'undefined',
      )
      console.log(chalk.gray('Model:'), model)
      console.log(chalk.gray('Temperature:'), temperature)
      console.log(chalk.gray('Max Tokens:'), maxTokens)
    }

    // Validate input before any API calls
    if (!prompt && (!messages || !Array.isArray(messages))) {
      const error = new Error(
        "Invalid input: Must provide either 'prompt' or 'messages' array",
      )
      console.error(chalk.red('\n❌ Validation Error:'))
      console.error(chalk.red('Error:'), error.message)
      console.error(chalk.yellow('Stack trace:'), error.stack)
      console.error(
        chalk.yellow('Called from:'),
        new Error().stack.split('\n')[2],
      )
      throw error
    }

    // Check credits before making the API call
    const sufficientCredits = await this.checkOpenRouterCredits()
    if (!sufficientCredits) {
      // If OpenRouter has insufficient credits, try OpenAI instead
      if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy') {
        console.log(chalk.yellow('⚠️  OpenRouter credits insufficient, using OpenAI...'))

        // Format messages
        let finalMessages
        if (messages && Array.isArray(messages)) {
          finalMessages = messages.map(msg => ({
            role: msg.role,
            content: String(msg.content),
          }))
        } else if (prompt) {
          finalMessages = [{ role: 'user', content: String(prompt) }]
        }

        try {
          const openaiResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model: 'gpt-4o-mini',
              messages: finalMessages,
              temperature,
              max_tokens: maxTokens,
            },
            {
              headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
              },
            },
          )

          if (openaiResponse.data?.usage) {
            trackCost('gpt-4o-mini', openaiResponse.data.usage, {
              scrapId,
              taskType,
              source: 'openai-primary',
            })
          }

          console.log(chalk.green('✅ OpenAI succeeded'))
          return openaiResponse.data.choices[0].message.content
        } catch (openaiError) {
          console.error(chalk.red(`❌ OpenAI failed: ${openaiError.message}`))
          return null
        }
      }
      return null
    }

    // Declare finalMessages outside try block so it's accessible in catch
    let finalMessages
    try {
      // Validate and format messages according to OpenRouter's schema
      if (messages && Array.isArray(messages)) {
        // Validate each message in the array has required properties
        finalMessages = messages.map((msg, index) => {
          if (!msg.role || !msg.content) {
            const error = new Error(
              `Message at index ${index} missing required properties. Got: ${JSON.stringify(
                msg,
              )}`,
            )
            if (DEBUG) {
              console.error(chalk.red('\n❌ Message Validation Error:'))
              console.error(
                chalk.yellow('Full messages array:'),
                JSON.stringify(messages, null, 2),
              )
            }
            throw error
          }
          if (!['user', 'assistant', 'system'].includes(msg.role)) {
            const error = new Error(
              `Invalid role "${msg.role}" at index ${index}. Must be "user", "assistant", or "system"`,
            )
            if (DEBUG) {
              console.error(chalk.red('\n❌ Role Validation Error:'))
              console.error(
                chalk.yellow('Invalid message:'),
                JSON.stringify(msg, null, 2),
              )
            }
            throw error
          }
          return {
            role: msg.role,
            content: String(msg.content),
          }
        })
      } else if (prompt) {
        finalMessages = [
          {
            role: 'user',
            content: String(prompt),
          },
        ]
      }

      if (DEBUG) {
        console.log(chalk.cyan('\n📤 Sending to OpenRouter API:'))
        console.log(
          chalk.gray('Final Messages:'),
          JSON.stringify(finalMessages, null, 2),
        )
      }

      if (DEBUG) {
        console.log(chalk.gray('\nRequest payload:'))
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
              2,
            ),
          ),
        )
      }

      // Get fallback models from config
      const getFallbackModelsForModel = (currentModel) => {
        const fallbacks = getFallbackModels()
        // Filter out the current model if it's in the fallbacks
        return fallbacks.filter(m => m !== currentModel)
      }

      const tryCompletion = async (currentModel, attempt = 1, useFreeModels = false) => {
        try {
          const makeRequest = async () => {
            return await axios.post(
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
                  'HTTP-Referer': 'https://github.com/ejfox/scrapbook-core',
                  'X-Title': 'Scrapbook Core',
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                  'X-Custom-Auth': 'scrapbook-core',
                  'X-Custom-Model': currentModel,
                },
              },
            )
          }

          // Use smart rate limiter - automatically handles 429s and fallbacks
          const response = await openRouterLimiter.schedule(makeRequest)

          // CRITICAL DEBUG: Log response structure to catch silent failures
          console.log(chalk.magenta(`\n🔍 Response received from ${currentModel}`))
          console.log(chalk.gray('Response structure:'), {
            hasData: !!response.data,
            hasChoices: !!response.data?.choices,
            choicesLength: response.data?.choices?.length,
            hasMessage: !!response.data?.choices?.[0]?.message,
            hasContent: !!response.data?.choices?.[0]?.message?.content,
            contentLength: response.data?.choices?.[0]?.message?.content?.length || 0,
            contentPreview: response.data?.choices?.[0]?.message?.content?.substring(0, 100),
          })

          // Log rate limiter status occasionally for monitoring
          if (attempt === 1 && Math.random() < 0.05) { // 5% chance to log
            logger.info('🔧 OpenRouter limiter status:', openRouterLimiter.getStatus())
          }

          // Check for overloaded error
          if (response.data?.choices?.[0]?.error?.code === 502) {
            const error = response.data.choices[0].error
            console.error(
              chalk.yellow(
                `\n⚠️ Model ${currentModel} overloaded (attempt ${attempt})`,
              ),
            )

            // Get fallback models
            const fallbacks = getFallbackModels(currentModel)

            if (fallbacks.length > 0) {
              const nextModel = fallbacks[0]
              console.log(chalk.blue(`Trying fallback model: ${nextModel}`))
              return tryCompletion(nextModel, attempt + 1)
            } else {
              console.error(chalk.red('❌ No more OpenRouter fallback models available'))

              // Try OpenAI as final fallback
              if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy') {
                console.log(chalk.yellow('⚠️  Trying OpenAI as last resort fallback...'))
                try {
                  const openaiResponse = await axios.post(
                    'https://api.openai.com/v1/chat/completions',
                    {
                      model: 'gpt-4o-mini',
                      messages: finalMessages,
                      temperature,
                      max_tokens: maxTokens,
                    },
                    {
                      headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': 'application/json',
                      },
                    },
                  )

                  if (openaiResponse.data?.usage) {
                    trackCost('gpt-4o-mini', openaiResponse.data.usage, {
                      scrapId,
                      taskType,
                      source: 'openai-fallback',
                    })
                  }

                  console.log(chalk.green('✅ OpenAI fallback succeeded'))
                  return openaiResponse.data.choices[0].message.content
                } catch (openaiError) {
                  console.error(chalk.red(`❌ OpenAI fallback also failed: ${openaiError.message}`))
                }
              }

              return null // Gracefully fail instead of crashing
            }
          }

          // Track token usage from response
          if (response.data?.usage) {
            const { prompt_tokens, completion_tokens, total_tokens } =
              response.data.usage

            tokenUsage.total += total_tokens
            tokenUsage.byModel[model] =
              (tokenUsage.byModel[model] || 0) + total_tokens
            tokenUsage.byEndpoint['chat/completions'] =
              (tokenUsage.byEndpoint['chat/completions'] || 0) + total_tokens

            // Track cost using the new cost tracking service
            const costInfo = trackCost(currentModel, response.data.usage, {
              scrapId,
              taskType,
              source: 'openrouter',
            })

            if (DEBUG) {
              console.log(chalk.cyan('\n📊 Token Usage for this request:'))
              console.log(chalk.gray(`Prompt tokens: ${prompt_tokens}`))
              console.log(
                chalk.gray(`Completion tokens: ${completion_tokens}`),
              )
              console.log(chalk.gray(`Total tokens: ${total_tokens}`))
              console.log(chalk.gray(`Model: ${currentModel}`))
              console.log(chalk.green(`💰 Cost: $${costInfo.totalCost.toFixed(6)}`))
            }
          }

          // CRITICAL: Log the actual response to catch silent failures
          if (!response.data?.choices?.[0]?.message?.content) {
            console.error(chalk.red(`\n❌ Empty response from ${currentModel}`))
            console.error(chalk.yellow('Response data:'), JSON.stringify(response.data, null, 2))
            throw new Error(
              `Invalid response format from OpenRouter API (model: ${currentModel}): ${JSON.stringify(
                response.data,
                null,
                2,
              )}`,
            )
          }

          return response.data.choices[0].message.content
        } catch (error) {
          // Log ALL errors to prevent silent failures
          console.error(chalk.red(`\n⚠️ Error in tryCompletion for ${currentModel}:`))
          console.error(chalk.yellow(`Error message: ${error.message}`))

          // Handle payment errors (402) by falling back to free models
          if (error.response?.status === 402 && !useFreeModels) {
            console.log(chalk.yellow(`💳 Payment required for ${currentModel}, trying free models...`))
            const freeModels = getFallbackModelsForModel(currentModel)
            if (freeModels.length > 0) {
              const freeModel = freeModels[0]
              console.log(chalk.blue(`🆓 Falling back to free model: ${freeModel}`))
              return tryCompletion(freeModel, attempt + 1, true)
            }
          }

          // If free models fail with ANY error (404, 402, etc), try OpenAI
          if (useFreeModels && process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy') {
            console.log(chalk.yellow(`⚠️  Free model failed (${error.response?.status || error.message}), trying OpenAI as fallback...`))
            try {
              const openaiResponse = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                  model: 'gpt-4o-mini',
                  messages: finalMessages,
                  temperature,
                  max_tokens: maxTokens,
                },
                {
                  headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                },
              )

              if (openaiResponse.data?.usage) {
                trackCost('gpt-4o-mini', openaiResponse.data.usage, {
                  scrapId,
                  taskType,
                  source: 'openai-fallback',
                })
              }

              console.log(chalk.green('✅ OpenAI fallback succeeded'))
              return openaiResponse.data.choices[0].message.content
            } catch (openaiError) {
              console.error(chalk.red(`❌ OpenAI fallback failed: ${openaiError.message}`))
              throw error // Throw original error
            }
          }

          // Handle overloaded errors (502)
          if (error.response?.data?.choices?.[0]?.error?.code === 502) {
            const fallbacks = getFallbackModelsForModel(currentModel)
            if (fallbacks.length > 0) {
              const nextModel = fallbacks[0]
              console.log(
                chalk.blue(`Model ${currentModel} overloaded, trying: ${nextModel}`),
              )
              return tryCompletion(nextModel, attempt + 1, useFreeModels)
            }
          }
          throw error
        }
      }

      // Start with requested model
      return tryCompletion(model)
    } catch (error) {
      if (DEBUG) {
        console.error(chalk.red('\nOpenRouter API error details:'))
        if (error.response) {
          console.error(chalk.yellow('Status:'), error.response.status)
          console.error(
            chalk.yellow('Response data:'),
            JSON.stringify(error.response.data, null, 2),
          )
          console.error(
            chalk.yellow('Request payload:'),
            JSON.stringify(
              {
                model,
                messages: finalMessages || messages,
                temperature,
                max_tokens: maxTokens,
              },
              null,
              2,
            ),
          )
          console.error(
            chalk.yellow('Headers:'),
            JSON.stringify(error.response.headers, null, 2),
          )
        } else if (error.request) {
          console.error(
            chalk.yellow('No response received. Request:'),
            error.request,
          )
        }
        console.error(chalk.yellow('Full error:'), error)
      }

      // Check if it's an overloaded error from the API response
      if (error.response?.data?.choices?.[0]?.error?.code === 502) {
        const apiError = error.response.data.choices[0].error
        console.error(chalk.red(`OpenRouter API Overloaded: ${apiError.message}`))
      }

      // LAST RESORT: Try OpenAI as fallback when all OpenRouter options fail
      if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy') {
        console.log(chalk.yellow('⚠️  All OpenRouter attempts failed, trying OpenAI as fallback...'))

        try {
          const openaiResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model: 'gpt-4o-mini',
              messages: finalMessages || messages || [{ role: 'user', content: prompt }],
              temperature,
              max_tokens: maxTokens,
            },
            {
              headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
              },
            },
          )

          // Track OpenAI cost
          if (openaiResponse.data?.usage) {
            trackCost('gpt-4o-mini', openaiResponse.data.usage, {
              scrapId,
              taskType,
              source: 'openai-fallback',
            })
          }

          console.log(chalk.green('✅ OpenAI fallback succeeded'))
          return openaiResponse.data.choices[0].message.content
        } catch (openaiError) {
          console.error(chalk.red(`❌ OpenAI fallback also failed: ${openaiError.message}`))
        }
      }

      console.error(chalk.red('All completion attempts failed - returning null'))
      return null // Gracefully fail instead of crashing
    }
  },

  async embedding(input, options = {}) {
    if (!process.env.NOMIC_API_KEY) {
      console.warn('Nomic API key not configured - please set NOMIC_API_KEY')
      return null
    }

    const { type = 'text', model } = options
    const defaultModel =
      type === 'image' ? 'nomic-embed-vision-v1.5' : 'nomic-embed-text-v1.5'

    try {
      let response

      if (type === 'image') {
        // Handle image input
        let imageBuffer

        if (input.startsWith('http')) {
          // Fetch image from URL
          const imageResponse = await axios.get(input, {
            responseType: 'arraybuffer',
          })
          imageBuffer = Buffer.from(imageResponse.data)
        } else {
          // Handle base64 input
          imageBuffer = Buffer.from(input, 'base64')
        }

        // Resize image before embedding
        const resizedBuffer = await resizeImageForEmbedding(imageBuffer)

        // Check if resizedBuffer is empty
        if (resizedBuffer.length === 0) {
          console.error('Resized image buffer is empty. Aborting upload.')
          return null // Handle empty buffer case
        }

        // Create form data
        const form = new FormData()
        form.append('model', 'nomic-embed-vision-v1.5')

        // Create a proper Blob from the buffer
        const blob = new Blob([resizedBuffer], { type: 'image/jpeg' })
        form.append('images', blob, 'image.jpg')

        if (DEBUG) {
          console.log(
            'Image size after processing:',
            `${(resizedBuffer.length / 1024).toFixed(2)}KB`,
          )
        }

        const makeNomicImageRequest = () => axios.post(
          'https://api-atlas.nomic.ai/v1/embedding/image',
          form,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
              Authorization: `Bearer ${process.env.NOMIC_API_KEY}`,
            },
          },
        )

        response = await nomicLimiter.schedule(makeNomicImageRequest)
      } else {
        // Text embeddings
        const makeNomicTextRequest = () => axios.post(
          'https://api-atlas.nomic.ai/v1/embedding/text',
          {
            model: 'nomic-embed-text-v1.5',
            texts: Array.isArray(input) ? input : [input],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.NOMIC_API_KEY}`,
              'Content-Type': 'application/json',
            },
          },
        )

        response = await nomicLimiter.schedule(makeNomicTextRequest)
      }

      if (DEBUG) {
        console.log(`📊 ${type.toUpperCase()} Embedding Response:`, {
          model: model || defaultModel,
          dimensions: response.data.embeddings[0]?.length,
          usage: response.data.usage,
        })
      }

      return response.data.embeddings[0]
    } catch (error) {
      console.error(
        `Nomic ${type} embedding error:`,
        error.response?.data || error.message,
      )
      if (DEBUG) {
        console.error('Full error:', error)
      }
      return null
    }
  },

  async checkOpenRouterCredits() {
    if (!this.enabled) {
      return true
    }

    try {
      const response = await axios.get(`${OPENROUTER_API_URL}/auth/key`, {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://github.com/ejfox/scrapbook-core',
          'X-Title': 'Scrapbook Core',
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Custom-Auth': 'scrapbook-core',
        },
      })

      if (!response.data?.data) {
        console.error(chalk.red('Invalid response format from OpenRouter API - returning false'))
        return false // Gracefully fail instead of crashing
      }

      const { usage, limit, is_free_tier, rate_limit } = response.data.data

      if (limit !== null && usage >= limit) {
        console.error(
          chalk.redBright(
            `OpenRouter credit limit exceeded! Usage: ${usage}, Limit: ${limit}. Processing stopped.`,
          ),
        )
        return false
      }

      // Log rate limit info as well
      console.log(
        `OpenRouter credits - Usage: ${usage}, Limit: ${limit}, Type: ${
          is_free_tier ? 'Free' : 'Paid'
        }, Rate Limit: ${rate_limit?.requests}/${rate_limit?.interval}`,
      )
      return true
    } catch (error) {
      console.error(
        `Error checking OpenRouter credits: ${error.message}. Processing stopped.`,
      )
      return false
    }
  },

  // Add method to get token usage stats
  getTokenUsage() {
    return {
      ...tokenUsage,
      timestamp: new Date().toISOString(),
    }
  },

  // Add method to reset token usage stats
  resetTokenUsage() {
    tokenUsage.total = 0
    tokenUsage.byModel = {}
    tokenUsage.byEndpoint = {}
  },
}

export async function completion(promptOrOptions, options = {}) {
  // If first argument is a string, treat it as a prompt
  if (typeof promptOrOptions === 'string') {
    return service.completion({
      messages: [
        {
          role: 'user',
          content: promptOrOptions,
        },
      ],
      ...options,
    })
  }

  // If it's an object with messages, pass it through
  if (promptOrOptions.messages) {
    return service.completion(promptOrOptions)
  }

  // If it's an object with prompt, convert to messages
  if (promptOrOptions.prompt) {
    return service.completion({
      ...promptOrOptions,
      messages: [
        {
          role: 'user',
          content: promptOrOptions.prompt,
        },
      ],
    })
  }

  throw new Error(
    'completion() requires either a string prompt or an object with messages/prompt',
  )
}

// Add PROMPTS to exports
export { PROMPTS }

// Export token usage methods
export const getTokenUsage = () => service.getTokenUsage()
export const resetTokenUsage = () => service.resetTokenUsage()

// Export dimensions for use in other files
export { EMBEDDING_DIMENSIONS }

async function resizeImageForEmbedding(imageBuffer) {
  try {
    const MAX_FILE_SIZE = 4 * 1024 * 1024 // 4MB limit

    // Resize to 1024px width while preserving aspect ratio
    const resized = await sharp(imageBuffer)
      .resize(1024, null, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 95, // Higher quality since we're already at a small size
        progressive: true,
      })
      .toBuffer()

    // If still too large, compress progressively until under limit
    if (resized.length > MAX_FILE_SIZE) {
      let quality = 90
      let compressed = resized

      while (compressed.length > MAX_FILE_SIZE && quality > 40) {
        compressed = await sharp(compressed)
          .jpeg({
            quality: quality,
            progressive: true,
          })
          .toBuffer()

        quality -= 10
      }

      if (compressed.length > MAX_FILE_SIZE) {
        throw new Error(
          `Image too large (${compressed.length} bytes) even after compression`,
        )
      }

      if (DEBUG) {
        console.log(
          chalk.gray(
            `Image compressed from ${resized.length} to ${
              compressed.length
            } bytes (quality: ${quality + 10})`,
          ),
        )
      }

      return compressed
    }

    return resized
  } catch (error) {
    console.error('Error resizing image:', error)
    throw error
  }
}

// Consolidated embedding functions
export async function generateEmbedding(input, options = {}) {
  const { type = 'text', maxRetries = 3, scrapId, taskType = 'embedding' } = options

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy') {
    logger.warn('OpenAI API key not configured or invalid - please set a valid OPENAI_API_KEY')
    return null
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Use OpenAI text-embedding-3-small with 1536 dimensions to match Supabase
      const makeOpenAIRequest = () => axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          model: 'text-embedding-3-small',
          input: Array.isArray(input) ? input : [input],
          dimensions: 1536,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      )

      const response = await openAILimiter.schedule(makeOpenAIRequest)

      if (!response.data?.data?.[0]?.embedding) {
        console.error(chalk.red('Invalid embedding response - returning null'))
        return null
      }

      // Track cost for embedding
      if (response.data?.usage) {
        trackCost('text-embedding-3-small', response.data.usage, {
          scrapId,
          taskType,
          source: 'openai',
        })
      }

      return response.data.data[0].embedding
    } catch (error) {
      logger.warn(`Embedding attempt ${attempt} failed:`, error.message || error.response?.data || error)

      if (attempt === maxRetries) {
        logger.error(
          `Failed to generate ${type} embedding after ${maxRetries} attempts`,
        )
        return null
      }

      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)),
      )
    }
  }
}

async function sendCreditAlertEmail(error) {
  const msg = {
    to: process.env.ALERT_EMAIL,
    from: process.env.ALERT_EMAIL_FROM,
    subject: '⚠️ Scrapbook AI Credits Depleted',
    text: `OpenRouter credits have been depleted.\n\nError: ${error.message}\n\nProcessing has been halted.`,
    html: `<h1>⚠️ OpenRouter Credits Depleted</h1>
          <p>Processing has been halted due to insufficient credits.</p>
          <pre>${error.message}</pre>`,
  }

  try {
    await sgMail.send(msg)
    logger.info('📧 Credit alert email sent')
  } catch (err) {
    logger.error('Failed to send credit alert email:', err)
  }
}

class CreditError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CreditError'
  }
}

async function tryCompletion(prompt, options = {}) {
  try {
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_REFERER,
        },
        body: JSON.stringify({
          model: options.model || DEFAULT_COMPLETION_MODEL,
          messages: Array.isArray(prompt) ? prompt : [prompt],
        }),
      },
    )

    const data = await response.json()

    if (data.error) {
      // Check specifically for credit-related errors
      if (data.error.code === 402 || data.error.message.includes('credits')) {
        const creditError = new CreditError(data.error.message)
        await sendCreditAlertEmail(creditError)
        throw creditError // Let the caller handle graceful shutdown
      }
      throw new Error(
        `Invalid response format from OpenRouter API: ${JSON.stringify(
          data,
          null,
          2,
        )}`,
      )
    }

    return data
  } catch (error) {
    if (error instanceof CreditError) {
      throw error // Let it propagate up
    }
    logger.error('Error during completion:', error)
    throw error
  }
}

// Add a URL validation and sanitization function
function sanitizeUrl(url) {
  try {
    // Try to construct a URL object to validate
    const urlObj = new URL(url)

    // Ensure protocol is http or https
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Invalid protocol')
    }

    // Encode any special characters in the path, query, and hash
    const sanitizedPath = encodeURI(urlObj.pathname)
    const sanitizedSearch = urlObj.search.replace(/\s/g, '%20')
    const sanitizedHash = urlObj.hash.replace(/\s/g, '%20')

    // Reconstruct the URL with encoded components
    return `${urlObj.protocol}//${urlObj.host}${sanitizedPath}${sanitizedSearch}${sanitizedHash}`
  } catch (error) {
    console.warn(`Invalid URL: ${url}`, error.message)
    return null
  }
}

// Update the screenshot function with better URL handling
async function takeScreenshot(url) {
  try {
    // Handle URL encoding more carefully
    const urlObj = new URL(url)
    const encodedUrl = urlObj.toString()

    const browser = await puppeteer.launch({
      // Note: getChromeExecutablePath is not defined - using default Chrome
      // executablePath: await getChromeExecutablePath(),
      args: ['--no-sandbox'],
      headless: 'new',
    })

    const page = await browser.newPage()

    // Add error handling for navigation
    await page.goto(encodedUrl).catch((e) => {
      console.warn(`Navigation failed: ${e.message}`)
      throw e
    })

    const screenshot = await page.screenshot({ type: 'jpeg' })
    await browser.close()
    return screenshot
  } catch (error) {
    console.error(`Screenshot failed for ${url}:`, error.message)
    return null
  }
}
