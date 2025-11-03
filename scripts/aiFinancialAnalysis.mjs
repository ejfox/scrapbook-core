import { completion, MODELS, PROMPTS } from "./llmService.mjs";
import { getModelForTask } from "../lib/config.mjs";

// Import canonical asset list from finance-prism
const FINANCE_PRISM_ASSETS = {
  // Major Indexes
  "^GSPC": "S&P 500",
  "^DJI": "Dow Jones",
  "^IXIC": "Nasdaq",
  "^RUT": "Russell 2000",

  // Big Tech
  "AAPL": "Apple",
  "MSFT": "Microsoft",
  "AMZN": "Amazon",
  "NVDA": "Nvidia",
  "GOOGL": "Alphabet",
  "META": "Meta",
  "TSLA": "Tesla",
  "NFLX": "Netflix",

  // ETFs
  "SPY": "S&P 500 ETF",
  "QQQ": "Nasdaq 100 ETF",
  "IWM": "Russell 2000 ETF",
  "VTI": "Total Stock Market",

  // Crypto
  "BTC-USD": "Bitcoin",
  "ETH-USD": "Ethereum",
  "SOL-USD": "Solana",

  // Commodities
  "CL=F": "Crude Oil",
  "GC=F": "Gold",
  "SI=F": "Silver",

  // Forex
  "JPY=X": "USD/JPY",
  "EUR=X": "EUR/USD",
};

// Use finance-prism canonical list as our tracked assets
const TRACKED_ASSETS = FINANCE_PRISM_ASSETS;

// Alternative names and synonyms for tracked assets (updated for canonical list)
const ASSET_ALIASES = {
  // Big Tech common names
  "Apple": "AAPL",
  "Microsoft": "MSFT",
  "Amazon": "AMZN",
  "Nvidia": "NVDA",
  "Google": "GOOGL",
  "Alphabet": "GOOGL",
  "Meta": "META",
  "Facebook": "META",
  "Tesla": "TSLA",
  "Netflix": "NFLX",

  // Indexes
  "S&P 500": "^GSPC",
  "S&P": "^GSPC",
  "SPX": "^GSPC",
  "Dow Jones": "^DJI",
  "Dow": "^DJI",
  "Nasdaq": "^IXIC",
  "Russell 2000": "^RUT",
  "Russell": "^RUT",

  // ETFs
  "S&P 500 ETF": "SPY",
  "Nasdaq ETF": "QQQ",
  "Nasdaq 100": "QQQ",
  "Small Cap ETF": "IWM",
  "Total Market": "VTI",

  // Crypto (without -USD suffix for common usage)
  "Bitcoin": "BTC-USD",
  "BTC": "BTC-USD",
  "Ethereum": "ETH-USD",
  "ETH": "ETH-USD",
  "Solana": "SOL-USD",
  "SOL": "SOL-USD",

  // Commodities
  "Oil": "CL=F",
  "Crude": "CL=F",
  "Crude Oil": "CL=F",
  "Gold": "GC=F",
  "Silver": "SI=F",

  // Forex
  "USD/JPY": "JPY=X",
  "USDJPY": "JPY=X",
  "Yen": "JPY=X",
  "EUR/USD": "EUR=X",
  "EURUSD": "EUR=X",
  "Euro": "EUR=X",
};

/**
 * Determine asset type based on ticker symbol patterns
 * @param {string} ticker - Asset ticker symbol
 * @returns {string} Asset type classification
 */
function determineAssetType(ticker) {
  if (!ticker) return "unknown";

  const upperTicker = ticker.toUpperCase();

  // Crypto patterns
  if (upperTicker.includes("-USD") || upperTicker.includes("USDT") ||
      ["BTC", "ETH", "ADA", "DOT", "SOL", "MATIC", "AVAX", "DOGE"].includes(upperTicker)) {
    return "crypto";
  }

  // Forex patterns
  if (upperTicker.includes("=X") || upperTicker.includes("/")) {
    return "forex";
  }

  // Index patterns
  if (upperTicker.startsWith("^") || ["SPX", "NDX", "DJX"].includes(upperTicker)) {
    return "index";
  }

  // ETF patterns
  if (upperTicker.length === 3 && (
    upperTicker.includes("ETF") ||
    ["SPY", "QQQ", "VTI", "IWM", "GLD", "SLV"].includes(upperTicker) ||
    upperTicker.endsWith("Y")
  )) {
    return "etf";
  }

  // Commodity futures patterns
  if (upperTicker.includes("=F") || ["GC", "SI", "CL", "NG"].includes(upperTicker.split("=")[0])) {
    return "commodity";
  }

  // Default to stock for standard tickers
  return "stock";
}

/**
 * Extract financial assets and analyze sentiment from content
 * @param {string} content - Text content to analyze
 * @param {Object} options - Analysis options
 * @returns {Object} Financial analysis results
 */
export async function extractFinancialAnalysis(content, options = {}) {
  if (!content) return { assets: [], sentiment: {} };

  const { url, isRawText = false } = options;

  try {
    // Create system prompt for financial analysis
    const systemPrompt = `You are a financial analysis specialist. Extract mentions of financial assets (stocks, crypto, ETFs, commodities, forex) and analyze sentiment.

TRACKED ASSETS (prioritize these): ${Object.keys(TRACKED_ASSETS).join(", ")}

CRITICAL: You MUST return ONLY valid JSON with no markdown, no code blocks, no explanations. Just the raw JSON object.

Sentiment scores: -1 (very negative) to +1 (very positive)`;

    const userPrompt = `Analyze for financial assets and sentiment. Return ONLY this exact JSON structure with no markdown formatting:

{
  "tracked_assets": [
    {
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "mentions": ["Apple"],
      "context": "how mentioned",
      "sentiment_score": 0.5,
      "sentiment_reasoning": "why",
      "is_tracked": true
    }
  ],
  "discovered_assets": [
    {
      "ticker": "OTHER",
      "name": "Other Asset",
      "mentions": ["name"],
      "context": "how mentioned",
      "sentiment_score": 0.0,
      "sentiment_reasoning": "why",
      "is_tracked": false,
      "asset_type": "stock"
    }
  ],
  "overall_market_sentiment": 0.0,
  "market_reasoning": "overall analysis"
}

Content to analyze:
${content}
${url ? `\nURL: ${url}` : ""}

Return ONLY the JSON. No code blocks, no markdown, no text before or after.`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const response = await completion({
      messages,
      temperature: 0.2,
      maxTokens: 4000,
      model: getModelForTask("contentAnalysis"),
    });

    if (!response) {
      return { assets: [], tracked_assets: [], discovered_assets: [], overall_market_sentiment: 0, market_reasoning: "No LLM response" };
    }

    // Try to parse JSON response with improved extraction
    let analysisResult;
    try {
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith("```")) {
        // Extract content between ```json and ``` or just ``` and ```
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim();
        }
      }

      // If still not starting with {, try to extract JSON object
      if (!jsonStr.startsWith("{")) {
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        jsonStr = jsonMatch ? jsonMatch[0] : jsonStr;
      }

      // Validate JSON is complete (ends with })
      if (!jsonStr.endsWith("}")) {
        console.warn("Financial analysis JSON appears truncated (doesn't end with })");
        // Try to find the last complete closing brace
        const lastBrace = jsonStr.lastIndexOf("}");
        if (lastBrace > 0) {
          jsonStr = jsonStr.substring(0, lastBrace + 1);
        } else {
          throw new Error("JSON is incomplete and cannot be recovered");
        }
      }

      analysisResult = JSON.parse(jsonStr);
    } catch (parseError) {
      console.warn("Failed to parse financial analysis JSON:", parseError.message);
      console.warn("Response preview:", response.substring(0, 200));
      return {
        assets: [],
        tracked_assets: [],
        discovered_assets: [],
        overall_market_sentiment: 0,
        market_reasoning: `JSON parsing failed: ${parseError.message}`,
      };
    }

    // Process tracked assets (validate against whitelist)
    const trackedAssets = (analysisResult.tracked_assets || analysisResult.assets || [])
      .filter(asset => TRACKED_ASSETS[asset.ticker]) // Only include whitelisted assets
      .map(asset => ({
        ...asset,
        sentiment_score: Math.max(-1, Math.min(1, asset.sentiment_score || 0)), // Clamp to [-1, 1]
        name: asset.name || TRACKED_ASSETS[asset.ticker], // Ensure we have the name
        mentions: asset.mentions || [asset.ticker],
        is_tracked: true,
      }));

    // Process discovered assets (any assets not in our whitelist)
    const discoveredAssets = (analysisResult.discovered_assets || [])
      .filter(asset => !TRACKED_ASSETS[asset.ticker]) // Only non-whitelisted assets
      .map(asset => ({
        ...asset,
        sentiment_score: Math.max(-1, Math.min(1, asset.sentiment_score || 0)), // Clamp to [-1, 1]
        mentions: asset.mentions || [asset.ticker],
        is_tracked: false,
        asset_type: asset.asset_type || determineAssetType(asset.ticker),
      }))
      .slice(0, 10); // Limit discovered assets to prevent spam

    // Combine all assets for backward compatibility
    const allAssets = [...trackedAssets, ...discoveredAssets];

    return {
      assets: allAssets, // Backward compatibility - all assets combined
      tracked_assets: trackedAssets,
      discovered_assets: discoveredAssets,
      overall_market_sentiment: Math.max(-1, Math.min(1, analysisResult.overall_market_sentiment || 0)),
      market_reasoning: analysisResult.market_reasoning || "No overall market analysis provided",
      analysis_timestamp: new Date().toISOString(),
    };

  } catch (error) {
    console.error("Error in financial analysis:", error);
    return { assets: [], tracked_assets: [], discovered_assets: [], overall_market_sentiment: 0, market_reasoning: "Analysis failed", error: error.message };
  }
}

/**
 * Extract financial analysis and add to scrap data
 * @param {Object} scrapData - Scrap data to enrich
 * @returns {Object} Enriched scrap data
 */
export async function extractAndAddFinancialAnalysis(scrapData) {
  const contentToAnalyze = [
    scrapData.content,
    scrapData.description,
    scrapData.title,
    scrapData.summary,
    scrapData.metadata?.description,
    scrapData.metadata?.content,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!contentToAnalyze) {
    return scrapData;
  }

  const analysis = await extractFinancialAnalysis(contentToAnalyze, {
    url: scrapData.url,
    isRawText: false,
  });

  return {
    ...scrapData,
    financial_analysis: analysis,
  };
}

/**
 * Get all tracked assets (useful for external queries)
 * @returns {Object} Object mapping tickers to company names
 */
export function getTrackedAssets() {
  return { ...TRACKED_ASSETS };
}

/**
 * Check if a ticker is in our tracking list
 * @param {string} ticker - Ticker symbol to check
 * @returns {boolean} Whether the ticker is tracked
 */
export function isTrackedAsset(ticker) {
  return ticker && TRACKED_ASSETS[ticker.toUpperCase()];
}
