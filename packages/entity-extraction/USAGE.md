# Standalone Usage Guide - @scrapbook/entity-extraction

This guide shows you how to use the entity-extraction package completely independently from scrapbook-core.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Advanced Usage](#advanced-usage)
- [LLM Provider Setup](#llm-provider-setup)
- [Integration Patterns](#integration-patterns)
- [Troubleshooting](#troubleshooting)

## Quick Start

### 1. Install the Package

```bash
# From npm (when published)
npm install @scrapbook/entity-extraction

# Or use locally in scrapbook-core monorepo
npm install
```

### 2. Set Up Your LLM Provider

Choose your preferred LLM provider and create a simple wrapper:

**OpenAI Example:**

```javascript
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

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

### 3. Extract Relationships

```javascript
import { extractRelationships } from '@scrapbook/entity-extraction'

const content = `
  Apple Inc. acquired Beats Electronics for $3 billion in 2014.
  Tim Cook, the CEO of Apple, announced the deal at a press conference.
  Dr. Dre and Jimmy Iovine founded Beats in 2006.
`

const relationships = await extractRelationships(content, { llmProvider })

console.log(relationships)
// Output:
// [
//   { source: "Apple Inc.", target: "Beats Electronics", relationship: "ACQUIRED" },
//   { source: "Tim Cook", target: "Apple", relationship: "CEO_OF" },
//   { source: "Dr. Dre", target: "Beats", relationship: "FOUNDED" },
//   { source: "Jimmy Iovine", target: "Beats", relationship: "FOUNDED" }
// ]
```

## Installation

### From npm (when published)

```bash
npm install @scrapbook/entity-extraction
```

### From Local Monorepo

If you're working within the scrapbook-core repository:

```bash
cd scrapbook-core
npm install
```

The package will be automatically linked via npm workspaces.

### Dependencies

The package has minimal dependencies:

- **Required**: `dotenv` (for environment variables)
- **Optional**: `@supabase/supabase-js` (for learning from existing relationships)

## Basic Usage

### Simple Extraction

```javascript
import { extractRelationships } from '@scrapbook/entity-extraction'

// Your LLM provider (see LLM Provider Setup section)
const llmProvider = { /* ... */ }

// Extract from any text
const text = "Microsoft hired Satya Nadella as CEO in 2014."
const relationships = await extractRelationships(text, { llmProvider })

console.log(relationships)
// [{ source: "Microsoft", target: "Satya Nadella", relationship: "HIRED" }]
```

### With URL Context

Providing the source URL helps with entity disambiguation:

```javascript
const relationships = await extractRelationships(content, {
  llmProvider,
  url: 'https://techcrunch.com/2024/article-about-tech-acquisition'
})
```

### With Custom Model

Override the default model:

```javascript
const relationships = await extractRelationships(content, {
  llmProvider,
  model: 'gpt-4-turbo-preview'
})
```

## Advanced Usage

### Entity Type Detection

The package can automatically classify entities:

```javascript
import { detectEntityType } from '@scrapbook/entity-extraction'

console.log(detectEntityType('Apple Inc.'))        // "Organization"
console.log(detectEntityType('San Francisco'))     // "Location"
console.log(detectEntityType('React'))             // "Technology"
console.log(detectEntityType('Tim Cook'))          // "Person"
console.log(detectEntityType('iPhone 15 Pro'))     // "Product"
console.log(detectEntityType('WWDC 2024'))         // "Event"
console.log(detectEntityType('Machine Learning'))  // "Concept"
```

### Using with Supabase (Optional)

If you have existing relationships in Supabase, the package can learn from them:

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const relationships = await extractRelationships(content, {
  llmProvider,
  supabaseClient: supabase
})
```

This fetches recent relationship examples from your database to improve extraction quality.

### Pattern Matching

The package includes 50+ built-in patterns for entity classification:

```javascript
import { ENTITY_TYPE_PATTERNS } from '@scrapbook/entity-extraction'

// View available patterns
console.log(Object.keys(ENTITY_TYPE_PATTERNS))
// ['technology', 'organization', 'person', 'location', 'product', 'concept', 'event']
```

## LLM Provider Setup

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

### OpenRouter (Multiple Providers)

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

### Building a Knowledge Graph

```javascript
import { extractRelationships } from '@scrapbook/entity-extraction'

async function buildKnowledgeGraph(documents) {
  const allRelationships = []
  
  for (const doc of documents) {
    const relationships = await extractRelationships(doc.content, {
      llmProvider,
      url: doc.url
    })
    allRelationships.push(...relationships)
  }
  
  // Store in your preferred graph database
  return allRelationships
}
```

### Neo4j Integration

```javascript
import neo4j from 'neo4j-driver'

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'password')
)

async function importToNeo4j(relationships) {
  const session = driver.session()
  
  for (const rel of relationships) {
    await session.run(
      `MERGE (a {name: $source})
       MERGE (b {name: $target})
       MERGE (a)-[:${rel.relationship}]->(b)`,
      { source: rel.source, target: rel.target }
    )
  }
  
  await session.close()
}
```

### Batch Processing

```javascript
import { extractRelationships } from '@scrapbook/entity-extraction'
import pLimit from 'p-limit'

const limit = pLimit(5) // Process 5 documents concurrently

async function batchExtract(documents) {
  const promises = documents.map(doc =>
    limit(() => extractRelationships(doc.content, { llmProvider }))
  )
  
  const results = await Promise.all(promises)
  return results.flat()
}
```

### Stream Processing

```javascript
import { extractRelationships } from '@scrapbook/entity-extraction'

async function* processStream(contentStream) {
  for await (const content of contentStream) {
    const relationships = await extractRelationships(content, { llmProvider })
    yield relationships
  }
}

// Usage
for await (const relationships of processStream(myContentStream)) {
  console.log('Extracted:', relationships)
}
```

## Troubleshooting

### Common Issues

**1. "llmProvider with completion method is required"**

Make sure you're passing a valid LLM provider:

```javascript
const llmProvider = {
  async completion({ messages, temperature, maxTokens }) {
    // Your implementation here
    return responseText
  }
}
```

**2. No relationships extracted**

- Check that your content has meaningful entity relationships
- Try increasing the LLM's max_tokens parameter
- Verify your LLM provider is working correctly

**3. Low-quality extractions**

- Provide URL context: `{ url: 'https://...' }`
- Use a more capable model (e.g., GPT-4 instead of GPT-3.5)
- Consider using Supabase integration for better examples

**4. Supabase warnings**

If you see warnings about Supabase not being available, it's normal if you haven't configured it. The package works fine without it.

### Debug Mode

Enable debug logging:

```javascript
process.env.DEBUG = 'true'

const relationships = await extractRelationships(content, { llmProvider })
// Will output detailed logs
```

### Validation

Check if extracted relationships are valid:

```javascript
import { extractRelationships } from '@scrapbook/entity-extraction'

const relationships = await extractRelationships(content, { llmProvider })

// All returned relationships are pre-validated, but you can add your own checks
const validRelationships = relationships.filter(rel => 
  rel.source.length > 0 &&
  rel.target.length > 0 &&
  rel.relationship.length > 0
)
```

## Environment Variables

```bash
# Optional - for Supabase integration
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key

# Optional - enable debug logging
DEBUG=true
```

## API Reference

See [README.md](./README.md) for complete API documentation.

## Examples

See [example.mjs](./example.mjs) for a runnable example.

## Support

- **Issues**: https://github.com/ejfox/scrapbook-core/issues
- **Discussions**: https://github.com/ejfox/scrapbook-core/discussions
