# Thread-Aware Summarization: Integration Guide

*How to weave thread context into your existing pipeline*

## Quick Start: 3 Simple Steps

### Step 1: Run the Database Migration

Apply the SQL functions that power fast thread discovery:

```bash
# Using Supabase CLI
supabase db execute --file migrations/add_thread_discovery_functions.sql

# Or manually copy/paste the SQL into your Supabase SQL editor
```

This creates:
- `find_related_by_tags()` - Fast tag-based discovery
- `cosine_similarity()` - Embedding similarity helper
- `find_related_by_embedding()` - Semantic discovery (optional)
- `find_related_hybrid()` - Best of both worlds (optional)

Plus optimized indexes for blazing fast queries.

### Step 2: Modify aiSummarization.mjs

Add thread context discovery to the summarization pipeline:

```javascript
// At the top of scripts/aiSummarization.mjs
import { discoverThreadContext } from '../lib/threadContext.mjs'
import { buildThreadAwareMessages } from '../lib/promptTemplates.mjs'

// Modify the summarizeChunk function (around line 197)
async function summarizeChunk(chunk, options = {}) {
  const { scrapId, taskType = 'summarization', ...otherOptions } = options

  // NEW: Discover thread context if we have a scrap object
  let threadContext = null
  if (otherOptions.scrap) {
    threadContext = await discoverThreadContext(otherOptions.scrap)
  }

  const startTime = performance.now()
  let summary = null
  let retries = 0
  let messages = otherOptions.messages || []

  // MODIFIED: Use thread-aware prompt template
  const promptMessages = buildThreadAwareMessages(chunk, threadContext, {
    temperature: options.temperature || 0.3,
  })

  while (summary === null && retries < 3) {
    try {
      log(`🔄 Attempt ${retries + 1}/3 to generate summary...`)

      // Log thread context if present
      if (threadContext && threadContext.count > 0) {
        log(`🧵 Using thread context: ${threadContext.count} related scraps (${threadContext.connectionStrength} connection)`)
      }

      const response = await completion({
        messages: [...promptMessages, ...messages],
        temperature: options.temperature || 0.3,
        maxTokens: options.metaSummary ? 2048 : 16384,
        model: getModelForTask('summarization'),
        scrapId,
        taskType,
      })

      // ... rest of existing code ...
    }
  }

  return summary
}

// Modify the main summarizeContent function to pass scrap object
export async function summarizeContent(content, options = {}) {
  const { scrapId, taskType = 'summarization', scrap, ...otherOptions } = options

  // ... existing validation code ...

  // Process chunks with scrap context
  const summaries = []
  for (const [i, chunk] of chunks.entries()) {
    try {
      log(`Processing chunk ${i + 1}/${chunks.length}`)
      const summary = await limiter.schedule(async () => {
        log(`🔄 Starting chunk ${i + 1} summarization...`)
        const result = await summarizeChunk(chunk, {
          ...otherOptions,
          scrapId,
          taskType,
          scrap  // PASS SCRAP OBJECT HERE
        })
        log(`✅ Chunk ${i + 1} summary generated (${result?.length || 0} chars)`)
        return result
      })
      // ... rest of existing code ...
    }
  }

  return summary
}
```

### Step 3: Update Calling Code

When calling summarizeContent, pass the full scrap object:

```javascript
// In scripts/index.mjs or wherever you call summarization

// OLD WAY:
const summary = await summarizeContent(content, {
  scrapId: scrap.id,
  taskType: 'summarization'
})

// NEW WAY:
const summary = await summarizeContent(content, {
  scrapId: scrap.id,
  taskType: 'summarization',
  scrap: scrap  // Pass full scrap object for thread discovery
})
```

That's it! Thread-aware summarization is now active.

---

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# Feature flags (all optional)
ENABLE_THREAD_CONTEXT=true          # Master switch (default: true)
ENABLE_SEMANTIC_RANKING=false       # Use embeddings for ranking (default: false)

# Tuning parameters (all optional, sane defaults exist)
THREAD_TEMPORAL_WINDOW=30           # Days to look back (default: 30)
THREAD_MIN_TAG_OVERLAP=2            # Minimum shared tags (default: 2)
THREAD_MAX_CANDIDATES=50            # Pre-filter pool size (default: 50)
THREAD_MAX_CONTEXT=5                # Max scraps in prompt (default: 5)
THREAD_SEMANTIC_THRESHOLD=0.7       # Minimum similarity (default: 0.7)
```

### Testing Your Configuration

```bash
# Quick test (shows what would happen, doesn't spend money)
node examples/thread_aware_demo.mjs

# Test with a specific scrap
node examples/thread_aware_demo.mjs "https://example.com/article"

# Compare with/without context
node examples/thread_aware_demo.mjs compare

# Actually generate summaries (costs ~$0.01)
DEMO_GENERATE_SUMMARY=true node examples/thread_aware_demo.mjs
```

---

## Verification & Monitoring

### Check Thread Discovery Rate

After running some scraps through the pipeline:

```sql
-- How many scraps would find thread context?
SELECT
  COUNT(DISTINCT s.id) as scraps_with_threads,
  COUNT(DISTINCT s.id)::FLOAT / (SELECT COUNT(*) FROM scraps WHERE tags IS NOT NULL) as discovery_rate
FROM scraps s
WHERE array_length(s.tags, 1) >= 2
  AND EXISTS (
    SELECT 1
    FROM find_related_by_tags(s.tags, s.id, 30, 5, 2)
  );

-- Expected: 70-80% discovery rate
```

### Monitor Query Performance

```sql
-- Test query speed
EXPLAIN ANALYZE
SELECT * FROM find_related_by_tags(
  ARRAY['neural-networks', 'ai', 'transformers'],
  '00000000-0000-0000-0000-000000000000'::UUID,
  30,
  50,
  2
);

-- Should complete in < 50ms with proper indexes
```

### Check Summary Quality

Look for these indicators in generated summaries:

- Natural references to previous items: "builds on..." "unlike previous..."
- Temporal context: "you explored this last week..."
- Novel insights: "what's new here is..."
- Graceful handling of weak connections (no forced mentions)

### Example Quality Check

```bash
# Get recent summaries to review
node scripts/check_backlog.mjs --limit 10 | grep "summary"

# Compare AI quality before/after
node scripts/comprehensive_quality_audit.mjs
```

---

## Troubleshooting

### "No related scraps found" for everything

**Possible causes:**
- Tags aren't being extracted properly
- Temporal window too narrow
- Min tag overlap too high

**Fix:**
```bash
# Check tag coverage
SELECT
  COUNT(*) FILTER (WHERE tags IS NOT NULL) as with_tags,
  COUNT(*) FILTER (WHERE tags IS NULL) as without_tags,
  AVG(array_length(tags, 1)) as avg_tag_count
FROM scraps;

# If avg_tag_count < 3, tags aren't being extracted well
# Lower the min overlap threshold:
export THREAD_MIN_TAG_OVERLAP=1
```

### Queries are slow (> 100ms)

**Possible causes:**
- Missing indexes
- Database needs vacuuming
- Result set too large

**Fix:**
```sql
-- Verify indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'scraps'
  AND indexname LIKE '%tag%';

-- Should see idx_scraps_tags_gin

-- Vacuum/analyze
VACUUM ANALYZE scraps;

-- Reduce candidate pool if needed
export THREAD_MAX_CANDIDATES=25
```

### Summaries don't mention related items

**This is actually GOOD!**

The AI should only mention connections when they're meaningful. If summaries don't reference thread context, it means:
- The connections weren't strong enough
- The content stands on its own
- The AI made the right judgment call

**Check connection strength:**
```bash
# Enable debug mode to see thread discovery details
DEBUG=true node scripts/index.mjs --source pinboard --limit 5

# Look for:
# 🧵 Thread context: 5 related scraps (strong connection)
# vs
# 🧵 Thread context: 2 related scraps (weak connection)
```

### Costs increased significantly

**Expected:** 5-10% cost increase due to extra context tokens

**If costs increased > 20%:**
```bash
# Reduce context size
export THREAD_MAX_CONTEXT=3

# Or disable for less important sources
if (scrap.source === 'pinboard') {
  // Enable thread context for main sources
  threadContext = await discoverThreadContext(scrap)
} else {
  // Skip for less important sources
  threadContext = null
}
```

---

## Performance Tuning

### For Small Databases (< 1,000 scraps)

```bash
# More aggressive context discovery
export THREAD_TEMPORAL_WINDOW=90        # Look back 3 months
export THREAD_MIN_TAG_OVERLAP=1         # Allow single tag matches
export THREAD_MAX_CONTEXT=7             # Show more context
```

### For Large Databases (> 50,000 scraps)

```bash
# Tighter filtering for performance
export THREAD_TEMPORAL_WINDOW=14        # Just 2 weeks
export THREAD_MIN_TAG_OVERLAP=3         # Require strong overlap
export THREAD_MAX_CANDIDATES=25         # Smaller candidate pool
```

### Enable Semantic Ranking (Advanced)

Only after embeddings are working:

```bash
# 1. Ensure embeddings are generated
export ENABLE_EMBEDDINGS=true

# 2. Create IVFFlat index
supabase db execute --sql "
CREATE INDEX idx_scraps_embedding_ivfflat
  ON scraps
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
"

# 3. Enable semantic ranking
export ENABLE_SEMANTIC_RANKING=true

# 4. Test performance
node examples/thread_aware_demo.mjs
```

---

## Rollback Plan

If you need to disable thread-aware summarization:

### Option 1: Environment Variable (Instant)
```bash
export ENABLE_THREAD_CONTEXT=false
```

### Option 2: Code Modification (Permanent)
```javascript
// In aiSummarization.mjs, comment out thread context discovery:

async function summarizeChunk(chunk, options = {}) {
  // let threadContext = null
  // if (otherOptions.scrap) {
  //   threadContext = await discoverThreadContext(otherOptions.scrap)
  // }

  const threadContext = null  // Disabled

  // Rest of code stays the same
}
```

### Option 3: Remove Functions (Full Cleanup)
```sql
DROP FUNCTION IF EXISTS find_related_by_tags;
DROP FUNCTION IF EXISTS find_related_by_embedding;
DROP FUNCTION IF EXISTS find_related_hybrid;
DROP FUNCTION IF EXISTS cosine_similarity;
```

---

## Next Steps

1. **Run the demo** to see it in action:
   ```bash
   node examples/thread_aware_demo.mjs
   ```

2. **Apply the migration** to your database:
   ```bash
   supabase db execute --file migrations/add_thread_discovery_functions.sql
   ```

3. **Integrate into aiSummarization.mjs** (copy the code examples above)

4. **Test with a small batch**:
   ```bash
   node scripts/index.mjs --source pinboard --limit 5
   ```

5. **Review the summaries** - do they feel more connected?

6. **Tune the parameters** based on results

7. **Roll out to production** with confidence!

---

## Support & Debugging

Enable debug mode to see exactly what's happening:

```bash
DEBUG=true node scripts/index.mjs --source pinboard --limit 1
```

You'll see output like:
```
🏷️  Found 23 candidates with tag overlap
🧵 Thread context: 5 related scraps (strong connection)
   Themes: neural-networks, transformers, ai
Processing chunk 1/1...
🔄 Starting chunk 1 summarization...
✅ Chunk 1 summary generated (1234 chars)
```

---

*"Like a perfectly seasoned dish, the best systems reveal themselves gradually. Start simple, taste as you go, adjust until it sings."*

— 🔮 SAGE
