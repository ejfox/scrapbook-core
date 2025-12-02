# Supabase to Drizzle ORM Migration Guide

This document provides real-world examples of migrating from Supabase client queries to Drizzle ORM, based on patterns from the scrapbook-core codebase.

## Setup

```typescript
// Before (Supabase)
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// After (Drizzle)
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { scraps } from './db/schema'
import { eq, and, or, desc, asc, isNull, isNotNull, gte, lte, sql } from 'drizzle-orm'

const client = postgres(process.env.DATABASE_URL)
const db = drizzle(client)
```

## 1. Simple Select Queries

### Basic Select All
```javascript
// Before (Supabase)
const { data, error } = await supabase
  .from('scraps')
  .select('*')

// After (Drizzle)
const data = await db.select().from(scraps)
```

### Select with Limit
```javascript
// Before (Supabase) - from audit_backlog.mjs:13
const { data } = await supabase
  .from('scraps')
  .select('*')
  .limit(10)

// After (Drizzle)
const data = await db
  .select()
  .from(scraps)
  .limit(10)
```

### Select Specific Columns
```javascript
// Before (Supabase) - from sync_tags_to_pinboard.mjs:74-76
const { data } = await supabase
  .from('scraps')
  .select('scrap_id, url, title, tags, metadata')

// After (Drizzle)
const data = await db
  .select({
    scrap_id: scraps.scrap_id,
    url: scraps.url,
    title: scraps.title,
    tags: scraps.tags,
    metadata: scraps.metadata
  })
  .from(scraps)
```

### Select with Ordering
```javascript
// Before (Supabase) - from scrap_doctor_ai.mjs:70-71
const { data } = await supabase
  .from('scraps')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(100)

// After (Drizzle)
const data = await db
  .select()
  .from(scraps)
  .orderBy(desc(scraps.created_at))
  .limit(100)
```

## 2. Insert Operations

### Basic Insert
```javascript
// Before (Supabase) - from index.mjs:957-969
const { error } = await supabase.from('scraps').insert({
  scrap_id: scrapId,
  processing_instance_id: INSTANCE_NAME,
  processing_started_at: new Date().toISOString(),
  source: source,
  type: getTypeFromSource(source),
  content: '',
  title: '',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  metadata: {},
  tags: [],
})

// After (Drizzle)
const result = await db.insert(scraps).values({
  scrap_id: scrapId,
  processing_instance_id: INSTANCE_NAME,
  processing_started_at: new Date(),
  source: source,
  type: getTypeFromSource(source),
  content: '',
  title: '',
  created_at: new Date(),
  updated_at: new Date(),
  metadata: {},
  tags: [],
})

// Note: Drizzle throws on error by default - wrap in try/catch
```

### Insert Multiple Rows
```javascript
// Before (Supabase)
const { error } = await supabase.from('scraps').insert([
  { scrap_id: 'id1', title: 'First', source: 'pinboard' },
  { scrap_id: 'id2', title: 'Second', source: 'arena' }
])

// After (Drizzle)
const result = await db.insert(scraps).values([
  { scrap_id: 'id1', title: 'First', source: 'pinboard' },
  { scrap_id: 'id2', title: 'Second', source: 'arena' }
])
```

## 3. Update Operations

### Update with Filter
```javascript
// Before (Supabase) - from sync_tags_to_pinboard.mjs:160-170
const { error } = await supabase
  .from('scraps')
  .update({
    metadata: {
      ...bookmark.metadata,
      tags_synced_to_pinboard: true,
      tags_synced_at: new Date().toISOString(),
      pinboard_tags_count: mergedTags.length,
    },
  })
  .eq('scrap_id', bookmark.scrap_id)

// After (Drizzle)
await db
  .update(scraps)
  .set({
    metadata: {
      ...bookmark.metadata,
      tags_synced_to_pinboard: true,
      tags_synced_at: new Date().toISOString(),
      pinboard_tags_count: mergedTags.length,
    },
  })
  .where(eq(scraps.scrap_id, bookmark.scrap_id))
```

### Update from scrap_doctor_ai.mjs
```javascript
// Before (Supabase) - from scrap_doctor_ai.mjs:564-567
const { error } = await supabase
  .from('scraps')
  .update(updates)
  .eq('scrap_id', scrap.scrap_id)

// After (Drizzle)
await db
  .update(scraps)
  .set(updates)
  .where(eq(scraps.scrap_id, scrap.scrap_id))
```

## 4. Upsert Operations

### Upsert with Conflict Resolution
```javascript
// Before (Supabase) - from index.mjs:1021-1030
const { error } = await supabase.from('scraps').upsert(
  {
    ...enrichedData,
    source: source,
    type: enrichedData.type || getTypeFromSource(source),
    scrap_id: scrapId,
    updated_at: new Date().toISOString(),
  },
  {
    onConflict: 'scrap_id'
  }
)

// After (Drizzle)
await db
  .insert(scraps)
  .values({
    ...enrichedData,
    source: source,
    type: enrichedData.type || getTypeFromSource(source),
    scrap_id: scrapId,
    updated_at: new Date(),
  })
  .onConflictDoUpdate({
    target: scraps.scrap_id,
    set: {
      ...enrichedData,
      updated_at: new Date(),
    }
  })
```

### Upsert with ignoreDuplicates
```javascript
// Before (Supabase) - from index.mjs:1097-1100
const { error } = await supabase.from('scraps').upsert(mergedData, {
  onConflict: 'scrap_id',
  ignoreDuplicates: true,
  returning: 'minimal',
})

// After (Drizzle)
await db
  .insert(scraps)
  .values(mergedData)
  .onConflictDoNothing({
    target: scraps.scrap_id
  })
```

## 5. Complex Queries with Filters

### Multiple OR Conditions
```javascript
// Before (Supabase) - from scrap_doctor_ai.mjs:80
const { data } = await supabase
  .from('scraps')
  .select('*')
  .or('summary.is.null,summary.eq.""')

// After (Drizzle)
const data = await db
  .select()
  .from(scraps)
  .where(
    or(
      isNull(scraps.summary),
      eq(scraps.summary, '')
    )
  )
```

### Complex Query with Multiple Filters
```javascript
// Before (Supabase) - from scrap_doctor_ai.mjs:68-96
let query = supabase
  .from('scraps')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(parseInt(options.limit))

if (options.source) {
  query = query.eq('source', options.source)
}

if (options.type === 'summary') {
  query = query.or('summary.is.null,summary.eq.""')
} else if (options.type === 'tags') {
  query = query.or('tags.is.null,tags.eq.{}')
} else {
  query = query.or('summary.is.null,tags.is.null,relationships.is.null')
}

const { data: scraps } = await query

// After (Drizzle)
const conditions = []

if (options.source) {
  conditions.push(eq(scraps.source, options.source))
}

if (options.type === 'summary') {
  conditions.push(or(
    isNull(scraps.summary),
    eq(scraps.summary, '')
  ))
} else if (options.type === 'tags') {
  conditions.push(or(
    isNull(scraps.tags),
    eq(scraps.tags, {})
  ))
} else {
  conditions.push(or(
    isNull(scraps.summary),
    isNull(scraps.tags),
    isNull(scraps.relationships)
  ))
}

const data = await db
  .select()
  .from(scraps)
  .where(and(...conditions))
  .orderBy(desc(scraps.created_at))
  .limit(parseInt(options.limit))
```

### Not Null Filters
```javascript
// Before (Supabase) - from sync_tags_to_pinboard.mjs:74-80
const { data } = await supabase
  .from('scraps')
  .select('scrap_id, url, title, tags, metadata')
  .eq('source', 'pinboard')
  .not('tags', 'is', null)
  .not('url', 'is', null)
  .limit(10)

// After (Drizzle)
const data = await db
  .select({
    scrap_id: scraps.scrap_id,
    url: scraps.url,
    title: scraps.title,
    tags: scraps.tags,
    metadata: scraps.metadata
  })
  .from(scraps)
  .where(
    and(
      eq(scraps.source, 'pinboard'),
      isNotNull(scraps.tags),
      isNotNull(scraps.url)
    )
  )
  .limit(10)
```

### Date Range Query
```javascript
// Before (Supabase)
const { data } = await supabase
  .from('scraps')
  .select('*')
  .gte('updated_at', new Date(Date.now() - 3600000).toISOString())
  .order('updated_at', { ascending: false })

// After (Drizzle)
const data = await db
  .select()
  .from(scraps)
  .where(gte(scraps.updated_at, new Date(Date.now() - 3600000)))
  .orderBy(desc(scraps.updated_at))
```

## 6. Aggregation and Counting

### Count with Filter
```javascript
// Before (Supabase) - from sync_tags_to_pinboard.mjs:257-261
const { count } = await supabase
  .from('scraps')
  .select('*', { count: 'exact', head: true })
  .eq('source', 'pinboard')
  .not('tags', 'is', null)

// After (Drizzle)
import { count as countFn } from 'drizzle-orm'

const result = await db
  .select({ count: countFn() })
  .from(scraps)
  .where(
    and(
      eq(scraps.source, 'pinboard'),
      isNotNull(scraps.tags)
    )
  )

const count = result[0].count
```

### JSON Field Queries
```javascript
// Before (Supabase) - from sync_tags_to_pinboard.mjs:267-268
const { count } = await supabase
  .from('scraps')
  .select('*', { count: 'exact', head: true })
  .eq('source', 'pinboard')
  .eq('metadata->tags_synced_to_pinboard', true)

// After (Drizzle)
const result = await db
  .select({ count: countFn() })
  .from(scraps)
  .where(
    and(
      eq(scraps.source, 'pinboard'),
      sql`${scraps.metadata}->>'tags_synced_to_pinboard' = 'true'`
    )
  )

const count = result[0].count
```

## 7. Single Record Queries

### Get Single Record
```javascript
// Before (Supabase) - from dl_arena.mjs:91-95
const { data, error } = await supabase
  .from('scraps')
  .select('*')
  .eq('scrap_id', newScrap.scrap_id)
  .limit(1)

const existing = data?.[0]

// After (Drizzle)
const existing = await db
  .select()
  .from(scraps)
  .where(eq(scraps.scrap_id, newScrap.scrap_id))
  .limit(1)
  .then(rows => rows[0])

// Or use findFirst helper (more concise)
const existing = await db.query.scraps.findFirst({
  where: eq(scraps.scrap_id, newScrap.scrap_id)
})
```

## Key Differences and Type Safety Benefits

### Error Handling
```javascript
// Supabase: Must check error object
const { data, error } = await supabase.from('scraps').select('*')
if (error) {
  console.error('Database error:', error)
  return
}

// Drizzle: Uses exceptions (try/catch)
try {
  const data = await db.select().from(scraps)
} catch (error) {
  console.error('Database error:', error)
}
```

### Type Safety
```typescript
// Supabase: Limited type inference
const { data } = await supabase.from('scraps').select('scrap_id, title')
// data is typed as any[] or needs manual type assertion

// Drizzle: Full type inference
const data = await db
  .select({
    scrap_id: scraps.scrap_id,
    title: scraps.title
  })
  .from(scraps)
// data is automatically typed as { scrap_id: string; title: string | null }[]

// TypeScript will catch errors at compile time:
await db.update(scraps).set({
  non_existent_field: 'value' // TypeScript error!
}).where(eq(scraps.scrap_id, 'test'))
```

### Timestamps
```javascript
// Supabase: Must use ISO strings
const { error } = await supabase.from('scraps').insert({
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
})

// Drizzle: Use Date objects directly
await db.insert(scraps).values({
  created_at: new Date(),
  updated_at: new Date()
})
```

### JSON Fields
```javascript
// Supabase: Manual JSON handling
const { data } = await supabase.from('scraps').update({
  tags: JSON.stringify(['tag1', 'tag2'])
})

// Drizzle: Type-safe JSON with proper types
await db.update(scraps).set({
  tags: ['tag1', 'tag2'] // Automatically handled as JSONB
})
// TypeScript knows tags is string[], not any
```

## Common Gotchas

### 1. Building Dynamic Queries
```javascript
// Supabase: Chain methods on query object
let query = supabase.from('scraps').select('*')
if (condition) query = query.eq('source', 'pinboard')
if (anotherCondition) query = query.not('tags', 'is', null)
const { data } = await query

// Drizzle: Build conditions array, then combine
const conditions = []
if (condition) conditions.push(eq(scraps.source, 'pinboard'))
if (anotherCondition) conditions.push(isNotNull(scraps.tags))

const data = await db
  .select()
  .from(scraps)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
```

### 2. Empty Results
```javascript
// Supabase: Returns empty array + null error
const { data, error } = await supabase.from('scraps').select('*').eq('id', 'nonexistent')
// data = []

// Drizzle: Returns empty array (no separate error object)
const data = await db.select().from(scraps).where(eq(scraps.id, 'nonexistent'))
// data = []
```

### 3. Returning Inserted/Updated Data
```javascript
// Supabase: Returns data by default
const { data } = await supabase.from('scraps').insert({ ... })
// data contains the inserted row(s)

// Drizzle: Must explicitly request return
const [inserted] = await db
  .insert(scraps)
  .values({ ... })
  .returning()
// Returns array of inserted rows

// Or select specific fields
const [inserted] = await db
  .insert(scraps)
  .values({ ... })
  .returning({ scrap_id: scraps.scrap_id, title: scraps.title })
```

## Migration Checklist

- [ ] Install Drizzle ORM: `npm install drizzle-orm postgres`
- [ ] Create schema file in `db/schema.ts`
- [ ] Replace `createClient()` with Drizzle setup
- [ ] Import necessary operators: `eq`, `and`, `or`, `isNull`, `desc`, etc.
- [ ] Convert chained `.select().eq().order()` to Drizzle query builder
- [ ] Change error handling from `if (error)` to `try/catch`
- [ ] Replace `.toISOString()` with `new Date()`
- [ ] Update `.or()` string syntax to `or(condition1, condition2)`
- [ ] Convert `.not('field', 'is', null)` to `isNotNull(field)`
- [ ] Add `.returning()` to inserts/updates if you need the data back
- [ ] Test type inference in your IDE - you should see full autocomplete
- [ ] Update tests to use Drizzle syntax

## Resources

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [PostgreSQL Queries](https://orm.drizzle.team/docs/select)
- [Drizzle Filters & Operators](https://orm.drizzle.team/docs/operators)
- [Schema Definition](https://orm.drizzle.team/docs/sql-schema-declaration)
