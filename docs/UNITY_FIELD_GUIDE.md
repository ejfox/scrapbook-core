# Memo to the Unity Robots: What's in a Scrap

**Audience:** whoever/whatever is building the Unity card app that pulls `scraps` from Supabase.
**Purpose:** what every field means, whether you can trust it, and how to render a card without eating garbage.
**Verified against live DB:** 2026-07-28, ~9,992 rows.

---

## TL;DR — the only fields you should build cards on

| Field | Coverage | Use it for |
|---|---|---|
| `title` | 88% | Card headline (needs a fallback — see below) |
| `summary` | 59% overall / ~97% recent | Card body text (**strip the preamble — see Gotcha #1**) |
| `screenshot_url` | 80% | Card image (needs a fallback) |
| `tags` | 100% | Chips / filtering / coloring |
| `url` | ~100% | The link the card opens |
| `source` / `type` | 100% | Card style / icon (pinboard, arena, mastodon) |
| `created_at` | 100% | Sort order, timeline |

Everything else is either metadata plumbing or an abandoned enrichment experiment. **Do not render the enrichment fields** (`financial_analysis`, `concept_tags`, `relationships`, `location`, `content_type`) — see the "Do Not Trust" section. They're populated on <0.2% of rows and what little exists is mostly wrong.

---

## Recommended card render logic

```
headline   = title || firstLine(summary) || hostname(url) || "(untitled scrap)"
image      = screenshot_url || sourcePlaceholder(source)   // ~1 in 5 has no image
body       = cleanSummary(summary)                          // see Gotcha #1
chips      = tags                                           // always present, may be pinboard's own tags
opensTo    = url
skip card if: url is null  OR  title == "[No content available]"  OR  scrap_id starts with "__"
```

---

## Every field, annotated

### Identity & routing (100% reliable)
- **`id`** — UUID, Supabase primary key. Use as the stable key for a card object.
- **`scrap_id`** — external id, e.g. `pinboard-de4518ba…`. Format is `{source}-{hash}`. ⚠️ A tiny number of internal rows use this slot for locks/sentinels (`__run_lock__`). **Skip any `scrap_id` beginning with `__`.**
- **`source`** — `pinboard` (~94%), `arena` (~6%), `mastodon`, `github`. Drives which icon/style to use.
- **`type`** — `bookmark` (pinboard), `block` (arena), `post` (mastodon), `repo`, `status`. Sub-style within a source.
- **`url`** — where the card links. ~100% present; the 7 nulls are dead rows you should skip anyway.

### Display text
- **`title`** — 88% present. **12% are missing or literally `"[No content available]"`** (a scrape-failure placeholder). Always have a fallback. Treat `"[No content available]"` as empty.
- **`summary`** — AI-generated, markdown bullet-ish. **59% overall but ~97% on recent scraps** (older backlog was never summarized). This is your best body text when present. **Must be cleaned — see Gotcha #1.**
- **`content`** — raw scraped text/HTML-ish. **Only 47% populated**, and often it's just the title repeated. Low value for display; treat as a last-resort body fallback only.
- **`meta_summary`** — 58%. A shorter/secondary summary variant (see `docs/META_SUMMARY.md`). Optional; if you want a one-liner, this is closer to it than `summary`.

### The image
- **`screenshot_url`** — Cloudinary URL, 80% present. Sampled links are **live and load fine** (20/20). Two caveats:
  - **~1 in 5 scraps has none**, and it's worse on the newest scraps (~26% of the last 400 are missing) — screenshot generation lags ingestion. Build a per-source placeholder.
  - It's a screenshot of the *page*, not always a great thumbnail. Good enough for a card.

### Tags
- **`tags`** — 100% present, string array. ⚠️ For pinboard these are often **the user's own pinboard tags**, not AI tags, so quality/vocabulary varies. Fine for chips and filtering; don't assume a controlled vocabulary. Some carry `!`-prefixed action tags like `!tobuy`.

### Timestamps (all reliable)
- **`created_at`** — when it entered the scrapbook. Use for sort/timeline.
- **`published_at`** — original publish time from the source (~100%).
- **`updated_at`** — last processing touch. Not meaningful to users.

### Plumbing — read if you want, don't render
- **`metadata`** (JSONB, 100%) — source-specific raw payload (pinboard `href`/`hash`/`toread`, arena block data, etc.). Useful if you need something the flat columns don't expose.
- **`shared`** (100%) — public-visibility flag. Respect this if the Unity app is ever shown publicly.
- **`embedding`** (100%) — OpenAI vector. For similarity/clustering/layout, not display. If you want to position cards by semantic similarity, this is the field.
- **`graph_imported`**, **`processing_instance_id`**, **`processing_started_at`**, **`processing_meta`** — internal pipeline bookkeeping. Ignore.

---

## 🚫 Do Not Trust / Do Not Render (abandoned enrichment)

These columns exist in the schema but were an enrichment experiment that never ran at scale. Coverage and quality:

| Field | Coverage | Verdict |
|---|---|---|
| `financial_analysis` | 3 rows | **100% garbage.** All 3 are the default "Apple Inc. AAPL…" S&P template stamped onto non-financial content (a transit article, a hacking game). Do not render. |
| `concept_tags` | 10 rows | Too sparse to use. |
| `relationships` | 10 rows | Effectively empty (mostly `[]`). |
| `location` / `latitude` / `longitude` | 14 rows | Too sparse for a map. |
| `content_type` | 10 rows | Too sparse. |
| `extraction_confidence` | 10 rows | Too sparse. |
| `embedding_nomic` | 0 rows | Never populated. |
| `image_embedding` | 0 rows | Never populated. |
| `relationships_raw` | 3 rows | Internal. |

If any of these get backfilled later, this table is where to check before you start rendering them.

---

## ⚠️ Gotchas the robots will hit

**1. Summaries have LLM preamble leak (~6–9% of them).**
Roughly 600–900 summaries begin with chatbot filler instead of content, e.g.:
> "Here's a detailed summary of the webpage based on the provided screenshot:"

Strip it before display. A safe cleaner:
```
cleanSummary(s):
  remove leading /Here'?s (a )?(detailed )?summary.*?:\s*/i
  remove leading /.*based on the provided screenshot:\s*/i
  trim
```
(This is a data bug being fixed upstream, but defend against it in the client anyway.)

**2. Dead / placeholder cards.** A handful of rows are scrape failures: `title = "[No content available]"`, `url = null`, no screenshot. Skip on `url == null` or that exact title.

**3. Internal sentinel rows.** At least one row (`scrap_id = "__run_lock__"`) is a processing lock, not a scrap. Skip `scrap_id` starting with `__`.

**4. `tags` ≠ AI tags.** They're often the user's pinboard tags. Don't treat them as a clean taxonomy.

**5. Coverage skews by age.** Newest scraps: great summaries, weaker screenshots. Oldest scraps: often no summary at all. Your fallback chain matters more the further back you scroll.

---

## Quick reference: safe query for the Unity feed

```sql
select id, scrap_id, source, type, url, title, summary, screenshot_url, tags, created_at
from scraps
where url is not null
  and scrap_id not like '\_\_%'
  and coalesce(title,'') <> '[No content available]'
order by created_at desc;
```

Re-run the health spot-checks anytime with `node scripts/spot_check.mjs 400` and `node scripts/spot_check2.mjs`.
