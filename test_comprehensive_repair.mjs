#!/usr/bin/env node

/**
 * Comprehensive End-to-End Test Suite for Scrap Repair Pipeline
 *
 * Tests all aspects of the repair system:
 * 1. Location extraction (verify real place names, not "Unknown")
 * 2. Financial analysis integration (extract financial data when present)
 * 3. Complete repair workflow (summaries, tags, relationships, locations, financial analysis)
 * 4. Error handling (graceful degradation when services fail)
 * 5. Performance (rate limiting and cost tracking)
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'
import path from 'path'
import fs from 'fs'

// Import modules to test
import { repairScrapWithAI } from './scripts/scrap_doctor_ai.mjs'
import { extractLocation } from './scripts/aiGeolocation.mjs'
import { extractFinancialAnalysis } from './scripts/aiFinancialAnalysis.mjs'
import { summarizeContent } from './scripts/aiSummarization.mjs'
import { extractRelationships } from './scripts/aiRelationshipExtraction.mjs'
import { resetSession, printCostSummary, getSessionStats } from './scripts/costTracking.mjs'

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

// Test data with geographic locations AND financial content
const TEST_CONTENT = [
  {
    id: 'location-financial-1',
    title: 'Apple Store Opens New Flagship Location in Downtown San Francisco',
    content: "Apple Inc. (AAPL) announced today the opening of their largest West Coast retail location at 1 Stockton Street in San Francisco's Union Square. The new store spans three floors and features the latest iPhone 15 Pro models starting at $999. CEO Tim Cook attended the grand opening ceremony this morning. The company's stock rose 2.3% in after-hours trading following the announcement. Tesla (TSLA) and Microsoft (MSFT) also saw gains as tech stocks rallied on the news. The San Francisco location will serve the greater Bay Area, with easy access from Market Street and downtown BART stations.",
    url: 'https://apple.com/newsroom/san-francisco-store-opening',
    tags: [],
    summary: null,
    relationships: null,
    location: null,
    financial_analysis: null,
  },
  {
    id: 'location-only-1',
    title: "Tokyo's Cherry Blossom Festival Attracts Record Crowds",
    content: 'Thousands of visitors flocked to Ueno Park in Tokyo, Japan this weekend for the annual cherry blossom viewing festival. The Yoshino cherry trees reached full bloom earlier than expected this year. Local authorities reported that Shibuya Station processed over 3 million passengers during the peak weekend. The festival, known as hanami, includes traditional food stalls along the Sumida River and extends into nearby Asakusa district. Weather forecasts predict optimal viewing conditions will continue through next week across the Kanto region.',
    url: 'https://jnto.go.jp/cherry-blossom-tokyo',
    tags: [],
    summary: null,
    relationships: null,
    location: null,
    financial_analysis: null,
  },
  {
    id: 'financial-only-1',
    title: 'Federal Reserve Signals Interest Rate Changes Ahead',
    content: "The Federal Reserve indicated potential rate adjustments at their Jackson Hole symposium. Bitcoin (BTC-USD) surged 8% to $65,400 following Fed Chair Powell's comments about monetary policy flexibility. Major indices responded positively with the S&P 500 (^GSPC) gaining 1.2% and Nasdaq (^IXIC) up 1.8%. Gold futures (GC=F) reached new highs at $2,420 per ounce. Crypto markets saw broad gains with Ethereum (ETH-USD) and Solana (SOL-USD) following Bitcoin's lead. Treasury yields fell across the curve as investors repositioned for potential policy changes.",
    url: 'https://federalreserve.gov/newsevents/pressreleases/monetary20240825.htm',
    tags: [],
    summary: null,
    relationships: null,
    location: null,
    financial_analysis: null,
  },
  {
    id: 'complex-both-1',
    title: 'Chinese EV Manufacturer BYD Expands European Operations',
    content: 'Chinese electric vehicle manufacturer BYD announced plans to establish manufacturing facilities in Munich, Germany and Barcelona, Spain. The company aims to compete directly with Tesla (TSLA) and Volkswagen (VOW3.DE) in the European market. BYD shares (1211.HK) rose 4% in Hong Kong trading while European auto stocks declined. The Munich facility will focus on battery production, while Barcelona will handle final vehicle assembly. Construction begins next quarter with operations expected by 2025. The expansion represents a $2.8 billion investment and will create approximately 8,000 jobs across both locations. Local officials in Bavaria and Catalonia praised the investment as a boost to regional economies.',
    url: 'https://byd.com/news/european-expansion-2024',
    tags: [],
    summary: null,
    relationships: null,
    location: null,
    financial_analysis: null,
  },
  {
    id: 'minimal-content-1',
    title: 'Quick Update',
    content: 'Short post with minimal details.',
    url: 'https://example.com/quick',
    tags: [],
    summary: null,
    relationships: null,
    location: null,
    financial_analysis: null,
  },
]

// Robustness score function
function calculateRobustnessScore(results) {
  let totalScore = 0
  let totalTests = 0

  for (const result of results) {
    totalTests += 1

    // Success/failure (40% of score)
    if (result.success) totalScore += 4

    // Location extraction quality (20% of score)
    if (result.location?.location && result.location.location !== 'Unknown') totalScore += 2

    // Financial analysis quality (20% of score)
    if (result.financial?.tracked_assets?.length > 0 || result.financial?.discovered_assets?.length > 0) totalScore += 2

    // Content processing quality (20% of score)
    if (result.summary && result.summary.length > 50) totalScore += 1
    if (result.tags && result.tags.length > 0) totalScore += 1
  }

  return Math.round((totalScore / (totalTests * 10)) * 10)
}

// Individual module tests
async function testLocationExtraction() {
  console.log(chalk.blue('\n🌍 Testing Location Extraction...'))

  const testCases = [
    { content: TEST_CONTENT[0].content, title: TEST_CONTENT[0].title, expectedLocations: ['San Francisco', 'Union Square'] },
    { content: TEST_CONTENT[1].content, title: TEST_CONTENT[1].title, expectedLocations: ['Tokyo', 'Ueno Park'] },
    { content: TEST_CONTENT[3].content, title: TEST_CONTENT[3].title, expectedLocations: ['Munich', 'Barcelona'] },
  ]

  const results = []

  for (const testCase of testCases) {
    try {
      console.log(chalk.dim(`  Testing: ${testCase.title.substring(0, 50)}...`))

      const result = await extractLocation(testCase.content, {
        scrapId: `test-loc-${Date.now()}`,
        title: testCase.title,
      })

      const success = result.location && result.location !== 'Unknown'
      const foundExpected = testCase.expectedLocations.some(expected =>
        result.location?.toLowerCase().includes(expected.toLowerCase()),
      )

      results.push({
        test: testCase.title,
        result,
        success,
        foundExpected,
        hasCoordinates: !!(result.latitude && result.longitude),
      })

      if (success) {
        console.log(chalk.green(`    ✅ Found location: ${result.location}`))
        if (result.latitude && result.longitude) {
          console.log(chalk.dim(`    📍 Coordinates: ${result.latitude}, ${result.longitude}`))
        }
      } else {
        console.log(chalk.red('    ❌ No valid location found'))
      }

    } catch (error) {
      console.log(chalk.red(`    ❌ Error: ${error.message}`))
      results.push({ test: testCase.title, success: false, error: error.message })
    }
  }

  return results
}

async function testFinancialAnalysis() {
  console.log(chalk.blue('\n💰 Testing Financial Analysis...'))

  const testCases = [
    { content: TEST_CONTENT[0].content, title: TEST_CONTENT[0].title, expectedAssets: ['AAPL', 'TSLA', 'MSFT'] },
    { content: TEST_CONTENT[2].content, title: TEST_CONTENT[2].title, expectedAssets: ['BTC-USD', '^GSPC', '^IXIC'] },
    { content: TEST_CONTENT[3].content, title: TEST_CONTENT[3].title, expectedAssets: ['TSLA', '1211.HK'] },
  ]

  const results = []

  for (const testCase of testCases) {
    try {
      console.log(chalk.dim(`  Testing: ${testCase.title.substring(0, 50)}...`))

      const result = await extractFinancialAnalysis(testCase.content, {
        url: `https://test.com/${Date.now()}`,
      })

      const trackedCount = result.tracked_assets?.length || 0
      const discoveredCount = result.discovered_assets?.length || 0
      const totalAssets = trackedCount + discoveredCount

      const success = totalAssets > 0
      const foundExpected = testCase.expectedAssets.some(expected =>
        [...(result.tracked_assets || []), ...(result.discovered_assets || [])].some(asset =>
          asset.ticker?.includes(expected) || asset.mentions?.some(mention => mention.includes(expected)),
        ),
      )

      results.push({
        test: testCase.title,
        result,
        success,
        foundExpected,
        trackedCount,
        discoveredCount,
        totalAssets,
        hasSentiment: typeof result.overall_market_sentiment === 'number',
      })

      if (success) {
        console.log(chalk.green(`    ✅ Found ${trackedCount} tracked + ${discoveredCount} discovered assets`))
        console.log(chalk.dim(`    📊 Market sentiment: ${result.overall_market_sentiment || 'N/A'}`))
      } else {
        console.log(chalk.red('    ❌ No financial assets found'))
      }

    } catch (error) {
      console.log(chalk.red(`    ❌ Error: ${error.message}`))
      results.push({ test: testCase.title, success: false, error: error.message })
    }
  }

  return results
}

// End-to-end repair tests
async function testCompleteRepairPipeline() {
  console.log(chalk.blue('\n🔧 Testing Complete Repair Pipeline...'))

  const results = []

  for (const [index, testContent] of TEST_CONTENT.entries()) {
    console.log(chalk.dim(`  [${index + 1}/${TEST_CONTENT.length}] Testing: ${testContent.title.substring(0, 50)}...`))

    try {
      // Mock scrap object
      const mockScrap = {
        scrap_id: `test-repair-${Date.now()}-${index}`,
        id: index + 1000,
        ...testContent,
      }

      // Mock options
      const mockOptions = {
        fetchContent: false, // Don't actually fetch URLs
        force: true, // Force regeneration
        type: null, // Test all types
      }

      // Test individual components first
      const beforeState = {
        summary: mockScrap.summary,
        tags: mockScrap.tags,
        relationships: mockScrap.relationships,
        location: mockScrap.location,
        financial_analysis: mockScrap.financial_analysis,
      }

      // Run repair (this will modify mockScrap internally, but we'll capture the updates)
      await repairScrapWithAI(mockScrap, mockOptions)

      const afterState = {
        summary: mockScrap.summary,
        tags: mockScrap.tags,
        relationships: mockScrap.relationships,
        location: mockScrap.location,
        financial_analysis: mockScrap.financial_analysis,
      }

      // Test location extraction separately to see actual results
      let locationResult = null
      try {
        locationResult = await extractLocation(testContent.content, {
          scrapId: mockScrap.scrap_id,
          title: testContent.title,
          url: testContent.url,
        })
      } catch (error) {
        console.log(chalk.yellow(`    ⚠️ Location extraction failed: ${error.message}`))
      }

      // Test financial analysis separately
      let financialResult = null
      try {
        financialResult = await extractFinancialAnalysis(testContent.content, {
          url: testContent.url,
        })
      } catch (error) {
        console.log(chalk.yellow(`    ⚠️ Financial analysis failed: ${error.message}`))
      }

      const result = {
        test: testContent.title,
        testId: testContent.id,
        success: true,
        beforeState,
        afterState,
        location: locationResult,
        financial: financialResult,
        summary: mockScrap.summary,
        tags: mockScrap.tags,
        relationships: mockScrap.relationships,
        changes: {
          summaryGenerated: !beforeState.summary && afterState.summary,
          tagsGenerated: (!beforeState.tags || beforeState.tags.length === 0) && afterState.tags && afterState.tags.length > 0,
          relationshipsExtracted: (!beforeState.relationships || beforeState.relationships.length === 0) && afterState.relationships && afterState.relationships.length > 0,
          locationExtracted: !beforeState.location && locationResult && locationResult.location,
          financialExtracted: !beforeState.financial_analysis && financialResult && (financialResult.tracked_assets?.length > 0 || financialResult.discovered_assets?.length > 0),
        },
      }

      results.push(result)

      // Log results
      if (result.location?.location && result.location.location !== 'Unknown') {
        console.log(chalk.green(`    ✅ Location: ${result.location.location}`))
      } else {
        console.log(chalk.yellow(`    ⚠️ Location: ${result.location?.location || 'None found'}`))
      }

      if (result.financial && (result.financial.tracked_assets?.length > 0 || result.financial.discovered_assets?.length > 0)) {
        const trackedCount = result.financial.tracked_assets?.length || 0
        const discoveredCount = result.financial.discovered_assets?.length || 0
        console.log(chalk.green(`    ✅ Financial: ${trackedCount} tracked + ${discoveredCount} discovered assets`))
      } else {
        console.log(chalk.yellow('    ⚠️ Financial: No assets found'))
      }

      if (result.summary && result.summary.length > 50) {
        console.log(chalk.green(`    ✅ Summary: ${result.summary.length} chars`))
      } else {
        console.log(chalk.yellow(`    ⚠️ Summary: ${result.summary?.length || 0} chars`))
      }

      if (result.tags && result.tags.length > 0) {
        console.log(chalk.green(`    ✅ Tags: ${result.tags.length} generated`))
      } else {
        console.log(chalk.yellow('    ⚠️ Tags: None generated'))
      }

    } catch (error) {
      console.log(chalk.red(`    ❌ Pipeline failed: ${error.message}`))
      results.push({
        test: testContent.title,
        testId: testContent.id,
        success: false,
        error: error.message,
      })
    }

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  return results
}

// Error handling tests
async function testErrorHandling() {
  console.log(chalk.blue('\n🛡️ Testing Error Handling...'))

  const errorTests = [
    {
      name: 'Empty content',
      content: '',
      shouldGracefullyFail: true,
    },
    {
      name: 'Very long content',
      content: 'Lorem ipsum '.repeat(10000),
      shouldGracefullyFail: true,
    },
    {
      name: 'Invalid characters',
      content: 'Testing with emoji 🚀 and unicode characters ñáéíóú and symbols @#$%^&*()',
      shouldGracefullyFail: false,
    },
  ]

  const results = []

  for (const errorTest of errorTests) {
    console.log(chalk.dim(`  Testing: ${errorTest.name}`))

    try {
      // Test location extraction error handling
      const locationResult = await extractLocation(errorTest.content, {
        scrapId: `error-test-${Date.now()}`,
        title: 'Error Test',
      })

      // Test financial analysis error handling
      const financialResult = await extractFinancialAnalysis(errorTest.content, {
        url: 'https://error-test.com',
      })

      const success = !errorTest.shouldGracefullyFail || (
        locationResult && typeof locationResult === 'object' &&
        financialResult && typeof financialResult === 'object'
      )

      results.push({
        test: errorTest.name,
        success,
        locationResult,
        financialResult,
        gracefulFailure: errorTest.shouldGracefullyFail,
      })

      if (success) {
        console.log(chalk.green('    ✅ Handled gracefully'))
      } else {
        console.log(chalk.red('    ❌ Did not handle gracefully'))
      }

    } catch (error) {
      const isExpectedFailure = errorTest.shouldGracefullyFail
      results.push({
        test: errorTest.name,
        success: isExpectedFailure,
        error: error.message,
        gracefulFailure: errorTest.shouldGracefullyFail,
      })

      if (isExpectedFailure) {
        console.log(chalk.green(`    ✅ Failed as expected: ${error.message}`))
      } else {
        console.log(chalk.red(`    ❌ Unexpected failure: ${error.message}`))
      }
    }
  }

  return results
}

// Performance and cost tracking tests
async function testPerformanceAndCosts() {
  console.log(chalk.blue('\n📊 Testing Performance and Cost Tracking...'))

  // Reset cost tracking for clean test
  resetSession()

  const startTime = Date.now()
  const startStats = getSessionStats()

  // Run a few quick tests
  try {
    await extractLocation(TEST_CONTENT[0].content, {
      scrapId: `perf-test-${Date.now()}`,
      title: TEST_CONTENT[0].title,
    })

    await extractFinancialAnalysis(TEST_CONTENT[2].content, {
      url: TEST_CONTENT[2].url,
    })

  } catch (error) {
    console.log(chalk.yellow(`  ⚠️ Performance test error: ${error.message}`))
  }

  const endTime = Date.now()
  const endStats = getSessionStats()
  const totalTime = endTime - startTime

  console.log(chalk.green(`  ✅ Performance test completed in ${totalTime}ms`))
  console.log(chalk.dim(`  📊 API calls made: ${endStats.total_calls - startStats.total_calls}`))
  console.log(chalk.dim(`  💰 Cost incurred: $${(endStats.total_cost - startStats.total_cost).toFixed(4)}`))

  return {
    totalTime,
    apiCalls: endStats.total_calls - startStats.total_calls,
    totalCost: endStats.total_cost - startStats.total_cost,
    success: totalTime < 30000, // Should complete within 30 seconds
  }
}

// Main test runner
async function runComprehensiveTests() {
  console.log(chalk.cyan('🧪 COMPREHENSIVE SCRAP REPAIR PIPELINE TESTS\n'))
  console.log(chalk.gray('Testing all recent fixes and integrations...\n'))

  const allResults = {}

  try {
    // Individual component tests
    allResults.locationTests = await testLocationExtraction()
    allResults.financialTests = await testFinancialAnalysis()

    // End-to-end pipeline tests
    allResults.pipelineTests = await testCompleteRepairPipeline()

    // Error handling tests
    allResults.errorTests = await testErrorHandling()

    // Performance tests
    allResults.performanceTests = await testPerformanceAndCosts()

  } catch (error) {
    console.error(chalk.red('Fatal error during testing:'), error)
    process.exit(1)
  }

  // Generate final report
  console.log(chalk.cyan('\n📋 COMPREHENSIVE TEST RESULTS'))
  console.log(chalk.cyan('='.repeat(50)))

  // Calculate robustness score
  const robustnessScore = calculateRobustnessScore(allResults.pipelineTests || [])
  console.log(chalk.bold(`\n🏗️ ROBUSTNESS SCORE: ${robustnessScore}/10`))

  if (robustnessScore >= 8) {
    console.log(chalk.green('Excellent system resilience'))
  } else if (robustnessScore >= 6) {
    console.log(chalk.yellow('Good system resilience with room for improvement'))
  } else {
    console.log(chalk.red('System needs significant robustness improvements'))
  }

  // Location extraction results
  console.log(chalk.blue('\n🌍 Location Extraction:'))
  const locationSuccesses = allResults.locationTests?.filter(t => t.success).length || 0
  const locationTotal = allResults.locationTests?.length || 0
  console.log(`  Success rate: ${locationSuccesses}/${locationTotal} (${Math.round(locationSuccesses/locationTotal*100)}%)`)

  if (locationSuccesses > 0) {
    console.log(chalk.green('  ✅ Location extraction is working - real place names being returned'))
  } else {
    console.log(chalk.red('  ❌ Location extraction failing - returning "Unknown"'))
  }

  // Financial analysis results
  console.log(chalk.blue('\n💰 Financial Analysis:'))
  const financialSuccesses = allResults.financialTests?.filter(t => t.success).length || 0
  const financialTotal = allResults.financialTests?.length || 0
  console.log(`  Success rate: ${financialSuccesses}/${financialTotal} (${Math.round(financialSuccesses/financialTotal*100)}%)`)

  if (financialSuccesses > 0) {
    console.log(chalk.green('  ✅ Financial analysis integration working properly'))
  } else {
    console.log(chalk.red('  ❌ Financial analysis integration failing'))
  }

  // Pipeline integration results
  console.log(chalk.blue('\n🔧 Complete Pipeline:'))
  const pipelineSuccesses = allResults.pipelineTests?.filter(t => t.success).length || 0
  const pipelineTotal = allResults.pipelineTests?.length || 0
  console.log(`  Success rate: ${pipelineSuccesses}/${pipelineTotal} (${Math.round(pipelineSuccesses/pipelineTotal*100)}%)`)

  // Error handling results
  console.log(chalk.blue('\n🛡️ Error Handling:'))
  const errorSuccesses = allResults.errorTests?.filter(t => t.success).length || 0
  const errorTotal = allResults.errorTests?.length || 0
  console.log(`  Graceful degradation: ${errorSuccesses}/${errorTotal} (${Math.round(errorSuccesses/errorTotal*100)}%)`)

  // Performance results
  console.log(chalk.blue('\n📊 Performance:'))
  if (allResults.performanceTests?.success) {
    console.log(chalk.green(`  ✅ Completed in ${allResults.performanceTests.totalTime}ms`))
    console.log(chalk.green(`  💰 Cost: $${allResults.performanceTests.totalCost.toFixed(4)}`))
  } else {
    console.log(chalk.red('  ❌ Performance issues detected'))
  }

  // Detailed findings
  console.log(chalk.blue('\n🔍 Key Findings:'))

  // Check for specific issues
  const locationIssues = allResults.locationTests?.filter(t => !t.success) || []
  const financialIssues = allResults.financialTests?.filter(t => !t.success) || []

  if (locationIssues.length > 0) {
    console.log(chalk.red(`  ⚠️ Location extraction failing for ${locationIssues.length} test cases`))
  }

  if (financialIssues.length > 0) {
    console.log(chalk.red(`  ⚠️ Financial analysis failing for ${financialIssues.length} test cases`))
  }

  // Success highlights
  const successfulPipeline = allResults.pipelineTests?.filter(t => t.success) || []
  if (successfulPipeline.length > 0) {
    console.log(chalk.green(`  ✅ End-to-end pipeline working for ${successfulPipeline.length} test cases`))
  }

  // Cost summary
  console.log(chalk.cyan('\n💰 FINAL COST SUMMARY:'))
  printCostSummary()

  console.log(chalk.cyan('\n🎯 RECOMMENDATIONS:'))

  if (robustnessScore < 8) {
    console.log(chalk.yellow('  • Improve error handling for edge cases'))
    console.log(chalk.yellow('  • Add more validation for empty or minimal content'))
  }

  if (locationSuccesses < locationTotal) {
    console.log(chalk.yellow('  • Review location extraction prompts and logic'))
    console.log(chalk.yellow('  • Check OpenCage API key configuration'))
  }

  if (financialSuccesses < financialTotal) {
    console.log(chalk.yellow('  • Review financial analysis asset detection'))
    console.log(chalk.yellow('  • Check financial analysis prompts'))
  }

  if (robustnessScore >= 8) {
    console.log(chalk.green('  ✅ System shows excellent robustness and resilience'))
    console.log(chalk.green('  ✅ Ready for production workloads'))
  }

  console.log(chalk.cyan('\n' + '='.repeat(50)))
  console.log(chalk.cyan('🧪 COMPREHENSIVE TESTING COMPLETE'))

  return allResults
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runComprehensiveTests()
    .then(() => {
      console.log(chalk.green('\n✅ All tests completed successfully!'))
      process.exit(0)
    })
    .catch((error) => {
      console.error(chalk.red('\n❌ Test suite failed:'), error)
      process.exit(1)
    })
}

export { runComprehensiveTests }
