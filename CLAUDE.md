# Claude Code Session Notes

## Database Environment
- **Supabase URL**: `https://xmdylmbdeulxcqdbkfno.supabase.co`
- **Database**: `scraps` table (primary data store)
- **Environment**: Production instance with live data
- **Total Scraps**: 9,485 (as of 2025-09-30)

## 🔴 CRITICAL: Archive Completeness Status (2025-09-30)
**Overall Health Score: 16.7%** - Massive unprocessed backlog!

### Field Completeness Audit:
- **ai_summary**: 0% (0/9,485) ❌ CRITICAL
- **ai_tags**: 0% (0/9,485) ❌ CRITICAL
- **relationships**: 5.9% (561/9,485) ⚠️
- **location**: 2.6% (247/9,485) ⚠️
- **financial_analysis**: 0.1% (6/9,485) ❌
- **screenshot_url**: 8.2% (779/9,485) ⚠️
- **content**: 100% (9,485/9,485) ✅

### Recent Processing Activity:
- Last 24 hours: 236 processed
- Last 7 days: 7,144 processed
- Backlog requiring processing: ~9,000 scraps

## Recent Bug Fixes (2025-09-30)

### 1. ✅ FIXED: Zombie Process Issue
- **Problem**: Cron jobs never exiting, creating 10+ stuck processes
- **Solution**: Added `process.exit(0)` after successful completion in `scripts/index.mjs`
- **Added**: 10-minute timeout protection with `MAX_RUNTIME_MS`

### 2. ✅ FIXED: Location Extraction Bug
- **Problem**: All locations showing "Unknown"
- **Solution**: Fixed `scripts/scrap_doctor_ai.mjs:210` - changed `locationData.name` to `locationData.location`
- **Added**: OpenCage API key for geocoding with lat/lon coordinates

### 3. ✅ FIXED: Relationship Extraction Quality
- **Problem**: 0% success rate, malformed structures, generic "Entity" types
- **Solutions**:
  - Enhanced AI prompt to request entity types in Cypher format
  - Added 50+ patterns for entity type detection (Person, Organization, Technology, Product, Location, Event, Concept)
  - Fixed parsing to handle `[Entity:Type]` format from AI
- **Result**: Now extracting 30-60 high-quality relationships per scrap with proper types

### 4. ✅ FIXED: Financial Analysis Integration
- **Problem**: Column didn't exist, not integrated in batch processing
- **Solution**: Added `financial_analysis` JSONB column via Supabase dashboard
- **SQL**: `ALTER TABLE scraps ADD COLUMN financial_analysis JSONB;`

## Screenshot Handling Status
Different processors have inconsistent screenshot generation:
- **Arena**: ✅ Generates screenshots
- **GitHub**: ✅ Now generates screenshots (recently added)
- **Pinboard**: ⚠️ Conditional generation
- **Mastodon**: ❌ No generation

## Repair Commands

### Process Backlog (URGENT)
```bash
# Process everything missing AI extraction (start with small batches)
node scripts/scrap_doctor_ai.mjs repair --limit 100 --force

# Target specific extraction types
node scripts/scrap_doctor_ai.mjs repair --type summary --limit 100
node scripts/scrap_doctor_ai.mjs repair --type tags --limit 100
node scripts/scrap_doctor_ai.mjs repair --type relationships --limit 100
node scripts/scrap_doctor_ai.mjs repair --type location --limit 100
```

### Main Processing Script
```bash
# Run main scrapbook processing (with proper exit handling)
node scripts/index.mjs
```

## Validation Tools Available
```bash
# Data validation commands
node scripts/validate_db_integrity.mjs
node scripts/validate_scraps.mjs [source]
node scripts/sync_supabase_to_sqlite.mjs
node scripts/validate_ai.mjs
node scripts/validate_embeddings.mjs

# Check archive completeness
node -e "
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
// Quick completeness check
const { count: total } = await supabase.from('scraps').select('*', { count: 'exact', head: true });
const { count: summaries } = await supabase.from('scraps').select('*', { count: 'exact', head: true }).not('ai_summary', 'is', null);
const { count: tags } = await supabase.from('scraps').select('*', { count: 'exact', head: true }).not('ai_tags', 'is', null);
console.log(\`Archive: \${total} scraps, \${((summaries/total)*100).toFixed(1)}% summaries, \${((tags/total)*100).toFixed(1)}% tags\`);
"
```

## Cost Tracking
- **Current Lifetime Cost**: $13.46
- **Circuit Breakers**: Active with smart rate limiting
- **Safety Manager**: Batch limits and error protection enabled

## Environment Variables
All required API keys are configured:
- `OPENROUTER_API_KEY`: ✅ Configured
- `OPENCAGE_API_KEY`: ✅ Configured (45b5bcf9b00b43e8a50c241f9523735f)
- `SUPABASE_URL`: ✅ Configured
- `SUPABASE_KEY`: ✅ Configured

## Next Priority Actions
1. **CRITICAL**: Process the 9,000+ unprocessed scraps - the archive is only 16.7% complete!
2. Run batch repair to add AI summaries (0% complete)
3. Run batch repair to add AI tags (0% complete)
4. Continue monitoring cron job execution to ensure clean exits
5. Consider implementing progressive batch processing to handle backlog

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.