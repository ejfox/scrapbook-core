# Claude Code Session Notes

## Database

### Supabase (Primary - Cloud)
- **URL**: `https://xmdylmbdeulxcqdbkfno.supabase.co`
- **Table**: `scraps`
- **Count**: ~9,592 scraps
- **Date range**: 2010-03-05 to present

### SQLite (Local - Stale)
- **Path**: `~/scraps.db`
- **Count**: 10,335 scraps
- **Last synced**: June 2025 (6 months stale)
- **Note**: Missing 12 columns added for AI processing. Sync script needs update.

## Schema (Supabase - verified 2025-12)

Core fields:
- `id` - UUID primary key
- `scrap_id` - External ID from source
- `source` - pinboard, arena, github, mastodon
- `type` - bookmark, block, repo, status
- `url` - Source URL
- `title` - Title
- `content` - Raw content
- `created_at` / `updated_at` / `published_at`

AI extraction fields:
- `summary` - AI-generated summary
- `tags` - Array of tags
- `concept_tags` - Higher-level concept tags
- `relationships` - Entity relationships (JSONB array)
- `location` - Extracted location name
- `latitude` / `longitude` - Geocoded coordinates
- `financial_analysis` - Financial data (JSONB)
- `extraction_confidence` - Confidence scores (JSONB)
- `content_type` - article, video, etc.

Embedding fields:
- `embedding` - OpenAI embedding vector
- `embedding_nomic` - Nomic embedding vector
- `image_embedding` - Image embedding vector

Other:
- `screenshot_url` - Cloudinary screenshot
- `metadata` - Source-specific metadata (JSONB)
- `shared` - Public visibility flag
- `graph_imported` - Neo4j sync status
- `processing_instance_id` / `processing_started_at` - Processing locks

Screenshot quality fields (migrations/add_screenshot_quality.sql):
- `capture_status` - HTTP status at capture time (int2)
- `screenshot_quality` - accept | reject | review | recapture_pending. **Unity feed filter: `screenshot_quality = 'accept' OR screenshot_quality IS NULL`**
- `quality_category` - content|login_wall|captcha|error_page|cookie_wall|blank|css_broken|unknown
- `quality_score` - 0..1 confidence the shot is good content
- `quality_signals` - JSONB {aspect,dominantPct,entropy,visionConfidence,domain,recaptures}
- `quality_checked_at` - last gate timestamp
- `hide_shot_in_unity` - reject => render text/color card, keep the scrap

## Screenshot quality pipeline
```bash
# Gate stored screenshots (accept/reject/review). --dry = no writes, --no-vision = Stage A only
node scripts/quality_gate.mjs --dry --limit 100
node scripts/quality_gate.mjs --limit 500

# Corpus backfill: classify all, then auto-recapture retryable rejects
node scripts/quality_backfill.mjs classify [--dry]
node scripts/quality_backfill.mjs recapture [--dry]

# Human triage of the 'review' lane (keyboard UI):
node scripts/api-server.mjs   # then open http://localhost:3001/review

# Import logged-in social cookies (Cookie-Editor JSON export) for un-walling:
node scripts/import_cookies.mjs <export.json> [domainKey]
```

## Status Commands
```bash
# Field completeness (recent 64 scraps with samples)
node scripts/audit_fields.mjs

# Full backlog audit with health score
node scripts/audit_backlog.mjs [limit]

# Unprocessed items check
node scripts/check_backlog.mjs

# Deep AI quality analysis
node scripts/comprehensive_quality_audit.mjs

# API/service health (costs ~$0.01)
node scripts/health_check.mjs
```

## Processing Commands
```bash
# Main processing
node scripts/index.mjs

# Repair/reprocess
node scripts/scrap_doctor_ai.mjs repair --limit 100
node scripts/scrap_doctor_ai.mjs repair --type summary --limit 100
node scripts/scrap_doctor_ai.mjs repair --type relationships --limit 100
```

## Data Sources
- `pinboard` - ~94% of scraps
- `arena` - ~6% of scraps

## Environment Variables
Required:
- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `OPENCAGE_API_KEY`

Optional:
- `PINBOARD_TOKEN`
- `GITHUB_TOKEN`
- `MASTODON_ACCESS_TOKEN`
- `ARENA_ACCESS_TOKEN`
