/**
 * @scrapbook/content-geolocation
 * 
 * Extract and geocode geographic locations from text content.
 * 
 * NOTE: This is currently a placeholder that re-exports from scrapbook-core.
 * This means the package currently requires scrapbook-core to be installed.
 * 
 * For the full standalone implementation (coming soon), see:
 * ../../scripts/aiGeolocation.mjs
 * 
 * The standalone version will be extracted in a future update and will work
 * independently without requiring scrapbook-core.
 */

let extractLocation = async () => {
  throw new Error(
    '@scrapbook/content-geolocation: The underlying implementation could not be loaded. ' +
    'This placeholder package currently requires scrapbook-core to be installed.'
  )
}

// Attempt to load the implementation from scrapbook-core
;(async () => {
  try {
    const mod = await import('../../scripts/aiGeolocation.mjs')
    
    if (mod && typeof mod.extractLocation === 'function') {
      extractLocation = mod.extractLocation
    } else {
      console.warn(
        '@scrapbook/content-geolocation: Implementation loaded but missing expected exports. ' +
        'Using placeholder function that throws when called.'
      )
    }
  } catch (error) {
    console.warn(
      '@scrapbook/content-geolocation: Failed to load implementation from scrapbook-core. ' +
      'Using placeholder function that throws when called. Error: ' + error.message
    )
  }
})()

export { extractLocation }

