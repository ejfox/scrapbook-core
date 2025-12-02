import { pgTable, text, timestamp, boolean, doublePrecision, jsonb, uuid, vector } from 'drizzle-orm/pg-core';
import { sqliteTable, text as sqliteText, integer, real } from 'drizzle-orm/sqlite-core';

// ============================================
// PostgreSQL Schema (Supabase)
// ============================================

export const scraps = pgTable('scraps', {
  // Primary key
  id: uuid('id').primaryKey().defaultRandom(),

  // Core identifiers
  scrap_id: text('scrap_id').notNull(),
  source: text('source').notNull(), // pinboard, arena, github, mastodon
  type: text('type'), // bookmark, block, repo, status

  // Content
  url: text('url'),
  title: text('title'),
  content: text('content'),

  // Timestamps
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
  published_at: timestamp('published_at'),

  // AI extraction fields
  summary: text('summary'),
  tags: jsonb('tags').$type<string[]>(),
  concept_tags: jsonb('concept_tags').$type<string[]>(),
  relationships: jsonb('relationships').$type<{
    source: { name: string; type: string };
    target: { name: string; type: string };
    type: string;
  }[]>(),
  content_type: text('content_type'), // article, video, etc.
  extraction_confidence: jsonb('extraction_confidence').$type<{
    tags?: number;
    summary?: number;
    relationships?: number;
  }>(),

  // Location
  location: text('location'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),

  // Financial
  financial_analysis: jsonb('financial_analysis'),

  // Embeddings (stored as arrays, using pgvector extension)
  embedding: jsonb('embedding').$type<number[]>(),
  embedding_nomic: jsonb('embedding_nomic').$type<number[]>(),
  image_embedding: jsonb('image_embedding').$type<number[]>(),

  // Media
  screenshot_url: text('screenshot_url'),

  // Metadata
  metadata: jsonb('metadata'),
  shared: boolean('shared').default(false),

  // Processing state
  graph_imported: boolean('graph_imported').default(false),
  processing_instance_id: text('processing_instance_id'),
  processing_started_at: timestamp('processing_started_at'),
});

// ============================================
// SQLite Schema (Local)
// ============================================

export const scrapsSqlite = sqliteTable('scraps', {
  // Primary key (SQLite uses text for UUIDs)
  id: sqliteText('id').primaryKey(),

  // Core identifiers
  scrap_id: sqliteText('scrap_id').notNull(),
  source: sqliteText('source').notNull(),
  type: sqliteText('type'),

  // Content
  url: sqliteText('url'),
  title: sqliteText('title'),
  content: sqliteText('content'),

  // Timestamps (SQLite stores as text)
  created_at: sqliteText('created_at'),
  updated_at: sqliteText('updated_at'),
  published_at: sqliteText('published_at'),

  // AI extraction fields (JSON stored as text)
  summary: sqliteText('summary'),
  tags: sqliteText('tags'), // JSON string
  concept_tags: sqliteText('concept_tags'), // JSON string
  relationships: sqliteText('relationships'), // JSON string
  content_type: sqliteText('content_type'),
  extraction_confidence: sqliteText('extraction_confidence'), // JSON string

  // Location
  location: sqliteText('location'),
  latitude: real('latitude'),
  longitude: real('longitude'),

  // Financial
  financial_analysis: sqliteText('financial_analysis'), // JSON string

  // Embeddings (JSON string arrays)
  embedding: sqliteText('embedding'),
  embedding_nomic: sqliteText('embedding_nomic'),
  image_embedding: sqliteText('image_embedding'),

  // Media
  screenshot_url: sqliteText('screenshot_url'),

  // Metadata
  metadata: sqliteText('metadata'), // JSON string
  shared: integer('shared', { mode: 'boolean' }).default(false),

  // Processing state
  graph_imported: integer('graph_imported', { mode: 'boolean' }).default(false),
  processing_instance_id: sqliteText('processing_instance_id'),
  processing_started_at: sqliteText('processing_started_at'),
});

// ============================================
// Type exports
// ============================================

export type Scrap = typeof scraps.$inferSelect;
export type NewScrap = typeof scraps.$inferInsert;
export type ScrapSqlite = typeof scrapsSqlite.$inferSelect;
