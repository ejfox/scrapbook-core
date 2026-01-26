import { Octokit } from '@octokit/rest'
import dotenv from 'dotenv'
import { subDays } from 'date-fns'
import { generateScrapId } from '../helpers.js'
import { createClient } from '@supabase/supabase-js'
import winston from 'winston'
import { INSTANCE_NAME } from '../helpers/instanceName.mjs'
import { generateScreenshot } from './generateScreenshot.mjs'

dotenv.config()

const username = process.env.GITHUB_USERNAME || 'ejfox'
const token = process.env.GITHUB_TOKEN

if (!token) {
  console.error('GITHUB_TOKEN is not set in environment variables')
  process.exit(1)
}

const octokit = new Octokit({
  auth: token,
  userAgent: `${username}-scrapbook`,
  previews: ['mercy-preview'],
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' },
  },
)

// Improve logger setup
const logger = winston.createLogger({
  level: process.env.DEBUG === 'true' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
})

// Setup logging helpers
function logMetric(name, data = {}) {
  logger.info(name, {
    type: 'metric',
    metric: name,
    source: 'github',
    ...data,
  })
}

function logStatus(level, message, data = {}) {
  logger.log(level, message, {
    type: 'status',
    source: 'github',
    ...data,
  })
}

function logError(message, error, context = {}) {
  logger.error(message, {
    type: 'error',
    source: 'github',
    error: error.message,
    stack: error.stack,
    ...context,
  })
}

// Process different GitHub item types
export async function processGithubItem(item, type) {
  if (!item || !item.id) {
    logError('Invalid GitHub item', new Error('Invalid item'), { type })
    return null
  }

  const startTime = Date.now()
  const scrapId = `github-${item.id}`

  try {
    // Try to claim the item first
    const { data: claim } = await supabase
      .from('scraps')
      .update({
        processing_instance_id: INSTANCE_NAME,
        processing_started_at: new Date().toISOString(),
      })
      .eq('scrap_id', scrapId)
      .is('processing_instance_id', null)
      .select()
      .single()

    if (!claim) {
      logStatus('info', 'Item already being processed', {
        item_id: item.id,
        type,
      })
      return null
    }

    try {
      // Get best available URL
      const url = item.html_url || item.url

      // Get best available content
      const content = (() => {
        switch (type) {
        case 'repo':
          return item.description || 'No description'
        case 'pr':
        case 'issue':
          return item.body || 'No content'
        case 'gist':
          return item.description || 'No description'
        case 'release':
          return item.body || 'No content'
        case 'starred':
          return item.description || 'No description'
        default:
          return 'No content'
        }
      })()

      // Combine all possible tags
      const tags = [
        ...(item.topics || []),
        item.language?.toLowerCase(),
        type,
        ...(type === 'pr' || type === 'issue' ? [item.state] : []),
        ...(type === 'repo' || type === 'gist'
          ? [item.private ? 'private' : 'public']
          : []),
        ...(type === 'repo' && item.fork ? ['fork'] : []),
      ].filter(Boolean)

      // Generate screenshot if URL is available
      let screenshot_url = null
      if (url) {
        try {
          const result = await generateScreenshot(url, scrapId)
          screenshot_url = result?.url || null
        } catch (error) {
          logger.warn(`Failed to generate screenshot for ${url}:`, error)
        }
      }

      const processed = {
        scrap_id: scrapId,
        source: 'github',
        type,
        url,
        title: item.title || item.name || 'Untitled',
        content,
        screenshot_url,
        published_at: item.created_at,
        created_at: item.created_at,
        updated_at: item.updated_at,
        shared: false,
        tags: [...new Set(tags)],
        metadata: {
          topics: item.topics || [],
          language: item.language,
          ...(type === 'repo' && {
            stargazers_count: item.stargazers_count,
            forks_count: item.forks_count,
            is_fork: item.fork,
            default_branch: item.default_branch,
            homepage: item.homepage,
          }),
          ...(type === 'pr' && {
            comments: item.comments,
            labels: item.labels?.map((l) => l.name),
            changed_files: item.changedFiles,
            repo: {
              name: item.repo?.name,
              full_name: item.repo?.full_name,
            },
          }),
          ...(type === 'issue' && {
            comments: item.comments,
            labels: item.labels?.map((l) => l.name),
            repo: {
              name: item.repo?.name,
              full_name: item.repo?.full_name,
            },
          }),
          ...(type === 'gist' && {
            files: Object.keys(item.files || {}),
            public: item.public,
          }),
          ...(type === 'starred' && {
            starred_at: item.starred_at,
            language: item.language,
            stargazers_count: item.stargazers_count,
            forks_count: item.forks_count,
          }),
        },
      }

      const duration = Date.now() - startTime
      logMetric('item_processed', {
        item_id: item.id,
        type,
        duration_ms: duration,
        has_content: !!content,
        tags_count: tags.length,
        topics_count: item.topics?.length || 0,
        ...(type === 'repo' && {
          stars: item.stargazers_count,
          forks: item.forks_count,
          is_fork: item.fork,
        }),
        ...(type === 'pr' && {
          comments: item.comments,
          changed_files: item.changedFiles,
        }),
        ...(type === 'issue' && {
          comments: item.comments,
          labels: item.labels?.length,
        }),
      })

      return processed
    } finally {
      await supabase
        .from('scraps')
        .update({
          processing_instance_id: null,
          processing_started_at: null,
        })
        .eq('scrap_id', scrapId)
    }
  } catch (error) {
    logError('Item processing failed', error, {
      item_id: item.id,
      type,
      duration_ms: Date.now() - startTime,
    })

    await supabase
      .from('scraps')
      .update({
        processing_instance_id: null,
        processing_started_at: null,
      })
      .eq('scrap_id', scrapId)
    return null
  }
}

export const fetchGithubData = async (testMode = false) => {
  const startTime = Date.now()
  logStatus('info', 'Starting GitHub data sync', { test_mode: testMode })

  const sinceDate = subDays(new Date(), testMode ? 7 : 60).toISOString()

  try {
    // Fetch all data types
    const fetchStartTime = Date.now()
    const [
      userGists,
      userRepos,
      userReleases,
      userPRs,
      starredRepos,
      userIssues,
    ] = await Promise.all([
      octokit.gists.listForUser({ username }),
      octokit.repos.listForUser({
        username,
        type: 'owner',
        sort: 'updated',
        direction: 'desc',
        per_page: testMode ? 5 : 25,
        since: sinceDate,
      }),
      octokit.search.issuesAndPullRequests({
        q: `author:${username} is:public type:release updated:>${sinceDate}`,
      }),
      octokit.search.issuesAndPullRequests({
        q: `author:${username} is:public type:pr updated:>${sinceDate}`,
      }),
      octokit.activity.listReposStarredByUser({
        username,
        per_page: testMode ? 5 : 100,
        sort: 'created',
        direction: 'desc',
        since: sinceDate,
      }),
      octokit.search.issuesAndPullRequests({
        q: `author:${username} is:public updated:>${sinceDate}`,
      }),
    ])

    logMetric('github_api_fetch', {
      duration_ms: Date.now() - fetchStartTime,
      gists_count: userGists.data.length,
      repos_count: userRepos.data.length,
      releases_count: userReleases.data.items.length,
      prs_count: userPRs.data.items.length,
      starred_count: starredRepos.data.length,
      issues_count: userIssues.data.items.length,
    })

    // Process each type
    const processStartTime = Date.now()
    const processed = {
      userGists: await Promise.all(
        userGists.data.map((g) => processGithubItem(g, 'gist')),
      ),
      userRepos: await Promise.all(
        userRepos.data.map((r) => processGithubItem(r, 'repo')),
      ),
      userReleases: await Promise.all(
        userReleases.data.items.map((r) => processGithubItem(r, 'release')),
      ),
      userPRs: await Promise.all(
        userPRs.data.items.map((p) => processGithubItem(p, 'pr')),
      ),
      starredRepos: await Promise.all(
        starredRepos.data.map((s) => processGithubItem(s, 'starred')),
      ),
      userIssues: await Promise.all(
        userIssues.data.items.map((i) => processGithubItem(i, 'issue')),
      ),
    }

    const totalDuration = Date.now() - startTime
    logMetric('github_sync_completed', {
      total_duration_ms: totalDuration,
      fetch_duration_ms: Date.now() - fetchStartTime,
      process_duration_ms: Date.now() - processStartTime,
      processed_counts: {
        gists: processed.userGists.filter(Boolean).length,
        repos: processed.userRepos.filter(Boolean).length,
        releases: processed.userReleases.filter(Boolean).length,
        prs: processed.userPRs.filter(Boolean).length,
        starred: processed.starredRepos.filter(Boolean).length,
        issues: processed.userIssues.filter(Boolean).length,
      },
      test_mode: testMode,
    })

    return processed
  } catch (error) {
    logError('GitHub sync failed', error, {
      duration_ms: Date.now() - startTime,
      test_mode: testMode,
    })

    return {
      userGists: [],
      userRepos: [],
      userIssues: [],
      userReleases: [],
      userPRs: [],
      starredRepos: [],
    }
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchGithubData()
    .then((data) => {
      console.log('GitHub data fetched successfully')
      console.log(`Repos: ${data.userRepos.length}`)
      console.log(`PRs: ${data.userPRs.length}`)
      console.log(`Issues: ${data.userIssues.length}`)
      console.log(`Gists: ${data.userGists.length}`)
      console.log(`Releases: ${data.userReleases.length}`)
      console.log(`Starred Repos: ${data.starredRepos.length}`)
    })
    .catch((error) => {
      console.error('Error in main execution:', error)
      process.exit(1)
    })
}
