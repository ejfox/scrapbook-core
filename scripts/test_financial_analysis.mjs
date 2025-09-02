#!/usr/bin/env node

import { extractFinancialAnalysis, getTrackedAssets, isTrackedAsset } from "./aiFinancialAnalysis.mjs";
import chalk from "chalk";
import dotenv from "dotenv";

dotenv.config();

// Test content samples
const testCases = [
  {
    name: "Tech Stock News",
    content: `Apple (AAPL) reported strong quarterly earnings today, beating analyst expectations. 
    The iPhone maker saw revenue growth of 15% year-over-year, driven by strong demand for the iPhone 15 series.
    Meanwhile, Tesla (TSLA) shares dropped 5% after Elon Musk's latest Twitter controversy.
    Microsoft (MSFT) and Google (GOOGL) are also showing positive momentum in the AI space.`
  },
  {
    name: "Crypto Market Update", 
    content: `Bitcoin (BTC) surged past $45,000 today following news of institutional adoption.
    Ethereum (ETH) also gained 8%, while the broader market including S&P 500 (^GSPC) showed mixed signals.
    Solana (SOL) gained momentum in the DeFi space with new protocol launches.`
  },
  {
    name: "Market Update with Commodities",
    content: `Gold (GC=F) reached new highs amid inflation concerns, while crude oil (CL=F) dropped on supply fears.
    The S&P 500 (SPY) ETF saw heavy volume as investors rotated from growth to value.
    Silver (SI=F) also gained ground as precious metals attracted safe-haven flows.`
  },
  {
    name: "No Financial Content",
    content: `Today I went to the park and saw some beautiful flowers. The weather was perfect for a walk,
    and I met up with some friends for coffee. We talked about books, movies, and travel plans.
    It was a lovely day overall.`
  },
  {
    name: "Mixed Content with Non-Tracked Assets",
    content: `I've been reading about the future of AI and its impact on society. Companies like 
    NVIDIA (NVDA) are leading the charge in AI hardware, while Palantir (PLTR) focuses on data analytics.
    Unity Software (U) dropped 15% after earnings miss, and MongoDB (MDB) gained on strong cloud adoption.
    Even smaller players like Snowflake (SNOW) and CrowdStrike (CRWD) are showing resilience.`
  }
];

async function runTests() {
  console.log(chalk.blue.bold("\n🧪 Financial Analysis Module Test Suite\n"));
  
  // Display tracked assets summary
  const trackedAssets = getTrackedAssets();
  console.log(chalk.cyan(`📊 Tracking ${Object.keys(trackedAssets).length} financial assets (canonical finance-prism list)\n`));
  
  if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.log(chalk.yellow("⚠️  No API keys found - using fallback mode\n"));
  }

  // Run tests
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(chalk.blue(`\n🧪 Test ${i + 1}: ${chalk.bold(testCase.name)}`));
    console.log(chalk.gray("Content:"), testCase.content.substring(0, 100) + "...");
    
    try {
      const startTime = Date.now();
      const result = await extractFinancialAnalysis(testCase.content);
      const duration = Date.now() - startTime;
      
      console.log(chalk.green(`✅ Completed in ${duration}ms`));
      
      if (result.assets && result.assets.length > 0) {
        const trackedCount = result.tracked_assets?.length || 0;
        const discoveredCount = result.discovered_assets?.length || 0;
        console.log(chalk.cyan(`📈 Found ${result.assets.length} financial assets (${trackedCount} tracked, ${discoveredCount} discovered):`));
        
        // Show tracked assets
        if (trackedCount > 0) {
          console.log(chalk.blue("\n  📊 Tracked Assets:"));
          result.tracked_assets.forEach(asset => {
            const sentimentEmoji = asset.sentiment_score > 0.1 ? "📈" : 
                                  asset.sentiment_score < -0.1 ? "📉" : "➡️";
            const sentimentColor = asset.sentiment_score > 0.1 ? chalk.green : 
                                  asset.sentiment_score < -0.1 ? chalk.red : chalk.yellow;
            
            console.log(`    ${sentimentEmoji} ${chalk.bold(asset.ticker)} (${asset.name})`);
            console.log(`      Sentiment: ${sentimentColor(asset.sentiment_score.toFixed(2))} - ${asset.sentiment_reasoning || 'N/A'}`);
          });
        }
        
        // Show discovered assets
        if (discoveredCount > 0) {
          console.log(chalk.magenta("\n  🔍 Discovered Assets:"));
          result.discovered_assets.forEach(asset => {
            const sentimentEmoji = asset.sentiment_score > 0.1 ? "📈" : 
                                  asset.sentiment_score < -0.1 ? "📉" : "➡️";
            const sentimentColor = asset.sentiment_score > 0.1 ? chalk.green : 
                                  asset.sentiment_score < -0.1 ? chalk.red : chalk.yellow;
            const typeEmoji = asset.asset_type === 'crypto' ? '₿' : 
                             asset.asset_type === 'etf' ? '📈' :
                             asset.asset_type === 'commodity' ? '🏗️' : '📊';
            
            console.log(`    ${typeEmoji} ${sentimentEmoji} ${chalk.bold(asset.ticker)} (${asset.name}) [${asset.asset_type}]`);
            console.log(`      Sentiment: ${sentimentColor(asset.sentiment_score.toFixed(2))} - ${asset.sentiment_reasoning || 'N/A'}`);
          });
        }
        
        if (result.overall_market_sentiment !== undefined) {
          const marketEmoji = result.overall_market_sentiment > 0.1 ? "🔥" :
                             result.overall_market_sentiment < -0.1 ? "❄️" : "🤔";
          console.log(`\n  ${marketEmoji} Overall Market Sentiment: ${chalk.bold(result.overall_market_sentiment.toFixed(2))}`);
          console.log(`    ${result.market_reasoning}`);
        }
      } else {
        console.log(chalk.yellow("📭 No financial assets detected"));
      }
      
    } catch (error) {
      console.log(chalk.red(`❌ Test failed: ${error.message}`));
    }
    
    console.log(chalk.gray("─".repeat(80)));
  }

  // Test utility functions
  console.log(chalk.blue("\n🔧 Testing Utility Functions:"));
  
  const testTickers = ["AAPL", "^GSPC", "BTC-USD", "CL=F", "INVALID", "xyz"];
  testTickers.forEach(ticker => {
    const isTracked = isTrackedAsset(ticker);
    const status = isTracked ? chalk.green("✅ Tracked") : chalk.red("❌ Not tracked");
    console.log(`  ${ticker}: ${status}`);
  });

  console.log(chalk.blue.bold("\n✨ Test suite completed!\n"));
}

// Handle script execution
if (process.argv[1].endsWith('test_financial_analysis.mjs')) {
  runTests().catch(error => {
    console.error(chalk.red("Test suite failed:"), error);
    process.exit(1);
  });
}