# Scrapbook Packages

This directory contains modular, standalone packages extracted from scrapbook-core. Each package can be used independently or integrated into your own projects.

## Available Packages

### [@scrapbook/entity-extraction](./entity-extraction)
Extract entities and relationships from text content using AI. Perfect for building knowledge graphs.

**Status**: ✅ Fully implemented and standalone

```bash
npm install @scrapbook/entity-extraction
```

### [@scrapbook/content-summarization](./content-summarization)
AI-powered content summarization with automatic chunking and rate limiting.

**Status**: ✅ Fully implemented and standalone

```bash
npm install @scrapbook/content-summarization
```

### [@scrapbook/content-geolocation](./content-geolocation)
Extract and geocode geographic locations from text using AI and OpenCage.

**Status**: 🚧 Package structure created, full standalone version coming soon

```bash
npm install @scrapbook/content-geolocation
```

### [@scrapbook/financial-analysis](./financial-analysis)
Extract financial assets and analyze sentiment. Tracks 40+ stocks, crypto, ETFs, and commodities.

**Status**: 🚧 Package structure created, full standalone version coming soon

```bash
npm install @scrapbook/financial-analysis
```

## Usage Philosophy

These packages are designed to be:

1. **LLM-Agnostic**: Work with any LLM provider (OpenAI, Anthropic, OpenRouter, etc.)
2. **Minimal Dependencies**: Only essential dependencies included
3. **Well-Documented**: Comprehensive README and examples for each package
4. **Standalone**: Can be used independently without scrapbook-core
5. **Composable**: Easily integrate multiple packages together

## Example: Using Multiple Packages Together

```javascript
import { extractRelationships } from '@scrapbook/entity-extraction'
import { summarizeContent } from '@scrapbook/content-summarization'
import { extractFinancialAnalysis } from '@scrapbook/financial-analysis'

// Your LLM provider
const llmProvider = {
  async completion({ messages, temperature, maxTokens }) {
    // Your API call here
  }
}

async function analyzeArticle(articleText) {
  // Summarize
  const summary = await summarizeContent(articleText, { llmProvider })
  
  // Extract relationships
  const relationships = await extractRelationships(articleText, { llmProvider })
  
  // Analyze financial content
  const financial = await extractFinancialAnalysis(articleText, { llmProvider })
  
  return {
    summary,
    relationships,
    financial
  }
}
```

## Package Structure

Each package follows this structure:

```
package-name/
├── index.mjs          # Main entry point
├── package.json       # Package metadata and dependencies
├── README.md          # Comprehensive documentation
└── example.mjs        # Usage examples (where applicable)
```

## Development

This is a monorepo using npm workspaces. To work on the packages:

```bash
# Install all dependencies
npm install

# Run tests (if available)
npm test

# Lint all packages
npm run lint
```

## Contributing

Contributions are welcome! Each package should:

- Have comprehensive documentation
- Include usage examples
- Be LLM-agnostic (accept provider as parameter)
- Have minimal external dependencies
- Include TypeScript types (JSDoc for now)

## License

MIT

## Links

- [scrapbook-core](https://github.com/ejfox/scrapbook-core) - The full system these packages are extracted from
- [Issue Tracker](https://github.com/ejfox/scrapbook-core/issues)
