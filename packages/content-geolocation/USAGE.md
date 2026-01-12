# Standalone Usage Guide - @scrapbook/content-geolocation

This guide shows you how to use the content-geolocation package to extract and geocode locations from text.

## ⚠️ Current Status

This package is currently a **placeholder** that re-exports from scrapbook-core. It requires the parent project to be installed. A fully standalone version is planned for a future release.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Advanced Usage](#advanced-usage)
- [LLM Provider Setup](#llm-provider-setup)
- [Integration Patterns](#integration-patterns)
- [Future Standalone Version](#future-standalone-version)

## Quick Start

### 1. Install within Scrapbook-Core

Currently, this package must be used within the scrapbook-core monorepo:

```bash
cd scrapbook-core
npm install
```

### 2. Set Up API Keys

```bash
# Required for geocoding
OPENCAGE_API_KEY=your_opencage_api_key

# Required for location extraction
OPENROUTER_API_KEY=your_openrouter_key
# or
OPENAI_API_KEY=your_openai_key
```

### 3. Extract and Geocode Locations

```javascript
import { extractLocation } from '@scrapbook/content-geolocation'

const content = "I visited the Eiffel Tower in Paris, France last summer."

const result = await extractLocation(content, {
  llmProvider,
  opencageApiKey: process.env.OPENCAGE_API_KEY,
  url: 'https://example.com/article'
})

console.log(result)
// {
//   location: "Paris, France",
//   latitude: 48.8566,
//   longitude: 2.3522,
//   metadata: {
//     otherLocations: [
//       { location: "Eiffel Tower, Paris", latitude: 48.8584, longitude: 2.2945 }
//     ]
//   }
// }
```

## Installation

### Current (Monorepo Only)

```bash
cd scrapbook-core
npm install
```

The package will be available through npm workspaces.

### Future (Standalone - Coming Soon)

```bash
npm install @scrapbook/content-geolocation
```

## Basic Usage

### Simple Location Extraction

```javascript
import { extractLocation } from '@scrapbook/content-geolocation'

const text = "The conference will be held in San Francisco, California."

const result = await extractLocation(text, {
  llmProvider,
  opencageApiKey: process.env.OPENCAGE_API_KEY
})

console.log(result.location)      // "San Francisco, California"
console.log(result.latitude)      // 37.7749
console.log(result.longitude)     // -122.4194
```

### Multiple Locations

```javascript
const text = "I traveled from New York to Los Angeles, stopping in Chicago."

const result = await extractLocation(text, {
  llmProvider,
  opencageApiKey: process.env.OPENCAGE_API_KEY
})

console.log(result.location)              // Primary: "New York"
console.log(result.metadata.otherLocations)  // ["Los Angeles", "Chicago"]
```

## Advanced Usage

### With URL Context

```javascript
const result = await extractLocation(content, {
  llmProvider,
  opencageApiKey: process.env.OPENCAGE_API_KEY,
  url: 'https://nytimes.com/article',
  rawHtml: htmlContent  // Optional: provides additional context
})
```

### Filtering Non-Geographic Entities

The package automatically filters out:
- Social media platforms (Twitter, Facebook, etc.)
- Websites and URLs
- Online platforms
- Non-physical locations

```javascript
const text = "I posted on Twitter about my trip to Paris."
// Will extract only "Paris", not "Twitter"
```

## LLM Provider Setup

The location extraction requires an LLM provider for AI-powered extraction:

### OpenAI

```javascript
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const llmProvider = {
  async completion({ messages, temperature, maxTokens, model }) {
    const response = await openai.chat.completions.create({
      model: model || 'gpt-4',
      messages,
      temperature,
      max_tokens: maxTokens
    })
    return response.choices[0].message.content
  }
}
```

### Using OpenRouter

```javascript
import axios from 'axios'

const llmProvider = {
  async completion({ messages, temperature, maxTokens, model }) {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: model || 'anthropic/claude-3.5-sonnet',
        messages,
        temperature,
        max_tokens: maxTokens
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    )
    return response.data.choices[0].message.content
  }
}
```

## Integration Patterns

### Travel Blog Processor

```javascript
import { extractLocation } from '@scrapbook/content-geolocation'

async function processTravelPost(post) {
  const result = await extractLocation(post.content, {
    llmProvider,
    opencageApiKey: process.env.OPENCAGE_API_KEY,
    url: post.url
  })
  
  return {
    ...post,
    primaryLocation: result.location,
    coordinates: {
      lat: result.latitude,
      lon: result.longitude
    },
    visitedPlaces: result.metadata.otherLocations
  }
}
```

### Map Visualization

```javascript
import { extractLocation } from '@scrapbook/content-geolocation'

async function createMap(articles) {
  const locations = []
  
  for (const article of articles) {
    const result = await extractLocation(article.content, {
      llmProvider,
      opencageApiKey: process.env.OPENCAGE_API_KEY
    })
    
    if (result.latitude && result.longitude) {
      locations.push({
        title: article.title,
        lat: result.latitude,
        lon: result.longitude,
        location: result.location
      })
    }
  }
  
  return locations
}
```

### Database Storage

```javascript
import { extractLocation } from '@scrapbook/content-geolocation'

async function storeWithLocation(document) {
  const location = await extractLocation(document.content, {
    llmProvider,
    opencageApiKey: process.env.OPENCAGE_API_KEY
  })
  
  await database.insert({
    ...document,
    location_name: location.location,
    latitude: location.latitude,
    longitude: location.longitude,
    additional_locations: location.metadata.otherLocations
  })
}
```

## Future Standalone Version

The planned standalone version will:

### Features

- ✅ Work independently without scrapbook-core
- ✅ Minimal dependencies (only essentials)
- ✅ Full API documentation
- ✅ Comprehensive examples
- ✅ Multiple geocoding provider support (OpenCage, Google Maps, etc.)

### Installation (Future)

```bash
npm install @scrapbook/content-geolocation
```

### Usage (Future)

```javascript
import { extractLocation } from '@scrapbook/content-geolocation'

const result = await extractLocation(content, {
  llmProvider,
  geocodingProvider: 'opencage',  // or 'google', 'mapbox'
  apiKey: process.env.GEOCODING_API_KEY
})
```

## API Reference

### `extractLocation(content, options)`

Extract and geocode geographic locations from text.

**Parameters:**
- `content` (string): Text content to analyze
- `options` (object):
  - `llmProvider` (object, required): LLM provider with completion method
  - `opencageApiKey` (string, required): OpenCage API key for geocoding
  - `url` (string, optional): Source URL for context
  - `rawHtml` (string, optional): Raw HTML for additional metadata

**Returns:** Promise<Object>

```javascript
{
  location: string | null,           // Primary location name
  latitude: number | null,           // Latitude coordinate
  longitude: number | null,          // Longitude coordinate
  metadata: {
    otherLocations: Array<{
      location: string,
      latitude: number,
      longitude: number
    }>
  }
}
```

## Environment Variables

```bash
# Required for geocoding
OPENCAGE_API_KEY=your_opencage_api_key

# Required for LLM-based extraction
OPENROUTER_API_KEY=your_openrouter_key
# or
OPENAI_API_KEY=your_openai_key

# Optional
DEBUG=true  # Enable debug logging
```

## Geocoding APIs

### OpenCage

Sign up at https://opencagedata.com

- Free tier: 2,500 requests/day
- Pricing: Starts at $50/month for 10,000 requests/day

### Future Support (Planned)

- Google Maps Geocoding API
- Mapbox Geocoding API
- Here Geocoding API

## Troubleshooting

### Common Issues

**1. Missing OpenCage API key**

```javascript
// Will return null coordinates but still extract location names
const result = await extractLocation(content, { llmProvider })
console.log(result.location)  // "Paris, France"
console.log(result.latitude)  // null (no API key)
```

**2. No locations found**

- Content may not contain geographic locations
- Try providing URL context
- Check if locations are being filtered (e.g., website names)

**3. Incorrect geocoding**

- Location names may be ambiguous
- Try more specific location strings: "Paris, France" vs "Paris"
- Provide URL context for disambiguation

### Debug Mode

```bash
DEBUG=true node your-script.js
```

## Current Limitations

As a placeholder package, current limitations include:

1. Requires scrapbook-core to be installed
2. Not available as standalone npm package yet
3. Limited to OpenCage for geocoding
4. No custom geocoding provider support yet

These will be addressed in the standalone version.

## Migration Path

When the standalone version is released:

1. Update your import (no change needed):
   ```javascript
   import { extractLocation } from '@scrapbook/content-geolocation'
   ```

2. Install standalone version:
   ```bash
   npm install @scrapbook/content-geolocation
   ```

3. Update geocoding configuration (if using custom providers):
   ```javascript
   const result = await extractLocation(content, {
     llmProvider,
     geocodingProvider: 'opencage',
     apiKey: process.env.OPENCAGE_API_KEY
   })
   ```

## Support

- **Issues**: https://github.com/ejfox/scrapbook-core/issues
- **Discussions**: https://github.com/ejfox/scrapbook-core/discussions
- **Full Implementation**: `../../scripts/aiGeolocation.mjs`
