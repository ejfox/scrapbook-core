#!/usr/bin/env node

import chalk from 'chalk';
import { extractFinancialAnalysis } from './scripts/aiFinancialAnalysis.mjs';

// Sample product page content that should contain pricing/financial data
const sampleProductContent = `
CADDX FPV Vista Kit Digital HD System
Price: $179.99
Original Price: $199.99 (Save $20.00)

Product Description:
The CADDX Vista is a revolutionary digital HD FPV system that brings crystal clear video transmission to your drone racing and freestyle experience. With its compact design and advanced DJI compatibility, this system delivers professional-quality footage.

Key Features:
- 1080p60 HD recording
- Ultra-low latency transmission
- Compatible with DJI FPV Goggles
- Lightweight design at only 30g
- Easy installation

Stock Status: In Stock (15 units available)
Shipping: Free shipping on orders over $150

Customer Reviews: 4.8/5 stars (234 reviews)
Warranty: 1-year manufacturer warranty

Similar Products:
- DJI FPV Air Unit - $189.99
- RunCam Link Phoenix - $159.99
- Caddx Nebula Pro - $129.99

Payment Options:
- PayPal accepted
- Credit cards accepted
- Buy now, pay later with Klarna (4 payments of $45.00)
`;

const oxilineProductContent = `
Oxiline Pulse 9 Pro Blood Pressure Monitor
Sale Price: $79.95
List Price: $119.99
You Save: $40.04 (33% off)

FDA Approved Medical Device
Free shipping on all orders

Product Features:
- Large LCD display
- Bluetooth connectivity
- Memory for 2 users (120 readings each)
- WHO blood pressure classification
- Irregular heartbeat detection

What's Included:
- Oxiline Pulse 9 Pro monitor
- Universal cuff (fits 8.7"-15.7" arms)
- Storage case
- Quick start guide
- AAA batteries (4 included)

Financing Available:
- PayPal Pay in 4: 4 payments of $19.99
- Affirm: As low as $7/month for 12 months
- Apple Pay available

Market Position:
Competing with Omron Platinum ($99.99) and Withings BPM ($129.99)
Rated #3 Best Blood Pressure Monitor by HealthTech Review 2024
`;

async function testFinancialExtraction() {
  console.log(chalk.cyan('🧪 Testing Financial Analysis Integration\n'));

  // Test 1: CADDX FPV Product
  console.log(chalk.yellow('Test 1: CADDX FPV Product Page'));
  console.log(chalk.gray('=' .repeat(50)));

  try {
    const caddxAnalysis = await extractFinancialAnalysis(sampleProductContent, {
      url: 'https://example.com/caddx-fpv-vista-kit',
      isRawText: false
    });

    console.log(chalk.green('✅ CADDX Analysis Results:'));
    console.log(JSON.stringify(caddxAnalysis, null, 2));
  } catch (error) {
    console.log(chalk.red('❌ CADDX Analysis Failed:'), error.message);
  }

  console.log('\n' + chalk.gray('=' .repeat(50)) + '\n');

  // Test 2: Oxiline Product
  console.log(chalk.yellow('Test 2: Oxiline Blood Pressure Monitor'));
  console.log(chalk.gray('=' .repeat(50)));

  try {
    const oxilineAnalysis = await extractFinancialAnalysis(oxilineProductContent, {
      url: 'https://example.com/oxiline-pulse-9-pro',
      isRawText: false
    });

    console.log(chalk.green('✅ Oxiline Analysis Results:'));
    console.log(JSON.stringify(oxilineAnalysis, null, 2));
  } catch (error) {
    console.log(chalk.red('❌ Oxiline Analysis Failed:'), error.message);
  }

  console.log('\n' + chalk.gray('=' .repeat(50)) + '\n');

  // Test 3: Non-financial content (should return minimal data)
  console.log(chalk.yellow('Test 3: Non-Financial Content (Control Test)'));
  console.log(chalk.gray('=' .repeat(50)));

  const nonFinancialContent = `
  How to Build a Better Todo App with React

  In this tutorial, we'll explore building a modern todo application using React hooks and context.
  We'll cover state management, component composition, and styling best practices.

  Prerequisites:
  - Basic JavaScript knowledge
  - Familiarity with React concepts
  - Node.js installed

  Let's start by setting up our project structure...
  `;

  try {
    const nonFinancialAnalysis = await extractFinancialAnalysis(nonFinancialContent, {
      url: 'https://example.com/react-todo-tutorial',
      isRawText: false
    });

    console.log(chalk.green('✅ Non-Financial Analysis Results:'));
    console.log(JSON.stringify(nonFinancialAnalysis, null, 2));
  } catch (error) {
    console.log(chalk.red('❌ Non-Financial Analysis Failed:'), error.message);
  }

  console.log(chalk.blue('\n🎯 Test Summary:'));
  console.log(chalk.dim('The financial extraction should:'));
  console.log(chalk.dim('1. Extract pricing data from product pages'));
  console.log(chalk.dim('2. Identify any mentioned financial assets/companies'));
  console.log(chalk.dim('3. Return minimal data for non-financial content'));
  console.log(chalk.dim('4. Provide sentiment analysis when relevant'));
}

// Run the test
testFinancialExtraction().catch(error => {
  console.error(chalk.red('Test failed:'), error);
  process.exit(1);
});