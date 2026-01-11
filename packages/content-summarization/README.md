# @scrapbook/content-summarization

AI-powered content summarization with automatic chunking, rate limiting, and multi-provider LLM support. Perfect for processing long articles, documents, and web content into concise, informative summaries.

## Features

- 📝 **Smart Summarization**: Generate detailed, bullet-point summaries of any content
- 🔄 **Automatic Chunking**: Handles content of any length by intelligently splitting into chunks
- ⏱️ **Rate Limiting**: Built-in rate limiting to avoid API throttling
- 🎯 **Flexible**: Works with any LLM provider (OpenAI, Anthropic, OpenRouter, etc.)
- 💡 **Context-Aware**: Optional thread context for better summaries
- 🔍 **Meta-Summaries**: Generate ultra-concise 140-character overviews

## Installation

```bash
npm install @scrapbook/content-summarization
```

## Quick Start

```javascript
import { summarizeContent } from '@scrapbook/content-summarization'

// Define your LLM provider
const llmProvider = {
  async completion({ messages, temperature, maxTokens, model }) {
    // Your LLM API call here
    const response = await yourLLMApi.chat.completions.create({
      model: model || 'gpt-4',
      messages,
      temperature,
      max_tokens: maxTokens
    })
    return response.choices[0].message.content
  }
}

// Summarize content
const article = `
  [Your long article content here...]
  This can be thousands of words long.
  The package will automatically chunk it and summarize each chunk.
`

const summary = await summarizeContent(article, { llmProvider })
console.log(summary)
// Output:
// • Main point 1: [detailed explanation]
// • Key insight 2: [specific details, numbers, dates]
// • Important fact 3: [context and implications]
// ... and more bullet points
```

## API

### `summarizeContent(content, options)`

Summarize text content with automatic chunking for long documents.

#### Parameters

- `content` (string): The text content to summarize
- `options` (object):
  - `llmProvider` (object, **required**): Provider with `completion` method
  - `chunkSize` (number, optional, default: 120000): Token limit per chunk
  - `temperature` (number, optional, default: 0.3): LLM temperature
  - `model` (string, optional): Override LLM model
  - `scrapId` (string, optional): ID for tracking
  - `threadContext` (string, optional): Related content context
  - `metaSummary` (boolean, optional, default: false): Generate shorter summary

#### Returns

Promise<string|null> - Generated summary with bullet points, or null if failed

### `breakContentIntoChunks(content, chunkSizeTokens)`

Split content into manageable chunks based on token size.

#### Parameters

- `content` (string): Content to chunk
- `chunkSizeTokens` (number, default: 6144): Target tokens per chunk

#### Returns

string[] - Array of content chunks

### `isContentInsufficient(content)`

Check if content is too short to meaningfully summarize.

#### Parameters

- `content` (string): Content to check

#### Returns

boolean - True if content is too short (< 100 characters cleaned)

### `generateMetaSummary(scrap)`

Generate an ultra-concise 140-character overview of a scrap.

#### Parameters

- `scrap` (object): Scrap object with title, tags, summary, etc.

#### Returns

string - Meta-summary (~140 chars)

## Examples

### Basic Usage

```javascript
import { summarizeContent } from '@scrapbook/content-summarization'

const summary = await summarizeContent(longArticle, {
  llmProvider: myLLMProvider,
  temperature: 0.3
})
```

### With Custom Chunk Size

```javascript
// For very long documents, use larger chunks
const summary = await summarizeContent(book, {
  llmProvider: myLLMProvider,
  chunkSize: 200000 // ~50k tokens
})
```

### With Thread Context

```javascript
// Provide context from related bookmarks for better summaries
const summary = await summarizeContent(article, {
  llmProvider: myLLMProvider,
  threadContext: `
    Related bookmarks you've saved:
    - Article about React performance optimization
    - Blog post on Next.js best practices
  `
})
```

### Manual Chunking

```javascript
import { breakContentIntoChunks } from '@scrapbook/content-summarization'

// Split content manually
const chunks = breakContentIntoChunks(veryLongDocument, 10000)

console.log(`Split into ${chunks.length} chunks`)
chunks.forEach((chunk, i) => {
  console.log(`Chunk ${i + 1}: ${chunk.length} characters`)
})
```

### Check Content Length

```javascript
import { isContentInsufficient } from '@scrapbook/content-summarization'

if (isContentInsufficient(snippet)) {
  console.log('Content too short to summarize')
} else {
  const summary = await summarizeContent(snippet, { llmProvider })
}
```

### Generate Meta-Summary

```javascript
import { generateMetaSummary } from '@scrapbook/content-summarization'

const scrap = {
  title: 'Advanced React Patterns',
  summary: '• Detailed explanation of render props\n• How to use compound components...',
  tags: ['react', 'javascript'],
  content_type: 'article',
  relationships: [
    { source: 'React', target: 'Render Props', relationship: 'USES' }
  ]
}

const metaSummary = generateMetaSummary(scrap)
console.log(metaSummary)
// Output: "ARTICLE Advanced React Patterns · 1 connections · #react #javascript - Detailed explanation..."
```

## LLM Provider Examples

### OpenAI

```javascript
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const llmProvider = {
  async completion({ messages, temperature, maxTokens, model }) {
    const response = await openai.chat.completions.create({
      model: model || 'gpt-4-turbo',
      messages,
      temperature,
      max_tokens: maxTokens
    })
    return response.choices[0].message.content
  }
}
```

### Anthropic Claude

```javascript
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const llmProvider = {
  async completion({ messages, temperature, maxTokens, model }) {
    const response = await anthropic.messages.create({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: maxTokens,
      temperature,
      messages
    })
    return response.content[0].text
  }
}
```

## Summary Format

Summaries are formatted as bullet points for easy scanning:

```
• Main thesis: The article argues that X is better than Y because...
• Supporting evidence: A 2023 study showed 45% improvement in...
• Key insight: The author notes that developers often overlook...
• Technical details: The system uses PostgreSQL 15 with pgvector extension
• Limitation: Only works in Node.js 18+ environments
• Conclusion: Recommends using approach X for production systems
```

## Advanced Options

### Content Blacklisting

Certain phrases are automatically filtered out (e.g., "Here is a summary"). The system will retry if these appear.

### Retry Logic

Failed summarizations are automatically retried up to 3 times with exponential backoff.

### Rate Limiting

Built-in Bottleneck rate limiter ensures API calls are spaced appropriately (1 request/second default).

## Use Cases

- **Article Summarization**: Condense blog posts and news articles
- **Document Processing**: Summarize research papers, reports, whitepapers
- **Content Curation**: Generate summaries for bookmarking services
- **Knowledge Management**: Build searchable archives of web content
- **Research Tools**: Quick overviews of long-form content
- **Reading Lists**: Understand content before committing time to read

## Performance

- Handles documents of any length through automatic chunking
- Typical summarization: 1-3 seconds per chunk
- Long documents (10,000+ words): 5-15 seconds total
- Rate limited to prevent API throttling

## Environment Variables

```bash
# Optional - enables debug logging
DEBUG=true
```

## License

MIT

## Related Packages

- [@scrapbook/entity-extraction](../entity-extraction) - Extract entities and relationships
- [@scrapbook/content-geolocation](../content-geolocation) - Extract and geocode locations
- [@scrapbook/financial-analysis](../financial-analysis) - Extract financial entities and sentiment
