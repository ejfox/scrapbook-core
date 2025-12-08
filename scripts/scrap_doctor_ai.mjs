#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'
import ora from 'ora'
import { program } from 'commander'
import path from 'path'
import fs from 'fs'

// Import AI services and utilities
import { summarizeContent, generateMetaSummary } from './aiSummarization.mjs'
import { extractRelationships } from './aiRelationshipExtraction.mjs'
import { extractLocation } from './aiGeolocation.mjs'
import { extractFinancialAnalysis } from './aiFinancialAnalysis.mjs'
import { enrichWithReasoningFields } from './reasoningFields.mjs'
import { generateScreenshot } from './generateScreenshot.mjs'
import { completion, MODELS } from './llmService.mjs'
import { getModelForTask } from '../lib/config.mjs'
import { fetchPageContent } from '../helpers.js'
import { trackCost } from './costTracking.mjs'
import { autoSyncRecentTags } from './sync_tags_to_pinboard.mjs'
import Bottleneck from 'bottleneck'

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

// Rate limiter for screenshots: 1 every 3 seconds
const browserLimiter = new Bottleneck({
  minTime: 3000,
  maxConcurrent: 1,
})

// Set up CLI
program
  .name('scrap-doctor-ai')
  .description('🩺 AI-powered doctor for your digital memory - generates rich summaries and tags')
  .version('2.0.0')

program
  .command('repair')
  .description('Repair scraps with AI-generated summaries, tags, and relationships')
  .option('-s, --source <source>', 'Only repair specific source')
  .option('-t, --type <type>', 'Only repair specific type (summary, tags, relationships, location, financial, screenshot)')
  .option('-l, --limit <number>', 'Limit repairs to N scraps', '10')
  .option('-a, --auto', 'Auto-repair without prompts')
  .option('--fetch-content', 'Fetch full content from URLs', true)
  .option('-f, --force', 'Force regenerate all fields even if they exist')
  .option('--sync-to-pinboard', 'Sync repaired tags back to Pinboard after batch completes')
  .option('--priority', 'Use priority_ids.json for weighted/interesting scraps first')
  .action(repair)

// Cyberpunk UI helpers
const cyber = {
  banner: () => {
    const lines = [
      '╔═══════════════════════════════════════════════════════════════╗',
      '║  ███████╗ ██████╗██████╗  █████╗ ██████╗     ██████╗  ██████╗ ║',
      '║  ██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗    ██╔══██╗██╔═══██╗║',
      '║  ███████╗██║     ██████╔╝███████║██████╔╝    ██║  ██║██║   ██║║',
      '║  ╚════██║██║     ██╔══██╗██╔══██║██╔═══╝     ██║  ██║██║   ██║║',
      '║  ███████║╚██████╗██║  ██║██║  ██║██║         ██████╔╝╚██████╔╝║',
      '║  ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝         ╚═════╝  ╚═════╝ ║',
      '║                                                                 ║',
      '║         A I - P O W E R E D   M E M O R Y   D O C T O R        ║',
      '╚═══════════════════════════════════════════════════════════════╝'
    ]
    console.log(chalk.cyan(lines.join('\n')))
    console.log(chalk.magenta('    > Initializing neural pathways...\n'))
  },

  bar: (current, total) => {
    const width = 40
    const percentage = Math.floor((current / total) * 100)
    const filled = Math.floor((current / total) * width)
    const empty = width - filled
    const bar = chalk.cyan('█').repeat(filled) + chalk.gray('░').repeat(empty)
    return `${bar} ${chalk.magenta(percentage + '%')} ${chalk.gray(`[${current}/${total}]`)}`
  },

  stats: (repaired, failed, total, threads = 0) => {
    const box = [
      chalk.gray('┌─────────────────────────────────────┐'),
      chalk.gray('│') + chalk.cyan(' STATS ') + chalk.gray('                             │'),
      chalk.gray('├─────────────────────────────────────┤'),
      chalk.gray('│') + chalk.green(' ✓ Repaired: ') + chalk.white(repaired.toString().padEnd(22)) + chalk.gray('│'),
      chalk.gray('│') + chalk.red(' ✗ Failed:   ') + chalk.white(failed.toString().padEnd(22)) + chalk.gray('│'),
      chalk.gray('│') + chalk.magenta(' 🧵 Threads:  ') + chalk.white(threads.toString().padEnd(21)) + chalk.gray('│'),
      chalk.gray('│') + chalk.yellow(' ⚡ Rate:     ') + chalk.white(`${((repaired/(repaired+failed))*100).toFixed(1)}%`.padEnd(21)) + chalk.gray('│'),
      chalk.gray('└─────────────────────────────────────┘')
    ]
    return box.join('\n')
  },

  divider: () => chalk.gray('━'.repeat(65)),

  glitch: (text) => {
    const glitchChars = '▒▓█░'
    const random = glitchChars[Math.floor(Math.random() * glitchChars.length)]
    return chalk.red(`${random} ${text} ${random}`)
  }
}

async function repair(options) {
  console.clear()
  cyber.banner()

  const spinner = ora({
    text: 'Scanning memory banks...',
    spinner: 'dots12',
    color: 'cyan'
  }).start()

  let scraps = []
  let error = null

  // Priority mode: use pre-computed priority IDs
  if (options.priority) {
    const priorityFile = path.resolve(process.cwd(), 'priority_ids.json')
    if (!fs.existsSync(priorityFile)) {
      spinner.stop()
      console.error(chalk.red('❌ priority_ids.json not found. Run: node scripts/prioritize_backlog.mjs'))
      return
    }

    const allPriorityIds = JSON.parse(fs.readFileSync(priorityFile, 'utf8'))
    const limit = parseInt(options.limit)
    const idsToProcess = allPriorityIds.slice(0, limit)

    console.log(chalk.yellow(`\n📊 Priority mode: processing ${idsToProcess.length} of ${allPriorityIds.length} prioritized scraps\n`))

    // Fetch scraps by ID in batches (Supabase IN query limit)
    const batchSize = 100
    for (let i = 0; i < idsToProcess.length; i += batchSize) {
      const batch = idsToProcess.slice(i, i + batchSize)
      const { data, error: batchError } = await supabase
        .from('scraps')
        .select('*')
        .in('id', batch)

      if (batchError) {
        error = batchError
        break
      }
      scraps = scraps.concat(data || [])
    }

    // Sort by priority order (maintain priority_ids.json order)
    const idOrder = new Map(idsToProcess.map((id, idx) => [id, idx]))
    scraps.sort((a, b) => (idOrder.get(a.id) || 0) - (idOrder.get(b.id) || 0))
  } else {
    // Standard mode: query by filters
    let query = supabase
      .from('scraps')
      .select('*')
      .order('created_at', { ascending: false })  // Most recent first
      .limit(parseInt(options.limit))

    if (options.source) {
      query = query.eq('source', options.source)
    }

    // Filter based on repair type (skip filters if --force is specified)
    if (!options.force) {
      if (options.type === 'summary') {
        query = query.or('summary.is.null,summary.eq.""')
      } else if (options.type === 'tags') {
        query = query.or('tags.is.null,tags.eq.{}')
      } else if (options.type === 'relationships') {
        query = query.or('relationships.is.null,relationships.eq.{}')
      } else if (options.type === 'location') {
        query = query.is('location', null)
      } else if (options.type === 'financial') {
        // For now, select all scraps since financial_analysis column may not exist yet
        // query = query.is('financial_analysis', null);
      } else if (options.type === 'screenshot') {
        query = query.not('url', 'is', null).is('screenshot_url', null)
      } else {
        // Get scraps missing any AI enrichment (excluding financial_analysis until column exists)
        query = query.or('summary.is.null,tags.is.null,relationships.is.null,location.is.null')
      }
    }

    const result = await query
    scraps = result.data
    error = result.error
  }

  if (error) {
    spinner.stop()
    console.error(chalk.red('❌ Error fetching scraps:'), error.message)
    return
  }

  spinner.stop()

  if (!scraps || scraps.length === 0) {
    console.log(chalk.green('\n✅ No scraps need repair! Memory banks are clean.\n'))
    return
  }

  console.log(cyber.divider())
  console.log(chalk.magenta(`    > ${scraps.length} memory fragments detected`))
  console.log(chalk.cyan(`    > Thread discovery: ${process.env.ENABLE_THREAD_CONTEXT === 'true' ? 'ENABLED' : 'DISABLED'}`))
  console.log(cyber.divider())
  console.log()

  let repaired = 0
  let failed = 0
  let threadsFound = 0
  const retryQueue = [] // Queue for scraps that failed content fetch
  const startTime = Date.now()

  for (const [index, scrap] of scraps.entries()) {
    const progress = index + 1
    const title = scrap.title?.substring(0, 50) || scrap.url?.substring(0, 50) || scrap.scrap_id

    // Progress bar
    console.log('\n' + cyber.bar(progress, scraps.length))
    console.log(chalk.gray('━'.repeat(65)))
    console.log(chalk.cyan('▶ ') + chalk.white(`${title}...`))

    try {
      const result = await repairScrapWithAI(scrap, options)

      // Track thread discoveries
      if (result && result.foundThreads) {
        threadsFound++
      }

      // Check if content fetch failed or returned insufficient content
      if (result && result.needsRetry) {
        retryQueue.push({ scrap, reason: result.retryReason, attempts: 1 })
        console.log(chalk.yellow('  ⏭  ') + chalk.gray(`Queued: ${result.retryReason}`))
      } else {
        repaired++
        console.log(chalk.green('  ✓  ') + chalk.cyan('Repaired'))
      }
    } catch (error) {
      failed++
      console.log(cyber.glitch(`FAILED: ${error.message.substring(0, 40)}`))
    }

    // Show stats every 10 items
    if ((index + 1) % 10 === 0) {
      console.log('\n' + cyber.stats(repaired, failed, scraps.length, threadsFound))
    }

    // Process retry queue every 10 scraps
    if ((index + 1) % 10 === 0 && retryQueue.length > 0) {
      console.log(chalk.blue(`\n🔄 Processing ${retryQueue.length} queued retries...\n`))

      const retriesToProcess = [...retryQueue]
      retryQueue.length = 0 // Clear queue

      for (const retry of retriesToProcess) {
        if (retry.attempts >= 3) {
          failed++
          console.log(chalk.red(`  ❌ Max retries reached for ${retry.scrap.title?.substring(0, 40)}`))
          continue
        }

        console.log(chalk.gray(`  🔄 Retry #${retry.attempts + 1}: ${retry.scrap.title?.substring(0, 60) || retry.scrap.url?.substring(0, 60)}...`))

        try {
          const result = await repairScrapWithAI(retry.scrap, options)

          if (result && result.needsRetry) {
            retryQueue.push({ ...retry, attempts: retry.attempts + 1 })
            console.log(chalk.yellow(`    ⏭️  Re-queued: ${result.retryReason}`))
          } else {
            repaired++
            console.log(chalk.green('    ✅ Retry successful'))
          }
        } catch (error) {
          failed++
          console.log(chalk.red(`    ❌ Retry failed: ${error.message}`))
        }

        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      console.log() // Blank line after retry batch
    }

    // Small delay to be nice to APIs
    if (index < scraps.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // Final retry pass for any remaining items
  if (retryQueue.length > 0) {
    console.log(chalk.blue(`\n🔄 Final pass: Processing ${retryQueue.length} remaining retries...\n`))

    for (const retry of retryQueue) {
      if (retry.attempts >= 3) {
        failed++
        console.log(chalk.red(`  ❌ Max retries reached for ${retry.scrap.title?.substring(0, 40)}`))
        continue
      }

      console.log(chalk.gray(`  🔄 Final retry: ${retry.scrap.title?.substring(0, 60) || retry.scrap.url?.substring(0, 60)}...`))

      try {
        const result = await repairScrapWithAI(retry.scrap, options)

        if (!result || !result.needsRetry) {
          repaired++
          console.log(chalk.green('    ✅ Retry successful'))
        } else {
          failed++
          console.log(chalk.red(`    ❌ Still insufficient: ${result.retryReason}`))
        }
      } catch (error) {
        failed++
        console.log(chalk.red(`    ❌ Retry failed: ${error.message}`))
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // Final stats
  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const rate = (repaired / (repaired + failed) * 100).toFixed(1)

  console.log('\n' + cyber.divider())
  console.log(chalk.cyan.bold('\n    ▓▓▓ MISSION COMPLETE ▓▓▓\n'))
  console.log(cyber.stats(repaired, failed, scraps.length, threadsFound))
  console.log()
  console.log(chalk.gray('    Time elapsed: ') + chalk.white(`${minutes}m ${seconds}s`))
  console.log(chalk.gray('    Avg per scrap: ') + chalk.white(`${(elapsed / scraps.length).toFixed(1)}s`))
  console.log(cyber.divider())

  // Sync tags back to Pinboard if requested
  if (options.syncToPinboard && repaired > 0) {
    console.log(chalk.blue('\n🔄 Syncing tags to Pinboard...'))
    const result = await autoSyncRecentTags({
      supabaseClient: supabase,
      source: options.source || 'pinboard',
      knownCount: repaired, // We know how many we just repaired
    })

    if (result.success) {
      console.log(chalk.green(`✅ Synced ${result.synced} Pinboard tags`))
    } else {
      console.log(chalk.red(`❌ Pinboard sync failed: ${result.error}`))
    }
  }
}

async function repairScrapWithAI(scrap, options) {
  const updates = {}
  const scrapId = scrap.scrap_id

  // If a specific type is requested, ONLY process that type
  // Note: --force only affects NULL checks in query, NOT type filtering
  const shouldProcessAll = !options.type
  const shouldProcessType = (type) => !options.type || options.type === type

  // Determine what content to use for AI processing
  let content = scrap.content || scrap.title || ''

  // Only fetch content if we're processing fields that need it (not for screenshots)
  let contentFetchFailed = false
  if (options.type !== 'screenshot' && options.fetchContent && scrap.url && (!content || content.length < 200)) {
    console.log(chalk.dim(`    Fetching content from ${scrap.url.substring(0, 50)}...`))
    try {
      const fetchedContent = await fetchPageContent(scrap.url)
      if (fetchedContent && fetchedContent.length > content.length) {
        content = fetchedContent
        updates.content = fetchedContent
        console.log(chalk.dim(`    ✓ Fetched ${fetchedContent.length} chars of content`))
      }
    } catch (error) {
      contentFetchFailed = true
      console.log(chalk.dim(`    ⚠ Could not fetch content: ${error.message}`))
    }
  }

  // Check if we have insufficient content and should retry
  const MIN_CONTENT_LENGTH = 500
  if (options.fetchContent && scrap.url && content.length < MIN_CONTENT_LENGTH && contentFetchFailed) {
    // TODO: After 3+ retries, use vision model on screenshot_url as last resort
    // if (retryAttempts >= 3 && scrap.screenshot_url) {
    //   content = await extractTextFromScreenshot(scrap.screenshot_url)
    // }
    return {
      needsRetry: true,
      retryReason: `Insufficient content (${content.length} chars, fetch failed)`,
    }
  }

  // Generate summary if missing (or if --force is used)
  if (shouldProcessType('summary') && (options.force || !scrap.summary || scrap.summary.trim() === '')) {
    if (!content || content.length < 50) {
      console.log(chalk.dim('    ⏭️  Skipping summary (insufficient content)'))
    } else {
      console.log(chalk.dim('    Generating AI summary...'))
      console.log(chalk.gray(`      Input: ${content.length} chars, URL: ${scrap.url}`))
      try {
        const summary = await summarizeContent(content, {
          scrapId,
          scrap, // Pass full scrap object for thread discovery
          tags: scrap.tags || scrap.concept_tags, // Use existing tags for thread discovery
          taskType: 'summarization',
          url: scrap.url,
          title: scrap.title,
        })

        if (summary && summary.length > 50) {
          updates.summary = summary
          console.log(chalk.dim(`    ✓ Generated ${summary.length} char summary`))
        } else {
        // Critical field - throw if generation failed
          console.error(chalk.red('    ✗ CRITICAL: Summary generation returned empty/short result'))
          console.error(chalk.red(`      Scrap ID: ${scrapId}`))
          console.error(chalk.red(`      Content length: ${content.length}`))
          console.error(chalk.red(`      Summary received: ${JSON.stringify(summary)}`))
          throw new Error('Summary generation returned empty result')
        }
      } catch (error) {
        console.error(chalk.red('    ✗ SUMMARY GENERATION FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
        throw error // Re-throw to stop repair
      }
    } // Close else block for summary content check
  }

  // Generate tags if missing or bad (only has 'pinboard', or has capitalized/stop words)
  const stopWords = ['of', 'and', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', '-', 'or']
  const badCapWords = ['Artificial', 'Intelligence', 'Machine', 'Learning', 'Table', 'Contents']
  const hasBadTags = scrap.tags && (
    (scrap.tags.length === 1 && scrap.tags[0] === 'pinboard') ||
    scrap.tags.some(tag => stopWords.includes(tag) || badCapWords.includes(tag) ||
      (tag[0] && tag[0] === tag[0].toUpperCase() && tag.length > 2 && /^[A-Z]/.test(tag)))
  )
  if (shouldProcessType('tags') && (!scrap.tags || scrap.tags.length === 0 || hasBadTags || options.force)) {
    // Need substantial content to generate good tags - skip if:
    // - No content or too short (< 200 chars)
    // - Content is just placeholder like "[no title]"
    const isPlaceholder = content && (
      content.trim() === '[no title]' ||
      content.trim() === scrap.title ||
      content.length < 200
    )

    if (!content || isPlaceholder) {
      console.log(chalk.dim('    ⏭️  Skipping tags (insufficient content)'))
    } else {
      console.log(chalk.dim('    Generating AI tags...'))
      console.log(chalk.gray(`      Input: ${content.length} chars`))
      try {
        const tags = await generateTags(content, scrap)
        if (tags && tags.length > 0) {
          updates.tags = tags
          console.log(chalk.dim(`    ✓ Generated ${tags.length} tags: ${tags.join(', ')}`))
        } else {
          console.error(chalk.yellow('    ⚠ Tag generation returned empty array'))
          console.error(chalk.yellow(`      Scrap ID: ${scrapId}`))
          console.error(chalk.yellow(`      Content length: ${content.length}`))
          console.error(chalk.yellow(`      Tags received: ${JSON.stringify(tags)}`))
        }
      } catch (error) {
        console.error(chalk.red('    ✗ TAG GENERATION FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
      }
    } // Close else block for tags content check
  }

  // Extract relationships if missing (or if --force is used)
  if (shouldProcessType('relationships') && (options.force || !scrap.relationships || scrap.relationships.length === 0)) {
    // Skip if no content
    if (!content || content.length < 50) {
      console.log(chalk.dim('    ⏭️  Skipping relationships (insufficient content)'))
    } else {
      console.log(chalk.dim('    Extracting relationships...'))
      console.log(chalk.gray(`      Input: ${content.length} chars`))

      // Try 3 different models for relationship extraction
      const models = [
        'deepseek/deepseek-chat-v3.1',     // First try: DeepSeek (default)
        'google/gemini-2.5-flash',         // Second try: Gemini
        'openai/gpt-4o-mini',               // Third try: OpenAI
      ]

      let relationships = []
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const model = models[attempt]
          console.log(chalk.dim(`      Attempt ${attempt + 1}/3 with ${model}...`))

          relationships = await extractRelationships(content, {
            scrapId,
            url: scrap.url,
            title: scrap.title,
            model,
          })

          // If we got relationships, break out of retry loop
          if (relationships && relationships.length > 0) {
            updates.relationships = relationships
            console.log(chalk.dim(`    ✓ Extracted ${relationships.length} relationships from ${model}`))
            break
          } else {
            console.log(chalk.yellow(`      ${model} returned empty relationships`))
            console.log(chalk.gray(`        Response: ${JSON.stringify(relationships)}`))
          }
        } catch (error) {
          console.error(chalk.yellow(`      Attempt ${attempt + 1} with ${models[attempt]} FAILED`))
          console.error(chalk.yellow(`        Error: ${error.message}`))
          console.error(chalk.gray(`        Stack: ${error.stack}`))
          if (attempt < 2) {
          // Wait a bit before next attempt
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
      }

      if (!relationships || relationships.length === 0) {
        console.error(chalk.red('    ✗ ALL 3 MODELS FAILED TO EXTRACT RELATIONSHIPS'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Content length: ${content.length}`))
        console.error(chalk.red(`      Models tried: ${models.join(', ')}`))
      }
    } // Close else block for content check
  }

  // Extract locations if missing (or if --force is used)
  if (shouldProcessType('location') && (options.force || !scrap.location)) {
    if (!content || content.length < 50) {
      console.log(chalk.dim('    ⏭️  Skipping location (insufficient content)'))
    } else {
      console.log(chalk.dim('    Extracting locations...'))
      console.log(chalk.gray(`      Input: ${content.length} chars`))
      try{
        const locationData = await extractLocation(content, {
          scrapId,
          url: scrap.url,
          title: scrap.title,
        })

        if (locationData && locationData.location) {
          updates.location = locationData.location
          if (locationData.latitude) updates.latitude = locationData.latitude
          if (locationData.longitude) updates.longitude = locationData.longitude
          console.log(chalk.dim(`    ✓ Extracted location: ${locationData.location}${locationData.latitude ? ` (${locationData.latitude.toFixed(2)}, ${locationData.longitude.toFixed(2)})` : ''}`))
        } else {
          console.log(chalk.yellow('    ⚠ Location extraction returned null'))
          console.log(chalk.gray(`      Scrap ID: ${scrapId}`))
        }
      } catch (error) {
        console.error(chalk.red('    ✗ LOCATION EXTRACTION FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
      }
    } // Close else block for location content check
  }

  // Extract financial analysis if missing
  if (shouldProcessType('financial') && (!scrap.financial_analysis || typeof scrap.financial_analysis === 'undefined')) {
    if (!content || content.length < 50) {
      console.log(chalk.dim('    ⏭️  Skipping financial analysis (insufficient content)'))
    } else {
      console.log(chalk.dim('    Extracting financial analysis...'))
      console.log(chalk.gray(`      Input: ${content.length} chars`))
      try {
        const financialAnalysis = await extractFinancialAnalysis(content, {
          url: scrap.url,
          isRawText: false,
        })

        // Only add financial analysis if we found some assets or meaningful data
        if (financialAnalysis && (
          (financialAnalysis.assets && financialAnalysis.assets.length > 0) ||
        (financialAnalysis.tracked_assets && financialAnalysis.tracked_assets.length > 0) ||
        (financialAnalysis.discovered_assets && financialAnalysis.discovered_assets.length > 0) ||
        Math.abs(financialAnalysis.overall_market_sentiment || 0) > 0.1
        )) {
          updates.financial_analysis = financialAnalysis
          const assetCount = (financialAnalysis.assets || []).length
          const trackedCount = (financialAnalysis.tracked_assets || []).length
          const discoveredCount = (financialAnalysis.discovered_assets || []).length
          console.log(chalk.dim(`    ✓ Extracted financial data: ${trackedCount} tracked, ${discoveredCount} discovered assets`))
        } else {
          console.log(chalk.gray('    ℹ No financial assets found (empty or low sentiment)'))
        }
      } catch (error) {
        console.error(chalk.red('    ✗ FINANCIAL ANALYSIS FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
      }
    } // Close else block for financial content check
  }

  // Extract reasoning fields if missing (content_type, concept_tags, extraction_confidence)
  // Note: reasoning fields require summary, so they implicitly require content
  if (shouldProcessType('reasoning') &&
      scrap.summary &&
      (!scrap.content_type || !scrap.concept_tags || !scrap.extraction_confidence)) {
    console.log(chalk.dim('    Extracting reasoning fields...'))
    console.log(chalk.gray(`      Summary length: ${(scrap.summary || updates.summary || '').length} chars`))
    try {
      // Create a temporary object to pass to enrichWithReasoningFields
      const tempScrap = {
        ...scrap,
        ...updates, // Include any updates we've made (like summary/tags)
      }

      await enrichWithReasoningFields(tempScrap, { scrapId })

      // Copy the extracted fields to updates
      if (tempScrap.content_type) updates.content_type = tempScrap.content_type
      if (tempScrap.concept_tags) updates.concept_tags = tempScrap.concept_tags
      if (tempScrap.extraction_confidence) updates.extraction_confidence = tempScrap.extraction_confidence

      // Auto-add !news tag for news articles
      if (tempScrap.content_type === 'news' && (updates.tags || scrap.tags)) {
        const currentTags = updates.tags || scrap.tags || []
        if (!currentTags.includes('!news')) {
          updates.tags = ['!news', ...currentTags]
          console.log(chalk.dim(`    ✓ Auto-added !news tag`))
        }
      }

      const conceptCount = (tempScrap.concept_tags || []).length
      console.log(chalk.dim(`    ✓ ${tempScrap.content_type}, ${conceptCount} concepts`))
      if (conceptCount > 0) {
        console.log(chalk.gray(`      Concepts: ${(tempScrap.concept_tags || []).join(', ')}`))
      }
    } catch (error) {
      console.error(chalk.red('    ✗ REASONING EXTRACTION FAILED'))
      console.error(chalk.red(`      Scrap ID: ${scrapId}`))
      console.error(chalk.red(`      URL: ${scrap.url}`))
      console.error(chalk.red(`      Has summary: ${!!(scrap.summary || updates.summary)}`))
      console.error(chalk.red(`      Error: ${error.message}`))
      console.error(chalk.red(`      Stack: ${error.stack}`))
    }
  }

  // Generate screenshot if missing
  if (shouldProcessType('screenshot') && !scrap.screenshot_url) {
    // Special handling for Are.na images
    if (scrap.source === 'arena' && scrap.metadata?.image_data) {
      const imageUrl = scrap.metadata.image_data.original_url ||
                      scrap.metadata.image_data.display ||
                      scrap.metadata.image_data.cloudinary_url
      if (imageUrl) {
        updates.screenshot_url = imageUrl
        const imgShort = imageUrl.split('/').pop()?.substring(0, 20) || 'image'
        console.log(chalk.dim(`    ✓ Arena image: ${imgShort}`))
      }
    }
    // For everything else with a URL, generate screenshot
    else if (scrap.url) {
      console.log(chalk.dim('    Generating screenshot...'))
      console.log(chalk.gray(`      URL: ${scrap.url.substring(0, 80)}`))
      try {
        const screenshot = await browserLimiter.schedule(() =>
          generateScreenshot(scrap.url),
        )

        if (screenshot?.url) {
          updates.screenshot_url = screenshot.url
          const filename = screenshot.url.split('/').pop()?.substring(0, 20) || 'screenshot'
          console.log(chalk.dim(`    ✓ Screenshot: ${filename}`))
        } else {
          console.log(chalk.yellow('    ⚠ Screenshot generation returned no URL'))
          console.log(chalk.yellow(`      Scrap ID: ${scrapId}`))
          console.log(chalk.yellow(`      Response: ${JSON.stringify(screenshot)}`))
        }
      } catch (error) {
        console.error(chalk.red('    ✗ SCREENSHOT GENERATION FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
      }
    }
  }

  // Generate META-summary after all other analysis is complete
  // This synthesizes summary, tags, relationships, location, etc. into ~140 chars
  if (shouldProcessType('summary') || shouldProcessType('tags') || shouldProcessType('relationships')) {
    const tempScrap = {
      ...scrap,
      ...updates,
    }

    // Only generate if we have enough data to make a useful meta-summary
    if (tempScrap.summary || tempScrap.title || tempScrap.tags?.length > 0) {
      try {
        const metaSummary = generateMetaSummary(tempScrap)
        if (metaSummary && metaSummary !== 'No summary available') {
          // TEMP: Commented out until meta_summary column is added to Supabase
          // Run: migrations/add_meta_summary.sql in Supabase SQL Editor
          // updates.meta_summary = metaSummary
          console.log(chalk.dim(`    ✓ META-summary: ${metaSummary.substring(0, 60)}... (not saved - column missing)`))
        }
      } catch (error) {
        console.error(chalk.red('    ✗ META-SUMMARY GENERATION FAILED'))
        console.error(chalk.red(`      Error: ${error.message}`))
      }
    }
  }

  // Fix type field if unknown - derive from source (type is source-level terminology)
  // type = bookmark|block|repo|status (from source system)
  // content_type = article|video|news|etc (AI-classified content kind)
  if (!scrap.type || scrap.type === 'unknown') {
    const sourceToType = {
      pinboard: 'bookmark',
      arena: 'block',
      github: 'repo',
      mastodon: 'status'
    }
    const derivedType = sourceToType[scrap.source] || 'bookmark'
    updates.type = derivedType
    console.log(chalk.dim(`    ✓ Fixed type: ${derivedType} (from source: ${scrap.source})`))
  }

  // Update the scrap if we have any updates
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString()
    console.log(chalk.gray(`    📝 Updating ${Object.keys(updates).length} fields: ${Object.keys(updates).join(', ')}`))

    // Retry database update up to 3 times for network failures
    let lastError
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { error } = await supabase
          .from('scraps')
          .update(updates)
          .eq('scrap_id', scrap.scrap_id)

        if (error) {
          // Supabase error (not network error) - don't retry
          console.error(chalk.red(`    ✗ DATABASE UPDATE FAILED (attempt ${attempt}/3)`))
          console.error(chalk.red(`      Scrap ID: ${scrapId}`))
          console.error(chalk.red(`      Fields: ${Object.keys(updates).join(', ')}`))
          console.error(chalk.red(`      Error: ${JSON.stringify(error)}`))
          throw error
        }
        // Success - break out of retry loop
        if (attempt > 1) {
          console.log(chalk.green(`    ✓ DB update succeeded on retry ${attempt}`))
        }
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (attempt < 3) {
          const delay = 2000 * attempt
          console.log(chalk.yellow(`    ⚠ DB update attempt ${attempt}/3 failed, retrying in ${delay}ms...`))
          console.log(chalk.yellow(`      Error: ${error.message}`))
          await new Promise(resolve => setTimeout(resolve, delay)) // Exponential backoff
        }
      }
    }

    if (lastError) {
      console.error(chalk.red('    ✗ DATABASE UPDATE FAILED AFTER 3 RETRIES'))
      console.error(chalk.red(`      Scrap ID: ${scrapId}`))
      console.error(chalk.red(`      Final error: ${lastError.message}`))
      // Don't throw - just log and continue to avoid losing progress
      console.log(chalk.yellow(`    ⏭️  Continuing to next scrap despite DB failure`))
    }
  } else {
    console.log(chalk.gray('    ℹ No updates needed'))
  }
}

async function generateTags(content, scrap) {
  const model = getModelForTask('tagging')

  // Load current tags from ejfox.com/tags.json
  const { loadCoreTags } = await import('./llmService.mjs')
  const userTags = await loadCoreTags()

  // Get current date for context
  const currentDate = new Date().toISOString().split('T')[0]
  const currentYear = new Date().getFullYear()

  const prompt = `You are a content tagger. Your job is to select the BEST MATCHING tags from the user's existing tag vocabulary.

CURRENT DATE: ${currentDate} (Year: ${currentYear})

${scrap.title ? `Title: ${scrap.title}` : ''}
${scrap.url ? `URL: ${scrap.url}` : ''}
${scrap.tags?.length > 0 ? `Existing tags: ${scrap.tags.join(', ')}` : ''}

Content: ${content.substring(0, 3000)}

YOUR EXISTING TAG VOCABULARY (YOU MUST CHOOSE FROM THESE):
${userTags.join(', ')}

CRITICAL RULES:
1. ONLY use tags from the vocabulary list above
2. If a perfect match doesn't exist, choose the CLOSEST related tag from the list
3. NEVER invent new tags - only use what's in the vocabulary
4. Choose 5-10 tags maximum
5. IGNORE: Footer text, legal disclaimers, navigation, ads, terms of service
6. FOCUS ON: Main subject matter, product type, article topic, core concepts
7. REPLACE OUTDATED temporal tags: If existing tags contain outdated years (like "election2020" for a ${currentYear} story), replace with current year or generic version from vocabulary

MATCHING STRATEGY:
- For "neural networks" → use "machinelearning" or "ai" from vocabulary
- For "evolutionary computing" → use "machinelearning" or "ai" from vocabulary
- For specific products → use category from vocabulary (electronics, hardware, tool)
- For article topics → use domain from vocabulary (journalism, education, coding)

EXAMPLES:
Content about neural networks → machinelearning, ai, python, tutorial
Content about a laptop → hardware, electronics, product, !tobuy
Content about woodworking → woodworking, design, howto, tutorial
${currentYear} election article with "election2020" tag → elections, politics, legal (replace outdated year)

Return ONLY comma-separated tags from the vocabulary list. No explanations. No new tags.`

  try {
    const response = await completion({
      model,
      prompt,
      max_tokens: 150,
      temperature: 0.5,
      taskType: 'tagging',
      scrapId: scrap.scrap_id,
    })

    // Handle both response formats (object with content property or direct string)
    const content = response?.content || response

    if (content && typeof content === 'string') {
      // Parse the tags from the response
      let rawTags = content
        .toLowerCase()
        .replace(/[\n\r]/g, ',')  // Convert newlines to commas
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0 && tag.length < 30)  // Max length for single word tags

      // Basic sanity filtering - trust the AI's judgment, just catch obvious errors
      // Known 2-char vocabulary tags
      const twoCharTags = ['ai', 'ar', 'vr', 'ui', 'ux', 'js', 'ny', 'r', 'd3']

      const filteredTags = rawTags.filter(tag => {
        // Remove structural mistakes
        if (tag.includes(' ')) return false  // Multi-word tags
        // Allow 2-char tags only if they're known vocabulary or start with !
        if (tag.length <= 2) {
          if (tag.startsWith('!') || twoCharTags.includes(tag)) {
            return true
          }
          return false
        }
        if (tag === '-' || tag === '&') return false  // Pure punctuation

        // Remove if AI ignored the lowercase instruction (means it word-split a title)
        const originalTag = content.split(/[,\n]/).find(t => t.trim().toLowerCase() === tag)?.trim()
        if (originalTag && /[A-Z]/.test(originalTag)) return false

        // Remove obvious meta-tags about the platform itself
        if (['pinboard', 'bookmark', 'webpage'].includes(tag)) return false

        return true
      })

      // Track the cost
      if (response.usage) {
        trackCost(model, response.usage.prompt_tokens, response.usage.completion_tokens)
      }

      return filteredTags
    }
  } catch (error) {
    console.error('Error generating tags:', error)
  }

  return []
}

// Make it executable
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse()
}

export { repair, repairScrapWithAI, generateTags }
