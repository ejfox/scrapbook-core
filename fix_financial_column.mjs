#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function addFinancialAnalysisColumn() {
  console.log(chalk.cyan('🔧 FIXING FINANCIAL ANALYSIS COLUMN\n'));

  try {
    // First check if column already exists
    console.log(chalk.yellow('Checking if column already exists...'));

    const { data: testData, error: testError } = await supabase
      .from('scraps')
      .select('scrap_id, financial_analysis')
      .limit(1);

    if (!testError) {
      console.log(chalk.green('✅ Column already exists!'));
      return true;
    }

    console.log(chalk.yellow('Column does not exist, adding it now...'));

    // Use Supabase SQL to add the column
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `ALTER TABLE scraps ADD COLUMN IF NOT EXISTS financial_analysis JSONB;`
    });

    if (error) {
      // Try alternative approach using direct SQL
      console.log(chalk.yellow('Trying alternative approach...'));

      // This requires using the Supabase Dashboard or direct SQL access
      console.log(chalk.red(`
❌ Cannot add column programmatically. Please run this SQL in Supabase Dashboard:

${chalk.white('ALTER TABLE scraps ADD COLUMN financial_analysis JSONB;')}

Steps:
1. Go to ${chalk.cyan(process.env.SUPABASE_URL)}
2. Navigate to SQL Editor
3. Run the command above
4. Click "Run"
`));

      console.log(chalk.yellow('\n🔗 Direct link to SQL editor:'));
      console.log(chalk.cyan(`${process.env.SUPABASE_URL}/project/default/sql`));

      return false;
    }

    console.log(chalk.green('✅ Column added successfully!'));

    // Verify it worked
    const { data: verifyData, error: verifyError } = await supabase
      .from('scraps')
      .select('scrap_id, financial_analysis')
      .limit(1);

    if (!verifyError) {
      console.log(chalk.green('✅ Verified: Column is working!'));
      return true;
    }

  } catch (error) {
    console.error(chalk.red('Error:', error.message));
    return false;
  }
}

// Test saving financial data
async function testFinancialAnalysis() {
  console.log(chalk.cyan('\n🧪 Testing financial analysis save...'));

  const testData = {
    tracked_assets: [
      { symbol: 'AAPL', sentiment: 0.8 },
      { symbol: 'GOOGL', sentiment: 0.6 }
    ],
    discovered_assets: [
      { name: 'Bitcoin', type: 'crypto', sentiment: 0.3 }
    ],
    overall_market_sentiment: 0.5,
    test: true,
    timestamp: new Date().toISOString()
  };

  // Find a random scrap to test with
  const { data: scraps } = await supabase
    .from('scraps')
    .select('scrap_id')
    .limit(1);

  if (scraps && scraps[0]) {
    const { error } = await supabase
      .from('scraps')
      .update({ financial_analysis: testData })
      .eq('scrap_id', scraps[0].scrap_id);

    if (error) {
      console.error(chalk.red('❌ Test failed:', error.message));
      return false;
    }

    console.log(chalk.green('✅ Financial data saved successfully!'));
    console.log(chalk.gray(`   Test scrap: ${scraps[0].scrap_id}`));
    return true;
  }
}

// Run the fix
async function main() {
  const testOnly = process.argv[2] === 'test';

  if (testOnly) {
    console.log(chalk.cyan.bold('\n🧪 TESTING FINANCIAL ANALYSIS COLUMN\n'));
    console.log('═'.repeat(50));

    // Check if column exists
    const { error: checkError } = await supabase
      .from('scraps')
      .select('scrap_id, financial_analysis')
      .limit(1);

    if (checkError) {
      console.log(chalk.red('❌ Column still missing! Please add it via Supabase Dashboard.'));
      return;
    }

    console.log(chalk.green('✅ Column exists!'));
    const testPassed = await testFinancialAnalysis();

    if (testPassed) {
      console.log(chalk.green.bold('\n🎉 FINANCIAL ANALYSIS FULLY WORKING!'));
      console.log(chalk.cyan('You can now run your scrapbook processing without errors!'));
    }

  } else {
    console.log(chalk.cyan.bold('\n💰 FINANCIAL ANALYSIS DATABASE FIX\n'));
    console.log('═'.repeat(50));

    const columnAdded = await addFinancialAnalysisColumn();

    if (columnAdded) {
      const testPassed = await testFinancialAnalysis();

      if (testPassed) {
        console.log(chalk.green.bold('\n🎉 COMPLETE SUCCESS!'));
        console.log(chalk.green('Financial analysis is now fully operational!'));
      }
    } else {
      console.log(chalk.yellow('\n⚠️  Manual action required (see instructions above)'));
      console.log(chalk.cyan('\nAfter adding the column, run: node fix_financial_column.mjs test'));
    }
  }

  console.log('═'.repeat(50));
}

main();