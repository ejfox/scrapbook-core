#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

async function spotCheck() {
  console.log(chalk.cyan('🔍 Fetching 10 random Pinboard bookmarks for spot-checking\n'))

  try {
    // Get total count first
    const { count } = await supabase
      .from('scraps')
      .select('*', { count: 'exact', head: true })
      .eq('source', 'pinboard')
      .not('tags', 'is', null)
      .not('summary', 'is', null)

    console.log(chalk.dim(`Total bookmarks with AI data: ${count}\n`))

    // Fetch 10 random ones by using a random offset
    const randomOffset = Math.floor(Math.random() * (count - 10))

    const { data: scraps, error } = await supabase
      .from('scraps')
      .select('scrap_id, url, title, summary, tags, concept_tags, metadata')
      .eq('source', 'pinboard')
      .not('tags', 'is', null)
      .not('summary', 'is', null)
      .range(randomOffset, randomOffset + 9)

    if (error) throw error

    scraps.forEach((scrap, i) => {
      console.log(chalk.bold.blue(`\n[${i + 1}/10] ${scrap.title || 'No Title'}`))
      console.log(chalk.dim(`URL: ${scrap.url}`))

      // Show original Pinboard tags if in metadata
      if (scrap.metadata?.tags) {
        console.log(chalk.yellow(`Original tags: ${scrap.metadata.tags}`))
      }

      // Show AI tags
      console.log(chalk.green(`AI tags: ${scrap.tags?.join(', ') || 'none'}`))

      // Show concept tags if present
      if (scrap.concept_tags?.length > 0) {
        console.log(chalk.magenta(`Concepts: ${scrap.concept_tags.join(', ')}`))
      }

      // Show summary (truncated to 240 chars like we might push to Pinboard)
      if (scrap.summary) {
        const shortSummary = scrap.summary.substring(0, 240)
        const truncated = scrap.summary.length > 240 ? '...' : ''
        console.log(chalk.cyan(`Summary (240c): ${shortSummary}${truncated}`))
      }

      // Show sync status if available
      if (scrap.metadata?.tags_synced_to_pinboard) {
        const syncDate = new Date(scrap.metadata.tags_synced_at)
        console.log(chalk.dim(`✓ Synced ${syncDate.toLocaleDateString()}`))
      } else {
        console.log(chalk.dim('○ Not yet synced'))
      }
    })

    console.log(chalk.cyan('\n✨ Spot check complete!\n'))

  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message)
    process.exit(1)
  }
}

spotCheck()
