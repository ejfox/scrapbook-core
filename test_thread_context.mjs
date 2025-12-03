#!/usr/bin/env node
/**
 * Murphy's "Stupid Simple" Thread Context Test
 *
 * Test thread-aware summarization with a sample scrap.
 * Run with: ENABLE_THREAD_CONTEXT=true DEBUG=true node test_thread_context.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { discoverThreadContext, formatThreadContext } from './lib/threadContext.mjs'
import dotenv from 'dotenv'
import chalk from 'chalk'

dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

async function testThreadContext() {
  console.log(chalk.cyan('🧵 Testing Murphy\'s Thread Context Discovery\n'))

  // Get a recent scrap with tags
  const { data: scraps, error } = await supabase
    .from('scraps')
    .select('id, title, url, tags, summary, created_at')
    .not('tags', 'is', null)
    .not('summary', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !scraps || scraps.length === 0) {
    console.log(chalk.red('❌ Failed to fetch test scrap'))
    console.error(error)
    return
  }

  const testScrap = scraps[0]
  console.log(chalk.bold('Test scrap:'))
  console.log(chalk.dim(`  ID: ${testScrap.id}`))
  console.log(chalk.dim(`  Title: ${testScrap.title || 'Untitled'}`))
  console.log(chalk.dim(`  URL: ${testScrap.url}`))
  console.log(chalk.dim(`  Tags: ${testScrap.tags?.join(', ') || 'none'}`))
  console.log(chalk.dim(`  Created: ${testScrap.created_at}\n`))

  if (!testScrap.tags || testScrap.tags.length === 0) {
    console.log(chalk.yellow('⚠️  This scrap has no tags, can\'t find related content'))
    return
  }

  // Test thread discovery
  console.log(chalk.cyan('🔍 Discovering related scraps...\n'))

  const threadContext = await discoverThreadContext(testScrap, { tags: testScrap.tags })

  if (!threadContext) {
    console.log(chalk.yellow('📭 No related scraps found'))
    console.log(chalk.dim('   (This might be because there are no other scraps with overlapping tags from the last 14 days)'))
    return
  }

  console.log(chalk.green(`✅ Found related scraps with thread context\n`))

  // discoverThreadContext already returns formatted text, no need to format again
  const formatted = threadContext

  console.log(chalk.bold('Formatted thread context:'))
  console.log(chalk.gray('━'.repeat(80)))
  console.log(formatted)
  console.log(chalk.gray('━'.repeat(80)))

  console.log(chalk.cyan('\n💡 This context would be injected into the AI summarization prompt'))
  console.log(chalk.dim('   The AI can now reference these related bookmarks in its summary'))

  // Show token count estimate
  const tokenEstimate = Math.ceil(formatted.length / 4)
  console.log(chalk.dim(`\n📊 Estimated tokens: ~${tokenEstimate} tokens`))
  console.log(chalk.dim(`   Cost per summary (rough): ~$0.0001-0.0005`))
}

testThreadContext().catch(console.error)
