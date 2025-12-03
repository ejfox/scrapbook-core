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

async function findWeakTags() {
  console.log(chalk.cyan('🔍 Finding scraps with only useless tags\n'))

  try {
    const { data: scraps, error } = await supabase
      .from('scraps')
      .select('scrap_id, url, title, tags')
      .eq('source', 'pinboard')
      .not('tags', 'is', null)
      .limit(100)

    if (error) throw error

    const weakScraps = scraps.filter(scrap => {
      const aiTags = (scrap.tags || []).filter(tag => !USELESS_TAGS.includes(tag.toLowerCase()))
      return aiTags.length === 0 && scrap.tags.length > 0
    })

    console.log(chalk.green(`Found ${weakScraps.length} scraps with only useless tags out of ${scraps.length} checked\n`))

    weakScraps.slice(0, 10).forEach((scrap, i) => {
      console.log(chalk.yellow(`[${i + 1}] ${scrap.title || 'No title'}`))
      console.log(chalk.dim(`    Tags: ${scrap.tags.join(', ')}`))
      console.log(chalk.dim(`    URL: ${scrap.url.substring(0, 80)}...\n`))
    })

    console.log(chalk.cyan(`\nTotal weak scraps: ${weakScraps.length}`))

  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message)
    process.exit(1)
  }
}

findWeakTags()
