#!/usr/bin/env node
// Parallel backfill of missing summaries. Fetches the full worklist of missing
// ids up front (id/url/title/content only — no embeddings, so no timeout),
// then runs WORKERS lanes concurrently over disjoint slices. Same content
// sourcing + summarizeContent() as scrap_doctor, so quality is identical.
//
//   node scripts/resummarize_parallel.mjs [workers]
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'; dotenv.config()
import { summarizeContent, summarizeFromScreenshot } from './aiSummarization.mjs'
import { extractContentWithRetry } from './contentExtractor.mjs'

const WORKERS = parseInt(process.argv[2] || '5', 10)
// By default skip the slow puppeteer fetch for no-screenshot rows — a single
// dead-URL navigation blocks a worker for 10-30s and starves the fast vision
// lanes. Run `ALLOW_FETCH=true` in a separate low-priority pass to mop up the
// no-screenshot tail.
const ALLOW_FETCH = process.env.ALLOW_FETCH === 'true'
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// ---- build worklist (cheap columns only) ----
console.log('Fetching worklist of missing summaries...')
let work = [], from = 0
while (true) {
  const { data, error } = await sb.from('scraps')
    .select('id, scrap_id, url, title, content, tags, screenshot_url')
    .or('summary.is.null,summary.eq.""')
    .order('created_at', { ascending: false })
    .range(from, from + 999)
  if (error) { console.error('worklist query:', error.message); process.exit(1) }
  if (!data.length) break
  work = work.concat(data); from += 1000
  if (data.length < 1000) break
}
console.log(`Worklist: ${work.length} scraps, ${WORKERS} workers\n`)

let done = 0, skipped = 0, failed = 0, idx = 0
const t0 = process.hrtime.bigint()

async function processOne(s) {
  let content = s.content || ''
  let summary = null

  if (content.length >= 200) {
    // 1. We already have real text — summarize it (fast, no fetch).
    summary = await summarizeContent(content, {
      scrapId: s.scrap_id, scrap: s, tags: s.tags, taskType: 'summarization',
      url: s.url, title: s.title,
    })
  } else if (s.screenshot_url) {
    // 2. No text but we have a screenshot — vision path. No browser, no
    //    dead-URL wait, and works even when the source URL is gone.
    summary = await summarizeFromScreenshot(s.screenshot_url, {
      scrapId: s.scrap_id, url: s.url, title: s.title,
    })
  } else if (s.url && ALLOW_FETCH) {
    // 3. Last resort: re-fetch the live page (slow, many are dead). Off by
    //    default so it can't block the fast vision lanes.
    try {
      const extracted = await extractContentWithRetry(s.url, { timeout: 10000, maxRetries: 1 })
      const fetched = extracted?.content
      if (fetched && fetched.length >= 50) {
        summary = await summarizeContent(fetched, {
          scrapId: s.scrap_id, scrap: s, tags: s.tags, taskType: 'summarization',
          url: s.url, title: s.title,
        })
      }
    } catch { /* dead url */ }
  }

  if (summary && summary.length > 50) {
    const { error } = await sb.from('scraps').update({ summary }).eq('id', s.id)
    if (error) { failed++; return }
    done++
  } else { skipped++ }
}

async function worker(wid) {
  while (true) {
    const i = idx++
    if (i >= work.length) return
    try { await processOne(work[i]) }
    catch (e) { failed++ }
    if ((done + skipped + failed) % 25 === 0) {
      const secs = Number(process.hrtime.bigint() - t0) / 1e9
      const rate = ((done + skipped + failed) / secs * 60).toFixed(0)
      const left = work.length - (done + skipped + failed)
      const eta = (left / (rate / 60) / 60).toFixed(1)
      console.log(`  done=${done} skip=${skipped} fail=${failed} | ${rate}/min | ~${eta}h left`)
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)))
const secs = Number(process.hrtime.bigint() - t0) / 1e9
console.log(`\nFINISHED in ${(secs/60).toFixed(1)}min — generated=${done} skipped=${skipped} failed=${failed}`)
