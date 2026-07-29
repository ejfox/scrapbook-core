/**
 * Distributed Locking for Scrapbook
 * Prevents overlapping cron runs across multiple instances.
 */

import { createClient } from '@supabase/supabase-js'
import os from 'os'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// Unique instance ID
const INSTANCE_ID = process.env.INSTANCE_NAME ||
  `${os.hostname()}-${process.pid}-${Date.now().toString(36)}`

// Run lock config
const RUN_LOCK_ID = '__run_lock__'
const RUN_LOCK_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes
let hasRunLock = false

export function getInstanceId() {
  return INSTANCE_ID
}

export async function acquireRunLock() {
  const now = new Date().toISOString()
  const staleThreshold = new Date(Date.now() - RUN_LOCK_TIMEOUT_MS).toISOString()

  // Check existing lock
  const { data: existing } = await supabase
    .from('scraps')
    .select('processing_instance_id, processing_started_at')
    .eq('scrap_id', RUN_LOCK_ID)
    .single()

  if (existing) {
    // Someone else has it and it's not stale?
    if (existing.processing_instance_id &&
        existing.processing_instance_id !== INSTANCE_ID &&
        existing.processing_started_at > staleThreshold) {
      const mins = Math.round((Date.now() - new Date(existing.processing_started_at).getTime()) / 60000)
      return { acquired: false, reason: `locked by ${existing.processing_instance_id} (${mins}m ago)` }
    }

    // Take it
    await supabase
      .from('scraps')
      .update({ processing_instance_id: INSTANCE_ID, processing_started_at: now })
      .eq('scrap_id', RUN_LOCK_ID)
  } else {
    // Create it
    const { error } = await supabase
      .from('scraps')
      .insert({
        scrap_id: RUN_LOCK_ID,
        source: 'system',
        type: 'system',
        processing_instance_id: INSTANCE_ID,
        processing_started_at: now,
        content: 'Run lock',
        title: 'Run Lock',
        // Self-exclude from enrichment worklists + the public feed. Non-null
        // summary skips summary.is.null queries; empty arrays skip the
        // tags/relationships.is.null queries; shared:false hides it from Unity.
        summary: 'Internal run lock — not a scrap.',
        content_type: 'system',
        tags: [],
        relationships: [],
        shared: false,
        created_at: now,
        updated_at: now,
      })

    if (error && !error.message.includes('duplicate')) {
      return { acquired: false, reason: error.message }
    }
  }

  hasRunLock = true
  return { acquired: true }
}

export async function releaseRunLock() {
  if (!hasRunLock) return

  await supabase
    .from('scraps')
    .update({ processing_instance_id: null, processing_started_at: null })
    .eq('scrap_id', RUN_LOCK_ID)
    .eq('processing_instance_id', INSTANCE_ID)

  hasRunLock = false
}

// Cleanup on exit
process.on('SIGTERM', releaseRunLock)
process.on('SIGINT', releaseRunLock)
