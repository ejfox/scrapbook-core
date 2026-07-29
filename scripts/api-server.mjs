#!/usr/bin/env node

import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { validateEnvironment } from '../lib/validateEnvironment.mjs'
import { loadConfig } from '../lib/config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const app = express()
const PORT = process.env.PORT || 3001

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

const startTime = Date.now()

app.use(cors())
app.use(express.json())
app.use(express.static('.'))

// Health endpoint
app.get('/health', async (req, res) => {
  const checks = {
    envVars: { status: 'unknown' },
    config: { status: 'unknown' },
    database: { status: 'unknown' },
  }

  // Check env vars
  const envResult = validateEnvironment()
  checks.envVars = {
    status: envResult.valid ? 'ok' : 'fail',
    errors: envResult.errors,
    warnings: envResult.warnings,
  }

  // Check config
  try {
    loadConfig()
    checks.config = { status: 'ok' }
  } catch (err) {
    checks.config = { status: 'fail', error: err.message }
  }

  // Check database connectivity
  try {
    const { count, error } = await supabase
      .from('scraps')
      .select('*', { count: 'exact', head: true })
    if (error) throw error
    checks.database = { status: 'ok', scrapCount: count }
  } catch (err) {
    checks.database = { status: 'fail', error: err.message }
  }

  const dbOk = checks.database.status === 'ok'
  const envOk = checks.envVars.status === 'ok'
  const hasWarnings = envResult.warnings.length > 0

  let status = 'healthy'
  if (!dbOk || !envOk) {
    status = 'unhealthy'
  } else if (hasWarnings) {
    status = 'degraded'
  }

  const httpCode = status === 'unhealthy' ? 503 : 200
  res.status(httpCode).json({
    status,
    checks,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  })
})

// API Routes
app.get('/api/scraps', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scraps')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (error) throw error

    res.json(data || [])
  } catch (error) {
    console.error('Error fetching scraps:', error)
    res.status(500).json({ error: 'Failed to fetch scraps' })
  }
})

app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query
    if (!q) {
      return res.json([])
    }

    const { data, error } = await supabase
      .from('scraps')
      .select('*')
      .or(`title.ilike.%${q}%,summary.ilike.%${q}%,content.ilike.%${q}%`)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    res.json(data || [])
  } catch (error) {
    console.error('Error searching scraps:', error)
    res.status(500).json({ error: 'Search failed' })
  }
})

app.get('/api/stats', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scraps')
      .select('source, created_at')
      .order('created_at', { ascending: false })

    if (error) throw error

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

    const stats = {
      total: data.length,
      today: data.filter(s => new Date(s.created_at) >= today).length,
      week: data.filter(s => new Date(s.created_at) >= weekAgo).length,
      sources: [...new Set(data.map(s => s.source))].length,
      bySource: data.reduce((acc, scrap) => {
        acc[scrap.source] = (acc[scrap.source] || 0) + 1
        return acc
      }, {}),
    }

    res.json(stats)
  } catch (error) {
    console.error('Error getting stats:', error)
    res.status(500).json({ error: 'Failed to get stats' })
  }
})

// ============ Screenshot triage (Layer 3) ============
// Lightweight human review queue for shots the gate flagged 'review'.

// The ambiguous queue, worst-score first (most likely bad → reviewed first).
app.get('/review/queue', async (req, res) => {
  try {
    const { data, error } = await supabase.from('scraps')
      .select('id, scrap_id, source, type, url, title, screenshot_url, quality_category, quality_score')
      .eq('screenshot_quality', 'review')
      .order('quality_score', { ascending: true })
      .limit(300)
    if (error) throw error
    res.json(data || [])
  } catch (e) { console.error('review/queue:', e.message); res.status(500).json({ error: e.message }) }
})

// Apply one decision. approve|reject|recapture|skip. Logs to screenshot_reviews.
app.post('/review/decide', async (req, res) => {
  const { id, decision, category, score } = req.body || {}
  if (!id || !decision) return res.status(400).json({ error: 'id and decision required' })
  try {
    const { data: scrap, error: ge } = await supabase.from('scraps')
      .select('scrap_id, url').eq('id', id).single()
    if (ge) throw ge

    let update = null
    if (decision === 'approve') {
      update = { screenshot_quality: 'accept', quality_checked_at: new Date().toISOString() }
    } else if (decision === 'reject') {
      // Never delete the scrap — drop the image, tell Unity to render text/color.
      update = { screenshot_quality: 'reject', screenshot_url: null, hide_shot_in_unity: true, quality_checked_at: new Date().toISOString() }
    } else if (decision === 'skip') {
      update = { quality_checked_at: new Date().toISOString() } // leave in review lane
    }
    if (update) {
      const { error: ue } = await supabase.from('scraps').update(update).eq('id', id)
      if (ue) throw ue
    }
    await supabase.from('screenshot_reviews').insert({
      scrap_id: scrap.scrap_id, category: category || null, decision, gate_score: score ?? null,
    })
    res.json({ ok: true })
  } catch (e) { console.error('review/decide:', e.message); res.status(500).json({ error: e.message }) }
})

// Re-shoot a scrap with the improved engine (force bypasses the cache), then let
// the gate re-score it. Async — returns immediately; the row re-enters the gate.
app.post('/review/recapture', async (req, res) => {
  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const { data: scrap, error } = await supabase.from('scraps')
      .select('scrap_id, url').eq('id', id).single()
    if (error) throw error
    if (!scrap.url) return res.status(400).json({ error: 'no url to recapture' })
    await supabase.from('scraps').update({ screenshot_quality: 'recapture_pending' }).eq('id', id)
    await supabase.from('screenshot_reviews').insert({ scrap_id: scrap.scrap_id, decision: 'recapture' })
    res.status(202).json({ ok: true, status: 'recapture_pending' })
    // Fire-and-forget after responding.
    ;(async () => {
      try {
        const { generateScreenshot } = await import('./generateScreenshot.mjs')
        const { gateScrap } = await import('../lib/screenshotQuality.mjs')
        const shot = await generateScreenshot(scrap.url, scrap.scrap_id, { force: true })
        const r = await gateScrap({ ...scrap, screenshot_url: shot?.url, capture_status: shot?.capture_status }, { allowVision: true })
        await supabase.from('scraps').update({
          screenshot_url: shot?.url ?? null,
          screenshot_quality: r.screenshot_quality, quality_category: r.quality_category,
          quality_score: r.quality_score, quality_signals: r.quality_signals,
          capture_status: shot?.capture_status ?? null, quality_checked_at: new Date().toISOString(),
        }).eq('id', id)
        console.log(`  recapture ${scrap.scrap_id} → ${r.screenshot_quality}`)
      } catch (e) { console.error(`  recapture ${scrap.scrap_id} failed:`, e.message) }
    })()
  } catch (e) { console.error('review/recapture:', e.message); res.status(500).json({ error: e.message }) }
})

// Bulk-apply a decision to every review-lane row in a category (e.g. reject all
// login_wall in one keypress). approve|reject only.
app.post('/review/bulk', async (req, res) => {
  const { category, decision } = req.body || {}
  if (!category || !['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'category + decision(approve|reject) required' })
  }
  try {
    const update = decision === 'approve'
      ? { screenshot_quality: 'accept', quality_checked_at: new Date().toISOString() }
      : { screenshot_quality: 'reject', screenshot_url: null, hide_shot_in_unity: true, quality_checked_at: new Date().toISOString() }
    const { data, error } = await supabase.from('scraps')
      .update(update).eq('screenshot_quality', 'review').eq('quality_category', category).select('id')
    if (error) throw error
    res.json({ ok: true, count: data?.length || 0 })
  } catch (e) { console.error('review/bulk:', e.message); res.status(500).json({ error: e.message }) }
})

// Serve the triage page.
app.get('/review', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'review.html'))
})

// Serve the dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'))
})

app.listen(PORT, () => {
  console.log(`🚀 Scrapbook Dashboard running at http://localhost:${PORT}`)
  console.log('📊 Real-time search and analytics for your digital memory')
})
