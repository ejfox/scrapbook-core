# Financial Analysis Module

## 📈 Overview

The Financial Analysis module is an AI-powered extension to the scrapbook enrichment pipeline that automatically detects financial assets (stocks, crypto, ETFs) mentioned in content and performs sentiment analysis on their potential market impact.

## 🎯 Features

### Asset Detection
- **Canonical Source**: Uses the exact 24 assets from `/Users/ejfox/code/finance-prism/src/utils/assets.js`
- **Multi-format recognition**: Detects both ticker symbols (AAPL) and company names (Apple) 
- **Context extraction**: Captures how each asset was mentioned
- **Symbol consistency**: Maintains exact symbol format (e.g., `^GSPC`, `BTC-USD`, `CL=F`)

### Sentiment Analysis
- **Numerical scores**: -1 (very negative) to +1 (very positive) impact prediction
- **Detailed reasoning**: LLM provides explanation for each sentiment score
- **Overall market sentiment**: Aggregate analysis across all detected assets

### Asset Categories Tracked (24 Total)
- **Major Indexes (4)**: ^GSPC, ^DJI, ^IXIC, ^RUT
- **Big Tech (8)**: AAPL, MSFT, AMZN, NVDA, GOOGL, META, TSLA, NFLX
- **ETFs (4)**: SPY, QQQ, IWM, VTI
- **Crypto (3)**: BTC-USD, ETH-USD, SOL-USD
- **Commodities (3)**: CL=F, GC=F, SI=F
- **Forex (2)**: JPY=X, EUR=X

## 📁 Files Structure

```
scripts/
├── aiFinancialAnalysis.mjs          # Core financial analysis module
├── test_financial_analysis.mjs      # Test suite for validation
└── index.mjs                        # Main pipeline (includes integration)
```

## 🔧 Integration

The financial analysis runs as **Step 4** in the enrichment pipeline:

1. **Text Embedding** (Nomic)
2. **Summary & Tags** (Claude/GPT)
3. **Relationships** (LLM Analysis)
4. **🆕 Financial Analysis** (Asset Detection + Sentiment)
5. **Location** (Geo Extraction)
6. **Image Processing** (Visual AI)

## 💾 Data Structure

Financial analysis results are stored in the `financial_analysis` field:

```json
{
  "financial_analysis": {
    "assets": [
      {
        "ticker": "AAPL",
        "name": "Apple Inc.",
        "mentions": ["Apple", "AAPL"],
        "context": "Apple reported strong quarterly earnings...",
        "sentiment_score": 0.7,
        "sentiment_reasoning": "Strong earnings beat suggests positive momentum"
      }
    ],
    "overall_market_sentiment": 0.2,
    "market_reasoning": "Mixed signals across tech sector",
    "analysis_timestamp": "2025-09-01T19:30:00.000Z"
  }
}
```

## 🎛️ Configuration

### Environment Variables
- `OPENROUTER_API_KEY` or `OPENAI_API_KEY`: Required for LLM analysis
- Fallback mode available when API keys not configured

### Customization
- **Asset source**: Canonical list sourced from `finance-prism/src/utils/assets.js`
- **Aliases**: Update `ASSET_ALIASES` for alternative names (Apple → AAPL, Bitcoin → BTC-USD)
- **Sentiment ranges**: Modify scoring logic as needed
- **Symbol formats**: Preserves exact finance-prism formats (^GSPC, BTC-USD, CL=F, etc.)

## 📊 Example Output

```bash
4️⃣  Analyzing financial content...
✅ Found 3 financial assets (avg sentiment: 0.23)
  • AAPL: 0.70
  • TSLA: -0.40
  • NVDA: 0.50
```

## 🧪 Testing

Run the test suite:
```bash
node scripts/test_financial_analysis.mjs
```

Test specific content:
```javascript
import { extractFinancialAnalysis } from "./scripts/aiFinancialAnalysis.mjs";

const result = await extractFinancialAnalysis(
  "Apple (AAPL) beats earnings while Tesla (TSLA) faces production issues"
);
```

## 🔍 Utility Functions

```javascript
import { getTrackedAssets, isTrackedAsset } from "./scripts/aiFinancialAnalysis.mjs";

// Get all tracked assets
const assets = getTrackedAssets(); // Returns {ticker: name} mapping

// Check if ticker is tracked
const isTracked = isTrackedAsset("AAPL"); // Returns true/false
```

## 🚀 Next Steps

Potential enhancements:
1. **Real-time price integration**: Fetch current prices for detected assets
2. **Historical correlation**: Track sentiment accuracy over time
3. **Risk assessment**: Add volatility and risk metrics
4. **Portfolio impact**: Calculate potential impact on personal holdings
5. **Alert system**: Notify on significant sentiment changes

## 🐛 Error Handling

The module includes:
- **Graceful degradation**: Returns empty results if LLM fails
- **Fallback parsing**: Text-based detection when JSON parsing fails
- **Input validation**: Ensures sentiment scores stay within [-1, 1] range
- **Asset filtering**: Only includes whitelisted assets in results

## 📈 Performance

- **Rate limiting**: Built-in throttling for API calls
- **Caching**: Reuses analysis for duplicate content
- **Timeout handling**: Prevents hanging on slow API responses
- **Error recovery**: Multiple retry attempts with backoff