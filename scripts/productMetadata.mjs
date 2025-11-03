/**
 * Product Metadata Extraction
 * Extracts cost, weight, and other product specifications from content
 */

import { completion } from './llmService.mjs'
import { getModelForTask } from '../lib/config.mjs'

/**
 * Extract product metadata (cost, weight, etc.) from content
 */
export async function extractProductMetadata(content, url, title, options = {}) {
  const { scrapId, taskType = 'product_metadata' } = options

  // Only run if content seems product-related
  const urlLower = (url || '').toLowerCase()
  const titleLower = (title || '').toLowerCase()
  const contentLower = (content || '').toLowerCase()

  const isProduct =
    urlLower.match(/\/(product|buy|shop|store|item|review)\//) ||
    contentLower.match(/\$([\d,]+\.?\d*)/) || // Price patterns
    contentLower.match(/(\d+\.?\d*)\s*(lbs?|kg|grams?|oz|ounces?)/) || // Weight patterns
    titleLower.match(/(review|unboxing|specs?|specifications?)/)

  if (!isProduct) {
    return null
  }

  const prompt = `Analyze this content and extract product metadata if present.

Content:
${content?.substring(0, 2000)}
${title ? `\nTitle: ${title}` : ''}
${url ? `\nURL: ${url}` : ''}

Extract ONLY if explicitly mentioned:
- cost (price in USD, convert if needed)
- weight (in lbs, convert if needed)
- dimensions (length x width x height in inches)
- model_number
- manufacturer
- release_date

Return JSON ONLY with fields that were found:
{
  "cost": 49.99,
  "weight": 2.5,
  "dimensions": "10 x 6 x 2",
  "model_number": "XYZ-123",
  "manufacturer": "Acme Corp",
  "release_date": "2024-03-15"
}

If NO product data found, return: {}`

  try {
    const response = await completion({
      messages: [
        { role: 'system', content: 'You extract structured product metadata from text. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      maxTokens: 200,
      model: getModelForTask('superCheap'),
      scrapId,
      taskType,
    })

    if (!response) return null

    // Parse JSON from response
    const match = response.match(/\{.*?\}/s)
    if (!match) return null

    const metadata = JSON.parse(match[0])

    // Only return if we extracted something useful
    if (Object.keys(metadata).length === 0) {
      return null
    }

    return metadata
  } catch (error) {
    console.error('Error extracting product metadata:', error.message)
    return null
  }
}
