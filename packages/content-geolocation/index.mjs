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

export { extractLocation } from '../../scripts/aiGeolocation.mjs'

console.warn(
  '@scrapbook/content-geolocation: Currently using implementation from scrapbook-core. ' +
  'This package is not yet standalone. Full independent version coming soon.'
)
