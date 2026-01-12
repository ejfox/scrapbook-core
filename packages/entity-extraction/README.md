# @scrapbook/entity-extraction

Extract entities and relationships from text content using AI. This package provides a simple, flexible API for relationship extraction that can be integrated into any Node.js application.

## Features

- 🔗 **Relationship Extraction**: Automatically extract entities and their relationships from text
- 🎯 **Entity Type Detection**: Identify entity types (Person, Organization, Technology, Location, etc.)
- 🔄 **Cypher-Style Output**: Returns relationships in graph-friendly format
- 🧠 **LLM-Agnostic**: Works with any LLM provider (OpenAI, Anthropic, etc.)
- 📚 **Context Learning**: Optional integration with existing relationship database for better results

## Installation

```bash
npm install @scrapbook/entity-extraction
```

## Quick Start

```javascript
import { extractRelationships } from '@scrapbook/entity-extraction'

// Define your LLM provider
const llmProvider = {
  async completion({ messages, temperature, maxTokens, model }) {
    // Your LLM API call here (OpenAI, Anthropic, etc.)
    const response = await yourLLMApi.chat.completions.create({
      model: model || 'gpt-4',
      messages,
      temperature,
      max_tokens: maxTokens
    })
    return response.choices[0].message.content
  }
}

// Extract relationships from text
const content = `
  Apple acquired Beats Electronics for $3 billion in 2014.
  Tim Cook, the CEO of Apple, announced the deal.
  Beats was founded by Dr. Dre and Jimmy Iovine.
`

const relationships = await extractRelationships(content, { llmProvider })

console.log(relationships)
// Output:
// [
//   { source: "Apple", target: "Beats Electronics", relationship: "ACQUIRED" },
//   { source: "Tim Cook", target: "Apple", relationship: "CEO_OF" },
//   { source: "Dr. Dre", target: "Beats", relationship: "FOUNDED" },
//   { source: "Jimmy Iovine", target: "Beats", relationship: "FOUNDED" }
// ]
```

## API

### `extractRelationships(content, options)`

Extract relationships between entities from text content.

#### Parameters

- `content` (string): The text content to analyze
- `options` (object):
  - `llmProvider` (object, **required**): Provider with `completion` method
  - `url` (string, optional): Source URL for context
  - `model` (string, optional): Override LLM model
  - `supabaseClient` (object, optional): Supabase client for fetching example relationships

#### Returns

Promise<Relationship[]> - Array of relationship objects:

```typescript
{
  source: string,      // Source entity name
  target: string,      // Target entity name
  relationship: string // Relationship type (e.g., "WORKS_AT", "FOUNDED", "LOCATED_IN")
}
```

### `detectEntityType(entityName)`

Detect the type of an entity based on pattern matching.

#### Parameters

- `entityName` (string): The entity name to classify

#### Returns

string - One of: 'Person', 'Organization', 'Technology', 'Product', 'Location', 'Event', 'Concept', 'Entity'

```javascript
import { detectEntityType } from '@scrapbook/entity-extraction'

console.log(detectEntityType('Apple Inc.'))        // "Organization"
console.log(detectEntityType('San Francisco'))     // "Location"
console.log(detectEntityType('React'))             // "Technology"
console.log(detectEntityType('Tim Cook'))          // "Person"
```

## Entity Types

The package recognizes the following entity types:

- **Person**: Individuals (e.g., "Tim Cook", "Dr. Jane Smith")
- **Organization**: Companies, institutions (e.g., "Apple Inc.", "MIT")
- **Technology**: Software, frameworks, tools (e.g., "React", "Python", "PostgreSQL")
- **Product**: Specific products/services (e.g., "iPhone 15", "ChatGPT")
- **Location**: Places, cities, countries (e.g., "San Francisco", "Japan")
- **Event**: Conferences, meetings (e.g., "WWDC 2024", "Olympics")
- **Concept**: Abstract ideas (e.g., "Machine Learning", "Democracy")

## LLM Provider Examples

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

### OpenRouter (Multi-Provider)

```javascript
import axios from 'axios'

const llmProvider = {
  async completion({ messages, temperature, maxTokens, model }) {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model || 'anthropic/claude-3.5-sonnet',
      messages,
      temperature,
      max_tokens: maxTokens
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    })
    return response.data.choices[0].message.content
  }
}
```

## Advanced Usage

### With Supabase Context

If you have a Supabase database with existing relationships, you can provide it for better context:

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

This will fetch recent relationship examples from your database to help the LLM understand your relationship format better.

### With URL Context

Providing the source URL can help with entity disambiguation:

```javascript
const relationships = await extractRelationships(content, {
  llmProvider,
  url: 'https://techcrunch.com/2024/article'
})
```

## Output Format

Relationships are returned in a simple, graph-friendly format:

```javascript
[
  {
    source: "Apple",
    target: "iPhone",
    relationship: "MANUFACTURES"
  },
  {
    source: "Tim Cook",
    target: "Apple",
    relationship: "CEO_OF"
  }
]
```

This format can easily be:
- Imported into graph databases (Neo4j, Neptune, etc.)
- Converted to RDF triples
- Visualized with D3.js, Cytoscape, etc.
- Stored in JSON/JSONB columns

## Use Cases

- **Knowledge Graphs**: Build knowledge graphs from unstructured text
- **Content Analysis**: Understand relationships in articles, documents, papers
- **Entity Linking**: Connect entities across multiple documents
- **Research Tools**: Extract relationships from academic papers
- **CRM Systems**: Identify connections between people and organizations
- **Intelligence Analysis**: Map relationships in reports and communications

## Environment Variables

Optional configuration through environment variables:

```bash
# For Supabase integration (optional)
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

## License

MIT

## Related Packages

- [@scrapbook/content-summarization](../content-summarization) - AI-powered content summarization
- [@scrapbook/content-geolocation](../content-geolocation) - Extract and geocode locations
- [@scrapbook/financial-analysis](../financial-analysis) - Extract financial entities and sentiment
