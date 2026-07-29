// aiGeolocation.mjs

import axios from 'axios'
import Bottleneck from 'bottleneck'
import cheerio from 'cheerio'
import { completion, MODELS, PROMPTS } from './llmService.mjs'
import { getModelForTask } from '../lib/config.mjs'
import { isThinForLocation } from '../lib/contentQuality.mjs'

const DEBUG = process.env.DEBUG === 'true'
function log(...args) {
  if (DEBUG) console.log(...args)
}

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
})

export async function extractLocation(content, options = {}) {
  const { url, rawHtml } = options

  log('\n[LOCATION EXTRACTION]')
  log('Processing content:', content?.substring(0, 100) + '...')
  log('URL:', url)
  log('Raw HTML available:', !!rawHtml)

  if (!content || typeof content !== 'string') {
    log('❌ No valid content provided')
    return {
      location: null,
      latitude: null,
      longitude: null,
      metadata: {
        otherLocations: [],
      },
    }
  }

  try {
    // Clean and prepare content
    const cleanContent = content
      .replace(/<[^>]*>/g, ' ') // Remove HTML
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()

    // Not enough real text to ground a location. Bailing here prevents the model
    // from fabricating a confident city out of a near-empty page (e.g. 74 chars
    // of nav → "Paris, France"). Better to return no location than a made-up one.
    if (isThinForLocation(cleanContent)) {
      log(`❌ Content too thin for location (${cleanContent.length} chars) — abstaining`)
      return { location: null, latitude: null, longitude: null, metadata: { otherLocations: [] } }
    }

    if (!cleanContent) {
      log('❌ No content after cleaning')
      return {
        location: null,
        latitude: null,
        longitude: null,
        metadata: {
          otherLocations: [],
        },
      }
    }

    log('Cleaned content length:', cleanContent.length)

    // Extract additional context from URL and metadata
    let urlContext = ''
    let metaInfo = ''

    if (url) {
      urlContext = `URL: ${url}\n`

      // Extract domain hints
      const domainInfo = extractDomainInfo(url)
      if (domainInfo.domain) {
        urlContext += `Domain: ${domainInfo.domain}.${domainInfo.tld}\n`
      }

      // Check for location-related URL segments
      const locationHints = extractUrlLocationHints(url)
      if (locationHints.length > 0) {
        urlContext += `URL Location Hints: ${locationHints.join(', ')}\n`
      }
    }

    if (rawHtml) {
      metaInfo = extractMetaInfo(rawHtml)
      if (metaInfo) {
        metaInfo = `Metadata:\n${metaInfo}\n`
      }
    }

    // Combine all context for comprehensive analysis
    const enhancedContent = `${urlContext}${metaInfo}
Content to analyze:
${cleanContent}`

    log('🤖 Sending to LLM for location extraction...')
    const locations = await extractLocationsFromString(enhancedContent)

    // If no locations found, return early
    if (
      !locations.primary &&
      (!locations.others || locations.others.length === 0)
    ) {
      log('ℹ️ No locations found in content')
      return {
        location: null,
        latitude: null,
        longitude: null,
        metadata: {
          otherLocations: [],
        },
      }
    }

    // Get coordinates only if we have locations
    let primaryCoords = { latitude: null, longitude: null }
    let otherLocationsWithCoords = []

    if (locations.primary && process.env.OPENCAGE_API_KEY) {
      log('🌍 Getting coordinates for primary location...')
      primaryCoords = await limiter.schedule(() =>
        reverseGeocode(locations.primary),
      )
    }

    if (locations.others?.length > 0 && process.env.OPENCAGE_API_KEY) {
      otherLocationsWithCoords = await Promise.all(
        locations.others.map(async (loc) => ({
          location: loc,
          ...(await limiter.schedule(() => reverseGeocode(loc))),
        })),
      )
    }

    // Only keep locations that successfully geocoded (have coordinates)
    // If primary location didn't geocode, try to use first other location that did
    let finalLocation = locations.primary
    let finalLat = primaryCoords.latitude
    let finalLon = primaryCoords.longitude

    // Filter other locations to only those with coordinates
    const validOthers = otherLocationsWithCoords.filter(
      (l) => l.latitude && l.longitude,
    )

    // If primary didn't geocode but we have valid others, use the first one as primary
    if (!finalLat && !finalLon && validOthers.length > 0) {
      log(`⚠️ Primary location "${locations.primary}" failed to geocode, using "${validOthers[0].location}" instead`)
      finalLocation = validOthers[0].location
      finalLat = validOthers[0].latitude
      finalLon = validOthers[0].longitude
      validOthers.shift() // Remove it from others since it's now primary
    }

    // If primary didn't geocode and no valid others, set location to null
    if (!finalLat && !finalLon) {
      log('⚠️ No locations successfully geocoded')
      finalLocation = null
    }

    return {
      location: finalLocation,
      latitude: finalLat,
      longitude: finalLon,
      metadata: {
        otherLocations: validOthers,
      },
    }
  } catch (error) {
    console.error('❌ Error in location extraction:', error)
    return {
      location: null,
      latitude: null,
      longitude: null,
      metadata: {
        otherLocations: [],
      },
    }
  }
}

/**
 * Attempt to recover truncated location JSON
 * @param {string} jsonStr - Potentially truncated JSON string
 * @returns {string} Recovered JSON string
 */
function attemptLocationJsonRecovery(jsonStr) {
  // Count brackets and braces
  const openBrackets = (jsonStr.match(/\[/g) || []).length
  const closeBrackets = (jsonStr.match(/\]/g) || []).length
  const openBraces = (jsonStr.match(/\{/g) || []).length
  const closeBraces = (jsonStr.match(/\}/g) || []).length

  const missingBrackets = openBrackets - closeBrackets
  const missingBraces = openBraces - closeBraces

  // Remove incomplete trailing content
  let recovered = jsonStr
  const lastComma = jsonStr.lastIndexOf(',')
  const lastCloseBrace = jsonStr.lastIndexOf('}')

  // If there's content after the last complete element, remove it
  if (lastComma > lastCloseBrace) {
    recovered = jsonStr.substring(0, lastComma)
  }

  // Add missing closing brackets/braces
  recovered += ']'.repeat(missingBrackets)
  recovered += '}'.repeat(missingBraces)

  return recovered
}

/**
 * Aggressive recovery for location JSON
 * @param {string} response - Raw AI response
 * @returns {Object|null} Recovered locations object or null
 */
function attemptAggressiveLocationRecovery(response) {
  try {
    // Try to extract just the locations array
    const locationsMatch = response.match(/"locations"\s*:\s*\[([\s\S]*?)(?:\]|$)/)

    if (!locationsMatch) {
      return null
    }

    const result = {
      locations: [],
      analysis_notes: 'Recovered from truncated response',
    }

    // Extract individual location objects
    const locationsText = locationsMatch[1]
    const locationMatches = locationsText.matchAll(/\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*\}/g)

    for (const match of locationMatches) {
      try {
        const location = JSON.parse(match[0])
        if (location.name) {
          result.locations.push(location)
        }
      } catch (e) {
        // Skip invalid location
      }
    }

    // Only return if we recovered at least one location
    if (result.locations.length > 0) {
      return result
    }

    return null
  } catch (error) {
    return null
  }
}

async function extractLocationsFromString(content) {
  try {
    // Create properly formatted messages array with enhanced instructions
    const messages = [
      {
        role: 'system',
        content: `You are an expert at identifying REAL GEOGRAPHIC LOCATIONS in formats that geocoding APIs can easily resolve. You ONLY output valid JSON with no explanations.

WHEN TO ABSTAIN (this is the most important rule):
- Only extract a location if the content is genuinely ABOUT or SET IN a real physical place.
- Do NOT extract incidental mentions, an author's byline city, a dateline, a company HQ mentioned in passing, or the setting of a FICTIONAL/game/online work.
- Most content has NO real geographic subject. When nothing is genuinely specified, return an empty "locations" array — that is the correct, expected answer.
- If you are not sure the place is the actual subject, leave it out.

CRITICAL: Format locations for maximum geocodability:
- Cities: Include state/country (e.g., "San Francisco, California", "Tokyo, Japan", "Paris, France")
- Neighborhoods: Include city and state/country (e.g., "Brooklyn, New York", "Shibuya, Tokyo, Japan")
- Landmarks: Include city/country (e.g., "Eiffel Tower, Paris, France", "Central Park, New York")
- Addresses: Full street address with city, state
- Regions: Use official names (e.g., "California, USA", "Bavaria, Germany")
- Countries: Full country names (e.g., "United States", "Japan", "France")

ALWAYS PREFER:
- "City, State, Country" format when possible
- More specific > less specific (e.g., "Austin, Texas" > "Texas")
- Full names > abbreviations (e.g., "New York" > "NY")
- Official place names > colloquialisms

DO NOT EXTRACT:
- Social media platforms (Reddit, Twitter, Facebook, Instagram, GitHub, YouTube, TikTok, LinkedIn)
- Website names or URLs (.com, .org, http://, etc.)
- Company/brand names without location context
- Online platforms or services
- Anything that isn't a physical place on Earth`,
      },
      {
        role: 'user',
        content: `Extract ONLY real geographic locations in the most geocodable format possible. Return ONLY this JSON:

{
  "locations": [
    {
      "name": "Location Name, City/State, Country (formatted for geocoding)",
      "type": "city|neighborhood|landmark|address|region|country",
      "context": "how it was mentioned",
      "confidence": 0.9
    }
  ],
  "analysis_notes": "what was found"
}

FORMATTING RULES:
- Use "City, State" or "City, Country" format whenever possible
- Include geographic context (state/country) to help geocoding
- Be specific and unambiguous
- Confidence: 0.9-1.0 for clear city/country, 0.6-0.8 for regions, 0.3-0.5 for ambiguous
- If uncertain whether something is geocodable, LEAVE IT OUT
- Return empty array if no clear geographic locations exist
- ONLY return the JSON, nothing else

Source material:
${content}`,
      },
    ]

    const response = await completion({
      messages,
      temperature: 0.3,
      maxTokens: 1000,
      model: getModelForTask('geolocation'),
    })

    if (!response) {
      log('❌ No response from LLM')
      return { primary: null, others: [] }
    }

    try {
      // Clean the response to extract only the JSON
      const cleanResponse = (text) => {
        // Remove markdown code blocks if present
        if (text.includes('```')) {
          const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
          if (codeBlockMatch) {
            text = codeBlockMatch[1].trim()
          }
        }

        // Remove any text before the first {
        const jsonStart = text.indexOf('{')
        // Remove any text after the last }
        const jsonEnd = text.lastIndexOf('}') + 1

        if (jsonStart === -1 || jsonEnd === 0) {
          log('❌ No JSON found in response')
          return null
        }

        let jsonStr = text.slice(jsonStart, jsonEnd)

        // Check if JSON is truncated and try to recover
        if (!jsonStr.endsWith('}')) {
          log('⚠️ Location JSON appears truncated, attempting recovery...')
          jsonStr = attemptLocationJsonRecovery(jsonStr)
        }

        return jsonStr
      }

      // Get clean JSON string
      const jsonStr = cleanResponse(response)
      if (!jsonStr) {
        return { primary: null, others: [] }
      }

      // Parse the cleaned JSON
      let parsed
      try {
        parsed = JSON.parse(jsonStr)
      } catch (parseError) {
        // Try aggressive recovery
        log('⚠️ First parse failed, attempting aggressive recovery...')
        const recovered = attemptAggressiveLocationRecovery(response)
        if (recovered) {
          parsed = recovered
        } else {
          throw parseError
        }
      }

      if (!parsed.locations || !Array.isArray(parsed.locations)) {
        log('❌ Invalid locations array in response')
        return { primary: null, others: [], analysis_notes: parsed.analysis_notes || 'Invalid response format' }
      }

      // Only accept genuine geographic place types. Rejects the model coercing
      // non-places (years, "world", fictional settings) into the locations array.
      const GEO_TYPES = new Set([
        'city', 'neighborhood', 'landmark', 'address', 'region', 'country',
      ])

      // Validate and filter locations by confidence threshold
      const validLocations = parsed.locations
        .filter((loc) =>
          loc &&
          typeof loc === 'object' &&
          typeof loc.name === 'string' &&
          loc.name.trim().length > 0 &&
          GEO_TYPES.has(String(loc.type || '').toLowerCase()) && // must be a real place type
          (loc.confidence || 0) >= 0.7, // Require high confidence; abstain on incidental/uncertain mentions
        )
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0)) // Sort by confidence descending

      if (validLocations.length === 0) {
        log('❌ No valid locations found above confidence threshold')
        return { primary: null, others: [], analysis_notes: parsed.analysis_notes || 'No locations above confidence threshold' }
      }

      // Get primary location (highest confidence) and others
      const [primary, ...others] = validLocations

      if (DEBUG) {
        log('✅ Extracted locations:')
        log('Primary:', primary)
        log('Others:', others)
        log('Analysis notes:', parsed.analysis_notes)
      }

      return {
        primary: primary.name,
        others: others.map((loc) => loc.name),
        analysis_notes: parsed.analysis_notes,
        all_locations: validLocations, // Keep full location data for debugging
      }
    } catch (error) {
      console.error('Error parsing location response:', error)
      if (DEBUG) {
        console.error('Raw response:', response)
        // cleanResponse is not available in this catch block scope
      }
      return { primary: null, others: [], analysis_notes: 'JSON parsing failed', error: error.message }
    }
  } catch (error) {
    console.error('Error extracting locations:', error)
    return { primary: null, others: [], analysis_notes: 'Location extraction failed', error: error.message }
  }
}

function extractDomainInfo(url) {
  try {
    const parsedUrl = new URL(url)
    const domainParts = parsedUrl.hostname.split('.')
    return {
      domain: domainParts[domainParts.length - 2] || '',
      tld: domainParts[domainParts.length - 1] || '',
    }
  } catch (error) {
    console.error('Error parsing URL:', error)
    return { domain: '', tld: '' }
  }
}

function extractMetaInfo(rawHtml) {
  try {
    const $ = cheerio.load(rawHtml)
    let metaInfo = ''

    // Look for location-related meta tags
    const locationTags = [
      'place:location',
      'geo.placename',
      'geo.position',
      'geo.region',
      'og:locality',
      'og:region',
      'og:country',
      'twitter:place',
      'geo:lat',
      'geo:lon',
      'geo:location',
      'location',
      'address',
    ]

    $('meta').each((i, elem) => {
      const name = $(elem).attr('name') || $(elem).attr('property')
      const content = $(elem).attr('content')
      if (name && content && locationTags.some((tag) => name.toLowerCase().includes(tag.toLowerCase()))) {
        metaInfo += `${name}: ${content}\n`
      }
    })

    // Also check for structured data with location info
    $('script[type="application/ld+json"]').each((i, elem) => {
      try {
        const jsonData = JSON.parse($(elem).html())
        if (jsonData.address || jsonData.location || jsonData.geo) {
          metaInfo += `Structured Data: ${JSON.stringify({
            address: jsonData.address,
            location: jsonData.location,
            geo: jsonData.geo,
          })}\n`
        }
      } catch (e) {
        // Ignore JSON parsing errors
      }
    })

    return metaInfo
  } catch (error) {
    console.error('Error parsing HTML:', error)
    return ''
  }
}

function extractUrlLocationHints(url) {
  if (!url) return []

  const hints = []
  const lowerUrl = url.toLowerCase()

  // Check for common location-related path segments
  const locationSegments = [
    'local', 'city', 'region', 'metro', 'area', 'location',
    'weather', 'news', 'events', 'places', 'venue', 'address',
  ]

  for (const segment of locationSegments) {
    if (lowerUrl.includes(`/${segment}/`) || lowerUrl.includes(`-${segment}-`)) {
      hints.push(segment)
    }
  }

  // Check for geographic TLDs
  const geoTlds = ['.us', '.uk', '.ca', '.au', '.fr', '.de', '.jp', '.in']
  for (const tld of geoTlds) {
    if (lowerUrl.includes(tld)) {
      hints.push(`geographic domain (${tld})`)
    }
  }

  // Check for common location-indicating domains
  const locationDomains = [
    'patch.com', 'weather.com', 'yelp.com', 'foursquare.com',
    'maps.google.com', 'local.', 'city.', '.gov',
  ]

  for (const domain of locationDomains) {
    if (lowerUrl.includes(domain)) {
      hints.push(`location-focused domain (${domain})`)
    }
  }

  return [...new Set(hints)] // Remove duplicates
}

/**
 * Validate that a location string is actually a geographic place
 * and not a social media platform or website
 * @param {string} location - Location string to validate
 * @returns {boolean} True if location is valid for geocoding
 */
function isValidGeographicLocation(location) {
  if (!location || typeof location !== 'string') {
    return false
  }

  const lowerLocation = location.toLowerCase()

  // Blacklist of non-geographic entities
  const blacklist = [
    // Social media platforms
    'reddit', 'twitter', 'facebook', 'instagram', 'linkedin',
    'youtube', 'tiktok', 'snapchat', 'pinterest', 'tumblr',
    // Development platforms
    'github', 'gitlab', 'bitbucket', 'stackoverflow', 'codepen',
    // Generic web indicators
    '.com', '.org', '.net', '.io', '.dev', '.co', 'http://', 'https://',
    // Common non-geographic terms
    'online', 'virtual', 'digital', 'web', 'internet', 'cloud',
    'app', 'website', 'platform', 'service', 'network',
  ]

  // Check if location contains any blacklisted terms
  for (const term of blacklist) {
    if (lowerLocation.includes(term)) {
      log(`⚠️ Filtered out non-geographic location: "${location}" (contains "${term}")`)
      return false
    }
  }

  // Must have at least 2 characters
  if (location.trim().length < 2) {
    return false
  }

  return true
}

async function reverseGeocode(location) {
  if (!location || !process.env.OPENCAGE_API_KEY) {
    log('❌ Missing location or API key')
    return { latitude: null, longitude: null }
  }

  // Validate location before geocoding
  if (!isValidGeographicLocation(location)) {
    log(`❌ Skipping geocoding for invalid location: ${location}`)
    return { latitude: null, longitude: null }
  }

  try {
    log(`🌍 Geocoding location: ${location}`)
    const response = await axios.get(
      `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(
        location,
      )}&key=${process.env.OPENCAGE_API_KEY}&no_annotations=1&limit=1`,
    )

    if (response.data.results && response.data.results.length > 0) {
      const { lat, lng } = response.data.results[0].geometry
      log(`✅ Found coordinates: ${lat}, ${lng}`)
      return { latitude: lat, longitude: lng }
    }

    log('❌ No results found')
    return { latitude: null, longitude: null }
  } catch (error) {
    console.error('❌ Error in geocoding:', error.message)
    if (error.response?.data) {
      console.error('API Response:', error.response.data)
    }
    return { latitude: null, longitude: null }
  }
}
