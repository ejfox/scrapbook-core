/**
 * Test Drizzle connections to both Supabase and SQLite
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import path from 'path';
import os from 'os';

async function testSupabase() {
  console.log('\n=== Testing Supabase Connection ===\n');

  // Supabase direct connection (requires DATABASE_URL or we build it)
  // For Supabase, we need the database password from the dashboard
  // The SUPABASE_KEY is the anon/service key, not the DB password

  const projectRef = process.env.SUPABASE_URL?.replace('https://', '').replace('.supabase.co', '');

  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set.');
    console.log(`Project ref: ${projectRef}`);
    console.log('\nTo get your DATABASE_URL:');
    console.log('1. Go to Supabase Dashboard > Project Settings > Database');
    console.log('2. Copy the "Connection string" (URI format)');
    console.log('3. Add it to .env as DATABASE_URL\n');

    // Try using Supabase JS client as fallback test
    console.log('Falling back to Supabase JS client test...');
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
    const { count } = await supabase.from('scraps').select('*', { count: 'exact', head: true });
    console.log(`Supabase JS client works! Count: ${count}`);
    return;
  }

  try {
    const client = postgres(process.env.DATABASE_URL);
    const db = drizzle(client, { schema });

    // Test query
    const result = await db.execute(sql`SELECT COUNT(*) as count FROM scraps`);
    console.log('Supabase Drizzle connection successful!');
    console.log('Count:', result[0]?.count);

    await client.end();
  } catch (error: any) {
    console.error('Supabase connection failed:', error.message);
  }
}

async function testSqlite() {
  console.log('\n=== Testing SQLite Connection ===\n');

  const dbPath = path.join(os.homedir(), 'scraps.db');

  try {
    const sqlite = new Database(dbPath);
    const db = drizzleSqlite(sqlite, { schema });

    // Test query
    const result = db.all(sql`SELECT COUNT(*) as count FROM scraps`);
    console.log('SQLite connection successful!');
    console.log('Count:', result[0]?.count);

    // Check schema
    const columns = sqlite.prepare("PRAGMA table_info(scraps)").all();
    console.log('SQLite columns:', columns.length);

    sqlite.close();
  } catch (error: any) {
    console.error('SQLite connection failed:', error.message);
  }
}

async function main() {
  console.log('Drizzle Connection Test');
  console.log('=======================');

  await testSupabase();
  await testSqlite();

  console.log('\n=== Done ===\n');
}

main().catch(console.error);
