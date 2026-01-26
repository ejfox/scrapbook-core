/**
 * Distributed Locking System for Scrapbook
 *
 * Allows multiple instances to run simultaneously without conflicts.
 * Uses Supabase as the coordination layer with atomic operations.
 */

import { createClient } from '@supabase/supabase-js'
import os from 'os'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Generate a unique instance ID that's identifiable
const INSTANCE_ID = process.env.INSTANCE_NAME ||
  `${os.hostname().toLowerCase()}-${process.pid}-${Date.now().toString(36)}`

// Lock timeout - if a lock is older than this, it's considered abandoned
const LOCK_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

// Heartbeat interval - how often to refresh our locks
const HEARTBEAT_INTERVAL_MS = 60 * 1000 // 1 minute

// Track our active locks for heartbeat
const activeLocks = new Set()
let heartbeatTimer = null

/**
 * Get the current instance ID
 */
export function getInstanceId() {
  return INSTANCE_ID
}

/**
 * Attempt to acquire a lock on a scrap for processing.
 * Uses atomic update with conditions to prevent race conditions.
 *
 * @param {string} scrapId - The scrap_id to lock
 * @returns {Promise<{acquired: boolean, reason?: string, existingData?: object}>}
 */
export async function acquireLock(scrapId) {
  const now = new Date().toISOString()
  const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString()

  // First, check current state
  const { data: current, error: fetchError } = await supabase
    .from('scraps')
    .select('processing_instance_id, processing_started_at, screenshot_url, summary, embedding')
    .eq('scrap_id', scrapId)
    .single()

  if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
    return { acquired: false, reason: `fetch_error: ${fetchError.message}` }
  }

  // If scrap doesn't exist, we can't lock it (it needs to be created first)
  if (!current) {
    return { acquired: false, reason: 'scrap_not_found' }
  }

  // Check if already locked by someone else (and not stale)
  if (current.processing_instance_id &&
      current.processing_instance_id !== INSTANCE_ID &&
      current.processing_started_at > staleThreshold) {
    return {
      acquired: false,
      reason: `locked_by_${current.processing_instance_id}`,
      existingData: current
    }
  }

  // Try to acquire lock atomically
  // This UPDATE only succeeds if the row still matches our conditions
  const { data: updated, error: updateError } = await supabase
    .from('scraps')
    .update({
      processing_instance_id: INSTANCE_ID,
      processing_started_at: now
    })
    .eq('scrap_id', scrapId)
    .or(`processing_instance_id.is.null,processing_instance_id.eq.${INSTANCE_ID},processing_started_at.lt.${staleThreshold}`)
    .select('scrap_id')

  if (updateError) {
    return { acquired: false, reason: `update_error: ${updateError.message}` }
  }

  // If no rows were updated, someone else got the lock
  if (!updated || updated.length === 0) {
    return { acquired: false, reason: 'race_condition_lost' }
  }

  // We got the lock!
  activeLocks.add(scrapId)
  startHeartbeat()

  return { acquired: true, existingData: current }
}

/**
 * Release a lock on a scrap
 */
export async function releaseLock(scrapId) {
  activeLocks.delete(scrapId)

  const { error } = await supabase
    .from('scraps')
    .update({
      processing_instance_id: null,
      processing_started_at: null
    })
    .eq('scrap_id', scrapId)
    .eq('processing_instance_id', INSTANCE_ID) // Only release our own locks

  if (error) {
    console.error(`Failed to release lock for ${scrapId}:`, error.message)
  }
}

/**
 * Release all locks held by this instance
 */
export async function releaseAllLocks() {
  stopHeartbeat()

  const { error } = await supabase
    .from('scraps')
    .update({
      processing_instance_id: null,
      processing_started_at: null
    })
    .eq('processing_instance_id', INSTANCE_ID)

  activeLocks.clear()

  if (error) {
    console.error('Failed to release all locks:', error.message)
  }
}

/**
 * Refresh all our active locks (heartbeat)
 */
async function refreshLocks() {
  if (activeLocks.size === 0) return

  const now = new Date().toISOString()
  const scrapIds = Array.from(activeLocks)

  const { error } = await supabase
    .from('scraps')
    .update({ processing_started_at: now })
    .eq('processing_instance_id', INSTANCE_ID)
    .in('scrap_id', scrapIds)

  if (error) {
    console.error('Failed to refresh locks:', error.message)
  }
}

function startHeartbeat() {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(refreshLocks, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/**
 * Check if a field already has data (to avoid duplicate work)
 */
export async function checkFieldsExist(scrapId, fields) {
  const { data, error } = await supabase
    .from('scraps')
    .select(fields.join(', '))
    .eq('scrap_id', scrapId)
    .single()

  if (error || !data) {
    return { exists: {}, data: null }
  }

  const exists = {}
  for (const field of fields) {
    const value = data[field]
    exists[field] = value !== null && value !== undefined && value !== ''
  }

  return { exists, data }
}

/**
 * Claim a batch of scraps for processing.
 * Returns only scraps this instance successfully locked.
 *
 * @param {object} options - Query options
 * @param {number} options.limit - Max scraps to claim
 * @param {string} options.source - Filter by source
 * @param {string[]} options.missingFields - Fields that should be null/missing
 * @returns {Promise<string[]>} - Array of scrap_ids we successfully locked
 */
export async function claimBatch({ limit = 10, source = null, missingFields = [] } = {}) {
  const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString()

  // Build query for unlocked/stale scraps
  let query = supabase
    .from('scraps')
    .select('scrap_id')
    .or(`processing_instance_id.is.null,processing_started_at.lt.${staleThreshold}`)
    .limit(limit * 2) // Fetch extra since some may fail to lock

  if (source) {
    query = query.eq('source', source)
  }

  // Add conditions for missing fields
  for (const field of missingFields) {
    query = query.is(field, null)
  }

  const { data: candidates, error } = await query

  if (error || !candidates) {
    console.error('Failed to fetch candidates:', error?.message)
    return []
  }

  // Try to lock each candidate until we have enough
  const claimed = []
  for (const candidate of candidates) {
    if (claimed.length >= limit) break

    const result = await acquireLock(candidate.scrap_id)
    if (result.acquired) {
      claimed.push(candidate.scrap_id)
    }
  }

  return claimed
}

/**
 * Process a scrap with automatic locking
 *
 * @param {string} scrapId - The scrap to process
 * @param {function} processor - Async function that receives the scrap data and returns updates
 * @returns {Promise<{success: boolean, reason?: string, updates?: object}>}
 */
export async function withLock(scrapId, processor) {
  const lockResult = await acquireLock(scrapId)

  if (!lockResult.acquired) {
    return { success: false, reason: lockResult.reason }
  }

  try {
    // Fetch full scrap data
    const { data: scrap, error: fetchError } = await supabase
      .from('scraps')
      .select('*')
      .eq('scrap_id', scrapId)
      .single()

    if (fetchError || !scrap) {
      return { success: false, reason: 'fetch_failed' }
    }

    // Run the processor
    const updates = await processor(scrap)

    if (updates && Object.keys(updates).length > 0) {
      // Save updates
      const { error: updateError } = await supabase
        .from('scraps')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('scrap_id', scrapId)

      if (updateError) {
        return { success: false, reason: `save_failed: ${updateError.message}` }
      }
    }

    return { success: true, updates }
  } finally {
    await releaseLock(scrapId)
  }
}

/**
 * Get stats about current locks
 */
export async function getLockStats() {
  const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString()

  const { data: locks, error } = await supabase
    .from('scraps')
    .select('processing_instance_id, processing_started_at')
    .not('processing_instance_id', 'is', null)

  if (error) {
    return { error: error.message }
  }

  const byInstance = {}
  let staleCount = 0

  for (const lock of locks || []) {
    byInstance[lock.processing_instance_id] = (byInstance[lock.processing_instance_id] || 0) + 1
    if (lock.processing_started_at < staleThreshold) {
      staleCount++
    }
  }

  return {
    total: locks?.length || 0,
    stale: staleCount,
    byInstance,
    thisInstance: INSTANCE_ID,
    thisInstanceLocks: activeLocks.size
  }
}

/**
 * Clean up stale locks from dead instances
 */
export async function cleanStaleLocks() {
  const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString()

  const { data, error } = await supabase
    .from('scraps')
    .update({
      processing_instance_id: null,
      processing_started_at: null
    })
    .not('processing_instance_id', 'is', null)
    .lt('processing_started_at', staleThreshold)
    .select('scrap_id, processing_instance_id')

  if (error) {
    console.error('Failed to clean stale locks:', error.message)
    return { cleaned: 0, error: error.message }
  }

  return { cleaned: data?.length || 0, scraps: data }
}

// Cleanup on process exit
process.on('SIGTERM', releaseAllLocks)
process.on('SIGINT', releaseAllLocks)
process.on('exit', () => {
  // Sync cleanup - can't await here
  activeLocks.clear()
  stopHeartbeat()
})

export default {
  getInstanceId,
  acquireLock,
  releaseLock,
  releaseAllLocks,
  checkFieldsExist,
  claimBatch,
  withLock,
  getLockStats,
  cleanStaleLocks
}
