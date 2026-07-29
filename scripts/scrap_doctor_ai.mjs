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
import { extractRelationshipsDetailed } from './aiRelationshipExtraction.mjs'
import { extractLocation } from './aiGeolocation.mjs'
import { extractFinancialAnalysis } from './aiFinancialAnalysis.mjs'
import { enrichWithReasoningFields } from './reasoningFields.mjs'
import { generateScreenshot } from './generateScreenshot.mjs'
import { completion, MODELS } from './llmService.mjs'
import { getModelForTask } from '../lib/config.mjs'
import { looksLikeErrorPage } from '../lib/contentQuality.mjs'
import { extractContentWithRetry } from './contentExtractor.mjs'
import { trackCost } from './costTracking.mjs'
import { autoSyncRecentTags } from './sync_tags_to_pinboard.mjs'
import { applyNewsworthinessTag } from './aiNewsworthiness.mjs'
import Bottleneck from 'bottleneck'

/**
 * Generate a title from summary content when title is missing
 * Uses the first bullet point or sentence as the title
 */
function generateTitleFromSummary(summary, url) {
  if (!summary || summary.trim().length === 0) {
    // Fallback: derive from URL
    if (url) {
      try {
        const urlObj = new URL(url)
        const pathParts = urlObj.pathname.split('/').filter(p => p && p !== 'index.html')
        if (pathParts.length > 0) {
          // Use last meaningful path segment
          const lastPart = pathParts[pathParts.length - 1]
            .replace(/[-_]/g, ' ')
            .replace(/\.[^.]+$/, '') // Remove file extension
          return lastPart.charAt(0).toUpperCase() + lastPart.slice(1)
        }
        return urlObj.hostname.replace('www.', '')
      } catch {
        return null
      }
    }
    return null
  }

  // Clean up markdown formatting
  const cleanSummary = summary
    .replace(/^#+\s*/gm, '')  // headers
    .replace(/\*\*/g, '')      // bold
    .trim()

  // Split into lines and find first bullet point
  const lines = cleanSummary.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // Check if line starts with bullet (•, -, *)
    if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
      let title = trimmed.slice(1).trim()  // Remove bullet char
      if (title.length > 100) title = title.slice(0, 97) + '...'
      if (title.length > 10) return title
    }
  }

  // Fallback: first sentence (split on period followed by space)
  const firstSentence = cleanSummary.split('. ')[0]
  if (firstSentence && firstSentence.length > 10) {
    let title = firstSentence.trim()
    if (title.length > 100) title = title.slice(0, 97) + '...'
    return title
  }

  // Last resort: first 100 chars
  const short = cleanSummary.slice(0, 100).trim()
  return cleanSummary.length > 100 ? short + '...' : short
}

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
      '╚═══════════════════════════════════════════════════════════════╝',
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
      chalk.gray('└─────────────────────────────────────┘'),
    ]
    return box.join('\n')
  },

  divider: () => chalk.gray('━'.repeat(65)),

  glitch: (text) => {
    const glitchChars = '▒▓█░'
    const random = glitchChars[Math.floor(Math.random() * glitchChars.length)]
    return chalk.red(`${random} ${text} ${random}`)
  },
}

async function repair(options) {
  console.clear()
  cyber.banner()

  const spinner = ora({
    text: 'Scanning memory banks...',
    spinner: 'dots12',
    color: 'cyan',
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
      .neq('scrap_id', '__run_lock__') // never enrich the internal distributed lock
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
  const errors = [] // Track errors to potentially add !hide tag

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
      const extracted = await extractContentWithRetry(scrap.url, { timeout: 10000, maxRetries: 1 })
      const fetchedContent = extracted?.content
      if (fetchedContent && fetchedContent.length > content.length) {
        content = fetchedContent
        updates.content = fetchedContent
        console.log(chalk.dim(`    ✓ Fetched ${fetchedContent.length} chars of content (${extracted.method})`))
      } else if (!fetchedContent) {
        // extractContentWithRetry returns null (not throw) when all tiers fail;
        // preserve the old needsRetry semantics that keyed off the catch block.
        contentFetchFailed = true
        console.log(chalk.dim('    ⚠ No content extracted (all tiers failed)'))
      }
    } catch (error) {
      contentFetchFailed = true
      errors.push({ type: 'content_fetch', message: error.message })
      console.log(chalk.dim(`    ⚠ Could not fetch content: ${error.message}`))
    }
  }

  // Dead / 404 / unreachable page? Don't summarize or enrich it — that just
  // produces a "Summary of a Page Not Found". Mark it and skip enrichment.
  const isDeadPage = !!content && looksLikeErrorPage(content)
  if (isDeadPage) {
    console.log(chalk.yellow('    ☠️  Dead/error page detected — marking dead_link, skipping enrichment'))
    updates.content_type = 'dead_link'
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
  if (!isDeadPage && shouldProcessType('summary') && (options.force || !scrap.summary || scrap.summary.trim() === '')) {
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

  // Generate title from summary if missing or empty
  // This ensures downstream consumers never see "[no title]"
  const currentSummary = updates.summary || scrap.summary
  const isTitleMissing = !scrap.title || scrap.title.trim() === '' || scrap.title === '[no title]'
  if (isTitleMissing && currentSummary) {
    console.log(chalk.dim('    Generating title from summary...'))
    const generatedTitle = generateTitleFromSummary(currentSummary, scrap.url)
    if (generatedTitle) {
      updates.title = generatedTitle
      console.log(chalk.dim(`    ✓ Generated title: ${generatedTitle.substring(0, 60)}${generatedTitle.length > 60 ? '...' : ''}`))
    } else {
      console.log(chalk.yellow('    ⚠ Could not generate title from summary'))
    }
  }

  // Generate tags if missing or bad (only has 'pinboard', or has capitalized/stop words)
  const stopWords = ['of', 'and', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', '-', 'or']
  const badCapWords = ['Artificial', 'Intelligence', 'Machine', 'Learning', 'Table', 'Contents']
  const hasBadTags = scrap.tags && (
    (scrap.tags.length === 1 && scrap.tags[0] === 'pinboard') ||
    scrap.tags.some(tag => stopWords.includes(tag) || badCapWords.includes(tag) ||
      (tag[0] && tag[0] === tag[0].toUpperCase() && tag.length > 2 && /^[A-Z]/.test(tag)))
  )
  if (!isDeadPage && shouldProcessType('tags') && (!scrap.tags || scrap.tags.length === 0 || hasBadTags || options.force)) {
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
  if (!isDeadPage && shouldProcessType('relationships') && (options.force || !scrap.relationships || scrap.relationships.length === 0)) {
    // Skip if no content
    if (!content || content.length < 50) {
      console.log(chalk.dim('    ⏭️  Skipping relationships (insufficient content)'))
    } else {
      console.log(chalk.dim('    Extracting relationships...'))
      console.log(chalk.gray(`      Input: ${content.length} chars`))

      // Consolidated onto the same ontology pipeline the ingest path uses.
      // (The old hardcoded 'deepseek/deepseek-chat-v3.1' is not a valid
      // OpenRouter slug and 400'd on every scrap.) Lead with the configured
      // model; fall through to the others only on a thrown error — an EMPTY
      // result is a valid answer (the strict ontology drops abstraction edges),
      // so we don't cycle models chasing coerced garbage.
      const models = [
        getModelForTask('relationshipAnalysis'), // qwen3-235b (valid, canonical)
        'google/gemini-2.5-flash',
        'openai/gpt-4o-mini',
      ]

      // Anchor evidence needs the real text; give it content + summary.
      const relInput = [content, scrap.summary].filter(Boolean).join('\n\n')

      let relationships = []
      for (let attempt = 0; attempt < models.length; attempt++) {
        const model = models[attempt]
        try {
          console.log(chalk.dim(`      Attempt ${attempt + 1}/${models.length} with ${model}...`))
          const relResult = await extractRelationshipsDetailed(relInput, {
            scrapId,
            url: scrap.url,
            title: scrap.title,
            source: scrap.source,
            summary: scrap.summary,
            isRawText: !scrap.summary,
            model,
          })
          relationships = relResult.relationships || []
          if (Array.isArray(relResult.raw) && relResult.raw.length > 0) {
            updates.relationships_raw = relResult.raw
          }
          updates.relationships = relationships
          console.log(chalk.dim(`    ✓ ${relationships.length} relationships from ${model}`))
          break // success (even if empty) — don't cycle models
        } catch (error) {
          console.error(chalk.yellow(`      Attempt ${attempt + 1} with ${model} failed: ${error.message}`))
          if (attempt < models.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000))
          } else {
            console.error(chalk.red(`    ✗ All ${models.length} models failed for ${scrapId}`))
          }
        }
      }
    } // Close else block for content check
  }

  // Extract locations if missing (or if --force is used)
  if (!isDeadPage && shouldProcessType('location') && (options.force || !scrap.location)) {
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
  if (!isDeadPage && shouldProcessType('financial') && (!scrap.financial_analysis || typeof scrap.financial_analysis === 'undefined')) {
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
          generateScreenshot(scrap.url, scrap.scrap_id),
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
        errors.push({ type: 'screenshot', message: error.message })
        console.error(chalk.red('    ✗ SCREENSHOT GENERATION FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
      }
    }
  }

  // Evaluate newsworthiness for !news tag (editorial curation, ~3/day)
  // Only evaluate if we have a summary and it looks like potential news content
  const currentSummaryForNews = updates.summary || scrap.summary
  const currentTagsForNews = updates.tags || scrap.tags || []
  const potentialNewsTypes = ['news', 'article', 'report', null, undefined]

  if (process.env.ENABLE_NEWSWORTHINESS === 'true' &&
      currentSummaryForNews && !currentTagsForNews.includes('!news') &&
      potentialNewsTypes.includes(scrap.content_type || updates.content_type)) {
    console.log(chalk.dim('    Evaluating newsworthiness...'))
    try {
      const tempScrapForNews = {
        ...scrap,
        ...updates,
        summary: currentSummaryForNews,
        tags: currentTagsForNews,
      }
      const newsResult = await applyNewsworthinessTag(tempScrapForNews, { scrapId })

      if (newsResult.isNewsworthy) {
        updates.tags = newsResult.tags
        console.log(chalk.green(`    ✓ !NEWS: ${newsResult.reason}`))
      } else if (newsResult.evaluated) {
        console.log(chalk.gray(`    ℹ Not newsworthy: ${newsResult.reason}`))
      }
    } catch (error) {
      console.log(chalk.yellow(`    ⚠ Newsworthiness check failed: ${error.message}`))
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
          updates.meta_summary = metaSummary
          console.log(chalk.dim(`    ✓ META-summary: ${metaSummary.substring(0, 60)}...`))
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
      mastodon: 'status',
    }
    const derivedType = sourceToType[scrap.source] || 'bookmark'
    updates.type = derivedType
    console.log(chalk.dim(`    ✓ Fixed type: ${derivedType} (from source: ${scrap.source})`))
  }

  // Add !hide tag if we encountered critical errors (no content, failed summary, etc.)
  // This lets downstream consumers filter out broken scraps
  const criticalErrors = errors.filter(e =>
    e.type === 'content_fetch' || e.type === 'summary' || e.type === 'screenshot',
  )
  const hasNoUsefulContent = !scrap.summary && !updates.summary && (!content || content.length < 100)

  if (criticalErrors.length > 0 || hasNoUsefulContent) {
    const currentTags = updates.tags || scrap.tags || []
    if (!currentTags.includes('!hide')) {
      updates.tags = ['!hide', ...currentTags]
      const reasons = criticalErrors.map(e => e.type).join(', ') || 'no content'
      console.log(chalk.yellow(`    ⚠ Added !hide tag (${reasons})`))
    }
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
      console.log(chalk.yellow('    ⏭️  Continuing to next scrap despite DB failure'))
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
2. Choose ONLY tags that are genuinely CENTRAL to this content. Fewer precise tags beat more loosely-related ones.
3. If no vocabulary tag genuinely fits, return FEWER tags — omit rather than force a loose or "closest" match. Returning 1 accurate tag is better than 5 tangential ones.
4. Choose 1-3 tags. Never pad to hit a count.
5. NEVER invent new tags - only use what's in the vocabulary
6. NEVER output control tags that start with "!" (e.g. !hide, !tobuy) — those are private and off-limits
7. IGNORE: Footer text, legal disclaimers, navigation, ads, terms of service
8. FOCUS ON: Main subject matter, product type, article topic, core concepts
9. REPLACE OUTDATED temporal tags: If existing tags contain outdated years (like "election2020" for a ${currentYear} story), replace with current year or generic version from vocabulary

EXAMPLES:
Content about neural networks → machinelearning, ai
Content about a laptop review → hardware, electronics
Content about woodworking → woodworking, howto
A graphics-engineer job posting → programming, opensource   (NOT "3d"/"3dmodel" unless the content is genuinely about 3D modeling)
${currentYear} election article with "election2020" tag → elections, politics (replace outdated year)

Return ONLY comma-separated tags from the vocabulary list. No explanations. No new tags.`

  try {
    const response = await completion({
      model,
      prompt,
      max_tokens: 150,
      temperature: 0.2,
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

      // Hard vocabulary gate: the model may ONLY return tags that actually exist
      // in the user's vocabulary. This stops hallucinated tags (e.g. "cms",
      // "3dmodel") from surviving even if the prompt is ignored.
      const vocabSet = new Set(userTags.map((t) => String(t).toLowerCase()))

      // Known 2-char vocabulary tags
      const twoCharTags = ['ai', 'ar', 'vr', 'ui', 'ux', 'js', 'ny', 'r', 'd3']

      const filteredTags = rawTags.filter(tag => {
        // Never allow private control tags (!hide/!tobuy/…)
        if (tag.startsWith('!')) return false
        // Must be a real vocabulary tag
        if (!vocabSet.has(tag)) return false
        // Remove structural mistakes
        if (tag.includes(' ')) return false  // Multi-word tags
        // Allow 2-char tags only if they're known vocabulary
        if (tag.length <= 2) {
          if (twoCharTags.includes(tag)) {
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
