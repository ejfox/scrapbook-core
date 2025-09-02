// aiGeolocation.mjs

import axios from "axios";
import Bottleneck from "bottleneck";
import cheerio from "cheerio";
import { completion, MODELS, PROMPTS } from "./llmService.mjs";
import { getModelForTask } from "../lib/config.mjs";

const DEBUG = process.env.DEBUG === "true";
function log(...args) {
  if (DEBUG) console.log(...args);
}

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

export async function extractLocation(content, options = {}) {
  const { url, rawHtml } = options;

  log("\n[LOCATION EXTRACTION]");
  log("Processing content:", content?.substring(0, 100) + "...");
  log("URL:", url);
  log("Raw HTML available:", !!rawHtml);

  if (!content || typeof content !== "string") {
    log("❌ No valid content provided");
    return {
      location: null,
      latitude: null,
      longitude: null,
      metadata: {
        otherLocations: [],
      },
    };
  }

  try {
    // Clean and prepare content
    const cleanContent = content
      .replace(/<[^>]*>/g, " ") // Remove HTML
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim();

    if (!cleanContent) {
      log("❌ No content after cleaning");
      return {
        location: null,
        latitude: null,
        longitude: null,
        metadata: {
          otherLocations: [],
        },
      };
    }

    log("Cleaned content length:", cleanContent.length);

    // Extract additional context from URL and metadata
    let urlContext = "";
    let metaInfo = "";
    
    if (url) {
      urlContext = `URL: ${url}\n`;
      
      // Extract domain hints
      const domainInfo = extractDomainInfo(url);
      if (domainInfo.domain) {
        urlContext += `Domain: ${domainInfo.domain}.${domainInfo.tld}\n`;
      }
      
      // Check for location-related URL segments
      const locationHints = extractUrlLocationHints(url);
      if (locationHints.length > 0) {
        urlContext += `URL Location Hints: ${locationHints.join(', ')}\n`;
      }
    }
    
    if (rawHtml) {
      metaInfo = extractMetaInfo(rawHtml);
      if (metaInfo) {
        metaInfo = `Metadata:\n${metaInfo}\n`;
      }
    }
    
    // Combine all context for comprehensive analysis
    const enhancedContent = `${urlContext}${metaInfo}
Content to analyze:
${cleanContent}`;

    log("🤖 Sending to LLM for location extraction...");
    const locations = await extractLocationsFromString(enhancedContent);

    // If no locations found, return early
    if (
      !locations.primary &&
      (!locations.others || locations.others.length === 0)
    ) {
      log("ℹ️ No locations found in content");
      return {
        location: null,
        latitude: null,
        longitude: null,
        metadata: {
          otherLocations: [],
        },
      };
    }

    // Get coordinates only if we have locations
    let primaryCoords = { latitude: null, longitude: null };
    let otherLocationsWithCoords = [];

    if (locations.primary && process.env.OPENCAGE_API_KEY) {
      log("🌍 Getting coordinates for primary location...");
      primaryCoords = await limiter.schedule(() =>
        reverseGeocode(locations.primary)
      );
    }

    if (locations.others?.length > 0 && process.env.OPENCAGE_API_KEY) {
      otherLocationsWithCoords = await Promise.all(
        locations.others.map(async (loc) => ({
          location: loc,
          ...(await limiter.schedule(() => reverseGeocode(loc))),
        }))
      );
    }

    // Return object with otherLocations in a format suitable for metadata
    return {
      location: locations.primary,
      latitude: primaryCoords.latitude,
      longitude: primaryCoords.longitude,
      metadata: {
        otherLocations: otherLocationsWithCoords.filter(
          (l) => l.latitude && l.longitude
        ),
      },
    };
  } catch (error) {
    console.error("❌ Error in location extraction:", error);
    return {
      location: null,
      latitude: null,
      longitude: null,
      metadata: {
        otherLocations: [],
      },
    };
  }
}

async function extractLocationsFromString(content) {
  try {
    // Create properly formatted messages array with enhanced instructions
    const messages = [
      {
        role: "system",
        content: `You are an expert location extraction specialist. You analyze text, URLs, and metadata to identify specific geographic locations. You ONLY output valid JSON with no explanations.

Your task is to find:
- Cities, towns, neighborhoods 
- Specific addresses or landmarks
- Geographic regions (states, provinces, countries)
- Venues, businesses with locations
- Any place names mentioned

You must be thorough and catch locations that might be mentioned in various contexts including:
- Direct mentions ("in San Francisco", "visiting Tokyo")  
- Indirect references ("the mayor announced", "local officials")
- Business/venue names that imply location
- URL context and metadata hints
- Event locations and addresses`,
      },
      {
        role: "user",  
        content: `Analyze ALL provided information and extract every location mentioned. Return ONLY this JSON structure:

{
  "locations": [
    {
      "name": "specific location name",
      "type": "city|neighborhood|landmark|address|venue|region|country",
      "context": "how/where it was mentioned in the source",
      "confidence": 0.9
    }
  ],
  "analysis_notes": "brief explanation of extraction approach used"
}

Rules:
- Be aggressive in finding locations - look everywhere
- Include business locations, event venues, geographic references
- Confidence: 0.9-1.0 for explicit mentions, 0.6-0.8 for implied, 0.3-0.5 for uncertain
- Context should help understand WHY this is a location
- Return empty array only if truly no locations exist
- ONLY return the JSON, no other text

Source material to analyze:
${content}`,
      },
    ];

    const response = await completion({
      messages,
      temperature: 0.3,
      maxTokens: 1000,
      model: getModelForTask('geolocation'),
    });

    if (!response) {
      log("❌ No response from LLM");
      return { primary: null, others: [] };
    }

    try {
      // Clean the response to extract only the JSON
      const cleanResponse = (text) => {
        // Remove any text before the first {
        const jsonStart = text.indexOf("{");
        // Remove any text after the last }
        const jsonEnd = text.lastIndexOf("}") + 1;

        if (jsonStart === -1 || jsonEnd === 0) {
          log("❌ No JSON found in response");
          return null;
        }

        return text.slice(jsonStart, jsonEnd);
      };

      // Get clean JSON string
      const jsonStr = cleanResponse(response);
      if (!jsonStr) {
        return { primary: null, others: [] };
      }

      // Parse the cleaned JSON
      const parsed = JSON.parse(jsonStr);

      if (!parsed.locations || !Array.isArray(parsed.locations)) {
        log("❌ Invalid locations array in response");
        return { primary: null, others: [], analysis_notes: parsed.analysis_notes || "Invalid response format" };
      }

      // Validate and filter locations by confidence threshold
      const validLocations = parsed.locations
        .filter((loc) =>
          loc &&
          typeof loc === "object" &&
          typeof loc.name === "string" &&
          loc.name.trim().length > 0 &&
          (loc.confidence || 0) >= 0.3 // Minimum confidence threshold
        )
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0)); // Sort by confidence descending

      if (validLocations.length === 0) {
        log("❌ No valid locations found above confidence threshold");
        return { primary: null, others: [], analysis_notes: parsed.analysis_notes || "No locations above confidence threshold" };
      }

      // Get primary location (highest confidence) and others
      const [primary, ...others] = validLocations;

      if (DEBUG) {
        log("✅ Extracted locations:");
        log("Primary:", primary);
        log("Others:", others);
        log("Analysis notes:", parsed.analysis_notes);
      }

      return {
        primary: primary.name,
        others: others.map((loc) => loc.name),
        analysis_notes: parsed.analysis_notes,
        all_locations: validLocations, // Keep full location data for debugging
      };
    } catch (error) {
      console.error("Error parsing location response:", error);
      if (DEBUG) {
        console.error("Raw response:", response);
        console.error("Attempted clean response:", cleanResponse(response));
      }
      return { primary: null, others: [], analysis_notes: "JSON parsing failed", error: error.message };
    }
  } catch (error) {
    console.error("Error extracting locations:", error);
    return { primary: null, others: [], analysis_notes: "Location extraction failed", error: error.message };
  }
}

function extractDomainInfo(url) {
  try {
    const parsedUrl = new URL(url);
    const domainParts = parsedUrl.hostname.split(".");
    return {
      domain: domainParts[domainParts.length - 2] || "",
      tld: domainParts[domainParts.length - 1] || "",
    };
  } catch (error) {
    console.error("Error parsing URL:", error);
    return { domain: "", tld: "" };
  }
}

function extractMetaInfo(rawHtml) {
  try {
    const $ = cheerio.load(rawHtml);
    let metaInfo = "";

    // Look for location-related meta tags
    const locationTags = [
      "place:location",
      "geo.placename", 
      "geo.position",
      "geo.region",
      "og:locality",
      "og:region", 
      "og:country",
      "twitter:place",
      "geo:lat",
      "geo:lon",
      "geo:location",
      "location",
      "address"
    ];

    $("meta").each((i, elem) => {
      const name = $(elem).attr("name") || $(elem).attr("property");
      const content = $(elem).attr("content");
      if (name && content && locationTags.some((tag) => name.toLowerCase().includes(tag.toLowerCase()))) {
        metaInfo += `${name}: ${content}\n`;
      }
    });

    // Also check for structured data with location info
    $('script[type="application/ld+json"]').each((i, elem) => {
      try {
        const jsonData = JSON.parse($(elem).html());
        if (jsonData.address || jsonData.location || jsonData.geo) {
          metaInfo += `Structured Data: ${JSON.stringify({
            address: jsonData.address,
            location: jsonData.location, 
            geo: jsonData.geo
          })}\n`;
        }
      } catch (e) {
        // Ignore JSON parsing errors
      }
    });

    return metaInfo;
  } catch (error) {
    console.error("Error parsing HTML:", error);
    return "";
  }
}

function extractUrlLocationHints(url) {
  if (!url) return [];
  
  const hints = [];
  const lowerUrl = url.toLowerCase();
  
  // Check for common location-related path segments
  const locationSegments = [
    'local', 'city', 'region', 'metro', 'area', 'location',
    'weather', 'news', 'events', 'places', 'venue', 'address'
  ];
  
  for (const segment of locationSegments) {
    if (lowerUrl.includes(`/${segment}/`) || lowerUrl.includes(`-${segment}-`)) {
      hints.push(segment);
    }
  }
  
  // Check for geographic TLDs
  const geoTlds = ['.us', '.uk', '.ca', '.au', '.fr', '.de', '.jp', '.in'];
  for (const tld of geoTlds) {
    if (lowerUrl.includes(tld)) {
      hints.push(`geographic domain (${tld})`);
    }
  }
  
  // Check for common location-indicating domains
  const locationDomains = [
    'patch.com', 'weather.com', 'yelp.com', 'foursquare.com', 
    'maps.google.com', 'local.', 'city.', '.gov'
  ];
  
  for (const domain of locationDomains) {
    if (lowerUrl.includes(domain)) {
      hints.push(`location-focused domain (${domain})`);
    }
  }
  
  return [...new Set(hints)]; // Remove duplicates
}

async function reverseGeocode(location) {
  if (!location || !process.env.OPENCAGE_API_KEY) {
    log("❌ Missing location or API key");
    return { latitude: null, longitude: null };
  }

  try {
    log(`🌍 Geocoding location: ${location}`);
    const response = await axios.get(
      `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(
        location
      )}&key=${process.env.OPENCAGE_API_KEY}&no_annotations=1&limit=1`
    );

    if (response.data.results && response.data.results.length > 0) {
      const { lat, lng } = response.data.results[0].geometry;
      log(`✅ Found coordinates: ${lat}, ${lng}`);
      return { latitude: lat, longitude: lng };
    }

    log("❌ No results found");
    return { latitude: null, longitude: null };
  } catch (error) {
    console.error("❌ Error in geocoding:", error.message);
    if (error.response?.data) {
      console.error("API Response:", error.response.data);
    }
    return { latitude: null, longitude: null };
  }
}
