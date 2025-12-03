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

async function testWeakSync() {
  console.log(chalk.cyan('🔍 Testing sync on weak scraps\n'))

  // Get scraps with only useless tags
  const { data: allScraps } = await supabase
    .from('scraps')
    .select('scrap_id, url, title, tags')
    .eq('source', 'pinboard')
    .not('tags', 'is', null)
    .limit(100)

  const weakScraps = allScraps.filter(scrap => {
    const aiTags = (scrap.tags || []).filter(tag => !USELESS_TAGS.includes(tag.toLowerCase()))
    return aiTags.length === 0 && scrap.tags.length > 0
  })

  console.log(chalk.yellow(`Found ${weakScraps.length} weak scraps\n`))

  // Test logic for each
  weakScraps.slice(0, 5).forEach((scrap, i) => {
    const aiTags = (scrap.tags || []).filter(tag => !USELESS_TAGS.includes(tag.toLowerCase()))
    const needsReprocessing = aiTags.length === 0 && scrap.tags?.length > 0

    console.log(chalk.bold(`[${i + 1}] ${scrap.title || 'No title'}`))
    console.log(chalk.dim(`    Tags: ${scrap.tags.join(', ')}`))
    console.log(chalk.dim(`    AI tags after filter: ${aiTags.length > 0 ? aiTags.join(', ') : 'none'}`))
    console.log(chalk.dim(`    Needs reprocessing: ${needsReprocessing ? 'YES' : 'NO'}`))
    if (needsReprocessing) {
      console.log(chalk.red('    ⚠️ Would flag for reprocessing'))
    }
    console.log()
  })
}

testWeakSync()
