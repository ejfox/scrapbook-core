// aiGeolocation.mjs

import axios from "axios";
import Bottleneck from "bottleneck";
import cheerio from "cheerio";
import { completion, MODELS, PROMPTS } from "./llmService.mjs";

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
      otherLocations: [],
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
        otherLocations: [],
      };
    }

    log("Cleaned content length:", cleanContent.length);

    // Combine content with any URL context and meta information
    const enhancedContent = url
      ? `URL: ${url}\nMeta: ${extractMetaInfo(
          rawHtml || ""
        )}\n\n${cleanContent}`
      : `Meta: ${extractMetaInfo(rawHtml || "")}\n\n${cleanContent}`;

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
        otherLocations: [],
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

    return {
      location: locations.primary,
      latitude: primaryCoords.latitude,
      longitude: primaryCoords.longitude,
      otherLocations: otherLocationsWithCoords.filter(
        (l) => l.latitude && l.longitude
      ),
    };
  } catch (error) {
    console.error("❌ Error in location extraction:", error);
    return {
      location: null,
      latitude: null,
      longitude: null,
      otherLocations: [],
    };
  }
}

async function extractLocationsFromString(content) {
  try {
    // Create properly formatted messages array with clearer instructions
    const messages = [
      {
        role: "system",
        content:
          "You are a location extraction specialist. You output ONLY valid JSON containing location data, with no explanations or additional text.",
      },
      {
        role: "user",
        content: `Extract locations from this text and return ONLY a JSON object with this exact structure:
{
  "locations": [
    {"name": "location name", "type": "location type"}
  ]
}

Rules:
- Return ONLY the JSON object, no other text
- Include ONLY specific places (cities, neighborhoods, landmarks, addresses)
- Skip general regions or non-specific locations
- If no locations found, return empty locations array
- Maintain exact JSON format

Text to analyze:
${content}`,
      },
    ];

    const response = await completion({
      messages,
      temperature: 0.3,
      maxTokens: 1000,
      model: MODELS.CLAUDE_3_SONNET,
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
        return { primary: null, others: [] };
      }

      // Validate each location object
      const validLocations = parsed.locations.filter(
        (loc) =>
          loc &&
          typeof loc === "object" &&
          typeof loc.name === "string" &&
          loc.name.trim().length > 0
      );

      if (validLocations.length === 0) {
        log("❌ No valid locations found");
        return { primary: null, others: [] };
      }

      // Get primary location (first in the list) and others
      const [primary, ...others] = validLocations;

      if (DEBUG) {
        log("✅ Extracted locations:");
        log("Primary:", primary);
        log("Others:", others);
      }

      return {
        primary: primary.name,
        others: others.map((loc) => loc.name),
      };
    } catch (error) {
      console.error("Error parsing location response:", error);
      if (DEBUG) {
        console.error("Raw response:", response);
        console.error("Attempted clean response:", cleanResponse(response));
      }
      return { primary: null, others: [] };
    }
  } catch (error) {
    console.error("Error extracting locations:", error);
    return { primary: null, others: [] };
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
    ];

    $("meta").each((i, elem) => {
      const name = $(elem).attr("name") || $(elem).attr("property");
      const content = $(elem).attr("content");
      if (name && content && locationTags.some((tag) => name.includes(tag))) {
        metaInfo += `${name}: ${content}\n`;
      }
    });

    return metaInfo;
  } catch (error) {
    console.error("Error parsing HTML:", error);
    return "";
  }
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
