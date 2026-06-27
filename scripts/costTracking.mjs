/**
 * Cost Tracking Service for Scrapbook Core
 * Tracks token usage and calculates costs across all AI services
 */

import fs from 'fs'
import path from 'path'
import winston from 'winston'
import chalk from 'chalk'

// Initialize logger for NDJSON output
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    // NDJSON log file for detailed per-request tracking
    new winston.transports.File({
      filename: 'logs/cost-tracking.ndjson',
      format: winston.format.json(), // One JSON object per line
    }),
    // Human-readable console output
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
})

// Model pricing data (costs per token)
const MODEL_PRICING = {
  // OpenRouter models
  'deepseek/deepseek-chat-v3.1:free': { prompt: 0, completion: 0, request: 0 },
  'deepseek/deepseek-chat:free': { prompt: 0, completion: 0, request: 0 },
  'nousresearch/hermes-3-llama-3.1-405b:free': { prompt: 0, completion: 0, request: 0 },
  'mistralai/mistral-small-3.2-24b-instruct:free': { prompt: 0, completion: 0, request: 0 },
  'google/gemini-2.0-flash-exp:free': { prompt: 0, completion: 0, request: 0 },
  'meta-llama/llama-3.1-8b-instruct:free': { prompt: 0, completion: 0, request: 0 },

  // Paid models
  'deepseek/deepseek-chat-v3.1': { prompt: 0.00000027, completion: 0.000001, request: 0 },
  'google/gemini-2.5-flash-preview-09-2025': { prompt: 0.0000003, completion: 0.0000025, request: 0 },
  'google/gemini-2.5-flash': { prompt: 0.0000003, completion: 0.0000025, request: 0 }, // $0.30/$2.50 per 1M tokens
  'google/gemini-2.0-flash-001': { prompt: 0.0000001, completion: 0.0000004, request: 0 }, // $0.10/$0.40 per 1M tokens
  'google/gemini-2.5-flash-lite': { prompt: 0.0000001, completion: 0.0000004, request: 0 }, // $0.10/$0.40 per 1M tokens
  'google/gemini-2.5-flash-lite-preview-09-2025': { prompt: 0.0000001, completion: 0.0000004, request: 0 }, // $0.10/$0.40 per 1M tokens
  'google/gemma-3-12b-it': { prompt: 0.00000005, completion: 0.00000015, request: 0 }, // $0.05/$0.15 per 1M tokens
  'qwen/qwen3-235b-a22b-2507': { prompt: 0.00000009, completion: 0.0000001, request: 0 }, // $0.09/$0.10 per 1M tokens
  'qwen/qwen3-30b-a3b-instruct-2507': { prompt: 0.000000048, completion: 0.000000193, request: 0 }, // $0.048/$0.193 per 1M tokens
  'openai/gpt-5-nano': { prompt: 0.00000005, completion: 0.0000004, request: 0 }, // $0.05/$0.40 per 1M tokens
  // Newer Chinese models (buffet candidates)
  'qwen/qwen3.5-flash-02-23': { prompt: 0.000000065, completion: 0.00000026, request: 0 }, // $0.065/$0.26 per 1M tokens
  'z-ai/glm-4.7-flash': { prompt: 0.00000006, completion: 0.0000004, request: 0 }, // $0.06/$0.40 per 1M tokens
  'deepseek/deepseek-v3.2': { prompt: 0.000000229, completion: 0.000000343, request: 0 }, // $0.229/$0.343 per 1M tokens
  'moonshotai/kimi-k2.5': { prompt: 0.000000375, completion: 0.000002025, request: 0 }, // $0.375/$2.025 per 1M tokens

  // Claude models
  'anthropic/claude-3.5-sonnet': { prompt: 0.000003, completion: 0.000015, request: 0 }, // $3/$15 per 1M tokens
  'anthropic/claude-3.5-haiku': { prompt: 0.0000008, completion: 0.000004, request: 0 }, // $0.80/$4 per 1M tokens
  'openai/gpt-4o': { prompt: 0.0000025, completion: 0.00001, request: 0 }, // $2.50/$10 per 1M tokens
  'openai/gpt-4o-mini': { prompt: 0.00000015, completion: 0.0000006, request: 0 }, // $0.15/$0.60 per 1M tokens

  // OpenAI models (static pricing from documentation)
  'text-embedding-3-small': { prompt: 0.00000002, completion: 0, request: 0 }, // $0.02 per 1M tokens
  'text-embedding-3-large': { prompt: 0.00000013, completion: 0, request: 0 }, // $0.13 per 1M tokens
  'text-embedding-ada-002': { prompt: 0.0000001, completion: 0, request: 0 },  // $0.10 per 1M tokens

  // Nomic models
  'nomic-embed-text-v1.5': { prompt: 0, completion: 0, request: 0 }, // Free tier available
  'nomic-embed-vision-v1.5': { prompt: 0, completion: 0, request: 0 }, // Free tier available

  // Default fallback for unknown models — mid-range estimate (~$0.50/$1.50 per 1M),
  // NOT the old $10/$10 which wildly overstated cheap models like gemma/qwen.
  'unknown': { prompt: 0.0000005, completion: 0.0000015, request: 0 },
}

// Cost tracking state
let costTracking = {
  session: {
    totalCost: 0,
    totalTokens: 0,
    requestCount: 0,
    startTime: new Date().toISOString(),
    byModel: {},
    byTask: {},
    byScrap: {},
  },
  historical: {
    totalLifetimeCost: 0,
    totalLifetimeTokens: 0,
    totalLifetimeRequests: 0,
    dailyStats: {},
    weeklyStats: {},
    monthlyStats: {},
  },
}

// Load historical data on startup
function loadHistoricalData() {
  const costFile = path.join(process.cwd(), 'data', 'cost-history.json')
  try {
    if (fs.existsSync(costFile)) {
      const data = JSON.parse(fs.readFileSync(costFile, 'utf8'))
      costTracking.historical = { ...costTracking.historical, ...data }
      logger.info(`Loaded historical cost data: $${costTracking.historical.totalLifetimeCost.toFixed(4)} lifetime`)
    }
  } catch (error) {
    logger.warn('Could not load historical cost data:', error.message)
  }
}

// Save historical data
function saveHistoricalData() {
  const costFile = path.join(process.cwd(), 'data', 'cost-history.json')
  const dataDir = path.dirname(costFile)

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  try {
    fs.writeFileSync(costFile, JSON.stringify(costTracking.historical, null, 2))
  } catch (error) {
    logger.error('Could not save historical cost data:', error.message)
  }
}

// Calculate cost for a specific model and usage
export function calculateCost(modelId, usage) {
  const pricing = MODEL_PRICING[modelId] || MODEL_PRICING['unknown']

  const promptCost = (usage.prompt_tokens || 0) * pricing.prompt
  const completionCost = (usage.completion_tokens || 0) * pricing.completion
  const requestCost = pricing.request

  const totalCost = promptCost + completionCost + requestCost

  return {
    totalCost,
    promptCost,
    completionCost,
    requestCost,
    breakdown: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    },
  }
}

// Track cost for a request
export function trackCost(modelId, usage, options = {}) {
  const { scrapId, taskType, source, script, feature } = options

  const cost = calculateCost(modelId, usage)
  const timestamp = new Date().toISOString()
  const dateKey = timestamp.split('T')[0] // YYYY-MM-DD format
  const hourKey = timestamp.substring(11, 13) // HH (hour of day)

  // Update session tracking
  costTracking.session.totalCost += cost.totalCost
  costTracking.session.totalTokens += cost.breakdown.totalTokens
  costTracking.session.requestCount += 1

  // Track by model
  if (!costTracking.session.byModel[modelId]) {
    costTracking.session.byModel[modelId] = {
      cost: 0,
      tokens: 0,
      requests: 0,
    }
  }
  costTracking.session.byModel[modelId].cost += cost.totalCost
  costTracking.session.byModel[modelId].tokens += cost.breakdown.totalTokens
  costTracking.session.byModel[modelId].requests += 1

  // Track by task type
  if (taskType) {
    if (!costTracking.session.byTask[taskType]) {
      costTracking.session.byTask[taskType] = {
        cost: 0,
        tokens: 0,
        requests: 0,
        byModel: {},
      }
    }
    costTracking.session.byTask[taskType].cost += cost.totalCost
    costTracking.session.byTask[taskType].tokens += cost.breakdown.totalTokens
    costTracking.session.byTask[taskType].requests += 1

    // Track model usage within this task type
    if (!costTracking.session.byTask[taskType].byModel[modelId]) {
      costTracking.session.byTask[taskType].byModel[modelId] = {
        cost: 0,
        tokens: 0,
        requests: 0,
      }
    }
    costTracking.session.byTask[taskType].byModel[modelId].cost += cost.totalCost
    costTracking.session.byTask[taskType].byModel[modelId].tokens += cost.breakdown.totalTokens
    costTracking.session.byTask[taskType].byModel[modelId].requests += 1
  }

  // Track by scrap
  if (scrapId) {
    if (!costTracking.session.byScrap[scrapId]) {
      costTracking.session.byScrap[scrapId] = {
        cost: 0,
        tokens: 0,
        requests: 0,
        tasks: [],
        source: source,
      }
    }
    costTracking.session.byScrap[scrapId].cost += cost.totalCost
    costTracking.session.byScrap[scrapId].tokens += cost.breakdown.totalTokens
    costTracking.session.byScrap[scrapId].requests += 1
    if (taskType && !costTracking.session.byScrap[scrapId].tasks.includes(taskType)) {
      costTracking.session.byScrap[scrapId].tasks.push(taskType)
    }
  }

  // Update historical tracking
  costTracking.historical.totalLifetimeCost += cost.totalCost
  costTracking.historical.totalLifetimeTokens += cost.breakdown.totalTokens
  costTracking.historical.totalLifetimeRequests += 1

  // Update daily stats
  if (!costTracking.historical.dailyStats[dateKey]) {
    costTracking.historical.dailyStats[dateKey] = {
      cost: 0,
      tokens: 0,
      requests: 0,
      scrapCount: 0,
      byModel: {},
      byTask: {},
    }
  }
  costTracking.historical.dailyStats[dateKey].cost += cost.totalCost
  costTracking.historical.dailyStats[dateKey].tokens += cost.breakdown.totalTokens
  costTracking.historical.dailyStats[dateKey].requests += 1

  if (scrapId) {
    costTracking.historical.dailyStats[dateKey].scrapCount += 1
  }

  // Log detailed NDJSON entry for analysis
  logger.info('Cost tracked', {
    timestamp,
    date: dateKey,
    hour: hourKey,
    modelId,
    taskType,
    source,
    script,
    feature,
    scrapId,
    cost: cost.totalCost,
    promptCost: cost.promptCost,
    completionCost: cost.completionCost,
    promptTokens: cost.breakdown.promptTokens,
    completionTokens: cost.breakdown.completionTokens,
    totalTokens: cost.breakdown.totalTokens,
  })

  // Save historical data periodically (every 10 requests)
  if (costTracking.session.requestCount % 10 === 0) {
    saveHistoricalData()
  }

  return cost
}

// Get current session stats
export function getSessionStats() {
  const duration = new Date() - new Date(costTracking.session.startTime)

  return {
    ...costTracking.session,
    duration: duration,
    avgCostPerScrap: costTracking.session.totalCost / Object.keys(costTracking.session.byScrap).length || 0,
    avgCostPerRequest: costTracking.session.totalCost / costTracking.session.requestCount || 0,
    avgTokensPerRequest: costTracking.session.totalTokens / costTracking.session.requestCount || 0,
  }
}

// Get historical stats
export function getHistoricalStats() {
  return costTracking.historical
}

// Get per-scrap cost breakdown
export function getScrapCosts() {
  return costTracking.session.byScrap
}

// Get cost summary for display
export function getCostSummary() {
  const session = getSessionStats()
  const historical = getHistoricalStats()

  return {
    session: {
      totalCost: session.totalCost,
      totalTokens: session.totalTokens,
      requestCount: session.requestCount,
      avgCostPerScrap: session.avgCostPerScrap,
      duration: Math.round(session.duration / 1000), // seconds
    },
    historical: {
      totalLifetimeCost: historical.totalLifetimeCost,
      totalLifetimeTokens: historical.totalLifetimeTokens,
      totalLifetimeRequests: historical.totalLifetimeRequests,
    },
    topExpensiveModels: Object.entries(session.byModel)
      .sort(([,a], [,b]) => b.cost - a.cost)
      .slice(0, 5),
    topExpensiveTasks: Object.entries(session.byTask)
      .sort(([,a], [,b]) => b.cost - a.cost)
      .slice(0, 5),
  }
}

// Print cost summary to console
export function printCostSummary() {
  const summary = getCostSummary()

  console.log(chalk.cyan('\n📊 COST TRACKING SUMMARY'))
  console.log(chalk.cyan('━'.repeat(50)))

  console.log(chalk.yellow('\n💰 Session Costs:'))
  console.log(`Total Cost: ${chalk.green('$' + summary.session.totalCost.toFixed(6))}`)
  console.log(`Total Tokens: ${chalk.blue(summary.session.totalTokens.toLocaleString())}`)
  console.log(`Requests: ${chalk.blue(summary.session.requestCount)}`)
  console.log(`Avg Cost/Scrap: ${chalk.green('$' + summary.session.avgCostPerScrap.toFixed(6))}`)
  console.log(`Duration: ${chalk.gray(summary.session.duration + 's')}`)

  console.log(chalk.yellow('\n📈 Lifetime Totals:'))
  console.log(`Total Cost: ${chalk.green('$' + summary.historical.totalLifetimeCost.toFixed(4))}`)
  console.log(`Total Tokens: ${chalk.blue(summary.historical.totalLifetimeTokens.toLocaleString())}`)
  console.log(`Total Requests: ${chalk.blue(summary.historical.totalLifetimeRequests.toLocaleString())}`)

  if (summary.topExpensiveModels.length > 0) {
    console.log(chalk.yellow('\n🏆 Top Models by Cost:'))
    summary.topExpensiveModels.forEach(([model, stats], i) => {
      console.log(`${i + 1}. ${chalk.blue(model)}: ${chalk.green('$' + stats.cost.toFixed(6))} (${stats.tokens.toLocaleString()} tokens)`)
    })
  }

  if (summary.topExpensiveTasks.length > 0) {
    console.log(chalk.yellow('\n📋 Top Tasks by Cost:'))
    summary.topExpensiveTasks.forEach(([task, stats], i) => {
      console.log(`${i + 1}. ${chalk.blue(task)}: ${chalk.green('$' + stats.cost.toFixed(6))} (${stats.tokens.toLocaleString()} tokens)`)
    })
  }

  console.log(chalk.cyan('━'.repeat(50)))
}

// Cost checking with circuit breaker support
export function checkCostAlerts(thresholds = {}) {
  const {
    sessionCostLimit = 1.0,    // $1.00 per session
    dailyCostLimit = 5.0,      // $5.00 per day
    scrapCostLimit = 0.10,      // $0.10 per scrap
  } = thresholds

  const alerts = []
  const session = getSessionStats()

  // Session cost alert - this is the primary circuit breaker
  if (session.totalCost > sessionCostLimit) {
    alerts.push({
      type: 'session_limit',
      message: `Session cost $${session.totalCost.toFixed(4)} exceeds limit $${sessionCostLimit}`,
      severity: 'critical',
      shouldStop: true,
    })
  }

  // Warning at 80% of session limit
  if (session.totalCost > sessionCostLimit * 0.8) {
    alerts.push({
      type: 'session_warning',
      message: `Session cost $${session.totalCost.toFixed(4)} approaching limit $${sessionCostLimit}`,
      severity: 'warning',
      shouldStop: false,
    })
  }

  // High-cost scrap alerts
  Object.entries(session.byScrap).forEach(([scrapId, stats]) => {
    if (stats.cost > scrapCostLimit) {
      alerts.push({
        type: 'scrap_cost',
        message: `Scrap ${scrapId} cost $${stats.cost.toFixed(4)} exceeds limit $${scrapCostLimit}`,
        scrapId,
        severity: 'warning',
        shouldStop: false,
      })
    }
  })

  return alerts
}

// Simple cost summary
export function generateQuickReport() {
  const session = getSessionStats()
  const historical = getHistoricalStats()

  console.log(chalk.cyan('\n💰 COST SUMMARY'))
  console.log(chalk.cyan('━'.repeat(30)))
  console.log(`Session: ${chalk.green('$' + session.totalCost.toFixed(4))} (${session.totalTokens.toLocaleString()} tokens)`)
  console.log(`Lifetime: ${chalk.green('$' + historical.totalLifetimeCost.toFixed(4))} (${historical.totalLifetimeTokens.toLocaleString()} tokens)`)

  if (session.requestCount > 0) {
    console.log(`Avg/Request: ${chalk.green('$' + (session.totalCost / session.requestCount).toFixed(6))}`)
  }

  // Show expensive scraps
  const expensiveScraps = Object.entries(session.byScrap)
    .filter(([, stats]) => stats.cost > 0.01)
    .sort(([,a], [,b]) => b.cost - a.cost)
    .slice(0, 3)

  if (expensiveScraps.length > 0) {
    console.log(chalk.yellow('\nTop expensive scraps:'))
    expensiveScraps.forEach(([scrapId, stats]) => {
      console.log(`  ${scrapId.substring(0, 20)}: ${chalk.red('$' + stats.cost.toFixed(4))}`)
    })
  }
}

// Reset session tracking (for new runs)
export function resetSession() {
  costTracking.session = {
    totalCost: 0,
    totalTokens: 0,
    requestCount: 0,
    startTime: new Date().toISOString(),
    byModel: {},
    byTask: {},
    byScrap: {},
  }

  logger.info('Cost tracking session reset')
}

// Initialize cost tracking
export function initializeCostTracking() {
  loadHistoricalData()

  // Set up graceful shutdown to save data
  process.on('SIGINT', () => {
    saveHistoricalData()
    printCostSummary()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    saveHistoricalData()
    process.exit(0)
  })

  logger.info('Cost tracking initialized')
}

// Update model pricing (for when API pricing changes)
export function updateModelPricing(newPricing) {
  Object.assign(MODEL_PRICING, newPricing)
  logger.info('Model pricing updated', { newModels: Object.keys(newPricing) })
}

// Initialize on import
initializeCostTracking()
