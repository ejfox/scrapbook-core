# @scrapbook/financial-analysis

Extract financial assets and analyze sentiment from text content using AI. Track stocks, crypto, ETFs, commodities, and more.

## Features

- 💰 **Asset Detection**: Automatically identify financial assets in text
- 📊 **Sentiment Analysis**: Analyze sentiment (-1 to +1) for each asset
- 🎯 **40+ Tracked Assets**: Built-in list of major stocks, crypto, ETFs, commodities
- 🔍 **Discovery Mode**: Find new assets not in the tracking list
- 📈 **Market Analysis**: Overall market sentiment and reasoning

## Installation

```bash
npm install @scrapbook/financial-analysis
```

## Quick Start

```javascript
import { extractFinancialAnalysis, getTrackedAssets } from '@scrapbook/financial-analysis'

// Define your LLM provider
const llmProvider = {
  async completion({ messages, temperature, maxTokens }) {
    // Your LLM API call here
    return responseText
  }
}

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
//   discovered_assets: [
//     {
//       ticker: "BTC-USD",
//       name: "Bitcoin",
//       sentiment_score: 0.6,
//       asset_type: "crypto",
//       is_tracked: false
//     }
//   ],
//   overall_market_sentiment: 0.7,
//   market_reasoning: "Generally positive with strong earnings and crypto gains"
// }
```

## Tracked Assets

The package tracks 40+ major assets:

- **Stocks**: AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, NFLX
- **Indexes**: ^GSPC (S&P 500), ^DJI (Dow), ^IXIC (Nasdaq)
- **ETFs**: SPY, QQQ, VTI, IWM
- **Crypto**: BTC-USD, ETH-USD, SOL-USD
- **Commodities**: GC=F (Gold), CL=F (Oil), SI=F (Silver)
- **Forex**: JPY=X, EUR=X

## API

### `extractFinancialAnalysis(content, options)`

Extract financial assets and sentiment from text.

**Returns**: Object with `tracked_assets`, `discovered_assets`, `overall_market_sentiment`, and `market_reasoning`.

### `getTrackedAssets()`

Get the list of all tracked assets.

**Returns**: Object mapping ticker symbols to company names.

### `isTrackedAsset(ticker)`

Check if a ticker is in the tracking list.

**Returns**: Boolean.

## License

MIT

## Related Packages

- [@scrapbook/entity-extraction](../entity-extraction) - Extract entities and relationships
- [@scrapbook/content-summarization](../content-summarization) - AI-powered summarization
- [@scrapbook/content-geolocation](../content-geolocation) - Extract and geocode locations

## Note

This package is extracted from [scrapbook-core](https://github.com/ejfox/scrapbook-core). For the complete implementation, see the source repository.
