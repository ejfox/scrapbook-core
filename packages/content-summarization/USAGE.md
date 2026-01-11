# Standalone Usage Guide - @scrapbook/content-summarization

This guide shows you how to use the content-summarization package completely independently from scrapbook-core.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Advanced Features](#advanced-features)
- [LLM Provider Setup](#llm-provider-setup)
- [Integration Patterns](#integration-patterns)
- [Troubleshooting](#troubleshooting)

## Quick Start

### 1. Install the Package

```bash
# From npm (when published)
npm install @scrapbook/content-summarization

# Or use locally in scrapbook-core monorepo
npm install
```

### 2. Set Up Your LLM Provider

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

### 3. Summarize Content

```javascript
import { summarizeContent } from '@scrapbook/content-summarization'

const article = `
  [Your long article content here - can be thousands of words]
  The package automatically handles chunking and rate limiting.
`

const summary = await summarizeContent(article, { llmProvider })

console.log(summary)
// Output:
// • Main point 1: [detailed explanation with specifics]
// • Key insight 2: [numbers, dates, and context]
// • Important fact 3: [supporting evidence and implications]
// ... more bullet points capturing all key information
```

## Installation

### From npm (when published)

```bash
npm install @scrapbook/content-summarization
```

### From Local Monorepo

If you're working within the scrapbook-core repository:

```bash
cd scrapbook-core
npm install
```

### Dependencies

The package has minimal dependencies:

- **Required**: `bottleneck` (for rate limiting)
- **Required**: `dotenv` (for environment variables)

## Basic Usage

### Simple Summarization

```javascript
import { summarizeContent } from '@scrapbook/content-summarization'

const llmProvider = { /* your LLM provider */ }

const text = `
  Your article or document content here.
  Can be any length - the package handles chunking automatically.
`

const summary = await summarizeContent(text, { llmProvider })
console.log(summary)
```

### Short Content Check

Before summarizing, check if content is long enough:

```javascript
import { isContentInsufficient } from '@scrapbook/content-summarization'

if (isContentInsufficient(text)) {
  console.log('Content too short to summarize meaningfully')
} else {
  const summary = await summarizeContent(text, { llmProvider })
}
```

### Manual Chunking

For more control, manually chunk content:

```javascript
import { breakContentIntoChunks } from '@scrapbook/content-summarization'

// Split into chunks of ~10,000 tokens each
const chunks = breakContentIntoChunks(veryLongDocument, 10000)

console.log(`Document split into ${chunks.length} chunks`)

// Process each chunk separately if needed
for (const chunk of chunks) {
  console.log(`Chunk length: ${chunk.length} characters`)
}
```

## Advanced Features

### Custom Chunk Size

For very long documents, adjust chunk size:

```javascript
const summary = await summarizeContent(bookContent, {
  llmProvider,
  chunkSize: 200000  // ~50k tokens per chunk
})
```

### Temperature Control

Adjust creativity of summaries:

```javascript
const summary = await summarizeContent(text, {
  llmProvider,
  temperature: 0.1  // More deterministic (default: 0.3)
})
```

### Model Override

Use a specific model:

```javascript
const summary = await summarizeContent(text, {
  llmProvider,
  model: 'gpt-4-turbo-preview'
})
```

### Meta-Summary Generation

Generate ultra-concise 140-character overviews:

```javascript
import { generateMetaSummary } from '@scrapbook/content-summarization'

const scrap = {
  title: 'Advanced React Patterns',
  summary: '• Detailed explanation...\n• Key concepts...',
  tags: ['react', 'javascript'],
  content_type: 'article',
  relationships: [{ source: 'React', target: 'Hooks', relationship: 'USES' }]
}

const metaSummary = generateMetaSummary(scrap)
console.log(metaSummary)
// "ARTICLE Advanced React Patterns · 1 connections · #react #javascript - Detailed explanation..."
```

### Thread Context

Provide context from related content for better summaries:

```javascript
const summary = await summarizeContent(article, {
  llmProvider,
  threadContext: `
    Related content you've saved:
    - Article about React performance optimization
    - Blog post on Next.js best practices
  `
})
```

## LLM Provider Setup

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

### OpenRouter

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

### Content Management System

```javascript
import { summarizeContent } from '@scrapbook/content-summarization'

async function processArticle(article) {
  const summary = await summarizeContent(article.content, {
    llmProvider,
    scrapId: article.id
  })
  
  // Store summary in your CMS
  await cms.updateArticle(article.id, { summary })
  
  return summary
}
```

### Batch Processing

```javascript
import { summarizeContent } from '@scrapbook/content-summarization'
import pLimit from 'p-limit'

const limit = pLimit(3) // Process 3 documents at a time

async function batchSummarize(documents) {
  const promises = documents.map(doc =>
    limit(() => summarizeContent(doc.content, { llmProvider }))
  )
  
  const summaries = await Promise.all(promises)
  return summaries
}
```

### RSS Feed Processor

```javascript
import Parser from 'rss-parser'
import { summarizeContent } from '@scrapbook/content-summarization'

const parser = new Parser()

async function processFeed(feedUrl) {
  const feed = await parser.parseURL(feedUrl)
  
  for (const item of feed.items) {
    const summary = await summarizeContent(item.content, {
      llmProvider,
      url: item.link
    })
    
    console.log(`${item.title}:\n${summary}\n`)
  }
}
```

### Research Paper Processor

```javascript
import { summarizeContent } from '@scrapbook/content-summarization'
import pdf from 'pdf-parse'
import fs from 'fs'

async function summarizePaper(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath)
  const pdfData = await pdf(dataBuffer)
  
  // Papers are usually long, use larger chunks
  const summary = await summarizeContent(pdfData.text, {
    llmProvider,
    chunkSize: 200000,
    temperature: 0.2  // More precise for academic content
  })
  
  return summary
}
```

### Web Scraper Integration

```javascript
import { summarizeContent } from '@scrapbook/content-summarization'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

async function summarizeWebpage(url) {
  // Fetch and parse webpage
  const response = await fetch(url)
  const html = await response.text()
  const dom = new JSDOM(html, { url })
  
  // Extract main content
  const reader = new Readability(dom.window.document)
  const article = reader.parse()
  
  // Summarize
  const summary = await summarizeContent(article.textContent, {
    llmProvider,
    url
  })
  
  return {
    title: article.title,
    url,
    summary
  }
}
```

### Slack Bot

```javascript
import { WebClient } from '@slack/web-api'
import { summarizeContent } from '@scrapbook/content-summarization'

const slack = new WebClient(process.env.SLACK_TOKEN)

async function summarizeSlackThread(channelId, threadTs) {
  // Fetch thread messages
  const result = await slack.conversations.replies({
    channel: channelId,
    ts: threadTs
  })
  
  // Combine messages
  const threadContent = result.messages
    .map(msg => `${msg.user}: ${msg.text}`)
    .join('\n\n')
  
  // Summarize
  const summary = await summarizeContent(threadContent, { llmProvider })
  
  // Post summary
  await slack.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `Thread Summary:\n${summary}`
  })
}
```

## Troubleshooting

### Common Issues

**1. "llmProvider with completion method is required"**

Ensure your LLM provider has the correct structure:

```javascript
const llmProvider = {
  async completion({ messages, temperature, maxTokens }) {
    // Must return a string
    return responseText
  }
}
```

**2. Empty summaries**

- Check that content is long enough (>100 characters after cleaning)
- Verify your LLM provider is working
- Try increasing maxTokens

**3. Rate limiting errors**

The package has built-in rate limiting (1 request/second). If you need faster processing:

```javascript
// The rate limiter is internal, but you can batch process
const summaries = await Promise.all(
  documents.map(doc => summarizeContent(doc, { llmProvider }))
)
```

**4. Chunking not working**

For very long documents, increase chunk size:

```javascript
const summary = await summarizeContent(veryLongDoc, {
  llmProvider,
  chunkSize: 200000  // Increase from default 120000
})
```

### Debug Mode

Enable debug logging:

```javascript
process.env.DEBUG = 'true'

const summary = await summarizeContent(content, { llmProvider })
// Will output detailed logs about chunking and processing
```

### Performance Tips

1. **Use appropriate chunk sizes**: Larger chunks = fewer API calls but higher cost per call
2. **Batch process**: Process multiple documents concurrently with `Promise.all()`
3. **Cache results**: Store summaries to avoid re-processing the same content
4. **Choose the right model**: GPT-3.5 is faster and cheaper for simple content

### Content Quality

For best results:

- **Clean content**: Remove navigation, ads, footers before summarizing
- **Provide context**: Use the `url` or `threadContext` options
- **Choose appropriate temperature**: Lower (0.1-0.3) for factual content, higher (0.5-0.7) for creative content

## Environment Variables

```bash
# Optional - enable debug logging
DEBUG=true
```

## API Reference

### `summarizeContent(content, options)`

Summarize text content with automatic chunking.

**Parameters:**
- `content` (string): Text to summarize
- `options` (object):
  - `llmProvider` (object, required): LLM provider with `completion` method
  - `chunkSize` (number, optional): Token limit per chunk (default: 120000)
  - `temperature` (number, optional): LLM temperature (default: 0.3)
  - `model` (string, optional): Override LLM model
  - `threadContext` (string, optional): Related content context
  - `metaSummary` (boolean, optional): Generate shorter summary (default: false)

**Returns:** Promise<string|null>

### `breakContentIntoChunks(content, chunkSizeTokens)`

Split content into chunks.

**Parameters:**
- `content` (string): Content to chunk
- `chunkSizeTokens` (number): Target tokens per chunk (default: 6144)

**Returns:** string[]

### `isContentInsufficient(content)`

Check if content is too short to summarize.

**Parameters:**
- `content` (string): Content to check

**Returns:** boolean

### `generateMetaSummary(scrap)`

Generate 140-character overview.

**Parameters:**
- `scrap` (object): Scrap object with title, tags, summary, etc.

**Returns:** string

## Examples

Complete examples in the package demonstrate:

- Basic summarization
- Multi-chunk processing
- Integration with various LLM providers
- Batch processing patterns

## Support

- **Issues**: https://github.com/ejfox/scrapbook-core/issues
- **Discussions**: https://github.com/ejfox/scrapbook-core/discussions
