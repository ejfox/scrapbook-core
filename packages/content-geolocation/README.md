# @scrapbook/content-geolocation

Extract and geocode geographic locations from text content using AI and the OpenCage geocoding API.

## Features

- 🌍 **Location Extraction**: Automatically identify geographic locations in text
- 📍 **Geocoding**: Convert location names to lat/lon coordinates
- 🎯 **Smart Filtering**: Removes non-geographic entities (websites, social media, etc.)
- 🔄 **Multiple Locations**: Extract primary and secondary locations
- 💡 **Context-Aware**: Uses URL and metadata for better extraction

## Installation

```bash
npm install @scrapbook/content-geolocation
```

## Quick Start

```javascript
import { extractLocation } from '@scrapbook/content-geolocation'

// Define your LLM provider
const llmProvider = {
  async completion({ messages, temperature, maxTokens }) {
    // Your LLM API call here
    return responseText
  }
}

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
//       { location: "Eiffel Tower, Paris, France", latitude: 48.8584, longitude: 2.2945 }
//     ]
//   }
// }
```

## API

See the source code for detailed API documentation. The package extracts locations from text and geocodes them using OpenCage.

## Environment Variables

```bash
OPENCAGE_API_KEY=your_opencage_api_key
DEBUG=true  # Optional: enable debug logging
```

## License

MIT

## Related Packages

- [@scrapbook/entity-extraction](../entity-extraction) - Extract entities and relationships
- [@scrapbook/content-summarization](../content-summarization) - AI-powered summarization
- [@scrapbook/financial-analysis](../financial-analysis) - Extract financial entities

## Note

This package is extracted from [scrapbook-core](https://github.com/ejfox/scrapbook-core) and designed to be used as a standalone module. For the complete implementation with all features, see the source repository.
