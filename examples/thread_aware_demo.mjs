#!/usr/bin/env node
/**
 * Thread-Aware Summarization Demo
 *
 * Shows how to integrate thread context discovery into the summarization pipeline.
 * Run this to see thread-aware summaries in action!
 *
 * Usage:
 *   node examples/thread_aware_demo.mjs [scrap_url]
 *   node examples/thread_aware_demo.mjs "https://arxiv.org/abs/2304.12345"
 */

import { createClient } from '@supabase/supabase-js'
import { discoverThreadContext, formatThreadContext } from '../lib/threadContext.mjs'
import {
  buildThreadAwareMessages,
  previewContext,
} from '../lib/promptTemplates.mjs'
import { summarizeContent } from '../scripts/aiSummarization.mjs'
import dotenv from 'dotenv'
import chalk from 'chalk'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

/**
 * Demo: Find a scrap and show its thread context
 */
async function demoThreadContext(scrapUrl) {
  console.log(chalk.cyan('🔮 THREAD-AWARE SUMMARIZATION DEMO\n'))

  // Find the scrap
  let query = supabase
    .from('scraps')
    .select('*')

  if (scrapUrl) {
    query = query.eq('url', scrapUrl)
  } else {
    // Get a random recent scrap with tags
    query = query
      .not('tags', 'is', null)
      .order('published_at', { ascending: false })
      .limit(1)
  }

  const { data: scraps, error } = await query

  if (error) {
    console.error('Error fetching scrap:', error)
    return
  }

  if (!scraps || scraps.length === 0) {
    console.log('No scraps found. Try running: node scripts/index.mjs --source pinboard --limit 10')
    return
  }

  const scrap = scraps[0]

  console.log(chalk.bold('📌 Selected Scrap:'))
  console.log(`   Title: ${scrap.title}`)
  console.log(`   URL: ${scrap.url}`)
  console.log(`   Tags: ${scrap.tags?.join(', ') || 'none'}`)
  console.log(`   Published: ${scrap.published_at}\n`)

  // Discover thread context
  console.log(chalk.bold('🧵 Discovering thread context...\n'))

  const threadContext = await discoverThreadContext(scrap)

  if (!threadContext) {
    console.log(chalk.yellow('   No related scraps found (this is fine - summary will be generated without context)\n'))
  } else {
    console.log(chalk.green(`   Found ${threadContext.count} related scraps!`))
    console.log(`   Dominant themes: ${threadContext.dominantThemes.join(', ')}`)
    console.log(`   Connection strength: ${threadContext.connectionStrength}`)
    console.log(`   Discovery method: ${threadContext.discoveryMethod}\n`)

    console.log(chalk.bold('📋 Related Items:'))
    threadContext.relatedScraps.forEach((related, i) => {
      console.log(chalk.dim(`   ${i + 1}. "${related.title}" (${related.when})`))
      if (related.snippet) {
        console.log(chalk.dim(`      ${related.snippet.substring(0, 80)}...`))
      }
      if (related.sharedTags?.length > 0) {
        console.log(chalk.dim(`      Tags: ${related.sharedTags.join(', ')}`))
      }
      console.log()
    })

    console.log(chalk.bold('📝 Context Preview:'))
    console.log(chalk.dim('   ' + previewContext(threadContext).replace(/\n/g, '\n   ')))
    console.log()
  }

  // Show what the prompt would look like
  console.log(chalk.bold('💬 Prompt Structure:'))
  const messages = buildThreadAwareMessages(
    scrap.content || scrap.title || 'No content available',
    threadContext,
  )

  console.log(chalk.cyan(`\n   System message: ${messages[0].content.substring(0, 100)}...`))
  console.log(chalk.cyan(`   User message: ${messages[1].content.substring(0, 200)}...\n`))

  // Token estimation
  const estimatedTokens = Math.ceil(
    (messages[0].content.length + messages[1].content.length) / 4,
  )
  console.log(chalk.dim(`   Estimated tokens: ~${estimatedTokens}`))
  console.log(chalk.dim(`   Context overhead: ~${threadContext ? 800 : 0} tokens\n`))

  // Optional: Actually generate summary (costs money!)
  const shouldSummarize = process.env.DEMO_GENERATE_SUMMARY === 'true'

  if (shouldSummarize && scrap.content) {
    console.log(chalk.bold('🤖 Generating thread-aware summary...\n'))

    try {
      // This would need to be modified in the actual aiSummarization.mjs
      // For now, just show what would happen
      console.log(chalk.yellow('   (Set DEMO_GENERATE_SUMMARY=true to actually call the AI)\n'))

      // const summary = await summarizeContent(scrap.content, {
      //   threadContext,
      //   scrapId: scrap.id
      // })
      //
      // console.log(chalk.bold('✨ Generated Summary:'))
      // console.log(summary)

    } catch (error) {
      console.error('Error generating summary:', error)
    }
  } else {
    console.log(chalk.dim('   💡 Tip: Set DEMO_GENERATE_SUMMARY=true to actually generate summaries'))
  }

  console.log('\n' + chalk.green('✨ Demo complete!'))
}

/**
 * Demo: Compare thread-aware vs isolated summaries side-by-side
 */
async function demoComparison() {
  console.log(chalk.cyan('🔮 THREAD CONTEXT COMPARISON\n'))

  // Get a scrap with good tag coverage
  const { data: scraps, error } = await supabase
    .from('scraps')
    .select('*')
    .not('tags', 'is', null)
    .filter('tags', 'cs', '{neural-networks}') // Contains 'neural-networks' tag
    .order('published_at', { ascending: false })
    .limit(1)

  if (error || !scraps || scraps.length === 0) {
    console.log('No suitable scraps found for comparison')
    return
  }

  const scrap = scraps[0]

  // Generate both versions
  const withContext = await discoverThreadContext(scrap)
  const withoutContext = null

  console.log(chalk.bold('WITHOUT THREAD CONTEXT:'))
  const messagesIsolated = buildThreadAwareMessages(scrap.content, withoutContext)
  console.log(chalk.dim(messagesIsolated[1].content.substring(0, 300) + '...\n'))

  console.log(chalk.bold('WITH THREAD CONTEXT:'))
  const messagesThreadAware = buildThreadAwareMessages(scrap.content, withContext)
  console.log(chalk.dim(messagesThreadAware[1].content.substring(0, 500) + '...\n'))

  const tokensAdded = Math.ceil(
    (messagesThreadAware[1].content.length - messagesIsolated[1].content.length) / 4,
  )

  console.log(chalk.green(`✨ Context added ~${tokensAdded} tokens of relevant history`))
}

// CLI interface
const command = process.argv[2]

if (command === 'compare') {
  demoComparison()
} else if (command) {
  // Treat as URL
  demoThreadContext(command)
} else {
  demoThreadContext()
}
