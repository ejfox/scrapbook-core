# Standalone Usage Guide - @scrapbook/financial-analysis

This guide shows you how to use the financial-analysis package to extract financial entities and analyze sentiment from text.

## ⚠️ Current Status

This package is currently a **placeholder** that re-exports from scrapbook-core. It requires the parent project to be installed. A fully standalone version is planned for a future release.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Tracked Assets](#tracked-assets)
- [Advanced Usage](#advanced-usage)
- [LLM Provider Setup](#llm-provider-setup)
- [Integration Patterns](#integration-patterns)
- [Future Standalone Version](#future-standalone-version)

## Quick Start

### 1. Install within Scrapbook-Core

Currently, this package must be used within the scrapbook-core monorepo:

```bash
cd scrapbook-core
npm install
```

### 2. Extract Financial Data

```javascript
import { extractFinancialAnalysis } from '@scrapbook/financial-analysis'

const content = `
  Apple stock (AAPL) surged 5% today after announcing record earnings.
  The iPhone maker beat expectations with strong growth in services revenue.
  Bitcoin (BTC) also rose 3% on positive regulatory news.
`

const analysis = await extractFinancialAnalysis(content, { llmProvider })

console.log(analysis)
// {
//   tracked_assets: [
//     {
//       ticker: "AAPL",
//       name: "Apple",
//       mentions: ["Apple", "AAPL"],
//       context: "surged 5% after record earnings",
//       sentiment_score: 0.8,
//       sentiment_reasoning: "Strong positive earnings beat",
//       is_tracked: true
//     }
//   ],
//   discovered_assets: [...],
//   overall_market_sentiment: 0.7,
//   market_reasoning: "Generally positive with strong earnings"
// }
```

## Installation

### Current (Monorepo Only)

```bash
cd scrapbook-core
npm install
```

### Future (Standalone - Coming Soon)

```bash
npm install @scrapbook/financial-analysis
```

## Basic Usage

### Extract Financial Assets

```javascript
import { extractFinancialAnalysis } from '@scrapbook/financial-analysis'

const article = `
  Tesla shares jumped 8% after Elon Musk announced new production targets.
  The EV maker plans to increase output at its Texas gigafactory.
`

const analysis = await extractFinancialAnalysis(article, { llmProvider })

console.log(analysis.tracked_assets)
// [
//   {
//     ticker: "TSLA",
//     name: "Tesla",
//     sentiment_score: 0.7,
//     sentiment_reasoning: "Positive production news",
//     ...
//   }
// ]
```

### Check if Asset is Tracked

```javascript
import { isTrackedAsset } from '@scrapbook/financial-analysis'

console.log(isTrackedAsset('AAPL'))   // true
console.log(isTrackedAsset('TSLA'))   // true
console.log(isTrackedAsset('UNKNOWN')) // false
```

### Get All Tracked Assets

```javascript
import { getTrackedAssets } from '@scrapbook/financial-analysis'

const assets = getTrackedAssets()
console.log(assets)
// {
//   'AAPL': 'Apple',
//   'MSFT': 'Microsoft',
//   'GOOGL': 'Alphabet',
//   ...
// }
```

## Tracked Assets

The package tracks 40+ major assets across multiple categories:

### Stocks (Big Tech)
- **AAPL**: Apple
- **MSFT**: Microsoft
- **GOOGL**: Alphabet (Google)
- **AMZN**: Amazon
- **NVDA**: Nvidia
- **META**: Meta (Facebook)
- **TSLA**: Tesla
- **NFLX**: Netflix

### Indexes
- **^GSPC**: S&P 500
- **^DJI**: Dow Jones Industrial Average
- **^IXIC**: Nasdaq Composite
- **^RUT**: Russell 2000

### ETFs
- **SPY**: S&P 500 ETF
- **QQQ**: Nasdaq 100 ETF
- **VTI**: Total Stock Market ETF
- **IWM**: Russell 2000 ETF

### Cryptocurrency
- **BTC-USD**: Bitcoin
- **ETH-USD**: Ethereum
- **SOL-USD**: Solana

### Commodities
- **GC=F**: Gold
- **CL=F**: Crude Oil
- **SI=F**: Silver

### Forex
- **JPY=X**: USD/JPY
- **EUR=X**: EUR/USD

## Advanced Usage

### Sentiment Analysis

The package analyzes sentiment on a scale from -1 (very negative) to +1 (very positive):

```javascript
const analysis = await extractFinancialAnalysis(content, { llmProvider })

for (const asset of analysis.tracked_assets) {
  console.log(`${asset.ticker}: ${asset.sentiment_score}`)
  console.log(`  Reason: ${asset.sentiment_reasoning}`)
  
  if (asset.sentiment_score > 0.5) {
    console.log('  → Bullish')
  } else if (asset.sentiment_score < -0.5) {
    console.log('  → Bearish')
  } else {
    console.log('  → Neutral')
  }
}
```

### Discovered Assets

The package also identifies assets not in the tracking list:

```javascript
const analysis = await extractFinancialAnalysis(content, { llmProvider })

console.log(analysis.discovered_assets)
// [
//   {
//     ticker: "NVDA",
//     name: "Nvidia",
//     sentiment_score: 0.6,
//     asset_type: "stock",
//     is_tracked: false
//   }
// ]
```

Asset types detected:
- `stock`
- `crypto`
- `etf`
- `commodity`
- `forex`
- `index`

### Overall Market Analysis

```javascript
const analysis = await extractFinancialAnalysis(content, { llmProvider })

console.log(`Market Sentiment: ${analysis.overall_market_sentiment}`)
console.log(`Analysis: ${analysis.market_reasoning}`)
```

### With URL Context

```javascript
const analysis = await extractFinancialAnalysis(content, {
  llmProvider,
  url: 'https://bloomberg.com/markets/article'
})
```

## LLM Provider Setup

### OpenAI

```javascript
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const llmProvider = {
  async completion({ messages, temperature, maxTokens, model }) {
    const response = await openai.chat.completions.create({
      model: model || 'gpt-4',
      messages,
      temperature,
      max_tokens: maxTokens
    })
    return response.choices[0].message.content
  }
}
```

### Anthropic Claude

```javascript
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const llmProvider = {
  async completion({ messages, temperature, maxTokens, model }) {
    const response = await anthropic.messages.create({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: maxTokens,
      temperature,
      messages
    })
    return response.content[0].text
  }
}
```

## Integration Patterns

### News Aggregator

```javascript
import { extractFinancialAnalysis } from '@scrapbook/financial-analysis'

async function analyzeFinancialNews(articles) {
  const analyses = []
  
  for (const article of articles) {
    const analysis = await extractFinancialAnalysis(article.content, {
      llmProvider,
      url: article.url
    })
    
    analyses.push({
      title: article.title,
      url: article.url,
      assets: analysis.tracked_assets,
      sentiment: analysis.overall_market_sentiment
    })
  }
  
  return analyses
}
```

### Trading Alert System

```javascript
import { extractFinancialAnalysis } from '@scrapbook/financial-analysis'

async function monitorMarketSentiment(articles, threshold = 0.7) {
  const alerts = []
  
  for (const article of articles) {
    const analysis = await extractFinancialAnalysis(article.content, {
      llmProvider
    })
    
    for (const asset of analysis.tracked_assets) {
      if (Math.abs(asset.sentiment_score) >= threshold) {
        alerts.push({
          ticker: asset.ticker,
          sentiment: asset.sentiment_score,
          reasoning: asset.sentiment_reasoning,
          source: article.url
        })
      }
    }
  }
  
  return alerts
}
```

### Portfolio Tracker

```javascript
import { extractFinancialAnalysis, getTrackedAssets } from '@scrapbook/financial-analysis'

class PortfolioMonitor {
  constructor(portfolio) {
    this.portfolio = portfolio // ['AAPL', 'MSFT', 'TSLA']
  }
  
  async analyzeNews(articles) {
    const relevantNews = []
    
    for (const article of articles) {
      const analysis = await extractFinancialAnalysis(article.content, {
        llmProvider
      })
      
      const portfolioMentions = analysis.tracked_assets.filter(asset =>
        this.portfolio.includes(asset.ticker)
      )
      
      if (portfolioMentions.length > 0) {
        relevantNews.push({
          article: article.title,
          assets: portfolioMentions,
          sentiment: analysis.overall_market_sentiment
        })
      }
    }
    
    return relevantNews
  }
}
```

### Sentiment Dashboard

```javascript
import { extractFinancialAnalysis } from '@scrapbook/financial-analysis'

async function createSentimentDashboard(articles) {
  const sentimentMap = new Map()
  
  for (const article of articles) {
    const analysis = await extractFinancialAnalysis(article.content, {
      llmProvider
    })
    
    for (const asset of analysis.tracked_assets) {
      if (!sentimentMap.has(asset.ticker)) {
        sentimentMap.set(asset.ticker, {
          ticker: asset.ticker,
          name: asset.name,
          mentions: 0,
          avgSentiment: 0,
          sentiments: []
        })
      }
      
      const data = sentimentMap.get(asset.ticker)
      data.mentions++
      data.sentiments.push(asset.sentiment_score)
      data.avgSentiment = data.sentiments.reduce((a, b) => a + b, 0) / data.sentiments.length
    }
  }
  
  return Array.from(sentimentMap.values())
    .sort((a, b) => b.mentions - a.mentions)
}
```

### RSS Feed Monitor

```javascript
import Parser from 'rss-parser'
import { extractFinancialAnalysis } from '@scrapbook/financial-analysis'

const parser = new Parser()

async function monitorFinancialFeeds(feedUrls) {
  const allAnalyses = []
  
  for (const feedUrl of feedUrls) {
    const feed = await parser.parseURL(feedUrl)
    
    for (const item of feed.items) {
      const analysis = await extractFinancialAnalysis(item.content, {
        llmProvider,
        url: item.link
      })
      
      allAnalyses.push({
        title: item.title,
        published: item.pubDate,
        analysis
      })
    }
  }
  
  return allAnalyses
}
```

## Future Standalone Version

The planned standalone version will:

### Features

- ✅ Work independently without scrapbook-core
- ✅ Minimal dependencies
- ✅ Customizable asset tracking list
- ✅ Real-time price data integration (optional)
- ✅ Historical sentiment tracking
- ✅ Webhook support for alerts

### Installation (Future)

```bash
npm install @scrapbook/financial-analysis
```

### Usage (Future)

```javascript
import { extractFinancialAnalysis, configureAssets } from '@scrapbook/financial-analysis'

// Customize tracked assets
configureAssets({
  stocks: ['AAPL', 'MSFT', 'GOOGL'],
  crypto: ['BTC-USD', 'ETH-USD'],
  commodities: ['GC=F']
})

const analysis = await extractFinancialAnalysis(content, { llmProvider })
```

## API Reference

### `extractFinancialAnalysis(content, options)`

Extract financial assets and analyze sentiment.

**Parameters:**
- `content` (string): Text content to analyze
- `options` (object):
  - `llmProvider` (object, required): LLM provider with completion method
  - `url` (string, optional): Source URL for context

**Returns:** Promise<Object>

```javascript
{
  tracked_assets: Array<{
    ticker: string,
    name: string,
    mentions: string[],
    context: string,
    sentiment_score: number,  // -1 to 1
    sentiment_reasoning: string,
    is_tracked: boolean
  }>,
  discovered_assets: Array<{
    ticker: string,
    name: string,
    sentiment_score: number,
    asset_type: string,
    is_tracked: boolean
  }>,
  overall_market_sentiment: number,  // -1 to 1
  market_reasoning: string,
  analysis_timestamp: string
}
```

### `getTrackedAssets()`

Get all tracked assets.

**Returns:** Object<string, string>

### `isTrackedAsset(ticker)`

Check if ticker is tracked.

**Parameters:**
- `ticker` (string): Ticker symbol

**Returns:** boolean

## Environment Variables

```bash
# Required for LLM-based extraction
OPENROUTER_API_KEY=your_openrouter_key
# or
OPENAI_API_KEY=your_openai_key

# Optional
DEBUG=true  # Enable debug logging
```

## Troubleshooting

### Common Issues

**1. No assets detected**

- Content may not mention any financial assets
- Try content with explicit ticker symbols
- Ensure LLM provider is working correctly

**2. Incorrect sentiment**

- Sentiment analysis is subjective
- Try adjusting LLM temperature (lower = more consistent)
- Provide more context in the content

**3. Missing ticker symbols**

- Some assets may not be in the tracking list
- Check `discovered_assets` for untracked mentions
- Use `getTrackedAssets()` to see full list

### Debug Mode

```bash
DEBUG=true node your-script.js
```

## Current Limitations

As a placeholder package, current limitations include:

1. Requires scrapbook-core to be installed
2. Not available as standalone npm package yet
3. Fixed list of 40+ tracked assets
4. No custom asset configuration yet
5. No real-time price data integration

These will be addressed in the standalone version.

## Support

- **Issues**: https://github.com/ejfox/scrapbook-core/issues
- **Discussions**: https://github.com/ejfox/scrapbook-core/discussions
- **Full Implementation**: `../../scripts/aiFinancialAnalysis.mjs`
