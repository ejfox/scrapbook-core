import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import axios from 'axios'
import winston from 'winston'
import { SmartRateLimiter } from './shared/smartRateLimiter.mjs'

dotenv.config()

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

// Initialize Supabase with service role for vector operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

// Initialize Smart Rate Limiter for Gemini Vision API
const geminiLimiter = new SmartRateLimiter('gemini', {
  name: 'Gemini Vision API',
  baseConfig: {
    maxConcurrent: 2,
    minTimeBetweenRequests: 1000, // Gemini is cheaper and more generous
  },
})

/**
 * Extract and describe images from different source types using Gemini Vision
 */
export async function processImagesForScrap(scrap) {
  try {
    let imageUrls = []

    switch (scrap.source) {
    case 'arena':
      imageUrls = extractArenaImages(scrap)
      break
    case 'mastodon':
      imageUrls = extractMastodonImages(scrap)
      break
    default:
      logger.debug(`No image processing for source: ${scrap.source} (only Arena and Mastodon supported)`)
      return scrap
    }

    if (!imageUrls.length) {
      logger.debug('No images found to process')
      return scrap
    }

    // Get description for first image using Gemini Vision
    const firstImageUrl = imageUrls[0]
    logger.info(`Getting description for image: ${firstImageUrl}`)

    const description = await getImageDescription(firstImageUrl)
    if (!description) {
      logger.warn('Failed to get image description')
      return scrap
    }

    // Add image data to scrap
    return {
      ...scrap,
      metadata: {
        ...scrap.metadata,
        image_urls: imageUrls,
        primary_image_url: firstImageUrl,
        image_description: description,
      },
    }
  } catch (error) {
    logger.error('Error processing images:', error)
    return scrap
  }
}

// Source-specific image extractors
function extractMastodonImages(scrap) {
  const mediaAttachments = scrap.metadata?.media_attachments || []
  const imageUrls = mediaAttachments
    .filter((media) => media.type === 'image')
    .map((media) => media.url)

  // Log what we found
  logger.info(`Found ${imageUrls.length} images in Mastodon status`)
  return imageUrls
}

function extractArenaImages(scrap) {
  const imageUrls = []

  // Priority order: display > cloudinary > original > screenshot
  if (scrap.metadata?.image_data?.display) {
    imageUrls.push(scrap.metadata.image_data.display)
    logger.info(`Found Arena display image: ${scrap.metadata.image_data.display}`)
  } else if (scrap.metadata?.image_data?.cloudinary_url) {
    imageUrls.push(scrap.metadata.image_data.cloudinary_url)
    logger.info(`Found Arena cloudinary image: ${scrap.metadata.image_data.cloudinary_url}`)
  } else if (scrap.metadata?.image_data?.original_url) {
    imageUrls.push(scrap.metadata.image_data.original_url)
    logger.info(`Found Arena original image: ${scrap.metadata.image_data.original_url}`)
  } else if (scrap.screenshot_url) {
    imageUrls.push(scrap.screenshot_url)
    logger.info(`Found Arena screenshot: ${scrap.screenshot_url}`)
  }

  logger.info(`Found ${imageUrls.length} Arena images`)
  return imageUrls
}

// GitHub image extraction removed - focusing on Arena and Mastodon for now
// Can be re-added later if needed

export async function getImageDescription(imageUrl) {
  return geminiLimiter.schedule(async () => {
    try {
      logger.info(`Getting description for image: ${imageUrl}`)

      // Use Gemini Vision API to describe the image
      const prompt = `Please provide a detailed but concise description of this image. Focus on:
- What is shown in the image (objects, people, scenes, text, etc.)
- The style or type of content (photo, artwork, diagram, screenshot, etc.)  
- Any text or important details visible
- The overall context or purpose of the image

Keep the description informative but under 200 words.`

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
                {
                  inline_data: {
                    mime_type: 'image/jpeg', // Gemini handles various formats
                    data: await getImageAsBase64(imageUrl),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            topK: 32,
            topP: 1,
            maxOutputTokens: 300,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      )

      const description = response.data.candidates?.[0]?.content?.parts?.[0]?.text

      if (description) {
        logger.info(`Generated description: ${description.substring(0, 100)}...`)
        return description.trim()
      } else {
        logger.warn('No description generated by Gemini')
        return null
      }

    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn('Gemini API rate limit exceeded, will retry after cooldown')
        throw error
      }
      logger.error('Error getting image description:', error.message)
      logger.error('Error details:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        url: imageUrl,
      })
      return null
    }
  })
}

async function getImageAsBase64(imageUrl) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
    })

    return Buffer.from(response.data, 'binary').toString('base64')
  } catch (error) {
    logger.error(`Error fetching image from ${imageUrl}:`, error.message)
    throw error
  }
}
