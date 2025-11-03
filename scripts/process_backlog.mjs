#!/usr/bin/env node

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import chalk from 'chalk'
import { processBookmark } from './dl_pinboard.mjs'
import { resetSession, getSessionStats } from './costTracking.mjs'
import {
  shouldContinueProcessing,
  startProcessingRun,
  recordSuccess,
  recordFailure,
  validateData,
  printSafetyStatus,
} from './safetyManager.mjs'

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://xmdylmbdeulxcqdbkfno.supabase.co',
  process.env.SUPABASE_KEY,
)

async function processBacklog() {
  console.log(chalk.bold.cyan('\n🚀 PROCESSING BACKLOG WITH GEMINI 2.5 FLASH\n'))

  // Check safety before starting
  const safetyCheck = shouldContinueProcessing(true) // automated=true
  if (!safetyCheck.safe) {
    console.log(chalk.red(`🚨 Safety check failed: ${safetyCheck.reason}`))
    console.log(chalk.gray(`Recommendation: ${safetyCheck.recommendation}`))
    printSafetyStatus()
    return
  }

  // Reset cost tracking
  resetSession()
  console.log(chalk.dim('Cost tracking session reset\n'))

  // Apply safety batch limits for automated processing
  const maxBatchSize = parseInt(process.env.SAFETY_MAX_ITEMS_PER_RUN || '50')
  const userLimit = 5 // Original limit from the code
  const safeLimit = Math.min(userLimit, maxBatchSize)

  // Get unprocessed items with safety limit
  const { data: unprocessed, error } = await supabase
    .from('scraps')
    .select('*')
    .or('summary.is.null,tags.is.null')
    .eq('source', 'pinboard') // Focus on pinboard for now
    .order('created_at', { ascending: false })
    .limit(safeLimit)

  console.log(chalk.blue(`🛡️  Safety limit applied: processing max ${safeLimit} items (user: ${userLimit}, safety: ${maxBatchSize})`))

  if (error) {
    console.error(chalk.red('Error fetching unprocessed items:'), error)
    return
  }

  if (!unprocessed || unprocessed.length === 0) {
    console.log(chalk.yellow('No unprocessed items found'))
    return
  }

  console.log(chalk.green(`Found ${unprocessed.length} items to process\n`))

  // Start safety-managed processing run
  startProcessingRun({
    isAutomated: true,
    expectedItems: unprocessed.length,
  })

  let processed = 0
  let errors = 0
  const startTime = Date.now()

  for (const item of unprocessed) {
    // Check safety before processing each item
    const itemSafetyCheck = shouldContinueProcessing(true)
    if (!itemSafetyCheck.safe) {
      console.log(chalk.yellow(`🛑 Safety stop: ${itemSafetyCheck.reason}`))
      break
    }

    // Validate data before processing
    const bookmark = {
      href: item.url,
      description: item.title || '',
      extended: item.content || '',
      tags: item.tags?.join(' ') || '',
      time: item.created_at,
      hash: item.scrap_id.replace('pinboard-', ''),
    }

    const validation = validateData(bookmark, 'pinboard')
    if (!validation.valid) {
      console.log(chalk.yellow(`⚠️  Skipping malformed item: ${validation.reason}`))
      recordFailure(item.scrap_id, 'pinboard', new Error(`Data validation: ${validation.reason}`))
      errors++
      continue
    }

    try {
      console.log(chalk.blue(`\n📝 Processing ${item.scrap_id.substring(0, 30)}...`))
      console.log(chalk.dim(`  Title: ${item.title || 'No title'}`))
      console.log(chalk.dim(`  URL: ${item.url}`))

      const processStart = Date.now()
      await processBookmark(bookmark)
      const processTime = Date.now() - processStart

      console.log(chalk.green(`  ✅ Processed in ${(processTime / 1000).toFixed(1)}s`))
      recordSuccess(item.scrap_id, 'pinboard')
      processed++

    } catch (error) {
      console.error(chalk.red(`  ❌ Error: ${error.message}`))
      recordFailure(item.scrap_id, 'pinboard', error)
      errors++
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)

  // Show summary
  console.log(chalk.bold.cyan('\n📊 PROCESSING SUMMARY\n'))
  console.log(chalk.green(`✅ Successfully processed: ${processed}`))
  console.log(chalk.red(`❌ Errors: ${errors}`))
  console.log(chalk.blue(`⏱️  Total time: ${totalTime}s`))
  if (processed > 0) {
    console.log(chalk.yellow(`⚡ Avg time per item: ${(totalTime / processed).toFixed(1)}s`))
  }

  // Show cost summary
  const costSummary = getSessionStats()
  console.log(chalk.bold.magenta('\n💰 COST SUMMARY'))
  console.log(chalk.dim(`Total cost: $${costSummary.totalCost.toFixed(4)}`))
  console.log(chalk.dim(`Total tokens: ${costSummary.totalTokens}`))
  if (processed > 0) {
    console.log(chalk.dim(`Avg cost per item: $${(costSummary.totalCost / processed).toFixed(5)}`))

    // Extrapolate costs
    const costPer1000 = (costSummary.totalCost / processed) * 1000
    console.log(chalk.cyan('\n📈 Projected costs:'))
    console.log(chalk.dim(`  Per 1,000 items: $${costPer1000.toFixed(2)}`))
    console.log(chalk.dim(`  Per 10,000 items: $${(costPer1000 * 10).toFixed(2)}`))
  }

  // Show final safety status
  console.log(chalk.bold.blue('\n🛡️  SAFETY STATUS'))
  printSafetyStatus()
}

processBacklog().catch(console.error)
