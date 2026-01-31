#!/usr/bin/env node
/**
 * OpenRouter Leaderboard - Personal AI usage analytics
 * Aggregates cost-tracking.ndjson into per-model and per-task stats
 * Pushes to Loki for Grafana dashboards
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGS_DIR = path.join(__dirname, '..', 'logs')
const NDJSON_FILE = path.join(LOGS_DIR, 'cost-tracking.ndjson')
const LOKI_URL = process.env.LOKI_URL || 'http://localhost:3100/loki/api/v1/push'

async function parseNDJSON(filepath, daysBack = 7) {
  const stats = {
    byModel: {},
    byTask: {},
    bySource: {},
    byDay: {},
    totals: { cost: 0, tokens: 0, requests: 0 }
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)
  const cutoffStr = cutoffDate.toISOString().split('T')[0]

  if (!fs.existsSync(filepath)) {
    console.error(`File not found: ${filepath}`)
    return stats
  }

  const fileStream = fs.createReadStream(filepath)
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line)
      if (entry.message !== 'Cost tracked') continue
      if (entry.date < cutoffStr) continue

      const { modelId, taskType, cost, totalTokens, promptTokens, completionTokens, source, date } = entry

      // Aggregate by model
      if (modelId) {
        if (!stats.byModel[modelId]) {
          stats.byModel[modelId] = { cost: 0, tokens: 0, requests: 0, promptTokens: 0, completionTokens: 0 }
        }
        stats.byModel[modelId].cost += cost || 0
        stats.byModel[modelId].tokens += totalTokens || 0
        stats.byModel[modelId].promptTokens += promptTokens || 0
        stats.byModel[modelId].completionTokens += completionTokens || 0
        stats.byModel[modelId].requests += 1
      }

      // Aggregate by task
      if (taskType) {
        if (!stats.byTask[taskType]) {
          stats.byTask[taskType] = { cost: 0, tokens: 0, requests: 0 }
        }
        stats.byTask[taskType].cost += cost || 0
        stats.byTask[taskType].tokens += totalTokens || 0
        stats.byTask[taskType].requests += 1
      }

      // Aggregate by source (openrouter vs openai-fallback)
      const src = source || 'unknown'
      if (!stats.bySource[src]) {
        stats.bySource[src] = { cost: 0, tokens: 0, requests: 0 }
      }
      stats.bySource[src].cost += cost || 0
      stats.bySource[src].tokens += totalTokens || 0
      stats.bySource[src].requests += 1

      // Aggregate by day
      if (date) {
        if (!stats.byDay[date]) {
          stats.byDay[date] = { cost: 0, tokens: 0, requests: 0 }
        }
        stats.byDay[date].cost += cost || 0
        stats.byDay[date].tokens += totalTokens || 0
        stats.byDay[date].requests += 1
      }

      // Totals
      stats.totals.cost += cost || 0
      stats.totals.tokens += totalTokens || 0
      stats.totals.requests += 1

    } catch (e) {
      // Skip malformed lines
    }
  }

  return stats
}

function formatLeaderboard(stats) {
  const lines = []

  lines.push('\n🏆 MODEL LEADERBOARD (by cost, last 7 days)')
  lines.push('─'.repeat(60))

  const modelsSorted = Object.entries(stats.byModel)
    .sort(([,a], [,b]) => b.cost - a.cost)
    .slice(0, 10)

  modelsSorted.forEach(([model, data], i) => {
    const avgTokens = Math.round(data.tokens / data.requests)
    lines.push(`${i+1}. ${model.padEnd(35)} $${data.cost.toFixed(4).padStart(8)} | ${data.requests.toString().padStart(5)} reqs | ~${avgTokens} tok/req`)
  })

  lines.push('\n📋 TASK BREAKDOWN')
  lines.push('─'.repeat(60))

  const tasksSorted = Object.entries(stats.byTask)
    .sort(([,a], [,b]) => b.cost - a.cost)

  tasksSorted.forEach(([task, data]) => {
    lines.push(`${task.padEnd(25)} $${data.cost.toFixed(4).padStart(8)} | ${data.requests.toString().padStart(5)} reqs`)
  })

  lines.push('\n🔌 SOURCE BREAKDOWN')
  lines.push('─'.repeat(60))

  Object.entries(stats.bySource).forEach(([source, data]) => {
    lines.push(`${source.padEnd(25)} $${data.cost.toFixed(4).padStart(8)} | ${data.requests.toString().padStart(5)} reqs`)
  })

  lines.push('\n📊 DAILY TREND (last 7 days)')
  lines.push('─'.repeat(60))

  const recentDays = Object.entries(stats.byDay)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7)

  recentDays.forEach(([day, data]) => {
    const bar = '█'.repeat(Math.min(50, Math.round(data.cost * 10)))
    lines.push(`${day} $${data.cost.toFixed(2).padStart(6)} ${bar}`)
  })

  lines.push('\n💰 TOTALS (last 7 days)')
  lines.push('─'.repeat(60))
  lines.push(`Cost: $${stats.totals.cost.toFixed(4)}`)
  lines.push(`Tokens: ${stats.totals.tokens.toLocaleString()}`)
  lines.push(`Requests: ${stats.totals.requests.toLocaleString()}`)
  lines.push(`Avg cost/request: $${(stats.totals.cost / stats.totals.requests).toFixed(6)}`)

  return lines.join('\n')
}

async function pushToLoki(stats) {
  const timestamp = Date.now() * 1000000 // nanoseconds

  const streams = []

  // Push model stats
  for (const [model, data] of Object.entries(stats.byModel)) {
    streams.push({
      stream: { job: 'openrouter-leaderboard', type: 'model', model: model.replace(/\//g, '_') },
      values: [[timestamp.toString(), JSON.stringify({ model, ...data })]]
    })
  }

  // Push task stats
  for (const [task, data] of Object.entries(stats.byTask)) {
    streams.push({
      stream: { job: 'openrouter-leaderboard', type: 'task', task },
      values: [[timestamp.toString(), JSON.stringify({ task, ...data })]]
    })
  }

  // Push totals
  streams.push({
    stream: { job: 'openrouter-leaderboard', type: 'totals' },
    values: [[timestamp.toString(), JSON.stringify(stats.totals)]]
  })

  try {
    const response = await fetch(LOKI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streams })
    })
    if (response.ok) {
      console.log(`✅ Pushed ${streams.length} streams to Loki`)
    } else {
      console.log(`⚠️  Loki push failed: ${response.status}`)
    }
  } catch (e) {
    console.log(`⚠️  Could not reach Loki: ${e.message}`)
  }
}

// Main
const stats = await parseNDJSON(NDJSON_FILE, 7)
console.log(formatLeaderboard(stats))
await pushToLoki(stats)
