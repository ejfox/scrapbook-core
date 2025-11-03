#!/usr/bin/env node

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import chalk from 'chalk'

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://xmdylmbdeulxcqdbkfno.supabase.co',
  process.env.SUPABASE_KEY,
)

async function checkBacklog() {
  console.log(chalk.bold.cyan('\n📊 CHECKING BACKLOG STATUS\n'))

  // Check for items without AI processing
  const { data: unprocessed, error: e1 } = await supabase
    .from('scraps')
    .select('scrap_id, source, created_at, summary, tags, title, url')
    .or('summary.is.null,tags.is.null')
    .order('created_at', { ascending: false })
    .limit(20)

  console.log(chalk.yellow('Items needing AI processing:'), unprocessed?.length || 0)

  if (unprocessed?.length > 0) {
    console.log('\nRecent unprocessed items:')
    unprocessed.slice(0, 5).forEach(item => {
      const id = item.scrap_id.substring(0, 30)
      const hasSummary = item.summary ? '✅' : '❌'
      const hasTags = item.tags?.length > 0 ? '✅' : '❌'
      console.log(chalk.dim(`- ${item.source}: ${id}...`))
      console.log(chalk.dim(`  Summary: ${hasSummary} Tags: ${hasTags}`))
      console.log(chalk.dim(`  ${item.title || item.url || 'No title'}\n`))
    })
  }

  // Check recently processed items
  const { data: recent, error: e2 } = await supabase
    .from('scraps')
    .select('scrap_id, source, created_at, summary, tags')
    .not('summary', 'is', null)
    .not('tags', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5)

  console.log(chalk.green('\nRecently processed items:'), recent?.length || 0)

  if (recent?.length > 0) {
    recent.forEach(item => {
      const id = item.scrap_id.substring(0, 30)
      const tagCount = item.tags?.length || 0
      const summaryLen = item.summary?.length || 0
      console.log(chalk.dim(`- ${item.source}: ${id}... (${summaryLen} chars, ${tagCount} tags)`))
    })
  }

  // Count by source
  const { data: sources, error: e3 } = await supabase
    .from('scraps')
    .select('source')

  if (sources) {
    const counts = {}
    sources.forEach(s => {
      counts[s.source] = (counts[s.source] || 0) + 1
    })

    console.log(chalk.bold.blue('\n📈 Total items by source:'))
    Object.entries(counts).forEach(([source, count]) => {
      console.log(chalk.dim(`  ${source}: ${count}`))
    })
  }
}

checkBacklog().catch(console.error)
