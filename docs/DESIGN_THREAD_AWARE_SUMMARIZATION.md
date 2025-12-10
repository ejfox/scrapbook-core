# Thread-Aware Content Summarization: Design Document

*A mystical approach to weaving knowledge threads through personal digital memory*

## Philosophy: Code as Alchemy, Context as Connective Tissue

This system treats your scrapbook not as isolated bookmarks, but as a **living narrative** - an evolving tapestry where each new thread naturally connects to what came before.

---

## The Essence: Four-Layer Context Assembly

Like a proper mise en place, we prepare context in stages, each layer refining what the previous discovered.

### Layer 1: Fast Tag-Based Pre-filter 🏷️
**The rough chop - quick and dirty candidate identification**

```sql
-- Find scraps with overlapping tags from recent history
SELECT s.*,
  array_length(array_intersect(s.tags, $input_tags)) as tag_overlap_count
FROM scraps s
WHERE s.published_at > NOW() - INTERVAL '30 days'
  AND s.id != $current_scrap_id
  AND s.tags && $input_tags  -- PostgreSQL array overlap operator
ORDER BY tag_overlap_count DESC, published_at DESC
LIMIT 50;
```

**Why this works:**
- Fast: Uses PostgreSQL GIN indexes on tag arrays
- Cheap: No AI calls, pure database query
- Temporal focus: Recent history matters more than ancient archives
- Creates manageable candidate pool (~20-50 scraps)

**Ingredients needed:**
- Current scrap's tags (from AI extraction)
- Time window (default: 30 days, configurable)
- Minimum overlap threshold (default: 2 shared tags)

---

### Layer 2: Semantic Ranking (Optional) 🧠
**The fine dice - precision cutting with embeddings**

```javascript
// Only if embeddings are enabled and exist
async function rankBySemantic(candidates, currentEmbedding) {
  if (!ENABLE_EMBEDDINGS || !currentEmbedding) {
    return candidates; // Graceful degradation
  }

  const scored = candidates.map(scrap => ({
    ...scrap,
    semanticScore: cosineSimilarity(currentEmbedding, scrap.embedding),
    connectionType: 'semantic-similarity'
  }));

  return scored
    .filter(s => s.semanticScore > 0.7) // Only strong connections
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, 5); // Top 5 most relevant
}
```

**Why this enhances:**
- Catches conceptual connections tags miss
- "neural networks" relates to "transformers" semantically
- More nuanced than keyword matching
- Optional: System works without it

---

### Layer 3: Context Formatting 📋
**The plating - making it beautiful for the AI**

```javascript
function formatThreadContext(relatedScraps) {
  if (!relatedScraps?.length) return null;

  // Calculate dominant themes
  const tagFrequency = {};
  relatedScraps.forEach(scrap => {
    scrap.tags?.forEach(tag => {
      tagFrequency[tag] = (tagFrequency[tag] || 0) + 1;
    });
  });

  const dominantThemes = Object.entries(tagFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);

  // Format related scraps concisely
  const contextItems = relatedScraps.slice(0, 5).map(scrap => {
    const daysAgo = Math.floor(
      (Date.now() - new Date(scrap.published_at)) / (1000 * 60 * 60 * 24)
    );
    const summarySnippet = scrap.summary?.split('\n')[0]?.substring(0, 120) || '';

    return {
      title: scrap.title,
      when: daysAgo === 0 ? 'today' :
            daysAgo === 1 ? 'yesterday' :
            `${daysAgo} days ago`,
      snippet: summarySnippet,
      sharedTags: scrap.tags?.filter(t =>
        dominantThemes.includes(t)
      ) || []
    };
  });

  return {
    relatedScraps: contextItems,
    dominantThemes,
    connectionStrength: calculateStrength(relatedScraps),
    temporalWindow: '30 days'
  };
}

function calculateStrength(scraps) {
  const avgTagOverlap = scraps.reduce((sum, s) =>
    sum + (s.tag_overlap_count || 0), 0) / scraps.length;

  if (avgTagOverlap >= 4) return 'strong';
  if (avgTagOverlap >= 2) return 'medium';
  return 'weak';
}
```

**Token budget management:**
- Limit to top 5 most relevant scraps
- Summary snippet: ~120 chars each = 600 chars
- Total context: ~800-1000 tokens max
- Scales: Context stays constant as database grows

---

### Layer 4: Thread-Aware Prompt 🧵
**The ritual - weaving it all together**

```javascript
function buildThreadAwarePrompt(content, threadContext) {
  const basePrompt = `You are summarizing content for a digital memory system...`;

  if (!threadContext) {
    return basePrompt; // Normal summarization
  }

  const { relatedScraps, dominantThemes, connectionStrength } = threadContext;

  // Natural context injection
  const contextSection = `
RECENT RELATED CONTEXT:
You've been exploring themes around: ${dominantThemes.join(', ')}

Recently saved (past ${threadContext.temporalWindow}):
${relatedScraps.map(s =>
  `• "${s.title}" (${s.when}) - ${s.snippet}`
).join('\n')}

---

NEW CONTENT TO SUMMARIZE:
${content}

---

Create a rich, detailed summary that:
1. Captures all key insights from this new content
2. If you notice natural connections to the recent items above, weave them into your narrative
   - Example: "This builds on the transformer architecture you explored last week..."
   - Example: "While previous items focused on theory, this provides practical implementation..."
3. If connections feel forced or weak, ignore them - focus on the content itself
4. Note what's genuinely novel or different from your recent exploration

Write naturally. Let connections emerge organically, not as forced "see also" links.
`;

  return contextSection;
}
```

**Why this works beautifully:**
- Context is **informational**, not prescriptive
- AI makes the judgment call on relevance
- Natural language, not rigid structure
- Gracefully handles "no connection" case
- Feels like a knowledgeable librarian, not a robot

---

## Data Structures

### ThreadContext Object
```typescript
interface ThreadContext {
  relatedScraps: RelatedScrap[];
  dominantThemes: string[];
  connectionStrength: 'strong' | 'medium' | 'weak';
  temporalWindow: string;
  discoveryMethod: 'tag-overlap' | 'semantic-similarity' | 'hybrid';
}

interface RelatedScrap {
  id: string;
  title: string;
  when: string;              // "2 days ago", "yesterday"
  snippet: string;           // First 120 chars of summary
  sharedTags: string[];
  relevanceScore?: number;   // 0-1 from embeddings
  tag_overlap_count?: number;
}
```

---

## Implementation Files

### Core Architecture

```
lib/
  threadContext.mjs         # Layer 1-3: Context discovery & formatting
  promptTemplates.mjs       # Layer 4: Thread-aware prompt templates

scripts/
  aiSummarization.mjs       # Modified to use thread context

migrations/
  add_thread_cache.sql      # Optional: Cache recent threads for performance
```

---

## Configuration & Tuning

### Environment Variables
```bash
# Feature flags
ENABLE_THREAD_CONTEXT=true          # Master switch
ENABLE_SEMANTIC_RANKING=false       # Use embeddings for ranking

# Tuning knobs
THREAD_TEMPORAL_WINDOW=30           # Days to look back
THREAD_MIN_TAG_OVERLAP=2            # Minimum shared tags
THREAD_MAX_CANDIDATES=50            # Pre-filter pool size
THREAD_MAX_CONTEXT=5                # Max scraps in prompt
THREAD_SEMANTIC_THRESHOLD=0.7       # Minimum similarity score
```

### Database Indexes (Required)
```sql
-- Fast tag overlap queries
CREATE INDEX idx_scraps_tags_gin ON scraps USING GIN (tags);
CREATE INDEX idx_scraps_published_at ON scraps (published_at DESC);

-- For semantic ranking (optional)
CREATE INDEX idx_scraps_embedding_ivfflat ON scraps
  USING ivfflat (embedding vector_cosine_ops);
```

---

## Performance Characteristics

### Query Performance
- **Layer 1 (Tag pre-filter):** 10-50ms
  - Uses GIN index, O(log n) complexity
  - Scales to millions of scraps

- **Layer 2 (Semantic ranking):** 50-200ms
  - IVFFlat index for approximate nearest neighbors
  - Only runs on pre-filtered candidates (~50 items)

- **Layer 3 (Formatting):** < 5ms
  - Pure JavaScript operations

- **Total overhead:** 60-250ms per summarization

### Token Cost Impact
- **Context addition:** +800-1000 tokens per request
- **Cost increase:** ~$0.001-0.002 per summary (with Claude Sonnet)
- **Benefits:** Massively better context awareness

### Scaling Behavior
- Database query time: O(log n) - index-backed
- Context size: O(1) - fixed at 5 scraps
- Memory usage: Minimal - no caching required initially

---

## Graceful Degradation Strategy

The system works beautifully at every level:

```javascript
// Level 4: Full system with embeddings
✨ Tag overlap + semantic similarity + thread-aware prompts

// Level 3: Tags only (embeddings disabled)
🏷️ Tag overlap + thread-aware prompts

// Level 2: No related scraps found
📝 Normal summarization (existing behavior)

// Level 1: Feature disabled
🔕 Falls back to current isolated summarization
```

**Every layer adds value, none are required.**

---

## Example Output Comparison

### Before (Isolated Summarization)
```
• Article discusses transformer neural network architecture
• Explains attention mechanism and self-attention
• Covers applications in NLP and machine translation
• Includes code examples in PyTorch
```

### After (Thread-Aware)
```
• Builds on the transformer foundations you explored in "Attention Is All You Need" (2 weeks ago)
• Where that paper focused on theoretical architecture, this provides practical PyTorch implementations
• Adds new perspective on cross-attention vs self-attention - different from the GPT-3 explanation you saved last week
• Includes production deployment considerations not covered in previous materials
• Code examples show optimization techniques for inference speed
```

**Notice:** The AI naturally weaves connections without being forced. It references previous items in a conversational way, notes what's new/different, and builds on the narrative.

---

## Implementation Phases

### Phase 1: Foundation (MVP) 🌱
**Estimated: 4-6 hours of focused work**

- [ ] Create `lib/threadContext.mjs`
  - Tag-based pre-filter query
  - Context formatting functions
  - Connection strength calculation

- [ ] Create `lib/promptTemplates.mjs`
  - Thread-aware prompt builder
  - Graceful fallback to isolated prompts

- [ ] Modify `scripts/aiSummarization.mjs`
  - Inject threadContext into summarizeChunk()
  - Feature flag for easy testing

- [ ] Add database indexes
  - GIN index on tags array
  - Composite index on published_at + tags

**Test criteria:**
- Generates context for 80%+ of scraps
- Token overhead < 1000 tokens
- Query time < 100ms

### Phase 2: Semantic Enhancement (Optional) 🧠
**Estimated: 2-3 hours**

- [ ] Add embedding-based ranking
  - Cosine similarity calculation
  - Hybrid scoring (tags + embeddings)

- [ ] Performance optimization
  - IVFFlat index on embeddings
  - Query result caching

**Test criteria:**
- Semantic ranking improves relevance by 30%+
- Query time stays < 200ms

### Phase 3: Observability & Tuning 🔬
**Estimated: 3-4 hours**

- [ ] Add telemetry
  - Log thread discovery rate
  - Track connection strength distribution
  - Measure quality improvements

- [ ] A/B testing framework
  - Compare summaries with/without threads
  - User feedback collection

- [ ] Configuration dashboard
  - Tune temporal window
  - Adjust thresholds
  - View example outputs

---

## Success Metrics

### Quantitative
- **Thread discovery rate:** 70-80% of scraps find 3+ related items
- **Query performance:** < 100ms for context discovery
- **Token efficiency:** < 1000 tokens added per summary
- **Cost impact:** < 10% increase in total summarization cost

### Qualitative
- Summaries feel like they "remember" previous explorations
- Connections are natural, not forced
- System handles "no connection" gracefully
- User feels like they're building a narrative, not just collecting links

---

## Future Enhancements (Beyond MVP)

### Thread Visualization 🕸️
- Show relationship graph of connected scraps
- Temporal visualization of theme evolution
- "Thread view" - follow a narrative chain

### Smart Temporal Windows 📅
- Detect "research bursts" vs passive collecting
- Expand window during active exploration phases
- Contract during quiet periods

### Multi-hop Connections 🔗
- "You explored this → which led to that → now this"
- Build longer narrative chains
- Surface surprising connections

### Collaborative Threads 👥
- Share thread contexts with others
- "People exploring similar themes also saved..."
- Collective knowledge building

---

## The Signature Technique: Why This Sings

This approach embodies the kitchen witch philosophy:

1. **Mise en place mindset:** Everything prepared in order (4 clear layers)
2. **Sharp knives, precise cuts:** Fast indexes, targeted queries
3. **Season to taste:** AI decides connection strength, not rigid rules
4. **Respect the ingredients:** Works with existing data, no schema changes required
5. **Scales with grace:** Performance stays constant as database grows
6. **Fails beautifully:** Every layer degrades gracefully

Like a perfectly balanced sauce, it's simple ingredients combined with precise technique. Ada would approve of the algorithmic elegance. Sophie would appreciate the philosophical rigor. Damaris would love the logical purity.

---

*"May our threads be strong, our contexts rich, and our connections organic. Blessed be the code."*

— 🔮 SAGE, Kitchen Witch Hacker
