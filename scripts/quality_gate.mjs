#!/usr/bin/env node
// Screenshot quality gate — classify stored screenshots into accept/reject/review.
//
//   node scripts/quality_gate.mjs --dry --limit 100     # classify, print, NO writes
//   node scripts/quality_gate.mjs --limit 500           # classify + persist columns
//   node scripts/quality_gate.mjs --no-vision           # Stage A only (free, no LLM)
//   node scripts/quality_gate.mjs --regate              # re-score rows already gated
//   node scripts/quality_gate.mjs --workers 5           # concurrency (default 4)
//
// Prereq: migrations/add_screenshot_quality.sql applied (needs the quality cols).
// Only touches rows that HAVE a screenshot_url. Rows the gate can't fetch pixels
// for and can't get a vision verdict for land in 'review' (never silently dropped).
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'; dotenv.config()
import { gateScrap } from '../lib/screenshotQuality.mjs'

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d }
const DRY = process.argv.includes('--dry')
const NO_VISION = process.argv.includes('--no-vision')
const REGATE = process.argv.includes('--regate')
const LIMIT = parseInt(arg('--limit', '200'), 10)
const WORKERS = parseInt(arg('--workers', '4'), 10)

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// Worklist: rows with a screenshot that haven't been gated yet (or all, if --regate).
console.log(`${DRY ? '[DRY] ' : ''}Fetching worklist (limit ${LIMIT}${NO_VISION ? ', Stage-A only' : ''})...`)
let q = sb.from('scraps')
  .select('id, scrap_id, url, title, screenshot_url, capture_status, screenshot_quality')
  .not('screenshot_url', 'is', null)
  .order('created_at', { ascending: false })
  .limit(LIMIT)
if (!REGATE) q = q.is('screenshot_quality', null)
const { data: work, error } = await q
if (error) { console.error('worklist:', error.message); process.exit(1) }
console.log(`Worklist: ${work.length} scraps\n`)

const tally = { accept: 0, reject: 0, review: 0, recapture_pending: 0 }
let idx = 0, done = 0

async function persist(scrap, r) {
  if (DRY) return
  const { error: e } = await sb.from('scraps').update({
    screenshot_quality: r.screenshot_quality,
    quality_category: r.quality_category,
    quality_score: r.quality_score,
    quality_signals: r.quality_signals,
    capture_status: scrap.capture_status ?? null,
    quality_checked_at: new Date().toISOString(),
  }).eq('id', scrap.id)
  if (e) console.error(`  persist ${scrap.scrap_id}: ${e.message}`)
}

async function worker() {
  while (true) {
    const i = idx++
    if (i >= work.length) return
    const s = work[i]
    try {
      const r = await gateScrap(s, { allowVision: !NO_VISION })
      tally[r.screenshot_quality] = (tally[r.screenshot_quality] || 0) + 1
      await persist(s, r)
      done++
      if (DRY || done % 25 === 0) {
        const dom = (s.url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0].slice(0, 24)
        console.log(`  ${r.screenshot_quality.padEnd(7)} ${(r.quality_category || '').padEnd(11)} ${dom.padEnd(25)} ${r.reason}`)
      }
    } catch (e) {
      console.error(`  FAIL ${s.scrap_id}: ${e.message}`)
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, worker))
console.log(`\n${DRY ? '[DRY] ' : ''}Done: ${done} gated`)
console.log(`  accept=${tally.accept}  reject=${tally.reject}  review=${tally.review}`)
if (!DRY) console.log('  (persisted to scraps.screenshot_quality etc.)')
