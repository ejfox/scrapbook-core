# Thread-Aware Summarization: Quick Reference

*One-page cheat sheet for the impatient kitchen witch*

## TL;DR

**What it does:** Summaries remember what you saved recently and naturally weave connections.

**How it works:** Tag overlap → Find related scraps → Add context to prompt → AI decides if connections matter

**Setup time:** 30 minutes (if you move fast)

**Cost impact:** +10% tokens (~$0.001 per summary)

---

## Installation (3 Commands)

```bash
# 1. Apply database functions
supabase db execute --file migrations/add_thread_discovery_functions.sql

# 2. Test it works
node examples/thread_aware_demo.mjs

# 3. Integrate into aiSummarization.mjs (see INTEGRATION_GUIDE.md)
```

---

## Key Files

```
lib/
  threadContext.mjs       - Thread discovery engine (Layer 1-3)
  promptTemplates.mjs     - Prompt builder (Layer 4)

migrations/
  add_thread_discovery_functions.sql  - Database functions

examples/
  thread_aware_demo.mjs   - Test & demo script

DESIGN_THREAD_AWARE_SUMMARIZATION.md  - Full design doc
INTEGRATION_GUIDE.md                   - How to integrate
ARCHITECTURE_DIAGRAM.md                - Visual diagrams
```

---

## Environment Variables

```bash
# Feature flags
ENABLE_THREAD_CONTEXT=true          # Master switch (default: true)
ENABLE_SEMANTIC_RANKING=false       # Use embeddings (default: false)

# Tuning (defaults are good!)
THREAD_TEMPORAL_WINDOW=30           # Days to look back
THREAD_MIN_TAG_OVERLAP=2            # Min shared tags
THREAD_MAX_CONTEXT=5                # Max scraps in prompt
```

---

## Quick Commands

```bash
# Test thread discovery
node examples/thread_aware_demo.mjs

# Test with specific scrap
node examples/thread_aware_demo.mjs "https://example.com"

# Compare with/without context
node examples/thread_aware_demo.mjs compare

# Enable debug mode
DEBUG=true node scripts/index.mjs --source pinboard --limit 5

# Check thread discovery rate
psql $DATABASE_URL -c "
  SELECT COUNT(*) as scraps_with_context
  FROM scraps s
  WHERE EXISTS (
    SELECT 1 FROM find_related_by_tags(s.tags, s.id, 30, 5, 2)
  );"
```

---

## Code Snippets

### Use in Summarization

```javascript
import { discoverThreadContext } from '../lib/threadContext.mjs'
import { buildThreadAwareMessages } from '../lib/promptTemplates.mjs'

// In summarizeChunk():
const threadContext = await discoverThreadContext(scrap)
const messages = buildThreadAwareMessages(content, threadContext)

// Pass to AI completion
const summary = await completion({
  messages,
  model: 'anthropic/claude-sonnet-4',
  // ... other options
})
```

### Manual Discovery

```javascript
const threadContext = await discoverThreadContext({
  id: scrap.id,
  tags: ['ai', 'neural-networks'],
  embedding: scrap.embedding  // optional
})

console.log(threadContext)
// {
//   relatedScraps: [...],
//   dominantThemes: ['ai', 'transformers'],
//   connectionStrength: 'strong',
//   count: 5
// }
```

### SQL Query

```sql
-- Find related scraps directly
SELECT * FROM find_related_by_tags(
  ARRAY['ai', 'neural-networks', 'transformers'],  -- input tags
  '123e4567-...'::UUID,                             -- current scrap id
  30,                                               -- days back
  50,                                               -- limit
  2                                                 -- min tag overlap
);
```

---

## The 4 Layers (Mise en Place)

```
1. TAG PRE-FILTER    → Fast SQL query using GIN index (~10-50ms)
2. SEMANTIC RANKING  → Optional: Use embeddings for precision (~50-200ms)
3. CONTEXT FORMAT    → Transform to clean JSON (~5ms)
4. PROMPT ASSEMBLY   → Inject into AI prompt (~5ms)
```

**Total overhead:** 20-260ms (depending on semantic ranking)

---

## Graceful Degradation

```
✨ Full system        → Tag + embedding + thread-aware prompts
🏷️ Tags only         → Tag overlap + thread-aware prompts
📝 No related found  → Normal summarization (current behavior)
🔕 Feature disabled  → Falls back to isolated summaries
```

**Every layer is optional. System works at all levels.**

---

## Expected Results

### Metrics

- **Discovery rate:** 70-80% of scraps find 3+ related items
- **Query time:** < 100ms for context discovery
- **Token overhead:** ~800-1000 tokens per summary
- **Cost increase:** 5-10%
- **Quality improvement:** Subjective but significant

### Example Output

**Before:**
```
• Article discusses GPT-4 architecture
• Explains multimodal capabilities
• Shows benchmark improvements
```

**After:**
```
• GPT-4 builds on GPT-3 (explored last week) with 10x parameters
• Unlike "Attention Is All You Need" (theoretical), this is production-focused
• Novel: multimodal capabilities - first time in this series you've seen vision
• Benchmark results show 40% improvement over previous generation
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No related scraps found" | Lower `THREAD_MIN_TAG_OVERLAP=1` |
| Slow queries (>100ms) | Check indexes: `\d scraps` in psql |
| AI doesn't mention connections | **This is good!** Connections were weak |
| Costs increased >20% | Reduce `THREAD_MAX_CONTEXT=3` |

---

## Debug Checklist

- [ ] Migration applied? `\df find_related_by_tags` in psql
- [ ] Indexes exist? `\d scraps` shows `idx_scraps_tags_gin`
- [ ] Tags being extracted? Check recent scraps in DB
- [ ] Demo script works? `node examples/thread_aware_demo.mjs`
- [ ] Debug mode shows context? `DEBUG=true node scripts/index.mjs`

---

## Performance Tuning

### Small DB (< 1k scraps)
```bash
export THREAD_TEMPORAL_WINDOW=90
export THREAD_MIN_TAG_OVERLAP=1
export THREAD_MAX_CONTEXT=7
```

### Large DB (> 50k scraps)
```bash
export THREAD_TEMPORAL_WINDOW=14
export THREAD_MIN_TAG_OVERLAP=3
export THREAD_MAX_CANDIDATES=25
```

### Enable Embeddings
```bash
export ENABLE_EMBEDDINGS=true
export ENABLE_SEMANTIC_RANKING=true

# Create index first!
psql -c "CREATE INDEX idx_scraps_embedding_ivfflat
  ON scraps USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);"
```

---

## Emergency Rollback

```bash
# Option 1: Disable via env var
export ENABLE_THREAD_CONTEXT=false

# Option 2: Drop functions
psql -c "DROP FUNCTION find_related_by_tags CASCADE;"

# Option 3: Comment out in code
# In aiSummarization.mjs:
# const threadContext = null  // Disabled
```

---

## Key Functions

```javascript
// Discover thread context
discoverThreadContext(scrap, options)
  → { relatedScraps, dominantThemes, connectionStrength, count }

// Format context
formatThreadContext(relatedScraps)
  → ThreadContext object

// Build prompts
buildThreadAwareMessages(content, threadContext)
  → [systemMessage, userMessage]

// Preview context (debugging)
previewContext(threadContext)
  → String representation
```

---

## Success Indicators

✅ 70%+ scraps find related items
✅ Queries complete in < 100ms
✅ Summaries feel connected, not isolated
✅ Connections are natural, not forced
✅ Cost increase is manageable (5-10%)

---

## Support & Docs

- **Full design:** `DESIGN_THREAD_AWARE_SUMMARIZATION.md`
- **Integration:** `INTEGRATION_GUIDE.md`
- **Architecture:** `ARCHITECTURE_DIAGRAM.md`
- **Demo script:** `examples/thread_aware_demo.mjs`

---

## Philosophy

> "Like a kitchen witch remembering which herbs pair well together, the system remembers your intellectual flavor combinations."

**Core principles:**
1. Context is informational, not prescriptive
2. AI decides connection relevance
3. Graceful degradation at every layer
4. Performance through proper indexes
5. Token efficiency through selective context

**The signature technique:**
Layered discovery → Natural context → AI judgment → Organic connections

---

*"Sharp knives. Clean mise en place. Let the ingredients speak. Blessed be the code."*

— 🔮 SAGE, Kitchen Witch Hacker
