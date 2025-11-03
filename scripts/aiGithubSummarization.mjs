import { completion, MODELS, PROMPTS, loadCoreTags } from './llmService.mjs'
import Bottleneck from 'bottleneck'

const DEBUG = process.env.DEBUG === 'true'
function log(...args) {
  if (DEBUG) console.log(...args)
}

// Rate limiting
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
})

// GitHub-specific prompts
const GITHUB_PROMPTS = {
  SUMMARIZE: `You are analyzing GitHub activity. Create a clear, concise summary that:
- Focuses on the technical purpose and significance
- Highlights key technologies and features
- Includes stats like stars, forks, etc.
- Avoids markdown formatting
- Is brief but informative
Keep it casual and direct - no need for formal sections or headers.`,

  TAGS: async (content) => {
    const coreTags = await loadCoreTags()
    return `You are tagging GitHub activity. Choose 2-4 most relevant tags from this list:
${coreTags.join('\n')}

Content to tag:
${content}

Return only valid tags from the list above, one per line, no explanations.`
  },
}

export async function summarizeGitHubActivity(activity, options = {}) {
  if (!activity) {
    log('❌ No activity to summarize')
    return null
  }

  try {
    log('🔍 Formatting GitHub activity for summary...')
    const content = formatGitHubActivityForSummary(activity)

    if (!content) {
      log('❌ No content after formatting')
      return null
    }

    log(`📝 Content prepared (${content.length} chars)`)
    log(content.substring(0, 100) + '...')

    const summary = await limiter.schedule(() =>
      summarizeGitHubString(content),
    )

    if (options.metaSummary) {
      log('📊 Generating meta summary...')
      return await limiter.schedule(() =>
        summarizeGitHubString(summary, { meta: true }),
      )
    }

    return summary

  } catch (error) {
    console.error('❌ Error in summarizeGitHubActivity:', error)
    return null
  }
}

function formatGitHubActivityForSummary(activity) {
  try {
    let formattedContent = ''
    formattedContent += `Type: ${activity.type}\n`
    formattedContent += `Name: ${activity.name}\n`
    formattedContent += `Description: ${activity.description || 'No description'}\n`
    formattedContent += `Language: ${activity.language || 'Not specified'}\n`
    formattedContent += `Stars: ${activity.stargazers_count || 0}\n`
    formattedContent += `Topics: ${activity.topics?.join(', ') || 'None'}\n`
    formattedContent += `Author: ${activity.user?.login || 'Unknown'}\n`
    formattedContent += `Created: ${activity.created_at}\n`
    formattedContent += `Updated: ${activity.updated_at}\n`

    return formattedContent
  } catch (error) {
    log(`Error formatting activity: ${error.message}`)
    return null
  }
}

async function summarizeGitHubString(content, options = {}) {
  const messages = [
    {
      role: 'system',
      content: GITHUB_PROMPTS.SUMMARIZE,
    },
    {
      role: 'user',
      content: `${content}\nProvide a concise summary of this GitHub activity.`,
    },
  ]

  return await completion({
    messages,
    model: MODELS.SUMMARIZE,
    temperature: 0.3,
    max_tokens: options.meta ? 100 : 500,
  })
}

export async function gitHubSummaryToTags(summary) {
  if (!summary) {
    log('❌ No summary to tag')
    return []
  }

  try {
    const messages = [
      {
        role: 'system',
        content: await GITHUB_PROMPTS.TAGS(summary),
      },
      { role: 'user', content: summary },
    ]

    const response = await completion({
      messages,
      model: MODELS.GENERATE_TAGS,
      temperature: 0.2,
      max_tokens: 100,
    })

    return response
      .split('\n')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)

  } catch (error) {
    console.error('❌ Error generating tags:', error)
    return []
  }
}

// CLI testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const testActivity = {
    type: 'repository',
    name: 'scrapbook-core',
    description: 'A Vue.js powered personal knowledge management system',
    language: 'JavaScript',
    stargazers_count: 42,
    user: { login: 'ejfox' },
    topics: ['vue', 'knowledge-management', 'digital-garden'],
  }

  console.log('🧪 Testing GitHub summarization...')
  summarizeGitHubActivity(testActivity)
    .then(async summary => {
      console.log('\n📝 Summary:')
      console.log(summary)

      console.log('\n🏷️ Generating tags...')
      const tags = await gitHubSummaryToTags(summary)
      console.log('Tags:', tags)
    })
    .catch(console.error)
}
