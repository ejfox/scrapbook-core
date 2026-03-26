#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

const envPath = path.resolve(process.cwd(), '.env')

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
]

const OPTIONAL_ENV_VARS = [
  'PINBOARD_TOKEN',
  'GITHUB_TOKEN',
  'MASTODON_ACCESS_TOKEN',
  'ARENA_ACCESS_TOKEN',
  'OPENCAGE_API_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
]

function isConfigured(value) {
  return Boolean(value && value !== 'dummy' && value !== 'your_value_here')
}

let hasMissingRequired = false

console.log('Validating environment configuration...\n')

for (const key of REQUIRED_ENV_VARS) {
  if (isConfigured(process.env[key])) {
    console.log(`PASS ${key}`)
  } else {
    console.log(`FAIL ${key}`)
    hasMissingRequired = true
  }
}

console.log('')

for (const key of OPTIONAL_ENV_VARS) {
  if (isConfigured(process.env[key])) {
    console.log(`OPT  ${key}`)
  } else {
    console.log(`MISS ${key}`)
  }
}

if (hasMissingRequired) {
  console.error('\nMissing required environment variables.')
  process.exit(1)
}

console.log('\nEnvironment looks usable.')
