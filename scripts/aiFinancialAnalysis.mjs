import { completion, MODELS, PROMPTS } from './llmService.mjs'
import { getModelForTask } from '../lib/config.mjs'

// Import canonical asset list from finance-prism
const FINANCE_PRISM_ASSETS = {
  // Major Indexes
  '^GSPC': 'S&P 500',
  '^DJI': 'Dow Jones',
  '^IXIC': 'Nasdaq',
  '^RUT': 'Russell 2000',

  // Big Tech
  'AAPL': 'Apple',
  'MSFT': 'Microsoft',
  'AMZN': 'Amazon',
  'NVDA': 'Nvidia',
  'GOOGL': 'Alphabet',
  'META': 'Meta',
  'TSLA': 'Tesla',
  'NFLX': 'Netflix',

  // ETFs
  'SPY': 'S&P 500 ETF',
  'QQQ': 'Nasdaq 100 ETF',
  'IWM': 'Russell 2000 ETF',
  'VTI': 'Total Stock Market',

  // Crypto
  'BTC-USD': 'Bitcoin',
  'ETH-USD': 'Ethereum',
  'SOL-USD': 'Solana',

  // Commodities
  'CL=F': 'Crude Oil',
  'GC=F': 'Gold',
  'SI=F': 'Silver',

  // Forex
  'JPY=X': 'USD/JPY',
  'EUR=X': 'EUR/USD',
}

// Use finance-prism canonical list as our tracked assets
const TRACKED_ASSETS = FINANCE_PRISM_ASSETS

// Alternative names and synonyms for tracked assets (updated for canonical list)
const ASSET_ALIASES = {
  // Big Tech common names
  'Apple': 'AAPL',
  'Microsoft': 'MSFT',
  'Amazon': 'AMZN',
  'Nvidia': 'NVDA',
  'Google': 'GOOGL',
  'Alphabet': 'GOOGL',
  'Meta': 'META',
  'Facebook': 'META',
  'Tesla': 'TSLA',
  'Netflix': 'NFLX',

  // Indexes
  'S&P 500': '^GSPC',
  'S&P': '^GSPC',
  'SPX': '^GSPC',
  'Dow Jones': '^DJI',
  'Dow': '^DJI',
  'Nasdaq': '^IXIC',
  'Russell 2000': '^RUT',
  'Russell': '^RUT',

  // ETFs
  'S&P 500 ETF': 'SPY',
  'Nasdaq ETF': 'QQQ',
  'Nasdaq 100': 'QQQ',
  'Small Cap ETF': 'IWM',
  'Total Market': 'VTI',

  // Crypto (without -USD suffix for common usage)
  'Bitcoin': 'BTC-USD',
  'BTC': 'BTC-USD',
  'Ethereum': 'ETH-USD',
  'ETH': 'ETH-USD',
  'Solana': 'SOL-USD',
  'SOL': 'SOL-USD',

  // Commodities
  'Oil': 'CL=F',
  'Crude': 'CL=F',
  'Crude Oil': 'CL=F',
  'Gold': 'GC=F',
  'Silver': 'SI=F',

  // Forex
  'USD/JPY': 'JPY=X',
  'USDJPY': 'JPY=X',
  'Yen': 'JPY=X',
  'EUR/USD': 'EUR=X',
  'EURUSD': 'EUR=X',
  'Euro': 'EUR=X',
}

/**
 * Attempt to recover truncated JSON by finding the last valid structure
 * @param {string} jsonStr - Potentially truncated JSON string
 * @returns {string} Recovered JSON string
 */
function attemptJsonRecovery(jsonStr) {
  // Try to find incomplete arrays and close them
  const openBrackets = (jsonStr.match(/\[/g) || []).length
  const closeBrackets = (jsonStr.match(/\]/g) || []).length
  const openBraces = (jsonStr.match(/\{/g) || []).length
  const closeBraces = (jsonStr.match(/\}/g) || []).length

  // Calculate how many closing brackets/braces we need
  const missingBrackets = openBrackets - closeBrackets
  const missingBraces = openBraces - closeBraces

  // Remove any incomplete object/array at the end
  // Look for the last complete comma or opening bracket/brace
  let truncatePoint = jsonStr.length

  // Find the last position where we have a complete element
  const lastCompleteMatch = jsonStr.match(/[}\]],?\s*$/)
  if (!lastCompleteMatch) {
    // No complete elements at end, try to find last complete position
    // Remove everything after the last complete structure
    const lastComma = jsonStr.lastIndexOf(',')
    const lastOpenBracket = jsonStr.lastIndexOf('[')
    const lastOpenBrace = jsonStr.lastIndexOf('{')
    const lastCloseBracket = jsonStr.lastIndexOf(']')
    const lastCloseBrace = jsonStr.lastIndexOf('}')

    // If we have an incomplete structure after the last comma, remove it
    if (lastComma > Math.max(lastCloseBracket, lastCloseBrace)) {
      truncatePoint = lastComma
    }
  }

  let recovered = jsonStr.substring(0, truncatePoint)

  // Add missing closing brackets/braces
  recovered += ']'.repeat(missingBrackets)
  recovered += '}'.repeat(missingBraces)

  return recovered
}

/**
 * Aggressive JSON recovery that tries to extract any valid assets
 * @param {string} response - Raw AI response
 * @returns {Object|null} Recovered analysis object or null
 */
function attemptAggressiveJsonRecovery(response) {
  try {
    // Try to extract just the tracked_assets array if it exists
    const trackedMatch = response.match(/"tracked_assets"\s*:\s*\[([\s\S]*?)(?:\]|$)/)
    const discoveredMatch = response.match(/"discovered_assets"\s*:\s*\[([\s\S]*?)(?:\]|$)/)

    if (!trackedMatch && !discoveredMatch) {
      return null
    }

    // Build a minimal valid structure
    const result = {
      tracked_assets: [],
      discovered_assets: [],
      overall_market_sentiment: 0,
      market_reasoning: 'Recovered from truncated response',
    }

    // Try to parse individual asset objects from the arrays
    if (trackedMatch) {
      const assetsText = trackedMatch[1]
      const assetMatches = assetsText.matchAll(/\{[^{}]*"ticker"\s*:\s*"([^"]+)"[^{}]*\}/g)
      for (const match of assetMatches) {
        try {
          const asset = JSON.parse(match[0])
          if (asset.ticker) {
            result.tracked_assets.push(asset)
          }
        } catch (e) {
          // Skip invalid asset
        }
      }
    }

    if (discoveredMatch) {
      const assetsText = discoveredMatch[1]
      const assetMatches = assetsText.matchAll(/\{[^{}]*"ticker"\s*:\s*"([^"]+)"[^{}]*\}/g)
      for (const match of assetMatches) {
        try {
          const asset = JSON.parse(match[0])
          if (asset.ticker) {
            result.discovered_assets.push(asset)
          }
        } catch (e) {
          // Skip invalid asset
        }
      }
    }

    // Only return if we recovered at least one asset
    if (result.tracked_assets.length > 0 || result.discovered_assets.length > 0) {
      return result
    }

    return null
  } catch (error) {
    return null
  }
}

/**
 * Determine asset type based on ticker symbol patterns
 * @param {string} ticker - Asset ticker symbol
 * @returns {string} Asset type classification
 */
function determineAssetType(ticker) {
  if (!ticker) return 'unknown'

  const upperTicker = ticker.toUpperCase()

  // Crypto patterns
  if (upperTicker.includes('-USD') || upperTicker.includes('USDT') ||
      ['BTC', 'ETH', 'ADA', 'DOT', 'SOL', 'MATIC', 'AVAX', 'DOGE'].includes(upperTicker)) {
    return 'crypto'
  }

  // Forex patterns
  if (upperTicker.includes('=X') || upperTicker.includes('/')) {
    return 'forex'
  }

  // Index patterns
  if (upperTicker.startsWith('^') || ['SPX', 'NDX', 'DJX'].includes(upperTicker)) {
    return 'index'
  }

  // ETF patterns
  if (upperTicker.length === 3 && (
    upperTicker.includes('ETF') ||
    ['SPY', 'QQQ', 'VTI', 'IWM', 'GLD', 'SLV'].includes(upperTicker) ||
    upperTicker.endsWith('Y')
  )) {
    return 'etf'
  }

  // Commodity futures patterns
  if (upperTicker.includes('=F') || ['GC', 'SI', 'CL', 'NG'].includes(upperTicker.split('=')[0])) {
    return 'commodity'
  }

  // Default to stock for standard tickers
  return 'stock'
}

// Phrases that indicate an asset was NOT actually discussed (model hallucination markers)
const NOT_MENTIONED_RE = /\b(not mentioned|not discussed|not present|not referenced|no mention|n\/?a|none|absent|implied|indirect)\b/i

/**
 * Guard against phantom assets: only keep assets the model actually grounded in the
 * content. Drops entries whose context says "not mentioned" or that lack any real
 * verbatim mention. Fixes tracked tickers (e.g. AAPL) being injected into
 * non-financial scraps.
 * @param {Object} asset
 * @returns {boolean}
 */
function isAssetActuallyMentioned(asset) {
  if (!asset || !asset.ticker) return false

  const context = String(asset.context || '').trim()
  // Explicit "not mentioned" style context is a hard reject.
  if (context && NOT_MENTIONED_RE.test(context)) return false

  const realMentions = Array.isArray(asset.mentions)
    ? asset.mentions
      .map((m) => String(m || '').trim())
      .filter((m) => m.length > 0 && !NOT_MENTIONED_RE.test(m))
    : []

  if (realMentions.length > 0) return true

  // No usable mentions array — only keep if the context is a substantive,
  // non-negative description of how the asset was discussed.
  return Boolean(context) && context.length > 3 && !NOT_MENTIONED_RE.test(context)
}

/**
 * Extract financial assets and analyze sentiment from content
 * @param {string} content - Text content to analyze
 * @param {Object} options - Analysis options
 * @returns {Object} Financial analysis results
 */
export async function extractFinancialAnalysis(content, options = {}) {
  if (!content) return { assets: [], sentiment: {} }

  const { url, isRawText = false } = options

  try {
    // Create system prompt for financial analysis
    const systemPrompt = `You are a financial analysis specialist. Extract ONLY financial assets (stocks, crypto, ETFs, commodities, forex) that are EXPLICITLY mentioned or clearly discussed in the content, then analyze sentiment for each.

If — and only if — the content actually discusses one of these tracked assets, use its exact ticker: ${Object.keys(TRACKED_ASSETS).join(', ')}

Hard rules:
- NEVER include an asset that is not genuinely discussed in the content. The tracked list is a ticker reference, NOT a checklist to fill in.
- Most content is not about finance. When no asset is discussed, return empty arrays — that is the correct, expected answer.
- Every asset you return must have a real "mentions" entry quoting how it appears in the text. Do not output context values like "not mentioned".

CRITICAL: You MUST return ONLY valid JSON with no markdown, no code blocks, no explanations. Just the raw JSON object.

Sentiment scores: -1 (very negative) to +1 (very positive)`

    const userPrompt = `Analyze for financial assets and sentiment.

CRITICAL FORMATTING RULE: Your response must be ONLY the JSON object starting with { and ending with }. NO markdown code blocks (no \`\`\`), NO explanations, NO text before or after the JSON.

Use this structure (the tickers below illustrate FORMAT ONLY — do not copy them; include an asset only if it is actually discussed):
{"tracked_assets":[{"ticker":"<ticker>","name":"<name>","mentions":["<verbatim phrase from the text>"],"context":"how it is discussed","sentiment_score":0.5,"sentiment_reasoning":"why","is_tracked":true}],"discovered_assets":[{"ticker":"<ticker>","name":"<name>","mentions":["<verbatim phrase from the text>"],"context":"how it is discussed","sentiment_score":0.0,"sentiment_reasoning":"why","is_tracked":false,"asset_type":"stock"}],"overall_market_sentiment":0.0,"market_reasoning":"overall analysis"}

If no financial assets are discussed, return: {"tracked_assets":[],"discovered_assets":[],"overall_market_sentiment":0.0,"market_reasoning":"No financial assets discussed"}

Content to analyze:
${content}
${url ? `\nURL: ${url}` : ''}

RESPOND WITH ONLY THE JSON OBJECT. START YOUR RESPONSE WITH { AND END WITH }`

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    const response = await completion({
      messages,
      temperature: 0.2,
      maxTokens: 4000,
      model: getModelForTask('contentAnalysis'),
    })

    if (!response) {
      return { assets: [], tracked_assets: [], discovered_assets: [], overall_market_sentiment: 0, market_reasoning: 'No LLM response' }
    }

    // Try to parse JSON response with simple extraction
    let analysisResult
    try {
      let jsonStr = response.trim()

      // Simple cleanup: remove markdown code blocks if AI ignored instructions
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/g, '').replace(/\n?```\s*$/g, '')

      // Find the JSON object boundaries
      const firstBrace = jsonStr.indexOf('{')
      const lastBrace = jsonStr.lastIndexOf('}')

      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error('No JSON object found in response')
      }

      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1)

      // If truncated, try recovery
      if (!jsonStr.endsWith('}')) {
        console.warn("Financial analysis JSON appears truncated (doesn't end with })")
        jsonStr = attemptJsonRecovery(jsonStr)
      }

      analysisResult = JSON.parse(jsonStr)
    } catch (parseError) {
      console.warn('Failed to parse financial analysis JSON:', parseError.message)
      console.warn('Response preview:', response.substring(0, 200))
      // Try one more aggressive recovery attempt
      try {
        const recovered = attemptAggressiveJsonRecovery(response)
        if (recovered) {
          console.log('✅ Successfully recovered JSON with aggressive parsing')
          analysisResult = recovered
        } else {
          throw parseError
        }
      } catch (recoveryError) {
        return {
          assets: [],
          tracked_assets: [],
          discovered_assets: [],
          overall_market_sentiment: 0,
          market_reasoning: `JSON parsing failed: ${parseError.message}`,
        }
      }
    }

    // Process tracked assets (validate against whitelist + require real mention)
    const trackedAssets = (analysisResult.tracked_assets || analysisResult.assets || [])
      .filter(asset => TRACKED_ASSETS[asset.ticker]) // Only include whitelisted assets
      .filter(isAssetActuallyMentioned) // Drop phantom assets the model didn't ground in the text
      .map(asset => ({
        ...asset,
        sentiment_score: Math.max(-1, Math.min(1, asset.sentiment_score || 0)), // Clamp to [-1, 1]
        name: asset.name || TRACKED_ASSETS[asset.ticker], // Ensure we have the name
        mentions: asset.mentions || [asset.ticker],
        is_tracked: true,
      }))

    // Process discovered assets (any assets not in our whitelist)
    const discoveredAssets = (analysisResult.discovered_assets || [])
      .filter(asset => !TRACKED_ASSETS[asset.ticker]) // Only non-whitelisted assets
      .filter(isAssetActuallyMentioned) // Drop phantom assets the model didn't ground in the text
      .map(asset => ({
        ...asset,
        sentiment_score: Math.max(-1, Math.min(1, asset.sentiment_score || 0)), // Clamp to [-1, 1]
        mentions: asset.mentions || [asset.ticker],
        is_tracked: false,
        asset_type: asset.asset_type || determineAssetType(asset.ticker),
      }))
      .slice(0, 10) // Limit discovered assets to prevent spam

    // Combine all assets for backward compatibility
    const allAssets = [...trackedAssets, ...discoveredAssets]

    return {
      assets: allAssets, // Backward compatibility - all assets combined
      tracked_assets: trackedAssets,
      discovered_assets: discoveredAssets,
      overall_market_sentiment: Math.max(-1, Math.min(1, analysisResult.overall_market_sentiment || 0)),
      market_reasoning: analysisResult.market_reasoning || 'No overall market analysis provided',
      analysis_timestamp: new Date().toISOString(),
    }

  } catch (error) {
    console.error('Error in financial analysis:', error)
    return { assets: [], tracked_assets: [], discovered_assets: [], overall_market_sentiment: 0, market_reasoning: 'Analysis failed', error: error.message }
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
    .join('\n\n')

  if (!contentToAnalyze) {
    return scrapData
  }

  const analysis = await extractFinancialAnalysis(contentToAnalyze, {
    url: scrapData.url,
    isRawText: false,
  })

  return {
    ...scrapData,
    financial_analysis: analysis,
  }
}

/**
 * Get all tracked assets (useful for external queries)
 * @returns {Object} Object mapping tickers to company names
 */
export function getTrackedAssets() {
  return { ...TRACKED_ASSETS }
}

/**
 * Check if a ticker is in our tracking list
 * @param {string} ticker - Ticker symbol to check
 * @returns {boolean} Whether the ticker is tracked
 */
export function isTrackedAsset(ticker) {
  return ticker && TRACKED_ASSETS[ticker.toUpperCase()]
}
