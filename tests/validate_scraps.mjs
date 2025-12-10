import { fetchBookmarksWithCache, processBookmark } from './dl_pinboard.mjs'
import { fetchStatuses, processStatus } from './dl_mastodon.mjs'
import { fetchAllBlocks, processBlock } from './dl_arena.mjs'
import { fetchGithubData } from './dl_github.mjs'
import chalk from 'chalk'
import fs from 'fs/promises'
import { performance } from 'perf_hooks'
import axios from 'axios'
import util from 'util'

console.log(`
==================================
   SCRAPBOOK VALIDATION UTILITY   
==================================
`)

// Benchmarking helpers
const benchmarks = {
  startTime: null,
  marks: new Map(),
  results: [],
}

function startBenchmark(label) {
  benchmarks.marks.set(label, performance.now())
}

function endBenchmark(label) {
  const start = benchmarks.marks.get(label)
  const duration = performance.now() - start
  benchmarks.results.push({
    label,
    duration,
    timestamp: new Date().toISOString(),
  })
  return duration
}

async function saveBenchmarks() {
  const logEntry =
    benchmarks.results
      .map(
        (result) =>
          `[${result.timestamp}] ${result.label}: ${result.duration.toFixed(
            2,
          )}ms`,
      )
      .join('\n') + '\n\n'

  await fs.appendFile('benchmarks.log', logEntry)
}

// Type definitions for validation
const VALID_SOURCES = ['pinboard', 'mastodon', 'arena', 'github']
const VALID_TYPES = [
  'bookmark',
  'status',
  'block',
  'repo',
  'pr',
  'issue',
  'gist',
  'release',
  'starred',
]

// Add source-specific validation rules
const SOURCE_CONFIG = {
  pinboard: {
    requiresScreenshot: true,
    validTypes: ['bookmark'],
  },
  mastodon: {
    requiresScreenshot: false,
    validTypes: ['status'],
  },
  arena: {
    requiresScreenshot: false,
    validTypes: ['block'],
  },
  github: {
    requiresScreenshot: false,
    validTypes: ['repo', 'pr', 'issue', 'gist', 'release', 'starred'],
  },
  default: {
    requiresScreenshot: false,
    validTypes: [],
  },
}

async function validateScrap(scrap) {
  if (!scrap) {
    console.warn('Received null or undefined scrap')
    return false
  }

  if (!scrap.source) {
    console.warn(`Scrap ${scrap.id || 'unknown'} is missing source property`)
    return false
  }

  startBenchmark(`validate_${scrap.source}_${scrap.type}`)

  console.log('\n+------------------------+')
  console.log('| VALIDATING SCRAP      |')
  console.log('+------------------------+')
  console.log(`Source: ${scrap.source}`)
  console.log(`Type: ${scrap.type}`)
  console.log(`URL: ${scrap.url?.substring(0, 50)}...`)

  const errors = []
  const warnings = []

  // Required fields with fancy progress display
  console.log('\n[CHECKING REQUIRED FIELDS]')
  // Use scrap_id for processor validation, id for database validation
  const required = {
    [scrap.id ? 'id' : 'scrap_id']: 'string',
    source: 'string',
    type: 'string',
    url: 'string',
    title: 'string',
    content: 'string',
    screenshot_url: 'string_or_null',
    published_at: 'string',
    created_at: 'string',
    updated_at: 'string',
    shared: 'boolean',
    tags: 'array',
    metadata: 'object',
  }

  // Check required fields and types with progress bar
  Object.entries(required).forEach(([field, type]) => {
    process.stdout.write(`  ${field.padEnd(12)} `)

    if (scrap[field] === undefined || scrap[field] === null) {
      if (type === 'string_or_null') {
        process.stdout.write(chalk.green('[OK]\n'))
      } else {
        process.stdout.write(chalk.red('[MISSING]\n'))
        errors.push(`Missing required field: ${field}`)
      }
    } else if (type === 'array' && !Array.isArray(scrap[field])) {
      process.stdout.write(chalk.red('[NOT ARRAY]\n'))
      errors.push(`${field} must be an array`)
    } else if (type === 'string_or_null' && (typeof scrap[field] !== 'string' && scrap[field] !== null)) {
      process.stdout.write(chalk.red('[NOT STRING OR NULL]\n'))
      errors.push(`${field} must be string or null`)
    } else if (type !== 'array' && type !== 'string_or_null' && typeof scrap[field] !== type) {
      process.stdout.write(chalk.red(`[NOT ${type.toUpperCase()}]\n`))
      errors.push(`${field} must be type ${type}`)
    } else {
      process.stdout.write(chalk.green('[OK]\n'))
    }
  })

  // Validate source
  console.log('\n[CHECKING SOURCE]')
  if (!VALID_SOURCES.includes(scrap.source)) {
    console.log(chalk.red(`  Invalid source: ${scrap.source}`))
    errors.push(`Invalid source: ${scrap.source}`)
  } else {
    console.log(chalk.green(`  Source: ${scrap.source} [VALID]`))
  }

  // Validate type
  console.log('\n[CHECKING TYPE]')
  if (!VALID_TYPES.includes(scrap.type)) {
    console.log(chalk.red(`  Invalid type: ${scrap.type}`))
    errors.push(`Invalid type: ${scrap.type}`)
  } else {
    console.log(chalk.green(`  Type: ${scrap.type} [VALID]`))
  }

  // Validate URL format
  console.log('\n[CHECKING URL]')
  try {
    new URL(scrap.url)
    console.log(chalk.green('  URL format [VALID]'))
  } catch {
    console.log(chalk.red('  URL format [INVALID]'))
    errors.push('Invalid URL format')
  }

  // Get source config with fallback to default
  const sourceConfig = SOURCE_CONFIG[scrap.source] || SOURCE_CONFIG.default

  // Validate screenshot URL if present
  if (scrap.screenshot_url) {
    console.log('\n[CHECKING SCREENSHOT URL]')

    // Only validate screenshot URL format if this source requires screenshots
    if (sourceConfig.requiresScreenshot) {
      if (!scrap.screenshot_url.startsWith('https://')) {
        console.log(chalk.red('  Screenshot URL must be HTTPS'))
        errors.push('Screenshot URL must be HTTPS')
      }
      if (!scrap.screenshot_url.includes('/screenshots/')) {
        console.log(chalk.red('  Invalid screenshot URL path format'))
        errors.push('Invalid screenshot URL path format')
      }
    }
  }

  // Validate dates
  console.log('\n[CHECKING DATES]');
  ['published_at', 'created_at', 'updated_at'].forEach((dateField) => {
    process.stdout.write(`  ${dateField.padEnd(12)} `)
    const date = new Date(scrap[dateField])
    if (isNaN(date.getTime())) {
      process.stdout.write(chalk.red('[INVALID]\n'))
      errors.push(`Invalid ${dateField} date format`)
    } else {
      process.stdout.write(chalk.green('[VALID]\n'))
    }
  })

  // Validate relationships if present
  if (scrap.relationships) {
    console.log('\n[CHECKING RELATIONSHIPS]')
    if (!Array.isArray(scrap.relationships)) {
      console.log(chalk.red('  Relationships must be an array'))
      errors.push('Relationships must be an array')
    } else {
      scrap.relationships.forEach((rel, index) => {
        process.stdout.write(`  Relationship #${index + 1} `)
        if (
          !rel.source?.type ||
          !rel.source?.name ||
          !rel.target?.type ||
          !rel.target?.name ||
          !rel.type
        ) {
          process.stdout.write(chalk.red('[INVALID]\n'))
          errors.push(`Invalid relationship structure at index ${index}`)
        } else {
          process.stdout.write(chalk.green('[VALID]\n'))
        }
      })
    }
  }

  // Optional fields warnings
  console.log('\n[CHECKING OPTIONAL FIELDS]')
  if (!scrap.location && (scrap.latitude || scrap.longitude)) {
    console.log(chalk.yellow('  ⚠ Location missing but coordinates present'))
    warnings.push('Location missing but coordinates present')
  }

  // Final results
  console.log('\n+------------------------+')
  console.log('| VALIDATION RESULTS     |')
  console.log('+------------------------+')

  if (errors.length === 0) {
    console.log(chalk.green('\n✓ SCRAP PASSED VALIDATION'))
    if (warnings.length > 0) {
      console.log(chalk.yellow('\nWarnings:'))
      warnings.forEach((w) => console.log(chalk.yellow(`  ⚠ ${w}`)))
    }
  } else {
    console.log(chalk.red('\n✗ SCRAP FAILED VALIDATION'))
    console.log(chalk.red('\nErrors:'))
    errors.forEach((e) => console.log(chalk.red(`  ✗ ${e}`)))
    console.log(chalk.yellow('\nWarnings:'))
    warnings.forEach((w) => console.log(chalk.yellow(`  ⚠ ${w}`)))
  }

  const duration = endBenchmark(`validate_${scrap.source}_${scrap.type}`)
  console.log(chalk.blue(`\nValidation took ${duration.toFixed(2)}ms`))

  return { errors, warnings }
}

function formatScrapForDisplay(scrap) {
  if (!scrap) {
    return chalk.yellow('No scrap data available to display')
  }

  // Deep clone the scrap to avoid modifying original
  try {
    const display = JSON.parse(JSON.stringify(scrap))

    // Remove large fields we don't need to see
    delete display.embedding
    if (display.metadata?.image_data?.base64) {
      display.metadata.image_data.base64 = '[TRUNCATED]'
    }

    // Truncate long text fields
    if (display.content?.length > 100) {
      display.content = display.content.substring(0, 100) + '...'
    }
    if (display.summary?.length > 100) {
      display.summary = display.summary.substring(0, 100) + '...'
    }

    // Pretty print with colors
    return util.inspect(display, {
      colors: true,
      depth: null,
      compact: false,
    })
  } catch (error) {
    return chalk.red(`Error formatting scrap: ${error.message}`)
  }
}

async function validateSource(source, count = 5) {
  // Set validation mode
  const isValidation = true

  // Set test mode env var
  process.env.TEST_MODE = 'true'

  startBenchmark(`fetch_${source}`)

  console.log(`
+------------------------+
| FETCHING ${source.toUpperCase().padEnd(11)} DATA |
+------------------------+
`)

  let scraps = []

  try {
    switch (source) {
    case 'pinboard': {
      process.stdout.write('Fetching bookmarks from Pinboard API...')
      // Use recent endpoint for validation instead of all
      const pinboardResponse = await axios.get(
        'https://api.pinboard.in/v1/posts/recent',
        {
          params: {
            auth_token: process.env.PINBOARD_TOKEN,
            format: 'json',
            count: 5, // Just get 5 most recent
          },
        },
      )

      if (!pinboardResponse?.data?.posts) {
        console.log(chalk.red(' No valid data received from Pinboard API'))
        return { totalErrors: 1, totalWarnings: 0, processed: 0 }
      }

      const bookmarks = pinboardResponse.data.posts
      console.log(chalk.green(` Found ${bookmarks.length} recent bookmarks`))

      process.stdout.write('Processing bookmarks...\n')
      scraps = await Promise.all(
        bookmarks.map(async (bookmark, i) => {
          try {
            process.stdout.write(
              `  [${i + 1}/${
                bookmarks.length
              }] Processing bookmark: ${bookmark.href?.substring(0, 40)}...\r`,
            )
            return await processBookmark(bookmark, isValidation)
          } catch (err) {
            console.log(
              chalk.red(`\n  Error processing bookmark: ${err.message}`),
            )
            return null
          }
        }),
      )

      // Filter out null values
      scraps = scraps.filter(Boolean)
      console.log('\n')
      break
    }

    case 'mastodon': {
      process.stdout.write('Fetching statuses...')
      try {
        // Use the statuses/home endpoint directly with test mode
        const mastodonResponse = await axios.get(
          `${process.env.MASTODON_API_URL}/api/v1/timelines/home`,
          {
            headers: {
              Authorization: `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`,
            },
            params: {
              limit: 5, // Just get 5 for validation
            },
          },
        )

        if (!mastodonResponse.data) {
          console.log(chalk.red(' No data received from Mastodon API'))
          return { totalErrors: 1, totalWarnings: 0, processed: 0 }
        }

        const statuses = mastodonResponse.data
        console.log(chalk.green(` Found ${statuses.length} statuses`))

        process.stdout.write('Processing statuses...\n')
        scraps = await Promise.all(
          statuses.map(async (status, i) => {
            try {
              process.stdout.write(
                `  [${i + 1}/${statuses.length}] Processing status: ${
                  status.id
                }\r`,
              )
              const processedStatus = await processStatus(status, true)
              if (!processedStatus) {
                console.log(
                  chalk.yellow(
                    `\n  Warning: Status ${status.id} processing returned null`,
                  ),
                )
                return null
              }
              return processedStatus
            } catch (err) {
              console.log(
                chalk.red(
                  `\n  Error processing status ${status.id}: ${err.message}`,
                ),
              )
              return null
            }
          }),
        )

        // Filter out null values
        scraps = scraps.filter((scrap) => scrap !== null)
        console.log('\n')
      } catch (error) {
        console.error(
          chalk.red(`\nError fetching Mastodon data: ${error.message}`),
        )
        if (error.response) {
          console.error(
            chalk.yellow(
              'API Response:',
              JSON.stringify(error.response.data, null, 2),
            ),
          )
        }
        return { totalErrors: 1, totalWarnings: 0, processed: 0 }
      }
      break
    }

    case 'arena': {
      process.stdout.write('Fetching blocks...')
      const blocks = await fetchAllBlocks(true)
      console.log(chalk.green(` Found ${blocks.length} blocks`))

      process.stdout.write('Processing first 5 blocks...\n')
      scraps = await Promise.all(
        blocks.slice(0, count).map(async (block, i) => {
          process.stdout.write(
            `  [${i + 1}/${count}] Processing block: ${
              block.title || block.id
            }\r`,
          )
          return await processBlock(block)
        }),
      )
      console.log('\n')
      break
    }

    case 'github': {
      process.stdout.write('Fetching GitHub data...')
      const githubData = await fetchGithubData()

      if (!githubData || Object.values(githubData).flat().length === 0) {
        console.log(chalk.yellow(' No data available'))
        return { totalErrors: 0, totalWarnings: 1, processed: 0 }
      }

      const totalItems = Object.values(githubData).flat().length
      console.log(chalk.green(` Found ${totalItems} items`))

      // Make sure we have valid scraps before processing
      const validGithubScraps = Object.values(githubData)
        .flat()
        .filter(Boolean)
        .slice(0, count)

      if (validGithubScraps.length === 0) {
        console.log(chalk.yellow('\nNo valid GitHub items to process'))
        return { totalErrors: 0, totalWarnings: 1, processed: 0 }
      }

      scraps = validGithubScraps
      console.log(`Processing first ${scraps.length} items...\n`)
      break
    }
    }

    const fetchDuration = endBenchmark(`fetch_${source}`)
    console.log(
      chalk.blue(`\nFetching ${source} took ${fetchDuration.toFixed(2)}ms`),
    )

    if (!Array.isArray(scraps)) {
      console.error(chalk.red('No valid scraps array returned'))
      return { totalErrors: 1, totalWarnings: 0, processed: 0 }
    }

    startBenchmark(`process_${source}`)
    let totalErrors = 0
    let totalWarnings = 0

    // Only process scraps if we have any
    if (scraps.length > 0) {
      for (const scrap of scraps) {
        if (!scrap) continue
        const { errors, warnings } = await validateScrap(scrap)
        totalErrors += errors?.length || 0
        totalWarnings += warnings?.length || 0
      }

      const processDuration = endBenchmark(`process_${source}`)
      console.log(
        chalk.blue(`Processing ${source} took ${processDuration.toFixed(2)}ms`),
      )

      console.log('\n+------------------------+')
      console.log('| SAMPLE SCRAP FORMAT   |')
      console.log('+------------------------+\n')
      console.log(formatScrapForDisplay(scraps[0]))
    } else {
      console.log(chalk.yellow('\nNo valid scraps to process'))
    }

    return {
      totalErrors,
      totalWarnings,
      processed: scraps.length,
    }
  } catch (error) {
    console.error(chalk.red(`\nError in validateSource: ${error.message}`))
    console.error(chalk.gray(error.stack))
    return {
      totalErrors: 1,
      totalWarnings: 0,
      processed: 0,
    }
  }
}

// Main validation
async function main() {
  benchmarks.startTime = performance.now()
  const sources = process.argv[2] ? [process.argv[2]] : VALID_SOURCES
  const results = {}

  console.log(
    chalk.blue('\nStarting validation at:', new Date().toISOString()),
  )

  for (const source of sources) {
    if (!VALID_SOURCES.includes(source)) {
      console.log(chalk.red(`Invalid source: ${source}`))
      continue
    }

    startBenchmark(`total_${source}`)
    const { totalErrors, totalWarnings, processed } = await validateSource(
      source,
    )
    const sourceDuration = endBenchmark(`total_${source}`)

    results[source] = {
      totalErrors,
      totalWarnings,
      processed,
      duration: sourceDuration,
    }
  }

  // Print summary with timing info
  console.log('\nValidation Summary:')
  Object.entries(results).forEach(
    ([source, { totalErrors, totalWarnings, processed, duration }]) => {
      const status =
        totalErrors === 0 ? chalk.green('PASS') : chalk.red('FAIL')
      console.log(
        `${status} ${source}: ${processed} scraps, ${totalErrors} errors, ` +
          `${totalWarnings} warnings (${duration.toFixed(2)}ms)`,
      )
    },
  )

  const totalDuration = performance.now() - benchmarks.startTime
  console.log(
    chalk.blue(`\nTotal validation time: ${totalDuration.toFixed(2)}ms`),
  )

  // Save benchmarks to log file
  await saveBenchmarks()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}
