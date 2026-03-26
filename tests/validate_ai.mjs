import { completion, MODELS, PROMPTS } from './llmService.mjs'
import { summarizeContent, metaSummaryToTags } from './aiSummarization.mjs'
import { extractLocation } from './aiGeolocation.mjs'
import { extractRelationships } from './aiRelationshipExtraction.mjs'
import { generateMastodonTags } from './aiMastodonSummarization.mjs'
import { summarizeGitHubActivity } from './aiGithubSummarization.mjs'
import { getFallbackModels } from '../lib/config.mjs'
import chalk from 'chalk'
import { performance } from 'perf_hooks'
import axios from 'axios'
import { getTokenUsage, resetTokenUsage } from './llmService.mjs'
import { program } from 'commander'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1'

console.log(
  chalk.cyan(`
╔═══════════════════════════════════════╗
║         AI VALIDATION UTILITY         ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║
║    [STATUS: INITIALIZING TESTS]       ║
╚═══════════════════════════════════════╝
`),
)

// Add command line options
program
  .option('--location', 'Only test location extraction')
  .option('--debug', 'Enable debug mode')
  .option('--free', 'Test with free models only')
  .parse(process.argv)

const options = program.opts()
const DEBUG = options.debug || process.env.DEBUG === 'true'

// Test data
const TEST_CONTENT = [
  "While working from a cafe in the East Village, New York City, I've been exploring Vue.js 3.0's Composition API...",
  'The ref() and reactive() functions are core utilities for managing reactive state in Vue.js applications...',
]

// Add more test cases specifically for location testing
const LOCATION_TEST_CASES = [
  "While working from a cafe in the East Village, New York City, I've been exploring Vue.js 3.0's Composition API...",
  'The new Apple Store in downtown Shanghai, located at 123 Huaihai Road, has a stunning glass facade.',
  "Remote work has allowed me to split my time between Berlin's Kreuzberg neighborhood and a small village in the South of France.",
  'This photo was taken at the Louvre Museum in Paris, just steps away from the Seine River.',
  // Technical content with no locations (negative test case)
  'The ref() and reactive() functions are core utilities for managing reactive state in Vue.js applications...',
]

async function checkCredits() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log(chalk.yellow('⚠️  OpenRouter API key not configured'))
    return false
  }

  try {
    const response = await axios.get(`${OPENROUTER_API_URL}/key`, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })

    if (!response.data?.data) {
      throw new Error('No data received from OpenRouter API')
    }

    const { usage, limit, limit_remaining, is_free_tier, rate_limit } =
      response.data.data

    // Check limit_remaining first!
    if (limit_remaining <= 0) {
      console.error(
        chalk.red('\n❌ No credits remaining!') +
          chalk.yellow(
            '\nPlease add more credits at https://openrouter.ai/credits',
          ),
      )
      console.log(chalk.gray('\nCredit Details:'))
      console.log(chalk.gray(`Limit Remaining: ${limit_remaining}`))
      console.log(chalk.gray(`Usage: ${usage}`))
      console.log(chalk.gray(`Limit: ${limit}`))
      return false
    }

    // Create a visual representation of credit usage
    const usagePercent = (usage / limit) * 100
    const creditBar = `[${'='.repeat(Math.floor(usagePercent / 5))}${' '.repeat(
      20 - Math.floor(usagePercent / 5),
    )}]`

    console.log(chalk.cyan('\n📊 OpenRouter Credits Status:'))
    console.log(chalk.cyan('━'.repeat(50)))
    console.log(
      `Account Type: ${chalk.blue(is_free_tier ? 'Free Tier' : 'Paid')}`,
    )
    console.log(
      `Rate Limit: ${chalk.blue(
        `${rate_limit.requests}/${rate_limit.interval}`,
      )}`,
    )
    console.log(
      `Usage: ${chalk.yellow(usage.toFixed(2))} / ${chalk.yellow(
        limit,
      )} (${usagePercent.toFixed(1)}%)`,
    )
    console.log(
      `Credits Remaining: ${
        limit_remaining > 10
          ? chalk.green(limit_remaining.toFixed(2))
          : chalk.yellow(limit_remaining.toFixed(2))
      }`,
    )
    console.log(`${creditBar} ${usagePercent.toFixed(1)}%`)
    console.log(chalk.cyan('━'.repeat(50)))

    return true
  } catch (error) {
    console.error(chalk.red('\n❌ Error checking credits:'))
    if (error.response) {
      console.error(`Status: ${error.response.status}`)
      console.error('Data:', error.response.data)
    } else if (error.request) {
      console.error('No response received from API')
    } else {
      console.error(`Error: ${error.message}`)
    }
    return false
  }
}

async function runTests() {
  // Check credits first
  const hasCredits = await checkCredits()
  if (!hasCredits) {
    console.error(chalk.red('\n❌ Credit check failed - stopping tests'))
    return
  }

  // If location flag is set, only run location tests
  if (options.location) {
    console.log(chalk.cyan('\n🌍 Running Location Extraction Tests'))
    console.log(chalk.cyan('━'.repeat(50)))

    for (const content of LOCATION_TEST_CASES) {
      console.log('\n' + '='.repeat(50))
      console.log(chalk.blue('📝 Test Content:'))
      console.log(content)

      try {
        console.time('Location Extraction')
        const location = await extractLocation(content)
        console.timeEnd('Location Extraction')

        if (location.location || location.otherLocations.length > 0) {
          console.log(chalk.green('\n✅ Locations Found:'))
          if (location.location) {
            console.log(chalk.cyan('\nPrimary Location:'))
            console.log(`Name: ${location.location}`)
            console.log(
              `Coordinates: ${location.latitude}, ${location.longitude}`,
            )
          }

          if (location.otherLocations.length > 0) {
            console.log(chalk.cyan('\nOther Locations:'))
            location.otherLocations.forEach((loc) => {
              console.log(
                `- ${loc.location} (${loc.latitude}, ${loc.longitude})`,
              )
            })
          }
        } else {
          console.log(chalk.yellow('\n⚠️ No locations found'))
        }
      } catch (error) {
        console.error(chalk.red('\n❌ Error in location extraction:'), error)
      }
    }

    // Log final token usage
    const usage = getTokenUsage()
    console.log(chalk.cyan('\n📊 Token Usage Stats:'))
    console.log(chalk.cyan('━'.repeat(50)))
    console.log(`Total Tokens Used: ${chalk.yellow(usage.total)}`)
    return
  }

  // Test each content piece
  for (const content of TEST_CONTENT) {
    console.log('\n' + '='.repeat(50))
    console.log('Testing content:', content.substring(0, 100) + '...')

    // Test with free models if requested
    if (options.free) {
      console.log('\n[TESTING FREE MODELS]')
      const freeModels = getFallbackModels()
      console.log('Available free models:', freeModels)

      for (const freeModel of freeModels.slice(0, 2)) {
        console.log(`\n🆓 Testing ${freeModel}:`)
        try {
          console.time(`Free Model ${freeModel}`)
          const freeResult = await completion({
            messages: [
              {
                role: 'system',
                content: 'Create a structured summary with key facts as bullet points. Include fact extraction.',
              },
              {
                role: 'user',
                content: `Summarize this content and extract key facts:\n\n${content}`,
              },
            ],
            model: freeModel,
            maxTokens: 400,
            temperature: 0.3,
          })
          console.timeEnd(`Free Model ${freeModel}`)

          if (freeResult) {
            console.log(chalk.green('✓ Free model result:'), freeResult.substring(0, 200) + '...')

            // Check for structured elements
            const hasMarkdown = freeResult.includes('**') || freeResult.includes('##')
            const hasBullets = freeResult.includes('- ') || freeResult.includes('• ')
            console.log(chalk.blue('  Has formatting:'), hasMarkdown, '| Has bullets:', hasBullets)
          } else {
            console.log(chalk.red('❌ Free model returned null'))
          }
        } catch (error) {
          console.error(chalk.red(`❌ Free model ${freeModel} failed:`), error.message)
        }
      }
    }

    // Test summarization
    console.log('\n[TESTING SUMMARIZATION]')
    try {
      console.time('Summary Generation')
      const summary = await summarizeContent(content, {
        temperature: 0.3,
        maxTokens: 500,
      })
      console.timeEnd('Summary Generation')
      console.log(chalk.green('✓ Summary:'), summary)

      if (summary) {
        console.time('Tag Generation')
        const tags = await metaSummaryToTags(summary, {})
        console.timeEnd('Tag Generation')
        console.log(chalk.green('✓ Tags:'), tags)
      }
    } catch (error) {
      console.error(chalk.red('❌ Error in summarization:'), error)
    }

    // Test location extraction
    console.log('\n[TESTING LOCATION]')
    try {
      console.time('Location Extraction')
      const location = await extractLocation(content)
      console.timeEnd('Location Extraction')
      console.log(chalk.green('✓ Location:'), location)
    } catch (error) {
      console.error(chalk.red('❌ Error in location extraction:'), error)
    }

    // Test relationship extraction
    console.log('\n[TESTING RELATIONSHIPS]')
    try {
      console.time('Relationship Extraction')
      const relationships = await extractRelationships(content)
      console.timeEnd('Relationship Extraction')
      console.log(chalk.green('✓ Relationships:'), relationships)
    } catch (error) {
      console.error(chalk.red('❌ Error in relationship extraction:'), error)
    }
  }

  // Log final token usage stats
  const usage = getTokenUsage()
  console.log(chalk.cyan('\n📊 Final Token Usage Stats:'))
  console.log(chalk.cyan('━'.repeat(50)))
  console.log(`Total Tokens Used: ${chalk.yellow(usage.total)}`)
  console.log('\nBy Model:')
  Object.entries(usage.byModel).forEach(([model, tokens]) => {
    console.log(`${chalk.blue(model)}: ${chalk.yellow(tokens)}`)
  })
  console.log('\nBy Endpoint:')
  Object.entries(usage.byEndpoint).forEach(([endpoint, tokens]) => {
    console.log(`${chalk.blue(endpoint)}: ${chalk.yellow(tokens)}`)
  })
  console.log(chalk.cyan('━'.repeat(50)))
}

// Run tests with error handling
runTests().catch((error) => {
  console.error(chalk.red('\n❌ Fatal error:'), error)
  process.exit(1)
})
