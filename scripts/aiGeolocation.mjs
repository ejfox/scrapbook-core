// aiGeolocation.mjs

import axios from "axios";
import Bottleneck from "bottleneck";
import cheerio from "cheerio";
import { completion, MODELS, PROMPTS } from './llmService.mjs';

const DEBUG = process.env.DEBUG === "true";
function log(...args) {
  if (DEBUG) console.log(...args);
}

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

const LOCATION_PROMPTS = {
  EXTRACT: `Analyze the text and extract locations in this format:
Primary: [Most significant/central location in City, State/Region, Country format]
Others: [List other mentioned locations in same format]

Choose the primary location based on:
1. Main focus of the content
2. First significant location mentioned
3. Location with most context/detail

Example output:
Primary: San Francisco, California, USA
Others:
- New York City, New York, USA
- London, England, UK`,
};

export async function extractLocation(content, options = {}) {
  const { url, rawHtml } = options;

  log("\n[LOCATION EXTRACTION]");
  log("Processing content:", content?.substring(0, 100) + "...");

  if (!content || typeof content !== 'string') {
    log("❌ No valid content provided");
    return { location: null, latitude: null, longitude: null, otherLocations: [] };
  }

  try {
    // Clean and prepare content
    const cleanContent = content
      .replace(/<[^>]*>/g, ' ')  // Remove HTML
      .replace(/\s+/g, ' ')      // Normalize whitespace
      .trim();

    if (!cleanContent) {
      log("❌ No content after cleaning");
      return { location: null, latitude: null, longitude: null, otherLocations: [] };
    }

    log("Cleaned content length:", cleanContent.length);

    // Gather additional context if available
    let contextualInfo = "";
    if (url) {
      log("📍 URL context:", url);
      const domainInfo = extractDomainInfo(url);
      contextualInfo += `URL: ${url}\nDomain: ${domainInfo.domain}\nTLD: ${domainInfo.tld}\n`;
    }
    if (rawHtml) {
      log("🔍 Extracting meta info from HTML...");
      const metaInfo = extractMetaInfo(rawHtml);
      if (metaInfo) {
        contextualInfo += `\nMeta Information:\n${metaInfo}\n`;
        log("Found meta info:", metaInfo);
      }
    }

    // Combine content with context
    const enhancedContent = contextualInfo ? 
      `${contextualInfo}\n\n${cleanContent}` : 
      cleanContent;

    log("🤖 Sending to LLM for location extraction...");
    const locations = await extractLocationsFromString(enhancedContent);
    
    if (!locations.primary) {
      log("❌ No primary location found");
      return { location: null, latitude: null, longitude: null, otherLocations: [] };
    }

    log("✅ Primary Location:", locations.primary);
    if (locations.others.length > 0) {
      log("📍 Other Locations:", locations.others);
    }

    // Get coordinates for primary location
    log("🌍 Getting coordinates for primary location...");
    const primaryCoords = await limiter.schedule(() => reverseGeocode(locations.primary));
    
    // Get coordinates for other locations
    const otherLocationsWithCoords = await Promise.all(
      locations.others.map(async loc => {
        const coords = await limiter.schedule(() => reverseGeocode(loc));
        return {
          location: loc,
          ...coords
        };
      })
    );

    return { 
      location: locations.primary,
      latitude: primaryCoords.latitude,
      longitude: primaryCoords.longitude,
      otherLocations: otherLocationsWithCoords.filter(l => l.latitude && l.longitude)
    };

  } catch (error) {
    console.error("❌ Error in location extraction:", error);
    return { 
      location: null, 
      latitude: null, 
      longitude: null,
      otherLocations: []
    };
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
      'place:location',
      'geo.placename',
      'geo.position',
      'geo.region',
      'og:locality',
      'og:region',
      'og:country'
    ];

    $('meta').each((i, elem) => {
      const name = $(elem).attr('name') || $(elem).attr('property');
      const content = $(elem).attr('content');
      if (name && content && locationTags.some(tag => name.includes(tag))) {
        metaInfo += `${name}: ${content}\n`;
      }
    });

    return metaInfo;
  } catch (error) {
    console.error("Error parsing HTML:", error);
    return "";
  }
}

async function extractLocationsFromString(content) {
  try {
    const messages = [
      { role: "system", content: LOCATION_PROMPTS.EXTRACT },
      { role: "user", content }
    ];

    const response = await completion({
      messages,
      model: MODELS.EXTRACT_LOCATION,
      temperature: 0.3,
      max_tokens: 200
    });

    // Parse the response
    const lines = response.split('\n');
    const primary = lines
      .find(l => l.startsWith('Primary:'))
      ?.replace('Primary:', '')
      .trim();
      
    const others = lines
      .slice(lines.findIndex(l => l.startsWith('Others:')) + 1)
      .filter(l => l.startsWith('-'))
      .map(l => l.replace('-', '').trim())
      .filter(Boolean);

    return {
      primary: primary === 'null' ? null : primary,
      others: others || []
    };
  } catch (error) {
    console.error("Error in location extraction:", error);
    return { primary: null, others: [] };
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
      `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(location)}&key=${process.env.OPENCAGE_API_KEY}&no_annotations=1&limit=1`
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
