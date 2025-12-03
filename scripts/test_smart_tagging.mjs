#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'
import { generateTags } from './scrap_doctor_ai.mjs'
import { fetchPageContent } from '../helpers.js'

dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

async function testTagging() {
  console.log(chalk.cyan('🧪 Testing smart tagging system\n'))

  // Test on the neuroevolution book
  const testUrl = 'https://neuroevolutionbook.com/'

  console.log(chalk.dim(`Fetching fresh content from ${testUrl}...\n`))

  const { data: scrap } = await supabase
    .from('scraps')
    .select('*')
    .eq('url', testUrl)
    .single()

  // Fetch fresh content
  const content = await fetchPageContent(testUrl)

  if (!content || content.length < 200) {
    console.log(chalk.red('❌ Not enough content fetched'))
    console.log(chalk.dim(`Content length: ${content?.length || 0}`))
    return
  }

  console.log(chalk.green(`✅ Fetched ${content.length} chars of content`))
  console.log(chalk.dim(`Preview: ${content.substring(0, 200)}...\n`))

  console.log(chalk.cyan('Generating tags with smart algorithm...\n'))

  const tags = await generateTags(content, scrap)

  console.log(chalk.green(`✅ Generated ${tags.length} tags:`))
  console.log(chalk.bold(tags.join(', ')))

  console.log(chalk.dim('\nOld tags were:'))
  console.log(chalk.dim(scrap.tags.join(', ')))
}

testTagging().catch(console.error)
