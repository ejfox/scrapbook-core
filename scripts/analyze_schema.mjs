#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

console.log(chalk.blue(`
╔═══════════════════════════════════════╗
║      DETAILED SCHEMA ANALYSIS          ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║
╚═══════════════════════════════════════╝
`))

async function analyzeSchema() {
  try {
    // Get records from each source to check field usage patterns
    console.log(chalk.yellow('\n🔍 Analyzing field usage by source...'))

    const sources = ['arena', 'github', 'pinboard', 'mastodon']

    for (const source of sources) {
      console.log(chalk.cyan(`\n--- ${source.toUpperCase()} ---`))

      const { data: records, error } = await supabase
        .from('scraps')
        .select('*')
        .eq('source', source)
        .limit(2)

      if (error) {
        console.log(chalk.red(`Error querying ${source}:`, error))
        continue
      }

      if (!records || records.length === 0) {
        console.log(chalk.gray(`No records found for ${source}`))
        continue
      }

      console.log(chalk.green(`Found ${records.length} sample records`))

      // Analyze each record
      records.forEach((record, i) => {
        console.log(chalk.blue(`\n  Record ${i+1}:`))
        console.log(`    id: ${record.id}`)
        console.log(`    scrap_id: ${record.scrap_id}`)
        console.log(`    source: ${record.source}`)
        console.log(`    type: ${record.type}`)
        console.log(`    url: ${record.url ? '✓' : '✗'}`)
        console.log(`    title: ${record.title ? '✓' : '✗'}`)
        console.log(`    content: ${record.content ? '✓' : '✗'}`)
        console.log(`    summary: ${record.summary ? '✓' : '✗'}`)
        console.log(`    screenshot_url: ${record.screenshot_url ? '✓' : '✗'}`)
        console.log(`    tags: ${record.tags ? '✓' : '✗'}`)
        console.log(`    metadata: ${record.metadata ? '✓' : '✗'}`)
        console.log(`    published_at: ${record.published_at ? '✓' : '✗'}`)
        console.log(`    created_at: ${record.created_at ? '✓' : '✗'}`)
        console.log(`    updated_at: ${record.updated_at ? '✓' : '✗'}`)
        console.log(`    shared: ${record.shared}`)
        console.log(`    embedding_nomic: ${record.embedding_nomic ? '✓' : '✗'}`)
        console.log(`    processing_instance_id: ${record.processing_instance_id ? '✓' : '✗'}`)
        console.log(`    processing_started_at: ${record.processing_started_at ? '✓' : '✗'}`)
      })
    }

    // Check for any records that might have both id patterns
    console.log(chalk.yellow('\n🚨 Checking for potential ID conflicts...'))

    const { data: allRecords, error: allError } = await supabase
      .from('scraps')
      .select('id, scrap_id, source')
      .limit(50)

    if (!allError && allRecords) {
      const idPatterns = {}
      allRecords.forEach(record => {
        const source = record.source
        if (!idPatterns[source]) {
          idPatterns[source] = {
            id_format: [],
            scrap_id_format: [],
          }
        }

        // Analyze ID formats
        idPatterns[source].id_format.push(record.id)
        idPatterns[source].scrap_id_format.push(record.scrap_id)
      })

      console.log(chalk.green('\n✅ ID Format Analysis:'))
      Object.keys(idPatterns).forEach(source => {
        console.log(chalk.blue(`\n${source}:`))
        console.log(`  id examples: ${idPatterns[source].id_format.slice(0,2).join(', ')}`)
        console.log(`  scrap_id examples: ${idPatterns[source].scrap_id_format.slice(0,2).join(', ')}`)
      })
    }

    // Check required vs optional field usage
    console.log(chalk.yellow('\n📊 Field Usage Statistics...'))

    const { count: totalCount } = await supabase
      .from('scraps')
      .select('*', { count: 'exact', head: true })

    console.log(chalk.green(`\nTotal records: ${totalCount}`))

    // Check null counts for key fields
    const fieldsToCheck = ['url', 'title', 'summary', 'screenshot_url', 'tags', 'published_at']

    for (const field of fieldsToCheck) {
      const { count: nullCount } = await supabase
        .from('scraps')
        .select('*', { count: 'exact', head: true })
        .is(field, null)

      const { count: notNullCount } = await supabase
        .from('scraps')
        .select('*', { count: 'exact', head: true })
        .not(field, 'is', null)

      const percentage = ((notNullCount / totalCount) * 100).toFixed(1)
      console.log(`  ${field}: ${notNullCount}/${totalCount} (${percentage}%) populated`)
    }

  } catch (error) {
    console.error(chalk.red('Error in analysis:'), error)
  }
}

analyzeSchema().then(() => {
  console.log(chalk.blue('\n🏁 Schema analysis complete'))
  process.exit(0)
})
