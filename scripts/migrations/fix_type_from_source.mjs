#!/usr/bin/env node
/**
 * Migration: Fix type field from source
 *
 * type = source-level terminology (bookmark, block, repo, status)
 * content_type = AI-classified content kind (article, video, news, etc)
 *
 * This script sets type based on source for any records with unknown/null type.
 */

import { createClient } from '@supabase/supabase-js'
import chalk from 'chalk'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

const SOURCE_TO_TYPE = {
  pinboard: 'bookmark',
  arena: 'block',
  github: 'repo',
  mastodon: 'status',
}

async function migrate() {
  console.log(chalk.blue('🔧 Fixing type field from source...\n'))

  // Fix records with type='unknown' for each source
  for (const [source, type] of Object.entries(SOURCE_TO_TYPE)) {
    const { data, error } = await supabase
      .from('scraps')
      .update({ type })
      .eq('source', source)
      .eq('type', 'unknown')
      .select('id')

    if (error) {
      console.error(chalk.red(`Error updating ${source} (unknown):`), error.message)
    } else {
      console.log(chalk.green(`✓ ${source} → ${type}: ${data.length} fixed (was unknown)`))
    }
  }

  // Also fix records with null type
  for (const [source, type] of Object.entries(SOURCE_TO_TYPE)) {
    const { data, error } = await supabase
      .from('scraps')
      .update({ type })
      .eq('source', source)
      .is('type', null)
      .select('id')

    if (error) {
      console.error(chalk.red(`Error updating ${source} (null):`), error.message)
    } else if (data.length > 0) {
      console.log(chalk.green(`✓ ${source} → ${type}: ${data.length} fixed (was null)`))
    }
  }

  console.log(chalk.blue('\n📊 Done!'))
}

migrate()
