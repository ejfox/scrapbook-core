// aiGeolocation.mjs

import OpenAI from "openai";
import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import cheerio from "cheerio";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

function chooseLLMService() {
  return process.env.USE_OPENAI === "true" ? "openai" : "local";
}

export async function extractLocation(content, options = {}) {
  const { url, rawHtml } = options;

  if (!content || typeof content !== 'string') {
    console.log("No valid content provided");
    return { location: null, latitude: null, longitude: null };
  }

  try {
    // Clean and prepare content
    const cleanContent = content
      .replace(/<[^>]*>/g, ' ')  // Remove HTML
      .replace(/\s+/g, ' ')      // Normalize whitespace
      .trim();

    if (!cleanContent) {
      console.log("No content after cleaning");
      return { location: null, latitude: null, longitude: null };
    }

    // Gather additional context if available
    let contextualInfo = "";
    if (url) {
      const domainInfo = extractDomainInfo(url);
      contextualInfo += `URL: ${url}\nDomain: ${domainInfo.domain}\nTLD: ${domainInfo.tld}\n`;
    }
    if (rawHtml) {
      const metaInfo = extractMetaInfo(rawHtml);
      contextualInfo += `\nMeta Information:\n${metaInfo}\n`;
    }

    // Combine content with context
    const enhancedContent = contextualInfo ? 
      `${contextualInfo}\n\n${cleanContent}` : 
      cleanContent;

    // Extract location
    const location = await extractLocationFromString(enhancedContent);
    
    if (!location) {
      console.log("No location found in the content");
      return { location: null, latitude: null, longitude: null };
    }

    console.log("Extracted Location:", location);

    // Get coordinates
    const { latitude, longitude } = await limiter.schedule(() =>
      reverseGeocode(location)
    );
    
    if (latitude && longitude) {
      console.log(`Coordinates: ${latitude}, ${longitude}`);
    }

    return { location, latitude, longitude };
  } catch (error) {
    console.error("Error in location extraction:", error);
    return { location: null, latitude: null, longitude: null };
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

async function extractLocationFromString(content) {
  const llmService = chooseLLMService();

  if (llmService === "openai") {
    return await extractLocationOpenAI(content);
  } else {
    return await extractLocationLocal(content);
  }
}

async function extractLocationOpenAI(content) {
  const messages = [
    {
      role: "system",
      content: "Extract the most relevant geographic location from the text. Return only the location in 'City, State/Region, Country' format. If no location is found, return null. Be conservative - only return locations you're confident about."
    },
    {
      role: "user",
      content: content
    }
  ];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3,
      max_tokens: 60
    });

    const location = response.choices[0].message.content.trim();
    return location === "null" ? null : location;
  } catch (error) {
    console.error("Error in OpenAI location extraction:", error);
    return null;
  }
}

async function extractLocationLocal(content) {
  const messages = [
    {
      role: "system",
      content: "Extract the most relevant geographic location from the text. Return only the location in 'City, State/Region, Country' format. If no location is found, return null. Be conservative - only return locations you're confident about."
    },
    {
      role: "user",
      content: content
    }
  ];

  try {
    const response = await axios.post(
      "http://localhost:1234/v1/chat/completions",
      {
        model: "Meta-Llama-3-8B-Instruct-imatrix",
        messages,
        temperature: 0.3,
        max_tokens: 60,
        stream: false
      }
    );

    const location = response.data.choices[0].message.content.trim();
    return location === "null" ? null : location;
  } catch (error) {
    console.error("Error in local LLM location extraction:", error);
    return null;
  }
}

async function reverseGeocode(location) {
  if (!location || !process.env.OPENCAGE_API_KEY) {
    return { latitude: null, longitude: null };
  }

  try {
    const response = await axios.get(
      `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(location)}&key=${process.env.OPENCAGE_API_KEY}`
    );

    if (response.data.results && response.data.results.length > 0) {
      const { lat, lng } = response.data.results[0].geometry;
      return { latitude: lat, longitude: lng };
    }
    
    return { latitude: null, longitude: null };
  } catch (error) {
    console.error("Error in geocoding:", error);
    return { latitude: null, longitude: null };
  }
}
