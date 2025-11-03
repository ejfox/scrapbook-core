#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'
import ora from 'ora'
import axios from 'axios'
import Bottleneck from 'bottleneck'
import { program } from 'commander'
import path from 'path'
import fs from 'fs'

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

const PINBOARD_API_TOKEN = process.env.PINBOARD_TOKEN

if (!PINBOARD_API_TOKEN) {
  console.error(chalk.red('❌ PINBOARD_TOKEN not found in environment variables'))
  process.exit(1)
}

// Pinboard API rate limiting - EXTRA respectful and gentle
// Pinboard requests 3-second delays between API calls, we'll use 5 seconds to be extra polite
const pinboardLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 5000, // 5 seconds between requests - slow and methodical
})

// Set up CLI (only when running directly, not when imported)
function setupCLI() {
  program
    .name('sync-tags-to-pinboard')
    .description('🏷️ Sync AI-generated tags back to Pinboard bookmarks (additive only)')
    .version('1.0.0')

  program
    .command('sync')
    .description('Sync tags from database back to Pinboard')
    .option('-l, --limit <number>', 'Limit number of bookmarks to sync', '10')
    .option('-r, --reverse', 'Process oldest bookmarks first (default: newest first)')
    .option('-d, --dry-run', 'Show what would be updated without making changes')
    .option('-s, --source <source>', 'Only sync specific source (default: pinboard)', 'pinboard')
    .action(syncTags)

  program
    .command('status')
    .description('Show sync status and statistics')
    .action(showStatus)
}

async function syncTags(options) {
  console.log(chalk.cyan('🏷️ Syncing AI Tags to Pinboard\n'))

  const isDryRun = options.dryRun
  if (isDryRun) {
    console.log(chalk.yellow('🔍 DRY RUN MODE - No changes will be made\n'))
  }

  const spinner = ora('Fetching bookmarks with AI-generated tags...').start()

  try {
    // Get bookmarks with AI tags from database
    let query = supabase
      .from('scraps')
      .select('scrap_id, url, title, tags, metadata')
      .eq('source', options.source)
      .not('tags', 'is', null)
      .not('url', 'is', null)
      .limit(parseInt(options.limit))

    // Order by created_at - reverse means oldest first
    if (options.reverse) {
      query = query.order('created_at', { ascending: true })
    } else {
      query = query.order('created_at', { ascending: false })
    }

    const { data: bookmarks, error } = await query

    if (error) throw error

    spinner.stop()

    if (!bookmarks || bookmarks.length === 0) {
      console.log(chalk.yellow('No bookmarks with tags found to sync'))
      return
    }

    console.log(chalk.green(`Found ${bookmarks.length} bookmarks with AI tags to sync\n`))

    let synced = 0
    let skipped = 0
    let failed = 0

    for (const [index, bookmark] of bookmarks.entries()) {
      const progress = `[${index + 1}/${bookmarks.length}]`
      const bookmarkId = bookmark.scrap_id.replace('pinboard-', '')

      console.log(chalk.gray(`${progress} Processing: ${bookmark.title?.substring(0, 60) || bookmark.url?.substring(0, 60)}...`))

      try {
        // Get current bookmark from Pinboard to preserve existing tags
        const currentBookmark = await pinboardLimiter.schedule(() =>
          getPinboardBookmark(bookmark.url),
        )

        if (!currentBookmark) {
          console.log(chalk.yellow('  ⚠️ Bookmark not found on Pinboard, skipping'))
          skipped++
          continue
        }

        // Parse existing tags
        const existingTags = currentBookmark.tags ? currentBookmark.tags.split(' ').filter(t => t) : []

        // Filter out useless tags from AI-generated tags
        const uselessTags = ['pinboard', 'bookmark', 'link', 'url', 'web', 'website', 'page', 'bookmarks']
        const aiTags = (bookmark.tags || []).filter(tag => !uselessTags.includes(tag.toLowerCase()))

        // Merge tags (additive only)
        const mergedTags = [...new Set([...existingTags, ...aiTags])]

        // Check if any new tags were added
        const newTags = aiTags.filter(tag => !existingTags.includes(tag))

        if (newTags.length === 0) {
          console.log(chalk.dim('  ⏭️ No new tags to add'))
          skipped++
          continue
        }

        console.log(chalk.dim(`  Existing tags: ${existingTags.join(', ') || 'none'}`))
        console.log(chalk.green(`  New AI tags: ${newTags.join(', ')}`))
        console.log(chalk.blue(`  Final tags: ${mergedTags.join(', ')}`))

        if (!isDryRun) {
          // Update bookmark on Pinboard with merged tags
          await pinboardLimiter.schedule(() =>
            updatePinboardBookmark({
              url: bookmark.url,
              description: currentBookmark.description || bookmark.title || '',
              extended: currentBookmark.extended || '',
              tags: mergedTags.join(' '),
              replace: 'yes', // Required to update existing bookmark
            }),
          )

          // Update metadata in database to track sync
          await supabase
            .from('scraps')
            .update({
              metadata: {
                ...bookmark.metadata,
                tags_synced_to_pinboard: true,
                tags_synced_at: new Date().toISOString(),
                pinboard_tags_count: mergedTags.length,
              },
            })
            .eq('scrap_id', bookmark.scrap_id)

          console.log(chalk.green(`  ✅ Synced ${newTags.length} new tags to Pinboard`))
          synced++
        } else {
          console.log(chalk.yellow(`  🔍 Would sync ${newTags.length} new tags (dry run)`))
          synced++
        }

      } catch (error) {
        console.log(chalk.red(`  ❌ Failed: ${error.message}`))
        failed++
      }
    }

    // Summary
    console.log(chalk.blue('\n📊 Sync Summary:'))
    console.log(`  ✅ Synced: ${synced}`)
    console.log(`  ⏭️ Skipped: ${skipped}`)
    console.log(`  ❌ Failed: ${failed}`)

    if (isDryRun) {
      console.log(chalk.yellow('\n🔍 This was a dry run. Use without --dry-run to apply changes.'))
    }

  } catch (error) {
    spinner.stop()
    console.error(chalk.red('❌ Error during sync:'), error.message)
    process.exit(1)
  }
}

async function getPinboardBookmark(url) {
  try {
    const response = await axios.get('https://api.pinboard.in/v1/posts/get', {
      params: {
        auth_token: PINBOARD_API_TOKEN,
        url: url,
        format: 'json',
      },
    })

    if (response.data && response.data.posts && response.data.posts.length > 0) {
      return response.data.posts[0]
    }

    return null
  } catch (error) {
    if (error.response?.status === 404) {
      return null
    }
    throw error
  }
}

async function updatePinboardBookmark(bookmark) {
  try {
    const response = await axios.get('https://api.pinboard.in/v1/posts/add', {
      params: {
        auth_token: PINBOARD_API_TOKEN,
        url: bookmark.url,
        description: bookmark.description,
        extended: bookmark.extended,
        tags: bookmark.tags,
        replace: bookmark.replace,
        format: 'json',
      },
    })

    if (response.data?.result_code !== 'done') {
      throw new Error(`Pinboard API error: ${JSON.stringify(response.data)}`)
    }

    return response.data
  } catch (error) {
    console.error('Pinboard update error:', error.response?.data || error.message)
    throw error
  }
}

async function showStatus() {
  console.log(chalk.cyan('🏷️ Tag Sync Status\n'))

  const spinner = ora('Checking sync status...').start()

  try {
    // Count bookmarks with AI tags
    const { count: withAiTags } = await supabase
      .from('scraps')
      .select('*', { count: 'exact', head: true })
      .eq('source', 'pinboard')
      .not('tags', 'is', null)

    // Count bookmarks that have been synced
    const { count: synced } = await supabase
      .from('scraps')
      .select('*', { count: 'exact', head: true })
      .eq('source', 'pinboard')
      .eq('metadata->tags_synced_to_pinboard', true)

    // Get recent syncs
    const { data: recentSyncs } = await supabase
      .from('scraps')
      .select('scrap_id, title, metadata')
      .eq('source', 'pinboard')
      .eq('metadata->tags_synced_to_pinboard', true)
      .order('metadata->tags_synced_at', { ascending: false })
      .limit(5)

    spinner.stop()

    console.log(chalk.green('📊 Sync Statistics:\n'))
    console.log(`  Total bookmarks with AI tags: ${withAiTags || 0}`)
    console.log(`  Already synced to Pinboard: ${synced || 0}`)
    console.log(`  Remaining to sync: ${(withAiTags || 0) - (synced || 0)}`)

    if (recentSyncs && recentSyncs.length > 0) {
      console.log(chalk.blue('\n📅 Recently Synced:'))
      recentSyncs.forEach(item => {
        const syncDate = new Date(item.metadata?.tags_synced_at)
        const timeAgo = getTimeAgo(syncDate)
        console.log(chalk.dim(`  • ${item.title?.substring(0, 50) || 'No title'} (${timeAgo})`))
      })
    }

    // Estimate sync time
    const remaining = (withAiTags || 0) - (synced || 0)
    if (remaining > 0) {
      const estimatedTime = remaining * 3.1 // seconds
      console.log(chalk.yellow(`\n⏱️ Estimated time to sync all: ${formatDuration(estimatedTime)}`))
      console.log(chalk.dim('  (Pinboard API requires 3-second delays between requests)'))
    }

  } catch (error) {
    spinner.stop()
    console.error(chalk.red('❌ Error checking status:'), error.message)
  }
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000)
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
  }

  for (const [name, secondsInInterval] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInInterval)
    if (interval >= 1) {
      return `${interval} ${name}${interval > 1 ? 's' : ''} ago`
    }
  }
  return 'just now'
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`
  } else {
    return `${secs}s`
  }
}

/**
 * Helper function to automatically sync recently updated tags
 * Handles query + sync + error handling in one DRY call
 */
export async function autoSyncRecentTags({
  supabaseClient,
  source = 'pinboard',
  maxAge = 3600000, // 1 hour in ms
  maxLimit = 50,
  knownCount = null, // If we already know the count (repair case)
}) {
  try {
    let count = knownCount

    // Query for recent scraps if count not provided
    if (count === null) {
      const result = await supabaseClient
        .from('scraps')
        .select('*', { count: 'exact', head: true })
        .eq('source', source)
        .not('tags', 'is', null)
        .gte('updated_at', new Date(Date.now() - maxAge).toISOString())

      count = result.count
    }

    // Sync if we have scraps to sync
    if (count && count > 0) {
      await syncTags({
        limit: Math.min(count, maxLimit),
        dryRun: false,
        source,
        reverse: false,
      })
      return { success: true, count, synced: Math.min(count, maxLimit) }
    }

    return { success: true, count: 0, synced: 0 }
  } catch (error) {
    return { success: false, error: error.message, count: 0, synced: 0 }
  }
}

// Make it executable
if (import.meta.url === `file://${process.argv[1]}`) {
  setupCLI()
  program.parse()
}

export { syncTags, showStatus }
