#!/usr/bin/env node
/**
 * POST-PROCESSING VALIDATOR
 * Run this AFTER processing to verify data was actually saved
 * Alerts if money was wasted on failed operations
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'
import fs from 'fs/promises'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

async function validateProcessing(options = {}) {
  const {
    minutesAgo = 60, // Check last hour by default
    minSuccessRate = 0.7, // 70% minimum success rate
  } = options

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'))
  console.log(chalk.bold.cyan('║    POST-PROCESSING VALIDATOR         ║'))
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝\n'))

  console.log(chalk.gray(`Analyzing scraps updated in the last ${minutesAgo} minutes...\n`))

  const cutoffTime = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString()

  // Get recent scraps
  const { data: recentScraps, error } = await supabase
    .from('scraps')
    .select('*')
    .gte('updated_at', cutoffTime)
    .order('updated_at', { ascending: false })

  if (error) {
    console.log(chalk.red(`❌ Failed to fetch scraps: ${error.message}\n`))
    return false
  }

  if (!recentScraps || recentScraps.length === 0) {
    console.log(chalk.yellow('⚠️  No scraps processed in this time window\n'))
    return true
  }

  console.log(chalk.blue(`📊 Analyzing ${recentScraps.length} recent scraps...\n`))

  // Analyze field completeness
  const stats = {
    total: recentScraps.length,
    withContent: 0,
    withSummary: 0,
    withTags: 0,
    withRelationships: 0,
    withLocation: 0,
    withScreenshot: 0,
    withEmbedding: 0,
    withFinancial: 0,
  }

  recentScraps.forEach(scrap => {
    if (scrap.content && scrap.content.length > 10) stats.withContent++
    if (scrap.summary && scrap.summary.length > 10) stats.withSummary++
    if (scrap.tags && scrap.tags.length > 0) stats.withTags++
    if (scrap.relationships && scrap.relationships.length > 0) stats.withRelationships++
    if (scrap.location) stats.withLocation++
    if (scrap.screenshot_url) stats.withScreenshot++
    if (scrap.embedding || scrap.embedding_nomic) stats.withEmbedding++
    if (scrap.financial_analysis) stats.withFinancial++
  })

  // Calculate rates
  const pct = (count) => ((count / stats.total) * 100).toFixed(1)

  console.log(chalk.bold('Field Completeness:'))
  console.log(`  Content:        ${stats.withContent.toString().padStart(4)} / ${stats.total} (${pct(stats.withContent)}%)`)
  console.log(`  Summaries:      ${stats.withSummary.toString().padStart(4)} / ${stats.total} (${pct(stats.withSummary)}%)`)
  console.log(`  Tags:           ${stats.withTags.toString().padStart(4)} / ${stats.total} (${pct(stats.withTags)}%)`)
  console.log(`  Relationships:  ${stats.withRelationships.toString().padStart(4)} / ${stats.total} (${pct(stats.withRelationships)}%)`)
  console.log(`  Embeddings:     ${stats.withEmbedding.toString().padStart(4)} / ${stats.total} (${pct(stats.withEmbedding)}%)`)
  console.log(`  Screenshots:    ${stats.withScreenshot.toString().padStart(4)} / ${stats.total} (${pct(stats.withScreenshot)}%)`)
  console.log(`  Locations:      ${stats.withLocation.toString().padStart(4)} / ${stats.total} (${pct(stats.withLocation)}%)`)
  console.log(`  Financial:      ${stats.withFinancial.toString().padStart(4)} / ${stats.total} (${pct(stats.withFinancial)}%)\n`)

  // Check cost tracking
  const costData = await loadCostData()
  if (costData) {
    const today = new Date().toISOString().split('T')[0]
    const todayStats = costData.dailyStats?.[today]
    if (todayStats) {
      console.log(chalk.bold("Today's Spending:"))
      console.log(`  Cost:     $${todayStats.cost.toFixed(4)}`)
      console.log(`  Requests: ${todayStats.requests}`)
      console.log(`  Scraps:   ${todayStats.scrapCount}\n`)

      if (todayStats.scrapCount > 0) {
        const costPerScrap = todayStats.cost / todayStats.scrapCount
        console.log(`  Avg Cost/Scrap: $${costPerScrap.toFixed(4)}\n`)
      }
    }
  }

  // Identify failures
  const failures = []
  const minSuccessCount = Math.floor(stats.total * minSuccessRate)

  if (stats.withContent < minSuccessCount) {
    failures.push(`Only ${pct(stats.withContent)}% have content (expected ${minSuccessRate * 100}%)`)
  }

  if (stats.withSummary < minSuccessCount) {
    failures.push(`Only ${pct(stats.withSummary)}% have summaries (expected ${minSuccessRate * 100}%)`)
  }

  if (stats.withEmbedding < minSuccessCount) {
    failures.push(`Only ${pct(stats.withEmbedding)}% have embeddings (expected ${minSuccessRate * 100}%)`)
  }

  // Show examples of failed scraps
  if (stats.withSummary < minSuccessCount) {
    console.log(chalk.bold.red('\n⚠️  SCRAPS WITHOUT SUMMARIES:\n'))

    const withoutSummaries = recentScraps
      .filter(s => !s.summary || s.summary.length < 10)
      .slice(0, 5)

    withoutSummaries.forEach((scrap, i) => {
      console.log(chalk.red(`  ${i+1}. ${scrap.title || 'No title'}`))
      console.log(chalk.gray(`     URL: ${scrap.url || 'N/A'}`))
      console.log(chalk.gray(`     Content: ${scrap.content ? scrap.content.length + ' chars' : 'missing'}`))
      console.log(chalk.gray(`     Updated: ${scrap.updated_at}\n`))
    })
  }

  // Final verdict
  console.log('\n' + '─'.repeat(50) + '\n')

  if (failures.length === 0) {
    console.log(chalk.bold.green('✅ VALIDATION PASSED\n'))
    console.log(chalk.green('Processing is working correctly. Money well spent!\n'))
    return true
  } else {
    console.log(chalk.bold.red('❌ VALIDATION FAILED\n'))
    console.log(chalk.red('Processing failures detected:\n'))
    failures.forEach(f => console.log(chalk.red(`  • ${f}`)))
    console.log()
    console.log(chalk.red('⚠️  MONEY MAY BE WASTED ON FAILED OPERATIONS!\n'))
    console.log(chalk.yellow('Actions:'))
    console.log(chalk.yellow('  1. Check circuit breaker logs'))
    console.log(chalk.yellow('  2. Run health check: node scripts/health_check.mjs'))
    console.log(chalk.yellow('  3. Check error logs in logs/error.log\n'))
    return false
  }
}

async function loadCostData() {
  try {
    const data = await fs.readFile('./data/cost-history.json', 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    return null
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const minutesAgo = parseInt(process.argv[2]) || 60
  validateProcessing({ minutesAgo })
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error(chalk.red(`\n❌ Validation error: ${error.message}\n`))
      process.exit(1)
    })
}

export default validateProcessing
