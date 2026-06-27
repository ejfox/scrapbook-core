#!/usr/bin/env node
/**
 * Unit tests for lib/validateEnvironment.mjs
 * Tests all branches: required vars, AI vars, optional vars, trim handling.
 */

import { validateEnvironment } from '../lib/validateEnvironment.mjs'

let passed = 0
let failed = 0

function assert(condition, name) {
  if (condition) {
    console.log(`  PASS: ${name}`)
    passed++
  } else {
    console.log(`  FAIL: ${name}`)
    failed++
  }
}

// Save original env
const originalEnv = { ...process.env }

const ALL_KEYS = [
  'SUPABASE_URL', 'SUPABASE_KEY',
  'OPENROUTER_API_KEY', 'OPENAI_API_KEY',
  'PINBOARD_TOKEN', 'MASTODON_ACCESS_TOKEN',
  'ARENA_ACCESS_TOKEN', 'GITHUB_TOKEN', 'CLOUDINARY_URL',
  'OPENCAGE_API_KEY',
]

function resetEnv() {
  ALL_KEYS.forEach(k => delete process.env[k])
}

function restoreEnv() {
  // Remove all test keys
  ALL_KEYS.forEach(k => delete process.env[k])
  // Restore originals
  Object.assign(process.env, originalEnv)
}

// ---- Test 1: All required vars missing ----
console.log('\n1. All required vars missing')
resetEnv()
let r = validateEnvironment()
assert(r.valid === false, 'valid should be false')
assert(r.errors.length === 3, `should have 3 errors (got ${r.errors.length})`)
assert(r.errors.some(e => e.includes('SUPABASE_URL')), 'should mention SUPABASE_URL')
assert(r.errors.some(e => e.includes('SUPABASE_KEY')), 'should mention SUPABASE_KEY')
assert(r.errors.some(e => e.includes('AI API key')), 'should mention AI API key')
assert(r.warnings.length === 6, `should have 6 warnings for optional vars (got ${r.warnings.length})`)

// ---- Test 2: Only SUPABASE vars set, no AI key ----
console.log('\n2. SUPABASE vars set, no AI key')
resetEnv()
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_KEY = 'test-key'
r = validateEnvironment()
assert(r.valid === false, 'valid should be false without AI key')
assert(r.errors.length === 1, `should have 1 error (got ${r.errors.length})`)
assert(r.errors[0].includes('AI API key'), 'error should be about AI key')
assert(!r.errors.some(e => e.includes('SUPABASE')), 'should not mention SUPABASE')

// ---- Test 3: SUPABASE + OPENROUTER only ----
console.log('\n3. SUPABASE + OPENROUTER_API_KEY only')
resetEnv()
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_KEY = 'test-key'
process.env.OPENROUTER_API_KEY = 'sk-or-test'
r = validateEnvironment()
assert(r.valid === true, 'valid should be true')
assert(r.errors.length === 0, `should have 0 errors (got ${r.errors.length})`)
assert(r.warnings.length === 6, `should have 6 warnings (got ${r.warnings.length})`)

// ---- Test 4: SUPABASE + OPENAI only ----
console.log('\n4. SUPABASE + OPENAI_API_KEY only')
resetEnv()
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_KEY = 'test-key'
process.env.OPENAI_API_KEY = 'sk-test'
r = validateEnvironment()
assert(r.valid === true, 'valid should be true with just OPENAI key')
assert(r.errors.length === 0, `should have 0 errors (got ${r.errors.length})`)

// ---- Test 5: SUPABASE + both AI keys ----
console.log('\n5. Both AI keys set')
resetEnv()
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_KEY = 'test-key'
process.env.OPENROUTER_API_KEY = 'sk-or-test'
process.env.OPENAI_API_KEY = 'sk-test'
r = validateEnvironment()
assert(r.valid === true, 'valid should be true')
assert(r.errors.length === 0, 'no errors')

// ---- Test 6: All vars set ----
console.log('\n6. All vars set (no warnings)')
resetEnv()
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_KEY = 'test-key'
process.env.OPENROUTER_API_KEY = 'sk-or-test'
process.env.OPENAI_API_KEY = 'sk-test'
process.env.PINBOARD_TOKEN = 'user:token'
process.env.MASTODON_ACCESS_TOKEN = 'masto-token'
process.env.ARENA_ACCESS_TOKEN = 'arena-token'
process.env.GITHUB_TOKEN = 'ghp_token'
process.env.CLOUDINARY_URL = 'cloudinary://test'
process.env.OPENCAGE_API_KEY = 'oc-key'
r = validateEnvironment()
assert(r.valid === true, 'valid should be true')
assert(r.errors.length === 0, 'no errors')
assert(r.warnings.length === 0, `no warnings (got ${r.warnings.length})`)

// ---- Test 7: Partial optional vars ----
console.log('\n7. Partial optional vars (3 of 6 set)')
resetEnv()
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_KEY = 'test-key'
process.env.OPENROUTER_API_KEY = 'sk-or-test'
process.env.PINBOARD_TOKEN = 'user:token'
process.env.GITHUB_TOKEN = 'ghp_token'
process.env.OPENCAGE_API_KEY = 'oc-key'
r = validateEnvironment()
assert(r.valid === true, 'valid should be true')
assert(r.warnings.length === 3, `should have 3 warnings (got ${r.warnings.length})`)

// ---- Test 8: Empty string values treated as missing ----
console.log('\n8. Empty string values treated as missing')
resetEnv()
process.env.SUPABASE_URL = ''
process.env.SUPABASE_KEY = ''
process.env.OPENROUTER_API_KEY = ''
r = validateEnvironment()
assert(r.valid === false, 'valid should be false for empty strings')
assert(r.errors.length === 3, `should have 3 errors (got ${r.errors.length})`)

// ---- Test 9: Whitespace-only values treated as missing ----
console.log('\n9. Whitespace-only values treated as missing')
resetEnv()
process.env.SUPABASE_URL = '   '
process.env.SUPABASE_KEY = '  \t  '
process.env.OPENROUTER_API_KEY = ' '
r = validateEnvironment()
assert(r.valid === false, 'valid should be false for whitespace-only')
assert(r.errors.length === 3, `should have 3 errors (got ${r.errors.length})`)

// ---- Test 10: Return shape ----
console.log('\n10. Return shape is correct')
resetEnv()
r = validateEnvironment()
assert(typeof r === 'object', 'returns an object')
assert(typeof r.valid === 'boolean', 'valid is boolean')
assert(Array.isArray(r.errors), 'errors is array')
assert(Array.isArray(r.warnings), 'warnings is array')

// ---- Cleanup ----
restoreEnv()

// ---- Summary ----
console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`)
if (failed > 0) {
  console.log('SOME TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL TESTS PASSED')
}
