/**
 * @scrapbook/financial-analysis
 *
 * Extract financial assets and analyze sentiment from text content.
 *
 * NOTE: This is currently a placeholder that re-exports from scrapbook-core.
 * This means the package currently requires scrapbook-core to be installed.
 *
 * For the full standalone implementation (coming soon), see:
 * ../../scripts/aiFinancialAnalysis.mjs
 *
 * The standalone version will be extracted in a future update and will work
 * independently without requiring scrapbook-core.
 */

let extractFinancialAnalysis = async () => {
  throw new Error(
    '@scrapbook/financial-analysis: The underlying implementation could not be loaded. ' +
    'This placeholder package currently requires scrapbook-core to be installed.',
  )
}

let extractAndAddFinancialAnalysis = async () => {
  throw new Error(
    '@scrapbook/financial-analysis: The underlying implementation could not be loaded. ' +
    'This placeholder package currently requires scrapbook-core to be installed.',
  )
}

let getTrackedAssets = () => {
  throw new Error(
    '@scrapbook/financial-analysis: The underlying implementation could not be loaded. ' +
    'This placeholder package currently requires scrapbook-core to be installed.',
  )
}

let isTrackedAsset = () => {
  throw new Error(
    '@scrapbook/financial-analysis: The underlying implementation could not be loaded. ' +
    'This placeholder package currently requires scrapbook-core to be installed.',
  )
}

// Attempt to load the implementation from scrapbook-core
;(async () => {
  try {
    const impl = await import('../../scripts/aiFinancialAnalysis.mjs')

    if (
      impl &&
      typeof impl.extractFinancialAnalysis === 'function' &&
      typeof impl.extractAndAddFinancialAnalysis === 'function' &&
      typeof impl.getTrackedAssets === 'function' &&
      typeof impl.isTrackedAsset === 'function'
    ) {
      extractFinancialAnalysis = impl.extractFinancialAnalysis
      extractAndAddFinancialAnalysis = impl.extractAndAddFinancialAnalysis
      getTrackedAssets = impl.getTrackedAssets
      isTrackedAsset = impl.isTrackedAsset
    } else {
      console.warn(
        '@scrapbook/financial-analysis: Implementation loaded but missing expected exports. ' +
        'Using placeholder functions that throw when called.',
      )
    }
  } catch (error) {
    console.warn(
      '@scrapbook/financial-analysis: Failed to load implementation from scrapbook-core. ' +
      'Using placeholder functions that throw when called. Error: ' + error.message,
    )
  }
})()

export {
  extractFinancialAnalysis,
  extractAndAddFinancialAnalysis,
  getTrackedAssets,
  isTrackedAsset,
}

