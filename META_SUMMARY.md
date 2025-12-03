# META-Summary Feature

## Overview

The META-summary is a ~140 character synthesis of all AI analysis outputs, designed to provide a quick, comprehensive overview of a scrap. It combines insights from multiple analysis fields into a Twitter-length summary that's perfect for:

- Quick previews in the CLI
- Social media sharing
- API responses
- Mobile notifications
- Search result snippets

## What It Includes

The META-summary intelligently combines:

1. **Content Type** - ARTICLE, NEWS, NOTE, etc. (if not a basic bookmark)
2. **Title** - Primary subject (first 40 chars)
3. **Location** - Geographic context (if notable)
4. **Relationships** - Connection count
5. **Financial Data** - Tracked asset symbols
6. **Tags** - Top 2-3 key tags
7. **Summary Snippet** - Brief excerpt from full summary (if space available)

## Format

```
ARTICLE · Cloud AI launches new features for deve · @ San Francisco, CA · 2 connections · #AI #technology - Anthropic announces major updat
```

## Database Schema

```sql
ALTER TABLE scraps
ADD COLUMN IF NOT EXISTS meta_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_scraps_meta_summary ON scraps(meta_summary);
```

## Usage

### In scrapbook-core Processing

The META-summary is automatically generated during AI processing, after all other analysis fields are populated:

```javascript
import { generateMetaSummary } from './aiSummarization.mjs';

// After summary, tags, relationships, etc. are extracted
const metaSummary = generateMetaSummary(scrap);
```

### In scrapbook-cli

The CLI displays the pre-computed META-summary from the database:

```javascript
const metaSummary = bookmark.meta_summary || generateMetaSummary(bookmark);
```

## Implementation Details

### Generation Logic

1. Builds an array of components based on available data
2. Joins with ` · ` separator
3. Adds summary snippet if room remains (< 120 chars used)
4. Truncates to exactly 140 characters maximum
5. Adds `…` ellipsis if truncated

### Character Budget

- Content type: ~5-15 chars
- Title: ~40 chars
- Location: ~15-25 chars
- Connections: ~15 chars
- Financial symbols: ~10-20 chars
- Tags: ~20-40 chars
- Summary snippet: remaining space (if > 20 chars available)

### Fallback Strategy

- If no data available: returns `"No summary available"`
- Prioritizes title over concept tags
- Skips empty or "Unknown" fields
- Uses concept_tags if regular tags unavailable

## Migration Instructions

1. Run the migration SQL:
   ```bash
   cd scrapbook-core
   psql $DATABASE_URL < migrations/add_meta_summary.sql
   ```

2. Regenerate META-summaries for existing scraps:
   ```bash
   cd scrapbook-core/scripts
   ./scrap_doctor_ai.mjs --type summary
   ```

## Examples

### News Article
```
NEWS · Bitcoin reaches new all-time high · 1 connections · $BTC,ETH · #crypto #finance
```

### Personal Note with Location
```
NOTE · Personal note about coffee shop in Brook · @ Brooklyn, NY · #coffee #personal - Found an amazing new coffee spot on Bedford Ave.
```

### Technical Article
```
ARTICLE · Deep dive into React Server Componen · 3 connections · #react #javascript #performance - Understanding the fundamental shift...
```

## Benefits

1. **Consistent Format** - All scraps have a standardized preview
2. **Rich Context** - Multiple data points in minimal space
3. **Pre-computed** - No runtime cost for clients
4. **Search Friendly** - Single field for full-text search
5. **Shareable** - Perfect for social media and messaging

## Future Enhancements

- [ ] Make max length configurable (140/280/500 chars)
- [ ] Add emoji indicators for content types
- [ ] Support different formats (markdown, HTML, plain text)
- [ ] Include sentiment or importance scores
- [ ] A/B test different component orderings
