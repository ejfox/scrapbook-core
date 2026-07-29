#!/usr/bin/env node
// Corpus-wide screenshot quality backfill. Idempotent, resumable, sharded.
//
//   node scripts/quality_backfill.mjs classify [--dry] [--no-vision]   # score every shot
//   node scripts/quality_backfill.mjs recapture [--dry]                # re-shoot the rejects
//   node scripts/quality_backfill.mjs all                              # classify then recapture
//
// Flow (per the "auto-recapture all bad" decision):
//   1. classify  — gate every screenshot_url row → accept/reject/review columns.
//   2. recapture — for each retryable reject, re-shoot with the new engine
//      (force:true, so cookies + networkidle + status-gate apply), then re-gate.
//      Still bad after MAX_RECAPTURES attempts → terminal reject (don't spin).
//   3. residual  — 'review' rows stay for the Layer 3 human triage queue.
//
// Prereq: migrations/add_screenshot_quality.sql applied. Recapture concurrency is
// deliberately low (Chrome is heavy); social rows only heal once cookies exist.
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'; dotenv.config()
import Bottleneck from 'bottleneck'
import { gateScrap } from '../lib/screenshotQuality.mjs'
import { generateScreenshot } from './generateScreenshot.mjs'

const phase = process.argv[2] || 'classify'
const DRY = process.argv.includes('--dry')
const NO_VISION = process.argv.includes('--no-vision')
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d }
const PAGE = 500
const MAX_RECAPTURES = 2
// Categories worth another shot with the improved engine. Hard 404/403 error
// pages and captchas are not retried by default (they won't heal on a retry).
const RETRYABLE = new Set(['blank', 'css_broken', 'cookie_wall', 'login_wall'])

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
// Vision (gate Stage B) is naturally serialized by its own limiter; here we cap
// the browser fan-out so recapture can't fork-bomb Chrome.
const gateLimiter = new Bottleneck({ maxConcurrent: NO_VISION ? 8 : 4 })
const browserLimiter = new Bottleneck({ maxConcurrent: 2, minTime: 400 })

async function pageThrough(buildQuery) {
  let out = [], from = 0
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE - 1)
    if (error) { console.error('query:', error.message); process.exit(1) }
    if (!data.length) break
    out = out.concat(data); from += PAGE
    if (data.length < PAGE) break
  }
  return out
}

// ---------- phase 1: classify ----------
async function classify() {
  console.log(`${DRY ? '[DRY] ' : ''}CLASSIFY — gating every ungated screenshot${NO_VISION ? ' (Stage-A only)' : ''}`)
  const work = await pageThrough((a, b) => sb.from('scraps')
    .select('id, scrap_id, url, title, screenshot_url, capture_status')
    .not('screenshot_url', 'is', null).is('screenshot_quality', null)
    .order('created_at', { ascending: false }).range(a, b))
  console.log(`  ${work.length} rows to gate\n`)

  const tally = {}
  let done = 0
  await Promise.all(work.map(s => gateLimiter.schedule(async () => {
    try {
      const r = await gateScrap(s, { allowVision: !NO_VISION })
      tally[r.screenshot_quality] = (tally[r.screenshot_quality] || 0) + 1
      if (!DRY) {
        await sb.from('scraps').update({
          screenshot_quality: r.screenshot_quality, quality_category: r.quality_category,
          quality_score: r.quality_score, quality_signals: r.quality_signals,
          quality_checked_at: new Date().toISOString(),
        }).eq('id', s.id)
      }
      if (++done % 100 === 0) console.log(`  gated ${done}/${work.length}  ${JSON.stringify(tally)}`)
    } catch (e) { console.error(`  FAIL ${s.scrap_id}: ${e.message}`) }
  })))
  console.log(`\n${DRY ? '[DRY] ' : ''}classify done: ${JSON.stringify(tally)}`)
}

// ---------- phase 2: recapture ----------
async function recapture() {
  console.log(`${DRY ? '[DRY] ' : ''}RECAPTURE — re-shooting retryable rejects (max ${MAX_RECAPTURES} tries each)`)
  const work = await pageThrough((a, b) => sb.from('scraps')
    .select('id, scrap_id, url, title, quality_category, quality_signals')
    .eq('screenshot_quality', 'reject').not('url', 'is', null)
    .order('created_at', { ascending: false }).range(a, b))
  const todo = work.filter(s =>
    RETRYABLE.has(s.quality_category) && (s.quality_signals?.recaptures || 0) < MAX_RECAPTURES)
  console.log(`  ${work.length} rejects, ${todo.length} retryable & under attempt cap\n`)

  let healed = 0, stillBad = 0, terminal = 0
  await Promise.all(todo.map(s => browserLimiter.schedule(async () => {
    const attempts = (s.quality_signals?.recaptures || 0) + 1
    if (DRY) { console.log(`  [DRY] would recapture ${s.scrap_id} (${s.quality_category}, attempt ${attempts})`); return }
    try {
      const shot = await generateScreenshot(s.url, s.scrap_id, { force: true })
      if (shot?.url) {
        // Re-gate the fresh capture.
        const r = await gateScrap({ ...s, screenshot_url: shot.url, capture_status: shot.capture_status }, { allowVision: !NO_VISION })
        const isTerminal = r.screenshot_quality === 'reject' && attempts >= MAX_RECAPTURES
        await sb.from('scraps').update({
          screenshot_url: shot.url,
          screenshot_quality: isTerminal ? 'reject' : r.screenshot_quality,
          quality_category: r.quality_category, quality_score: r.quality_score,
          quality_signals: { ...r.quality_signals, recaptures: attempts },
          capture_status: shot.capture_status ?? null,
          quality_checked_at: new Date().toISOString(),
        }).eq('id', s.id)
        if (r.screenshot_quality === 'accept') { healed++; console.log(`  ✅ healed ${s.scrap_id} (${s.quality_category}→content)`) }
        else if (isTerminal) { terminal++; console.log(`  ⛔ terminal ${s.scrap_id} after ${attempts} tries`) }
        else stillBad++
      } else {
        // Blocked/failed recapture — bump attempt count; terminal if capped.
        const isTerminal = attempts >= MAX_RECAPTURES
        await sb.from('scraps').update({
          quality_category: shot?.category || s.quality_category,
          quality_signals: { ...(s.quality_signals || {}), recaptures: attempts },
          capture_status: shot?.capture_status ?? null,
          quality_checked_at: new Date().toISOString(),
        }).eq('id', s.id)
        if (isTerminal) { terminal++; console.log(`  ⛔ terminal ${s.scrap_id} (recapture blocked: ${shot?.category || 'no url'})`) }
        else stillBad++
      }
    } catch (e) { console.error(`  FAIL ${s.scrap_id}: ${e.message}`) }
  })))
  console.log(`\n${DRY ? '[DRY] ' : ''}recapture done: healed=${healed} stillBad=${stillBad} terminal=${terminal}`)
}

if (phase === 'classify') await classify()
else if (phase === 'recapture') await recapture()
else if (phase === 'all') { await classify(); await recapture() }
else { console.error(`unknown phase "${phase}" — use classify | recapture | all`); process.exit(1) }
process.exit(0)
