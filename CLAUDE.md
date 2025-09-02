# Claude Code Session Notes

## Database Environment
- **Supabase URL**: `https://xmdylmbdeulxcqdbkfno.supabase.co`
- **Database**: `scraps` table (primary data store)
- **Environment**: Production instance with live data

## Screenshot Handling Status
Different processors have inconsistent screenshot generation:
- **Arena**: ✅ Generates screenshots 
- **GitHub**: ✅ Now generates screenshots (recently added)
- **Pinboard**: ⚠️ Conditional generation
- **Mastodon**: ❌ No generation

## Validation Tools Available
```bash
# Data validation commands
node scripts/validate_db_integrity.mjs
node scripts/validate_scraps.mjs [source]
node scripts/sync_supabase_to_sqlite.mjs
node scripts/validate_ai.mjs
node scripts/validate_embeddings.mjs
```

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.