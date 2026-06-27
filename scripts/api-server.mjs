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

// Serve the dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'))
})

app.listen(PORT, () => {
  console.log(`🚀 Scrapbook Dashboard running at http://localhost:${PORT}`)
  console.log('📊 Real-time search and analytics for your digital memory')
})
