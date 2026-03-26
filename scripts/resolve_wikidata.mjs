#!/usr/bin/env node

/**
 * Batch-resolve graph_entities against Wikidata.
 *
 * Strategy:
 *   1. Heuristic scoring — exact name + type alignment → accept immediately (free)
 *   2. LLM disambiguation — ambiguous candidates get routed through AI with graph context
 *   3. Junk filtering — punctuation, dollar amounts, fragments skipped automatically
 *
 * Usage:
 *   node scripts/resolve_wikidata.mjs [options]
 *
 * Options:
 *   --dry-run           Preview what would be resolved without writing
 *   --limit N           Process at most N entities
 *   --type TYPE         Only resolve entities of this type (Person, Organization, etc.)
 *   --unresolved-only   Only process entities without an existing wikidata_qid (default)
 *   --re-resolve        Re-resolve all entities, even those with existing QIDs
 *   --min-confidence N  Minimum confidence to write back (default: 0.3)
 *   --no-llm            Skip LLM disambiguation, heuristic only
 *   --verbose           Show detailed output per entity
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import chalk from 'chalk'
import { completion } from './llmService.mjs'
import { batchResolve, isJunkEntity } from '../lib/wikidataResolver.mjs'

dotenv.config()

const BATCH_SIZE = 100

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: null,
    entityType: null,
    unresolvedOnly: true,
    minConfidence: 0.6,
    noLlm: false,
    verbose: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--verbose') options.verbose = true
    else if (arg === '--no-llm') options.noLlm = true
    else if (arg === '--re-resolve') options.unresolvedOnly = false
    else if (arg === '--unresolved-only') options.unresolvedOnly = true
    else if (arg === '--limit' && argv[i + 1]) { options.limit = parseInt(argv[i + 1], 10); i++ }
    else if (arg === '--type' && argv[i + 1]) { options.entityType = argv[i + 1]; i++ }
    else if (arg === '--min-confidence' && argv[i + 1]) { options.minConfidence = parseFloat(argv[i + 1]); i++ }
  }

  return options
}

function getSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!process.env.SUPABASE_URL || !key) {
    throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY')
  }
  return createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false } })
}

/**
 * Fetch entities from graph_entities that need Wikidata resolution.
 */
async function fetchEntities(supabase, options) {
  let query = supabase
    .from('graph_entities')
    .select('id, entity_key, display_name, entity_type, aliases, metadata, wikidata_qid')
    .order('created_at', { ascending: true })

  if (options.unresolvedOnly) {
    query = query.is('wikidata_qid', null)
  }

  if (options.entityType) {
    query = query.eq('entity_type', options.entityType)
  }

  // Exclude Unknown type — these are mostly junk
  query = query.neq('entity_type', 'Unknown')

  if (options.limit) {
    query = query.limit(options.limit)
  } else {
    query = query.limit(1000)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to fetch entities: ${error.message}`)
  return data || []
}

/**
 * Fetch graph context for an entity — its claims and co-occurring entities.
 * This context makes LLM disambiguation much smarter.
 */
async function fetchEntityContext(supabase, entity) {
  const context = { claims: [], coOccurring: [] }

  // Fetch claims where this entity is subject or object (two simple queries to avoid FK join issues)
  const { data: asSubject } = await supabase
    .from('graph_claims')
    .select('predicate, object_entity_id')
    .eq('subject_entity_id', entity.id)
    .limit(10)

  const { data: asObject } = await supabase
    .from('graph_claims')
    .select('predicate, subject_entity_id')
    .eq('object_entity_id', entity.id)
    .limit(10)

  // Collect all related entity IDs to resolve names in one query
  const relatedIds = new Set()
  for (const c of (asSubject || [])) relatedIds.add(c.object_entity_id)
  for (const c of (asObject || [])) relatedIds.add(c.subject_entity_id)

  const nameMap = new Map()
  if (relatedIds.size > 0) {
    const { data: names } = await supabase
      .from('graph_entities')
      .select('id, display_name')
      .in('id', Array.from(relatedIds))
    for (const n of (names || [])) nameMap.set(n.id, n.display_name)
  }

  for (const claim of (asSubject || [])) {
    const objectName = nameMap.get(claim.object_entity_id) || '?'
    context.claims.push({ subject: entity.display_name, predicate: claim.predicate, object: objectName })
    if (objectName !== '?' && !context.coOccurring.includes(objectName)) context.coOccurring.push(objectName)
  }

  for (const claim of (asObject || [])) {
    const subjectName = nameMap.get(claim.subject_entity_id) || '?'
    context.claims.push({ subject: subjectName, predicate: claim.predicate, object: entity.display_name })
    if (subjectName !== '?' && !context.coOccurring.includes(subjectName)) context.coOccurring.push(subjectName)
  }

  return context
}

/**
 * Write a resolved Wikidata binding back to the database.
 */
async function writeResolution(supabase, entityId, result, now) {
  const update = {
    wikidata_qid: result.qid,
    wikidata_label: result.label,
    wikidata_description: result.description,
    wikidata_match_confidence: result.confidence,
    wikidata_last_resolved_at: now,
    updated_at: now,
  }

  const { error } = await supabase
    .from('graph_entities')
    .update(update)
    .eq('id', entityId)

  if (error) throw new Error(`Failed to write resolution for ${entityId}: ${error.message}`)
}

/**
 * Mark an entity as attempted but unresolved.
 */
async function markAttempted(supabase, entityId, now) {
  const { error } = await supabase
    .from('graph_entities')
    .update({
      wikidata_last_resolved_at: now,
      updated_at: now,
    })
    .eq('id', entityId)

  if (error) throw new Error(`Failed to mark attempted for ${entityId}: ${error.message}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const supabase = getSupabase()

  console.log(chalk.blue('Wikidata Entity Resolution'))
  console.log(chalk.gray(`  Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`))
  console.log(chalk.gray(`  LLM: ${options.noLlm ? 'disabled' : 'enabled'}`))
  console.log(chalk.gray(`  Min confidence: ${options.minConfidence}`))
  if (options.entityType) console.log(chalk.gray(`  Type filter: ${options.entityType}`))
  if (options.limit) console.log(chalk.gray(`  Limit: ${options.limit}`))
  console.log()

  const entities = await fetchEntities(supabase, options)
  console.log(chalk.cyan(`Fetched ${entities.length} entities to resolve`))

  // Pre-filter junk
  const validEntities = entities.filter(e => !isJunkEntity(e.display_name))
  const junkCount = entities.length - validEntities.length
  if (junkCount > 0) {
    console.log(chalk.yellow(`Skipping ${junkCount} junk entities`))
  }

  const completionFn = options.noLlm ? null : completion
  const contextFn = options.noLlm ? null : (entity) => fetchEntityContext(supabase, entity)

  const stats = {
    total: validEntities.length,
    resolved: 0,
    heuristic: 0,
    llm: 0,
    rejected: 0,
    skipped: 0,
    errors: 0,
  }

  const now = new Date().toISOString()

  for await (const { entity, result } of batchResolve(validEntities, {
    completionFn,
    contextFn,
    highConfidenceThreshold: 0.75,
    minAcceptConfidence: options.minConfidence,
    batchDelay: 250,
  })) {
    if (result.qid && result.confidence >= options.minConfidence) {
      stats.resolved++
      if (result.method === 'heuristic') stats.heuristic++
      else if (result.method === 'llm') stats.llm++
      else stats.heuristic++

      if (options.verbose || options.dryRun) {
        console.log(
          chalk.green(`  + ${entity.display_name} (${entity.entity_type})`) +
          chalk.gray(` → ${result.qid} "${result.label}" [${result.method} ${result.confidence.toFixed(2)}]`),
        )
        if (result.reason) console.log(chalk.gray(`    ${result.reason}`))
      }

      if (!options.dryRun) {
        try {
          await writeResolution(supabase, entity.id, result, now)
        } catch (err) {
          console.error(chalk.red(`  ! Write failed for ${entity.display_name}: ${err.message}`))
          stats.errors++
        }
      }
    } else {
      if (result.method === 'skipped_junk') {
        stats.skipped++
      } else {
        stats.rejected++
        if (options.verbose) {
          console.log(
            chalk.gray(`  - ${entity.display_name} (${entity.entity_type})`) +
            chalk.gray(` → no match [${result.method}]`),
          )
        }
      }

      if (!options.dryRun) {
        try {
          await markAttempted(supabase, entity.id, now)
        } catch (err) {
          stats.errors++
        }
      }
    }

    // Progress line every 50 entities
    const processed = stats.resolved + stats.rejected + stats.skipped
    if (processed % 50 === 0 && processed > 0) {
      console.log(chalk.cyan(`  ... ${processed}/${stats.total} processed (${stats.resolved} resolved)`))
    }
  }

  console.log()
  console.log(chalk.blue('Resolution complete:'))
  console.log(chalk.gray(JSON.stringify({
    ...stats,
    junk_filtered: junkCount,
    mode: options.dryRun ? 'dry_run' : 'live',
  }, null, 2)))
}

main().catch(err => {
  console.error(chalk.red('Fatal:'), err.message)
  process.exit(1)
})
