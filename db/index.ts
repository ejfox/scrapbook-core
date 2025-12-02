import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import postgres from 'postgres';
import Database from 'better-sqlite3';
import * as schema from './schema';
import path from 'path';
import os from 'os';

// ============================================
// PostgreSQL (Supabase) Connection
// ============================================

let pgClient: ReturnType<typeof postgres> | null = null;
let pgDb: ReturnType<typeof drizzlePg> | null = null;

export function getSupabaseDb() {
  if (!pgDb) {
    const connectionString = process.env.DATABASE_URL ||
      `postgresql://postgres:${process.env.SUPABASE_KEY}@db.${process.env.SUPABASE_URL?.replace('https://', '').replace('.supabase.co', '')}.supabase.co:5432/postgres`;

    pgClient = postgres(connectionString);
    pgDb = drizzlePg(pgClient, { schema });
  }
  return pgDb;
}

// ============================================
// SQLite (Local) Connection
// ============================================

let sqliteClient: Database.Database | null = null;
let sqliteDb: ReturnType<typeof drizzleSqlite> | null = null;

export function getSqliteDb(dbPath?: string) {
  if (!sqliteDb) {
    const finalPath = dbPath || path.join(os.homedir(), 'scraps.db');
    sqliteClient = new Database(finalPath);
    sqliteDb = drizzleSqlite(sqliteClient, { schema });
  }
  return sqliteDb;
}

// ============================================
// Unified interface
// ============================================

export type DbType = 'supabase' | 'sqlite';

export function getDb(type: DbType = 'supabase') {
  return type === 'supabase' ? getSupabaseDb() : getSqliteDb();
}

// ============================================
// Cleanup
// ============================================

export async function closeConnections() {
  if (pgClient) {
    await pgClient.end();
    pgClient = null;
    pgDb = null;
  }
  if (sqliteClient) {
    sqliteClient.close();
    sqliteClient = null;
    sqliteDb = null;
  }
}

// Re-export schema
export * from './schema';
