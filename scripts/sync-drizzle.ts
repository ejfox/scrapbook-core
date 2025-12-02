import { createClient } from '@supabase/supabase-js';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { scrapsSqlite } from '../db/schema';
import * as dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import { eq } from 'drizzle-orm';

dotenv.config();

// Column definitions for migration
// Note: For ALTER TABLE ADD COLUMN, we can't use NOT NULL on existing tables with data
// So we make them nullable during migration
const SQLITE_COLUMNS = [
  { name: 'id', type: 'TEXT PRIMARY KEY' },
  { name: 'scrap_id', type: 'TEXT' }, // Would be NOT NULL in fresh schema, but can't add NOT NULL to existing table
  { name: 'source', type: 'TEXT' }, // Would be NOT NULL in fresh schema, but can't add NOT NULL to existing table
  { name: 'type', type: 'TEXT' },
  { name: 'url', type: 'TEXT' },
  { name: 'title', type: 'TEXT' },
  { name: 'content', type: 'TEXT' },
  { name: 'created_at', type: 'TEXT' },
  { name: 'updated_at', type: 'TEXT' },
  { name: 'published_at', type: 'TEXT' },
  { name: 'summary', type: 'TEXT' },
  { name: 'tags', type: 'TEXT' }, // JSON string
  { name: 'concept_tags', type: 'TEXT' }, // JSON string
  { name: 'relationships', type: 'TEXT' }, // JSON string
  { name: 'content_type', type: 'TEXT' },
  { name: 'extraction_confidence', type: 'TEXT' }, // JSON string
  { name: 'location', type: 'TEXT' },
  { name: 'latitude', type: 'REAL' },
  { name: 'longitude', type: 'REAL' },
  { name: 'financial_analysis', type: 'TEXT' }, // JSON string
  { name: 'embedding', type: 'TEXT' }, // JSON string
  { name: 'embedding_nomic', type: 'TEXT' }, // JSON string
  { name: 'image_embedding', type: 'TEXT' }, // JSON string
  { name: 'screenshot_url', type: 'TEXT' },
  { name: 'metadata', type: 'TEXT' }, // JSON string
  { name: 'shared', type: 'INTEGER DEFAULT 0' },
  { name: 'graph_imported', type: 'INTEGER DEFAULT 0' },
  { name: 'processing_instance_id', type: 'TEXT' },
  { name: 'processing_started_at', type: 'TEXT' },
];

interface SupabaseScrap {
  id: string;
  scrap_id: string;
  source: string;
  type?: string | null;
  url?: string | null;
  title?: string | null;
  content?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
  summary?: string | null;
  tags?: any;
  concept_tags?: any;
  relationships?: any;
  content_type?: string | null;
  extraction_confidence?: any;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  financial_analysis?: any;
  embedding?: any;
  embedding_nomic?: any;
  image_embedding?: any;
  screenshot_url?: string | null;
  metadata?: any;
  shared?: boolean | null;
  graph_imported?: boolean | null;
  processing_instance_id?: string | null;
  processing_started_at?: string | null;
}

async function ensureTableStructure(sqlite: Database.Database) {
  console.log('Ensuring table structure...');

  // Create table if it doesn't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scraps (
      id TEXT PRIMARY KEY
    )
  `);

  // Get existing columns
  const existingColumns = sqlite.prepare(
    "PRAGMA table_info(scraps)"
  ).all() as Array<{ name: string }>;

  const existingColumnNames = new Set(existingColumns.map(col => col.name));

  // Add missing columns
  let addedColumns = 0;
  for (const column of SQLITE_COLUMNS) {
    if (!existingColumnNames.has(column.name)) {
      try {
        // Skip PRIMARY KEY for ALTER TABLE
        const columnType = column.type.replace(' PRIMARY KEY', '');
        sqlite.exec(`ALTER TABLE scraps ADD COLUMN ${column.name} ${columnType}`);
        console.log(`  ✓ Added column: ${column.name}`);
        addedColumns++;
      } catch (error: any) {
        // Ignore if column already exists
        if (!error.message.includes('duplicate column name')) {
          console.error(`  ✗ Error adding column ${column.name}:`, error.message);
        }
      }
    }
  }

  if (addedColumns === 0) {
    console.log('  ✓ All columns present');
  } else {
    console.log(`  ✓ Added ${addedColumns} missing column(s)`);
  }

  // Verify all columns are now present
  const finalColumns = sqlite.prepare(
    "PRAGMA table_info(scraps)"
  ).all() as Array<{ name: string }>;

  const finalColumnNames = new Set(finalColumns.map(col => col.name));
  const missingColumns = SQLITE_COLUMNS
    .map(col => col.name)
    .filter(name => !finalColumnNames.has(name));

  if (missingColumns.length > 0) {
    throw new Error(`Failed to add required columns: ${missingColumns.join(', ')}`);
  }

  console.log(`  ✓ All ${finalColumns.length} columns verified`);
}

function safeJsonStringify(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function transformScrapForSqlite(scrap: SupabaseScrap) {
  return {
    id: scrap.id,
    scrap_id: scrap.scrap_id,
    source: scrap.source,
    type: scrap.type ?? null,
    url: scrap.url ?? null,
    title: scrap.title ?? null,
    content: scrap.content ?? null,
    created_at: scrap.created_at ?? null,
    updated_at: scrap.updated_at ?? null,
    published_at: scrap.published_at ?? null,
    summary: scrap.summary ?? null,
    tags: safeJsonStringify(scrap.tags),
    concept_tags: safeJsonStringify(scrap.concept_tags),
    relationships: safeJsonStringify(scrap.relationships),
    content_type: scrap.content_type ?? null,
    extraction_confidence: safeJsonStringify(scrap.extraction_confidence),
    location: scrap.location ?? null,
    latitude: scrap.latitude ?? null,
    longitude: scrap.longitude ?? null,
    financial_analysis: safeJsonStringify(scrap.financial_analysis),
    embedding: safeJsonStringify(scrap.embedding),
    embedding_nomic: safeJsonStringify(scrap.embedding_nomic),
    image_embedding: safeJsonStringify(scrap.image_embedding),
    screenshot_url: scrap.screenshot_url ?? null,
    metadata: safeJsonStringify(scrap.metadata),
    shared: scrap.shared ? 1 : 0,
    graph_imported: scrap.graph_imported ? 1 : 0,
    processing_instance_id: scrap.processing_instance_id ?? null,
    processing_started_at: scrap.processing_started_at ?? null,
  };
}

async function syncSupabaseToSqlite(options: { limit?: number; dryRun?: boolean } = {}) {
  console.log('='.repeat(60));
  console.log(`Syncing Supabase → SQLite (All 29 columns)${options.dryRun ? ' [DRY RUN]' : ''}`);
  console.log('='.repeat(60));

  // Validate environment variables
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_KEY must be set in .env');
    process.exit(1);
  }

  // Initialize Supabase client
  console.log('\n1. Initializing Supabase client...');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );
  console.log('   ✓ Connected to:', process.env.SUPABASE_URL);

  // Initialize SQLite
  const dbPath = path.join(os.homedir(), 'scraps.db');
  console.log('\n2. Initializing SQLite database...');
  console.log('   Path:', dbPath);

  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);

  // Ensure table structure is correct
  console.log('\n3. Checking/migrating table structure...');
  await ensureTableStructure(sqlite);

  // Get total count first
  console.log('\n4. Fetching scraps from Supabase...');
  const { count: totalCount } = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true });

  console.log(`   ℹ Total scraps in Supabase: ${totalCount}`);

  // Fetch scraps with pagination if needed
  const limit = options.limit || totalCount || 0;
  const actualLimit = Math.min(limit, totalCount || 0);

  console.log(`   ℹ Fetching ${actualLimit} scraps...`);

  let scraps: any[] = [];
  const pageSize = 1000; // Supabase max

  for (let offset = 0; offset < actualLimit; offset += pageSize) {
    const fetchSize = Math.min(pageSize, actualLimit - offset);
    process.stdout.write(`   Fetching ${offset + 1}-${offset + fetchSize}...`);

    const { data, error } = await supabase
      .from('scraps')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + fetchSize - 1);

    if (error) {
      console.error('\n   ✗ Error fetching from Supabase:', error);
      process.exit(1);
    }

    scraps = scraps.concat(data || []);
    process.stdout.write(' ✓\n');
  }

  if (!scraps || scraps.length === 0) {
    console.log('   ! No scraps found in Supabase');
    return;
  }

  console.log(`   ✓ Fetched ${scraps.length} scraps`);

  // Sync to SQLite
  console.log(`\n5. ${options.dryRun ? 'Simulating sync to' : 'Syncing to'} SQLite...`);
  if (!options.dryRun) {
    console.log('   This may take a while...\n');
  }

  let inserted = 0;
  let updated = 0;
  let errors = 0;
  let wouldInsert = 0;
  let wouldUpdate = 0;

  const batchSize = 100;
  const totalBatches = Math.ceil(scraps.length / batchSize);

  for (let i = 0; i < scraps.length; i += batchSize) {
    const batch = scraps.slice(i, i + batchSize);
    const currentBatch = Math.floor(i / batchSize) + 1;

    process.stdout.write(`   Batch ${currentBatch}/${totalBatches} (${i + 1}-${Math.min(i + batchSize, scraps.length)} of ${scraps.length})...`);

    for (const scrap of batch) {
      try {
        const transformed = transformScrapForSqlite(scrap as SupabaseScrap);

        // Check if exists
        const existing = await db
          .select()
          .from(scrapsSqlite)
          .where(eq(scrapsSqlite.id, scrap.id))
          .limit(1);

        if (options.dryRun) {
          // Dry run - just count
          if (existing.length > 0) {
            wouldUpdate++;
          } else {
            wouldInsert++;
          }
        } else {
          // Actually perform the sync
          if (existing.length > 0) {
            // Update
            await db
              .update(scrapsSqlite)
              .set(transformed)
              .where(eq(scrapsSqlite.id, scrap.id));
            updated++;
          } else {
            // Insert
            await db.insert(scrapsSqlite).values(transformed);
            inserted++;
          }
        }
      } catch (error: any) {
        errors++;
        console.error(`\n   ✗ Error syncing scrap ${scrap.id}:`, error.message);
      }
    }

    process.stdout.write(' ✓\n');
  }

  // Final statistics
  console.log('\n' + '='.repeat(60));
  console.log(options.dryRun ? 'DRY RUN COMPLETE' : 'SYNC COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total scraps fetched:     ${scraps.length}`);

  if (options.dryRun) {
    console.log(`Would insert:             ${wouldInsert}`);
    console.log(`Would update:             ${wouldUpdate}`);
    console.log(`Errors:                   ${errors}`);
  } else {
    console.log(`Inserted:                 ${inserted}`);
    console.log(`Updated:                  ${updated}`);
    console.log(`Errors:                   ${errors}`);
  }

  // Verify final count
  const finalCount = sqlite.prepare('SELECT COUNT(*) as count FROM scraps').get() as { count: number };
  console.log(`Total in SQLite:          ${finalCount.count}`);

  // Show sample columns to verify
  console.log('\n' + '='.repeat(60));
  console.log('COLUMN VERIFICATION (Sample Scrap)');
  console.log('='.repeat(60));

  const sample = await db.select().from(scrapsSqlite).limit(1);
  if (sample.length > 0) {
    const sampleScrap = sample[0];
    console.log('Columns present:');
    Object.keys(sampleScrap).forEach(key => {
      const value = sampleScrap[key as keyof typeof sampleScrap];
      const preview = value
        ? String(value).substring(0, 50) + (String(value).length > 50 ? '...' : '')
        : '(null)';
      console.log(`  ${key}: ${preview}`);
    });
  }

  sqlite.close();
  console.log('\n✓ Sync complete!');
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: { limit?: number; dryRun?: boolean } = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--dry-run' || arg === '-d') {
    options.dryRun = true;
  } else if (arg === '--limit' || arg === '-l') {
    const limitValue = args[i + 1];
    if (limitValue && !limitValue.startsWith('-')) {
      options.limit = parseInt(limitValue, 10);
      i++; // Skip next arg
    }
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Usage: npx tsx scripts/sync-drizzle.ts [options]

Options:
  --dry-run, -d       Simulate sync without writing to database
  --limit N, -l N     Limit number of scraps to sync (default: all)
  --help, -h          Show this help message

Examples:
  npx tsx scripts/sync-drizzle.ts                    # Sync all scraps
  npx tsx scripts/sync-drizzle.ts --dry-run          # Dry run all scraps
  npx tsx scripts/sync-drizzle.ts --limit 1000       # Sync only 1000 scraps
  npx tsx scripts/sync-drizzle.ts -d -l 100          # Dry run first 100
    `);
    process.exit(0);
  }
}

// Run the sync
syncSupabaseToSqlite(options).catch(error => {
  console.error('\n✗ Fatal error:', error);
  process.exit(1);
});
