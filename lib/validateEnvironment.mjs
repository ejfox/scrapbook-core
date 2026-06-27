/**
 * Centralized environment variable validation.
 * Returns { valid, errors, warnings } — does NOT throw.
 */

import { fileURLToPath } from 'url'
import path from 'path'

const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_KEY']

const AI_VARS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY']

const OPTIONAL_VARS = [
  { name: 'PINBOARD_TOKEN', description: 'Pinboard bookmark syncing' },
  { name: 'MASTODON_ACCESS_TOKEN', description: 'Mastodon status syncing' },
  { name: 'ARENA_ACCESS_TOKEN', description: 'Are.na block syncing' },
  { name: 'GITHUB_TOKEN', description: 'GitHub activity syncing' },
  { name: 'CLOUDINARY_URL', description: 'Image hosting via Cloudinary' },
  { name: 'OPENCAGE_API_KEY', description: 'Geocoding via OpenCage' },
]

export function validateEnvironment() {
  const errors = []
  const warnings = []

  // Check required vars
  for (const name of REQUIRED_VARS) {
    if (!process.env[name]?.trim()) {
      errors.push(`Missing required env var: ${name}`)
    }
  }

  // Check AI vars — need at least one
  const hasAI = AI_VARS.some((name) => !!process.env[name]?.trim())
  if (!hasAI) {
    errors.push(
      `Missing AI API key: at least one of ${AI_VARS.join(', ')} is required`,
    )
  }

  // Check optional vars
  for (const { name, description } of OPTIONAL_VARS) {
    if (!process.env[name]?.trim()) {
      warnings.push(`Optional env var not set: ${name} (${description})`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// Allow running standalone: node lib/validateEnvironment.mjs
const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])

if (isMain) {
  try {
    const { default: dotenv } = await import('dotenv')
    dotenv.config()
  } catch {
    // dotenv not available — use env vars from shell
  }

  const result = validateEnvironment()
  console.log('\n=== Environment Validation ===')
  console.log(`Status: ${result.valid ? 'VALID' : 'INVALID'}`)

  if (result.errors.length) {
    console.log('\nErrors:')
    result.errors.forEach((e) => console.log(`  ✗ ${e}`))
  }

  if (result.warnings.length) {
    console.log('\nWarnings:')
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`))
  }

  if (!result.errors.length && !result.warnings.length) {
    console.log('\n  All environment variables are set.')
  }

  console.log('')
  process.exit(result.valid ? 0 : 1)
}

export default validateEnvironment
