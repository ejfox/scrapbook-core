#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { extractFinancialAnalysis } from './aiFinancialAnalysis.mjs'
import chalk from 'chalk'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

async function findAndTestFinancialBookmarks() {
  console.log(chalk.blue.bold('🔍 Finding Financial Bookmarks for Testing\n'))

  // Query recent Pinboard bookmarks with content
  const { data, error } = await supabase
    .from('scraps')
    .select('scrap_id, title, content, summary, url, published_at, metadata')
    .eq('source', 'pinboard')
    .or('content.neq., summary.neq.')  // Has either content or summary
    .order('published_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('Error querying database:', error)
    return
  }

  console.log(chalk.cyan(`📊 Searched ${data.length} recent Pinboard bookmarks`))

  // Look for financially relevant content
  const financialKeywords = [
    'stock', 'market', 'trading', 'crypto', 'bitcoin', 'ethereum', 'price', 'earnings', 'revenue',
    'shares', 'investment', 'fund', 'portfolio', 'nasdaq', 'sp500', 's&p', 'dow', 'fed', 'rates',
    'apple', 'microsoft', 'amazon', 'google', 'meta', 'tesla', 'nvidia', 'openai', 'ai bubble',
    'venture capital', 'ipo', 'acquisition', 'merger', 'valuation', 'startup', 'fintech',
    'inflation', 'recession', 'gdp', 'unemployment', 'monetary policy', 'fiscal',
  ]

  const relevant = data.filter(item => {
    const text = (item.title + ' ' + (item.content || '') + ' ' + (item.summary || '')).toLowerCase()
    return financialKeywords.some(keyword => text.includes(keyword))
  }).slice(0, 15)

  console.log(chalk.green(`✅ Found ${relevant.length} potentially financial bookmarks\n`))

  if (relevant.length === 0) {
    console.log(chalk.yellow('No financial content found in recent bookmarks'))
    return
  }

  // Test financial analysis on each relevant bookmark
  for (let i = 0; i < Math.min(relevant.length, 5); i++) {
    const bookmark = relevant[i]
    console.log(chalk.blue(`\n🧪 Testing Bookmark ${i + 1}:`))
    console.log(chalk.gray(`Title: ${bookmark.title?.substring(0, 80) || 'No title'}...`))
    console.log(chalk.gray(`URL: ${bookmark.url}`))
    console.log(chalk.gray(`Published: ${bookmark.published_at}`))
    console.log(chalk.gray(`Content preview: ${(bookmark.content || 'No content').substring(0, 150)}...\n`))

    try {
      const startTime = Date.now()
      // Use the richest content available
      const contentToAnalyze = [
        bookmark.content,
        bookmark.summary,
        bookmark.title,
      ].filter(Boolean).join('\n\n')

      const analysis = await extractFinancialAnalysis(contentToAnalyze, {
        url: bookmark.url,
      })
      const duration = Date.now() - startTime

      console.log(chalk.green(`⏱️  Analysis completed in ${duration}ms`))

      if (analysis.assets?.length > 0) {
        const trackedCount = analysis.tracked_assets?.length || 0
        const discoveredCount = analysis.discovered_assets?.length || 0

        console.log(chalk.cyan(`📈 Found ${analysis.assets.length} financial assets (${trackedCount} tracked, ${discoveredCount} discovered):`))

        // Show tracked assets
        if (trackedCount > 0) {
          console.log(chalk.blue('\n  📊 Tracked Assets:'))
          analysis.tracked_assets.forEach(asset => {
            const sentimentEmoji = asset.sentiment_score > 0.1 ? '📈' :
              asset.sentiment_score < -0.1 ? '📉' : '➡️'
            const sentimentColor = asset.sentiment_score > 0.1 ? chalk.green :
              asset.sentiment_score < -0.1 ? chalk.red : chalk.yellow

            console.log(`    ${sentimentEmoji} ${chalk.bold(asset.ticker)} (${asset.name})`)
            console.log(`      Sentiment: ${sentimentColor(asset.sentiment_score.toFixed(2))} - ${asset.sentiment_reasoning || 'N/A'}`)
          })
        }

        // Show discovered assets
        if (discoveredCount > 0) {
          console.log(chalk.magenta('\n  🔍 Discovered Assets:'))
          analysis.discovered_assets.forEach(asset => {
            const sentimentEmoji = asset.sentiment_score > 0.1 ? '📈' :
              asset.sentiment_score < -0.1 ? '📉' : '➡️'
            const sentimentColor = asset.sentiment_score > 0.1 ? chalk.green :
              asset.sentiment_score < -0.1 ? chalk.red : chalk.yellow
            const typeEmoji = asset.asset_type === 'crypto' ? '₿' :
              asset.asset_type === 'etf' ? '📈' :
                asset.asset_type === 'commodity' ? '🏗️' : '📊'

            console.log(`    ${typeEmoji} ${sentimentEmoji} ${chalk.bold(asset.ticker)} (${asset.name}) [${asset.asset_type}]`)
            console.log(`      Sentiment: ${sentimentColor(asset.sentiment_score.toFixed(2))} - ${asset.sentiment_reasoning || 'N/A'}`)
          })
        }

        if (analysis.overall_market_sentiment !== undefined) {
          const marketEmoji = analysis.overall_market_sentiment > 0.1 ? '🔥' :
            analysis.overall_market_sentiment < -0.1 ? '❄️' : '🤔'
          console.log(`\n  ${marketEmoji} Overall Market Sentiment: ${chalk.bold(analysis.overall_market_sentiment.toFixed(2))}`)
          console.log(`    ${chalk.gray(analysis.market_reasoning)}`)
        }
      } else {
        console.log(chalk.yellow('📭 No financial assets detected'))
      }

    } catch (error) {
      console.log(chalk.red(`❌ Analysis failed: ${error.message}`))
    }

    console.log(chalk.gray('─'.repeat(120)))
  }

  console.log(chalk.blue.bold('\n✨ Financial bookmark testing completed!'))

  if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.log(chalk.yellow('\nℹ️  Note: No API keys configured - using empty results'))
    console.log(chalk.yellow('   Set OPENAI_API_KEY or OPENROUTER_API_KEY for actual LLM analysis'))
  }
}

// Run the test
findAndTestFinancialBookmarks().catch(error => {
  console.error(chalk.red('Script failed:'), error)
  process.exit(1)
})
