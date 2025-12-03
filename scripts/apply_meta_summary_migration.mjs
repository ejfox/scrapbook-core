#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'
import fs from 'fs'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

async function applyMigration() {
  console.log(chalk.cyan('📦 Applying meta_summary migration to Supabase\n'))

  const migration = fs.readFileSync('migrations/add_meta_summary.sql', 'utf8')

  try {
    // Run the migration SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql: migration })

    if (error) {
      // Try alternative approach - direct SQL through PostgREST
      console.log(chalk.yellow('RPC approach failed, trying direct SQL...\n'))

      // Split into separate statements
      const statements = [
        'ALTER TABLE scraps ADD COLUMN IF NOT EXISTS meta_summary TEXT',
        'CREATE INDEX IF NOT EXISTS idx_scraps_meta_summary ON scraps(meta_summary)',
      ]

      for (const stmt of statements) {
        console.log(chalk.dim(`Executing: ${stmt.substring(0, 60)}...`))
        const { error: stmtError } = await supabase.rpc('exec_sql', { sql: stmt })
        if (stmtError) {
          console.log(chalk.red(`  ❌ Error: ${stmtError.message}`))
          console.log(chalk.yellow('\n⚠️  Please run this SQL manually in Supabase SQL Editor:'))
          console.log(chalk.dim(migration))
          process.exit(1)
        }
        console.log(chalk.green('  ✅ Success'))
      }
    }

    console.log(chalk.green('\n✅ Migration applied successfully!'))
    console.log(chalk.dim('The meta_summary column is now available.\n'))

  } catch (error) {
    console.log(chalk.red('❌ Error:'), error.message)
    console.log(chalk.yellow('\n⚠️  Please run this SQL manually in Supabase SQL Editor:'))
    console.log(chalk.dim(migration))
    process.exit(1)
  }
}

applyMigration()
