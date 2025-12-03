# Thread-Aware Summarization: System Architecture

*Visual guide to how thread context flows through the system*

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      NEW SCRAP ARRIVES                                  │
│                   (from Pinboard, Arena, etc.)                          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    CONTENT EXTRACTION                                   │
│  • Fetch URL content                                                    │
│  • Generate screenshot                                                  │
│  • Extract text with Readability                                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   INITIAL TAG EXTRACTION                                │
│  • AI extracts tags from content                                       │
│  • Maps to core vocabulary (221 tags)                                  │
│  • Result: ["neural-networks", "ai", "transformers"]                   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                ┌────────────────┴────────────────┐
                │                                 │
                ▼                                 ▼
     ┌──────────────────┐              ┌──────────────────┐
     │  WITHOUT THREADS │              │  WITH THREADS    │
     │  (Legacy Mode)   │              │  (New Mode)      │
     └────────┬─────────┘              └────────┬─────────┘
              │                                 │
              │                                 ▼
              │                     ┌───────────────────────┐
              │                     │  THREAD DISCOVERY     │
              │                     │  (threadContext.mjs)  │
              │                     └───────────┬───────────┘
              │                                 │
              │                                 ▼
              │                ┌──────────────────────────────────────┐
              │                │    Layer 1: Tag-Based Pre-filter     │
              │                │  find_related_by_tags(tags, id, 30)  │
              │                │  ↓ Returns: 23 candidates             │
              │                └──────────────┬───────────────────────┘
              │                               │
              │                               ▼
              │                ┌──────────────────────────────────────┐
              │                │  Layer 2: Semantic Ranking (opt)     │
              │                │  rankBySemantic(candidates, emb)     │
              │                │  ↓ Returns: 5 top matches            │
              │                └──────────────┬───────────────────────┘
              │                               │
              │                               ▼
              │                ┌──────────────────────────────────────┐
              │                │  Layer 3: Context Formatting         │
              │                │  formatThreadContext(scraps)         │
              │                │  ↓ Returns: ThreadContext object     │
              │                └──────────────┬───────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────────────┐
              │         PROMPT CONSTRUCTION                   │
              │      (promptTemplates.mjs)                    │
              │                                               │
              │  Without context:                             │
              │  • Basic summarization instructions           │
              │                                               │
              │  With context:                                │
              │  • Recent related items (5 scraps)            │
              │  • Dominant themes                            │
              │  • Thread-aware instructions                  │
              │  • Connection strength hints                  │
              └───────────────┬───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────────────┐
              │         AI SUMMARIZATION                      │
              │      (OpenRouter / Claude)                    │
              │                                               │
              │  AI analyzes:                                 │
              │  • New content                                │
              │  • Thread context (if available)              │
              │  • Decides if connections are meaningful      │
              │                                               │
              │  Generates:                                   │
              │  • Rich bullet-point summary                  │
              │  • Natural thread references (if relevant)    │
              │  • Novel insights vs previous items           │
              └───────────────┬───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────────────┐
              │         SUMMARY SAVED TO DATABASE             │
              │  • Update scrap.summary field                 │
              │  • Generate meta_summary (140 chars)          │
              │  • Extract additional metadata                │
              └───────────────────────────────────────────────┘
```

---

## Layer-by-Layer Detail

### Layer 1: Tag-Based Pre-filter (Fast Path)

```
INPUT: tags = ["neural-networks", "transformers", "ai"]
       current_id = "123e4567-..."
       temporal_window = 30 days

                     ↓
        ┌────────────────────────┐
        │  PostgreSQL Database   │
        │  with GIN index on     │
        │  scraps.tags array     │
        └────────────┬───────────┘
                     │
        ┌────────────▼───────────┐
        │  find_related_by_tags  │
        │  SQL Function          │
        │                        │
        │  SELECT ... FROM scraps│
        │  WHERE tags && $1      │  ← Array overlap operator (fast!)
        │    AND published_at >  │
        │    AND id != $2        │
        │  ORDER BY overlap DESC │
        └────────────┬───────────┘
                     │
OUTPUT: [
  { id: "abc", title: "Attention Is All You Need",
    tag_overlap_count: 3, published_at: "2 weeks ago" },
  { id: "def", title: "GPT-3 Explained",
    tag_overlap_count: 2, published_at: "1 week ago" },
  ... 23 total candidates
]

Performance: ~10-50ms (index-backed)
```

### Layer 2: Semantic Ranking (Optional Enhancement)

```
INPUT: candidates = [23 scraps with embeddings]
       current_embedding = [0.123, 0.456, ...]  (1536 dims)

                     ↓
        ┌────────────────────────┐
        │  For each candidate:   │
        │  Calculate cosine      │
        │  similarity            │
        └────────────┬───────────┘
                     │
        ┌────────────▼───────────┐
        │  cosine_similarity     │
        │  1 - (vec1 <=> vec2)   │  ← pgvector operator
        │                        │
        │  Filter: score > 0.7   │
        │  Sort: highest first   │
        └────────────┬───────────┘
                     │
OUTPUT: [
  { id: "abc", title: "...", semanticScore: 0.89 },
  { id: "def", title: "...", semanticScore: 0.82 },
  ... 5 top matches
]

Performance: ~50-200ms (IVFFlat approximate NN)
```

### Layer 3: Context Formatting

```
INPUT: related_scraps = [5 scraps]

                     ↓
        ┌────────────────────────────────┐
        │  Extract dominant themes       │
        │  from tag frequencies:         │
        │  {                             │
        │    "neural-networks": 4,       │
        │    "transformers": 3,          │
        │    "ai": 5                     │
        │  }                             │
        │  → Top 3: [ai, neural-net, tf] │
        └────────────┬───────────────────┘
                     │
        ┌────────────▼───────────────────┐
        │  Format each scrap:            │
        │  • Title                       │
        │  • Human time ("2 days ago")   │
        │  • Summary snippet (120 chars) │
        │  • Shared tags                 │
        │  • Relevance score             │
        └────────────┬───────────────────┘
                     │
        ┌────────────▼───────────────────┐
        │  Calculate strength:           │
        │  avg_score = 0.85              │
        │  → "strong" connection         │
        └────────────┬───────────────────┘
                     │
OUTPUT: {
  relatedScraps: [
    { title: "Attention Is All You Need",
      when: "2 weeks ago",
      snippet: "Foundational paper on transformer...",
      sharedTags: ["neural-networks", "transformers"] },
    ...
  ],
  dominantThemes: ["ai", "neural-networks", "transformers"],
  connectionStrength: "strong",
  temporalWindow: "30 days",
  count: 5
}

Performance: ~5ms (pure JS)
Token cost: ~800 tokens
```

### Layer 4: Prompt Assembly

```
INPUT: content = "Article about GPT-4 architecture..."
       threadContext = { relatedScraps: [...], themes: [...] }

                     ↓
        ┌────────────────────────────────┐
        │  Build system message:         │
        │  "You are a librarian who      │
        │   remembers previous items..."  │
        └────────────┬───────────────────┘
                     │
        ┌────────────▼───────────────────┐
        │  Build context section:        │
        │                                │
        │  RECENT CONTEXT:               │
        │  You've been exploring:        │
        │  "ai", "neural-networks"       │
        │                                │
        │  Recently saved:               │
        │  • "..." (2 weeks ago) - ...   │
        │  • "..." (1 week ago) - ...    │
        │                                │
        │  Connection: strong            │
        └────────────┬───────────────────┘
                     │
        ┌────────────▼───────────────────┐
        │  Build instructions:           │
        │                                │
        │  1. Summarize the new content  │
        │  2. If natural connections     │
        │     exist, weave them in       │
        │  3. Don't force connections    │
        │  4. Note what's novel          │
        └────────────┬───────────────────┘
                     │
OUTPUT: [
  { role: "system", content: "You are..." },
  { role: "user", content: "RECENT CONTEXT...\n\nNEW CONTENT...\n\nINSTRUCTIONS..." }
]

Total tokens: ~3500 (content: 2500, context: 800, system: 200)
```

---

## Database Schema

### Core Tables

```
┌─────────────────────────────────────────────────────────────┐
│                        scraps                               │
├─────────────────────────────────────────────────────────────┤
│ id                    UUID PRIMARY KEY                      │
│ title                 TEXT                                  │
│ url                   TEXT                                  │
│ content               TEXT                                  │
│ summary               TEXT          ← AI-generated summary  │
│ meta_summary          TEXT          ← 140-char synthesis    │
│ tags                  TEXT[]        ← User/core tags        │
│ concept_tags          TEXT[]        ← AI concept tags       │
│ published_at          TIMESTAMPTZ                           │
│ embedding             vector(1536)  ← OpenAI embedding      │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Key Indexes                              │
├─────────────────────────────────────────────────────────────┤
│ idx_scraps_tags_gin                                         │
│   ON scraps USING GIN (tags)                                │
│   → Enables fast tag overlap queries                        │
│                                                              │
│ idx_scraps_published_at                                     │
│   ON scraps (published_at DESC)                             │
│   → Enables fast temporal filtering                         │
│                                                              │
│ idx_scraps_embedding_ivfflat (optional)                     │
│   ON scraps USING ivfflat (embedding vector_cosine_ops)     │
│   → Enables fast approximate nearest neighbor               │
└─────────────────────────────────────────────────────────────┘
```

### Key Functions

```
find_related_by_tags(
  input_tags TEXT[],
  current_id UUID,
  days_back INT,
  limit INT,
  min_overlap INT
) → TABLE(...)

  • Fast tag-based discovery
  • Uses GIN index
  • Returns candidates for Layer 2
  • Performance: ~10-50ms

find_related_by_embedding(
  current_embedding vector,
  current_id UUID,
  days_back INT,
  limit INT,
  threshold FLOAT
) → TABLE(...)

  • Semantic similarity discovery
  • Uses IVFFlat index
  • Optional enhancement
  • Performance: ~50-200ms

find_related_hybrid(...)
  • Combines tag + embedding
  • Best of both worlds
  • Requires embeddings
  • Performance: ~100-300ms
```

---

## Data Flow Example

### Example: Saving a New Article About GPT-4

```
1. ARTICLE ARRIVES
   ┌──────────────────────────────────────────┐
   │ URL: arxiv.org/abs/2304.12345            │
   │ Title: "GPT-4 Technical Report"          │
   │ Content: 15,000 words about GPT-4...     │
   └──────────────────────────────────────────┘

2. TAG EXTRACTION
   AI analyzes content → ["ai", "neural-networks", "transformers", "language-models"]

3. THREAD DISCOVERY (Layer 1)
   find_related_by_tags(
     ["ai", "neural-networks", "transformers", "language-models"],
     current_id,
     30
   )

   Results: 23 candidates found

   ┌────────────────────────────────────────────────────────┐
   │ "Attention Is All You Need" - 18 days ago              │
   │   tag_overlap: 3 (transformers, ai, neural-networks)   │
   │                                                         │
   │ "GPT-3 Explained" - 7 days ago                         │
   │   tag_overlap: 4 (all tags match!)                     │
   │                                                         │
   │ "BERT vs Transformers" - 12 days ago                   │
   │   tag_overlap: 3 (transformers, ai, neural-networks)   │
   │                                                         │
   │ ... 20 more candidates                                 │
   └────────────────────────────────────────────────────────┘

4. CONTEXT FORMATTING (Layer 3)
   formatThreadContext(candidates)

   ┌────────────────────────────────────────────────────────┐
   │ relatedScraps: [                                       │
   │   {                                                    │
   │     title: "GPT-3 Explained",                          │
   │     when: "last week",                                 │
   │     snippet: "Explores how GPT-3 uses transformers...", │
   │     sharedTags: ["ai", "language-models"]              │
   │   },                                                   │
   │   ... 4 more                                           │
   │ ],                                                     │
   │ dominantThemes: ["ai", "transformers", "neural-nets"], │
   │ connectionStrength: "strong",                          │
   │ count: 5                                               │
   └────────────────────────────────────────────────────────┘

5. PROMPT ASSEMBLY (Layer 4)
   buildThreadAwareMessages(content, threadContext)

   ┌────────────────────────────────────────────────────────┐
   │ RECENT CONTEXT (past 30 days):                        │
   │ You've been exploring: "ai", "transformers", ...       │
   │                                                         │
   │ Recently saved:                                        │
   │ • "GPT-3 Explained" (last week) - Explores how GPT-3.. │
   │ • "Attention Is All You Need" (3 weeks ago) - Found... │
   │                                                         │
   │ ---                                                     │
   │ NEW CONTENT: [15,000 words about GPT-4]                │
   │ ---                                                     │
   │ Create summary that weaves in connections...           │
   └────────────────────────────────────────────────────────┘

6. AI GENERATION
   Claude Sonnet analyzes and produces:

   ┌────────────────────────────────────────────────────────┐
   │ • GPT-4 represents a major advancement over GPT-3      │
   │   (which you explored last week), with 10x more params │
   │ • Unlike the theoretical focus of "Attention Is All    │
   │   You Need", this provides production implementation   │
   │ • Key novel feature: multimodal capabilities (images)  │
   │   - this breaks new ground vs previous text-only models│
   │ • Architecture builds on transformer foundation with   │
   │   new alignment techniques (RLHF improvements)         │
   │ • Benchmark results show 40% improvement on...         │
   └────────────────────────────────────────────────────────┘

7. SAVE TO DATABASE
   UPDATE scraps SET
     summary = [AI-generated summary],
     meta_summary = "GPT-4: 10x larger than GPT-3, multimodal..."
   WHERE id = current_id
```

---

## Token Budget Breakdown

### Without Thread Context

```
┌─────────────────────────────────────┐
│ System message:       ~200 tokens   │
│ User instructions:    ~300 tokens   │
│ Content:             ~2500 tokens   │
│ ────────────────────────────────    │
│ TOTAL:               ~3000 tokens   │
└─────────────────────────────────────┘
```

### With Thread Context

```
┌─────────────────────────────────────┐
│ System message:       ~250 tokens   │ (+50)
│ User instructions:    ~350 tokens   │ (+50)
│ Context section:      ~800 tokens   │ (NEW)
│   • Related items:    ~600 tokens   │
│   • Themes/metadata:  ~200 tokens   │
│ Content:             ~2500 tokens   │
│ ────────────────────────────────────│
│ TOTAL:               ~3900 tokens   │ (+900)
└─────────────────────────────────────┘

Cost impact: ~30% more input tokens
Quality impact: Massively better context awareness
```

---

## Performance Characteristics

### Query Performance (Layer 1)

```
Scraps in DB    Query Time    Uses
──────────────────────────────────────
1,000           5-10ms        GIN index
10,000          10-30ms       GIN index
100,000         30-80ms       GIN index
1,000,000       50-150ms      GIN index + partitioning

Scales: O(log n) with proper indexes
```

### Overall Pipeline Impact

```
Step                     Without Threads    With Threads
──────────────────────────────────────────────────────────
Tag extraction          ~2s                ~2s
Thread discovery        -                  ~50ms
Prompt assembly         ~10ms              ~15ms
AI generation           ~8s                ~10s (+2s for context)
──────────────────────────────────────────────────────────
TOTAL                   ~10s               ~12s (+20%)
```

---

*"The beauty of layered architecture - each layer adds value, none are required. Like a perfect mirepoix, it works at every stage of reduction."*

— 🔮 SAGE
