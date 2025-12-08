#!/usr/bin/env node
/**
 * Migration: Fix JSON-format location strings
 *
 * Some locations were stored as JSON objects like:
 *   {"location":"NYC","latitude":40.7,"longitude":-73.9,"metadata":{...}}
 *
 * This script extracts the location string and coordinates properly.
 */

import { createClient } from '@supabase/supabase-js'
import chalk from 'chalk'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

async function migrate() {
  console.log(chalk.blue('🔧 Fixing JSON-format locations...\n'))

  // Find all scraps with JSON-format locations
  const { data, error } = await supabase
    .from('scraps')
    .select('id, location, latitude, longitude')
    .not('location', 'is', null)
    .like('location', '{%')

  if (error) {
    console.error(chalk.red('Error fetching scraps:'), error)
    return
  }

  console.log(chalk.yellow(`Found ${data.length} scraps with JSON-format locations\n`))

  let fixed = 0
  let failed = 0

  for (const scrap of data) {
    try {
      const parsed = JSON.parse(scrap.location)

      const updates = {
        location: parsed.location || null
      }

      // Only update lat/long if the scrap doesn't already have them
      // and the JSON has valid values
      if (!scrap.latitude && parsed.latitude) {
        updates.latitude = parsed.latitude
      }
      if (!scrap.longitude && parsed.longitude) {
        updates.longitude = parsed.longitude
      }

      const { error: updateError } = await supabase
        .from('scraps')
        .update(updates)
        .eq('id', scrap.id)

      if (updateError) {
        console.error(chalk.red(`  ✗ ${scrap.id}: ${updateError.message}`))
        failed++
      } else {
        const coordsInfo = updates.latitude ? ` (${updates.latitude.toFixed(2)}, ${updates.longitude.toFixed(2)})` : ''
        console.log(chalk.green(`  ✓ ${parsed.location}${coordsInfo}`))
        fixed++
      }
    } catch (parseError) {
      console.error(chalk.red(`  ✗ ${scrap.id}: Failed to parse JSON - ${parseError.message}`))
      failed++
    }
  }

  console.log(chalk.blue(`\n📊 Results: ${fixed} fixed, ${failed} failed`))
}

migrate()
