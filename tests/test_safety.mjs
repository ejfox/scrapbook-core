#!/usr/bin/env node
/**
 * Safety Manager Test Script
 * Tests and manages safety mechanisms for scrapbook-core
 */

import 'dotenv/config'
import { program } from 'commander'
import chalk from 'chalk'
import {
  shouldContinueProcessing,
  startProcessingRun,
  recordSuccess,
  recordFailure,
  validateData,
  getSafetyStatus,
  resetCostCircuitBreaker,
  resetErrorTracking,
  printSafetyStatus,
} from './safetyManager.mjs'
import { trackCost, resetSession, printCostSummary } from './costTracking.mjs'

// Set up command line interface
program
  .name('test-safety')
  .description('Test and manage safety mechanisms')
  .version('1.0.0')
  .option('--status', 'Show current safety status')
  .option('--reset-cost', 'Reset cost circuit breaker')
  .option('--reset-errors', 'Reset error tracking')
  .option('--reset-all', 'Reset all safety states')
  .option('--test-cost', 'Simulate cost limit breach')
  .option('--test-failures', 'Simulate consecutive failures')
  .option('--test-memory', 'Simulate memory pressure test')
  .option('--test-batch', 'Test batch size limits')
  .option('--test-validation', 'Test data validation')
  .option('--test-all', 'Run all safety tests')
  .option('--automated', 'Test in automated mode (stricter limits)')
  .parse()

const options = program.opts()
const isAutomated = options.automated

console.log(chalk.blue('\n🛡️  SAFETY MANAGER TEST SUITE\n'))

// Show current status
if (options.status || Object.keys(options).length === 0) {
  console.log(chalk.yellow('📊 Current Safety Status:'))
  printSafetyStatus()
  console.log('\n' + chalk.gray('Use --help to see available test options'))
}

// Reset functions
if (options.resetCost) {
  console.log(chalk.blue('\n🔄 Resetting cost circuit breaker...'))
  resetCostCircuitBreaker()
}

if (options.resetErrors) {
  console.log(chalk.blue('\n🔄 Resetting error tracking...'))
  resetErrorTracking()
}

if (options.resetAll) {
  console.log(chalk.blue('\n🔄 Resetting all safety states...'))
  resetCostCircuitBreaker()
  resetErrorTracking()
  resetSession()
}

// Test functions
if (options.testCost || options.testAll) {
  await testCostLimits()
}

if (options.testFailures || options.testAll) {
  await testFailureTracking()
}

if (options.testBatch || options.testAll) {
  await testBatchLimits()
}

if (options.testValidation || options.testAll) {
  await testDataValidation()
}

if (options.testMemory || options.testAll) {
  await testMemoryLimits()
}

// Test cost circuit breaker
async function testCostLimits() {
  console.log(chalk.blue('\n💰 Testing Cost Circuit Breaker...'))

  // Start with clean slate
  resetSession()
  resetCostCircuitBreaker()

  const testLimit = parseFloat(process.env.SAFETY_SESSION_COST_LIMIT || '1.0')
  console.log(chalk.gray(`Session limit: $${testLimit}`))

  // Simulate some costs that should be fine
  console.log(chalk.green('\n✅ Phase 1: Normal operation (should pass)'))
  trackCost('test-model', {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
  }, { scrapId: 'test-1', taskType: 'test' })

  let safetyCheck = shouldContinueProcessing(isAutomated)
  console.log(chalk[safetyCheck.safe ? 'green' : 'red'](
    `Safety check: ${safetyCheck.safe ? 'PASS' : 'FAIL'}`,
  ))
  if (!safetyCheck.safe) console.log(chalk.gray(`Reason: ${safetyCheck.reason}`))

  // Simulate costs that exceed the limit
  console.log(chalk.yellow('\n⚠️  Phase 2: Simulating cost overrun (should fail)'))

  // Add enough cost to exceed limit
  const excessCost = testLimit + 0.01
  trackCost('expensive-model', {
    prompt_tokens: Math.floor(excessCost / 0.00001), // Assuming $0.00001 per token
    completion_tokens: 100,
    total_tokens: Math.floor(excessCost / 0.00001) + 100,
  }, { scrapId: 'test-expensive', taskType: 'test' })

  safetyCheck = shouldContinueProcessing(isAutomated)
  console.log(chalk[safetyCheck.safe ? 'red' : 'green'](
    `Safety check: ${safetyCheck.safe ? 'UNEXPECTED PASS' : 'CORRECTLY FAILED'}`,
  ))
  if (!safetyCheck.safe) console.log(chalk.green(`✅ Blocked: ${safetyCheck.reason}`))

  printCostSummary()
}

// Test failure tracking
async function testFailureTracking() {
  console.log(chalk.blue('\n⚠️  Testing Failure Tracking...'))

  resetErrorTracking()

  const maxFailures = parseInt(process.env.SAFETY_MAX_CONSECUTIVE_FAILURES || '5')
  console.log(chalk.gray(`Max consecutive failures: ${maxFailures}`))

  console.log(chalk.green('\n✅ Phase 1: Recording successes (should pass)'))
  recordSuccess('test-success-1', 'test')
  recordSuccess('test-success-2', 'test')

  let safetyCheck = shouldContinueProcessing(isAutomated)
  console.log(chalk[safetyCheck.safe ? 'green' : 'red'](
    `Safety check: ${safetyCheck.safe ? 'PASS' : 'FAIL'}`,
  ))

  console.log(chalk.yellow('\n⚠️  Phase 2: Recording failures (should eventually fail)'))

  // Record failures up to the limit
  for (let i = 1; i <= maxFailures + 1; i++) {
    recordFailure(`test-failure-${i}`, 'test', new Error(`Test error ${i}`))

    const check = shouldContinueProcessing(isAutomated)
    const status = check.safe ? 'STILL SAFE' : 'STOPPED'
    const color = check.safe ? 'yellow' : 'green'

    console.log(chalk[color](`Failure ${i}/${maxFailures}: ${status}`))

    if (!check.safe) {
      console.log(chalk.green(`✅ Correctly stopped: ${check.reason}`))
      break
    }
  }
}

// Test batch limits
async function testBatchLimits() {
  console.log(chalk.blue('\n📊 Testing Batch Limits...'))

  const mode = isAutomated ? 'automated' : 'manual'
  const maxItems = parseInt(process.env[`SAFETY_${isAutomated ? '' : 'MANUAL_'}MAX_ITEMS_PER_RUN`] || (isAutomated ? '50' : '500'))

  console.log(chalk.gray(`Mode: ${mode}, Max items per run: ${maxItems}`))

  startProcessingRun({ isAutomated, expectedItems: maxItems + 10 })

  console.log(chalk.green('\n✅ Phase 1: Normal processing (should pass)'))

  // Process items up to near the limit
  const nearLimit = Math.floor(maxItems * 0.9)
  for (let i = 1; i <= nearLimit; i++) {
    recordSuccess(`batch-test-${i}`, 'test')

    if (i % 10 === 0) {
      const check = shouldContinueProcessing(isAutomated)
      console.log(chalk[check.safe ? 'green' : 'red'](
        `Processed ${i}: ${check.safe ? 'SAFE' : 'STOPPED'}`,
      ))
    }
  }

  console.log(chalk.yellow('\n⚠️  Phase 2: Approaching limit (should eventually stop)'))

  // Continue until we hit the limit
  for (let i = nearLimit + 1; i <= maxItems + 5; i++) {
    const check = shouldContinueProcessing(isAutomated)

    if (!check.safe) {
      console.log(chalk.green(`✅ Correctly stopped at item ${i}: ${check.reason}`))
      break
    }

    recordSuccess(`batch-test-${i}`, 'test')
    console.log(chalk.yellow(`Processed ${i}: STILL SAFE`))
  }
}

// Test data validation
async function testDataValidation() {
  console.log(chalk.blue('\n🔍 Testing Data Validation...'))

  const testCases = [
    {
      name: 'Valid Pinboard bookmark',
      data: { href: 'https://example.com', description: 'Test', tags: 'test' },
      source: 'pinboard',
      shouldPass: true,
    },
    {
      name: 'Pinboard bookmark without URL',
      data: { description: 'Test without URL', tags: 'test' },
      source: 'pinboard',
      shouldPass: false,
    },
    {
      name: 'Valid Mastodon status',
      data: { id: '12345', content: 'Test status' },
      source: 'mastodon',
      shouldPass: true,
    },
    {
      name: 'Mastodon status without ID',
      data: { content: 'Status without ID' },
      source: 'mastodon',
      shouldPass: false,
    },
    {
      name: 'Null data',
      data: null,
      source: 'test',
      shouldPass: false,
    },
    {
      name: 'Circular reference data',
      data: {},
      source: 'test',
      shouldPass: true, // Will be modified below
    },
  ]

  // Create circular reference
  testCases[5].data.self = testCases[5].data
  testCases[5].shouldPass = false

  console.log(chalk.gray('\nRunning validation tests...\n'))

  for (const testCase of testCases) {
    const result = validateData(testCase.data, testCase.source)
    const passed = result.valid === testCase.shouldPass
    const icon = passed ? '✅' : '❌'
    const color = passed ? 'green' : 'red'

    console.log(chalk[color](
      `${icon} ${testCase.name}: ${result.valid ? 'VALID' : 'INVALID'} (expected: ${testCase.shouldPass ? 'valid' : 'invalid'})`,
    ))

    if (!result.valid) {
      console.log(chalk.gray(`   Reason: ${result.reason}`))
    }
  }
}

// Test memory limits (simulated)
async function testMemoryLimits() {
  console.log(chalk.blue('\n💾 Testing Memory Limits...'))

  const currentMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  const maxMemory = parseInt(process.env.SAFETY_MAX_MEMORY_MB || '1500')

  console.log(chalk.gray(`Current memory: ${currentMemory}MB`))
  console.log(chalk.gray(`Max memory limit: ${maxMemory}MB`))

  if (currentMemory < maxMemory) {
    console.log(chalk.green('✅ Memory usage is within limits'))

    // Simulate high memory usage by temporarily setting a lower limit
    const originalLimit = process.env.SAFETY_MAX_MEMORY_MB
    process.env.SAFETY_MAX_MEMORY_MB = String(Math.max(1, currentMemory - 10))

    const memoryCheck = shouldContinueProcessing(isAutomated)

    console.log(chalk[memoryCheck.safe ? 'red' : 'green'](
      `Simulated high memory: ${memoryCheck.safe ? 'UNEXPECTED PASS' : 'CORRECTLY FAILED'}`,
    ))

    if (!memoryCheck.safe) {
      console.log(chalk.green(`✅ Blocked: ${memoryCheck.reason}`))
    }

    // Restore original limit
    if (originalLimit) {
      process.env.SAFETY_MAX_MEMORY_MB = originalLimit
    } else {
      delete process.env.SAFETY_MAX_MEMORY_MB
    }
  } else {
    console.log(chalk.red('❌ Current memory usage already exceeds limit!'))
  }
}

console.log(chalk.blue('\n🏁 Safety tests completed'))
console.log(chalk.gray('Final safety status:'))
printSafetyStatus()
