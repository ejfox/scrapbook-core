#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

const USELESS_TAGS = ['pinboard', 'bookmark', 'link', 'url', 'web', 'website', 'page', 'bookmarks']

async function auditWeakTags() {
  console.log(chalk.cyan('🔍 Auditing ALL scraps for weak tags\n'))

  try {
    // Get count of all scraps with tags
    const { count: totalWithTags } = await supabase
      .from('scraps')
      .select('*', { count: 'exact', head: true })
      .eq('source', 'pinboard')
      .not('tags', 'is', null)

    console.log(chalk.dim(`Total scraps with tags: ${totalWithTags}`))

    // Fetch ALL scraps with tags (we need to check them all)
    let allScraps = []
    let offset = 0
    const limit = 1000

    console.log(chalk.dim('Fetching all scraps...'))

    while (true) {
      const { data, error } = await supabase
        .from('scraps')
        .select('id, scrap_id, url, title, tags, summary')
        .eq('source', 'pinboard')
        .not('tags', 'is', null)
        .range(offset, offset + limit - 1)

      if (error) throw error
      if (!data || data.length === 0) break

      allScraps = allScraps.concat(data)
      offset += limit
      process.stdout.write(chalk.dim(`\rFetched ${allScraps.length}/${totalWithTags}...`))
    }

    console.log(chalk.green(`\n\nAnalyzing ${allScraps.length} scraps...\n`))

    // Analyze tags
    const weakScraps = []
    const emptySummary = []

    allScraps.forEach(scrap => {
      const aiTags = (scrap.tags || []).filter(tag => !USELESS_TAGS.includes(tag.toLowerCase()))

      if (aiTags.length === 0 && scrap.tags.length > 0) {
        weakScraps.push(scrap)
      }

      if (!scrap.summary || scrap.summary.trim().length === 0) {
        emptySummary.push(scrap)
      }
    })

    console.log(chalk.dim(`\nNote: Need to fetch UUIDs for priority list...\n`))

    // Report
    console.log(chalk.red.bold(`❌ Scraps with ONLY useless tags: ${weakScraps.length} (${((weakScraps.length / allScraps.length) * 100).toFixed(2)}%)`))
    console.log(chalk.yellow(`⚠️  Scraps with empty summaries: ${emptySummary.length} (${((emptySummary.length / allScraps.length) * 100).toFixed(2)}%)`))

    // Show examples
    if (weakScraps.length > 0) {
      console.log(chalk.cyan('\n📋 Sample weak scraps:'))
      weakScraps.slice(0, 10).forEach((scrap, i) => {
        console.log(chalk.dim(`${i + 1}. ${scrap.title || 'No title'}`))
        console.log(chalk.dim(`   Tags: ${scrap.tags.join(', ')}`))
        console.log(chalk.dim(`   URL: ${scrap.url.substring(0, 80)}...\n`))
      })
    }

    // Export UUIDs for priority-based reprocessing
    const weakIds = weakScraps.map(s => s.id)
    const fs = await import('fs')
    fs.writeFileSync('priority_ids.json', JSON.stringify(weakIds, null, 2))
    console.log(chalk.green(`\n✅ Exported ${weakIds.length} weak scrap UUIDs to priority_ids.json`))
    console.log(chalk.dim(`Run: node scripts/scrap_doctor_ai.mjs repair --priority --limit ${weakIds.length} --force`))

  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message)
    process.exit(1)
  }
}

auditWeakTags()
