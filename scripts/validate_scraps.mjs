import { fetchBookmarksWithCache, processBookmark } from "./dl_pinboard.mjs";
import { fetchStatuses, processStatus } from "./dl_mastodon.mjs";
import { fetchAllBlocks, processBlock } from "./dl_arena.mjs";
import { fetchGithubData } from "./dl_github.mjs";
import chalk from 'chalk';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';
import axios from 'axios';

console.log(`
==================================
   SCRAPBOOK VALIDATION UTILITY   
==================================
`);

// Benchmarking helpers
const benchmarks = {
  startTime: null,
  marks: new Map(),
  results: []
};

function startBenchmark(label) {
  benchmarks.marks.set(label, performance.now());
}

function endBenchmark(label) {
  const start = benchmarks.marks.get(label);
  const duration = performance.now() - start;
  benchmarks.results.push({
    label,
    duration,
    timestamp: new Date().toISOString()
  });
  return duration;
}

async function saveBenchmarks() {
  const logEntry = benchmarks.results.map(result => 
    `[${result.timestamp}] ${result.label}: ${result.duration.toFixed(2)}ms`
  ).join('\n') + '\n\n';

  await fs.appendFile('benchmarks.log', logEntry);
}

// Type definitions for validation
const VALID_SOURCES = ['pinboard', 'mastodon', 'arena', 'github'];
const VALID_TYPES = ['bookmark', 'status', 'block', 'repo', 'pr', 'issue', 'gist', 'release', 'starred'];

async function validateScrap(scrap) {
  startBenchmark(`validate_${scrap.source}_${scrap.type}`);
  
  console.log('\n+------------------------+');
  console.log('| VALIDATING SCRAP      |');
  console.log('+------------------------+');
  console.log(`Source: ${scrap.source}`);
  console.log(`Type: ${scrap.type}`);
  console.log(`URL: ${scrap.url?.substring(0, 50)}...`);

  const errors = [];
  const warnings = [];

  // Required fields with fancy progress display
  console.log('\n[CHECKING REQUIRED FIELDS]');
  const required = {
    id: 'string',
    source: 'string',
    type: 'string',
    url: 'string',
    title: 'string',
    content: 'string',
    published_at: 'string',
    created_at: 'string',
    updated_at: 'string',
    shared: 'boolean',
    tags: 'array',
    metadata: 'object'
  };

  // Check required fields and types with progress bar
  Object.entries(required).forEach(([field, type]) => {
    process.stdout.write(`  ${field.padEnd(12)} `);
    
    if (!scrap[field]) {
      process.stdout.write(chalk.red('[MISSING]\n'));
      errors.push(`Missing required field: ${field}`);
    } else if (type === 'array' && !Array.isArray(scrap[field])) {
      process.stdout.write(chalk.red('[NOT ARRAY]\n'));
      errors.push(`${field} must be an array`);
    } else if (type !== 'array' && typeof scrap[field] !== type) {
      process.stdout.write(chalk.red(`[NOT ${type.toUpperCase()}]\n`));
      errors.push(`${field} must be type ${type}`);
    } else {
      process.stdout.write(chalk.green('[OK]\n'));
    }
  });

  // Validate source
  console.log('\n[CHECKING SOURCE]');
  if (!VALID_SOURCES.includes(scrap.source)) {
    console.log(chalk.red(`  Invalid source: ${scrap.source}`));
    errors.push(`Invalid source: ${scrap.source}`);
  } else {
    console.log(chalk.green(`  Source: ${scrap.source} [VALID]`));
  }

  // Validate type
  console.log('\n[CHECKING TYPE]');
  if (!VALID_TYPES.includes(scrap.type)) {
    console.log(chalk.red(`  Invalid type: ${scrap.type}`));
    errors.push(`Invalid type: ${scrap.type}`);
  } else {
    console.log(chalk.green(`  Type: ${scrap.type} [VALID]`));
  }

  // Validate URL format
  console.log('\n[CHECKING URL]');
  try {
    new URL(scrap.url);
    console.log(chalk.green('  URL format [VALID]'));
  } catch {
    console.log(chalk.red('  URL format [INVALID]'));
    errors.push('Invalid URL format');
  }

  // Validate screenshot URL if present
  if (scrap.screenshot_url) {
    console.log('\n[CHECKING SCREENSHOT URL]');
    if (!scrap.screenshot_url.startsWith('https://')) {
      console.log(chalk.red('  Screenshot URL must be HTTPS'));
      errors.push('Screenshot URL must be HTTPS');
    }
    if (!scrap.screenshot_url.includes('/screenshots/')) {
      console.log(chalk.red('  Invalid screenshot URL path format'));
      errors.push('Invalid screenshot URL path format');
    }
  }

  // Validate dates
  console.log('\n[CHECKING DATES]');
  ['published_at', 'created_at', 'updated_at'].forEach(dateField => {
    process.stdout.write(`  ${dateField.padEnd(12)} `);
    const date = new Date(scrap[dateField]);
    if (isNaN(date.getTime())) {
      process.stdout.write(chalk.red('[INVALID]\n'));
      errors.push(`Invalid ${dateField} date format`);
    } else {
      process.stdout.write(chalk.green('[VALID]\n'));
    }
  });

  // Validate relationships if present
  if (scrap.relationships) {
    console.log('\n[CHECKING RELATIONSHIPS]');
    if (!Array.isArray(scrap.relationships)) {
      console.log(chalk.red('  Relationships must be an array'));
      errors.push('Relationships must be an array');
    } else {
      scrap.relationships.forEach((rel, index) => {
        process.stdout.write(`  Relationship #${index + 1} `);
        if (!rel.source?.type || !rel.source?.name || 
            !rel.target?.type || !rel.target?.name || 
            !rel.type) {
          process.stdout.write(chalk.red('[INVALID]\n'));
          errors.push(`Invalid relationship structure at index ${index}`);
        } else {
          process.stdout.write(chalk.green('[VALID]\n'));
        }
      });
    }
  }

  // Optional fields warnings
  console.log('\n[CHECKING OPTIONAL FIELDS]');
  if (!scrap.location && (scrap.latitude || scrap.longitude)) {
    console.log(chalk.yellow('  ⚠ Location missing but coordinates present'));
    warnings.push('Location missing but coordinates present');
  }

  // Final results
  console.log('\n+------------------------+');
  console.log('| VALIDATION RESULTS     |');
  console.log('+------------------------+');
  
  if (errors.length === 0) {
    console.log(chalk.green('\n✓ SCRAP PASSED VALIDATION'));
    if (warnings.length > 0) {
      console.log(chalk.yellow('\nWarnings:'));
      warnings.forEach(w => console.log(chalk.yellow(`  ⚠ ${w}`)));
    }
  } else {
    console.log(chalk.red('\n✗ SCRAP FAILED VALIDATION'));
    console.log(chalk.red('\nErrors:'));
    errors.forEach(e => console.log(chalk.red(`  ✗ ${e}`)));
    console.log(chalk.yellow('\nWarnings:'));
    warnings.forEach(w => console.log(chalk.yellow(`  ⚠ ${w}`)));
  }

  const duration = endBenchmark(`validate_${scrap.source}_${scrap.type}`);
  console.log(chalk.blue(`\nValidation took ${duration.toFixed(2)}ms`));

  return { errors, warnings };
}

async function validateSource(source, count = 5) {
  // Set test mode env var
  process.env.TEST_MODE = 'true';
  
  startBenchmark(`fetch_${source}`);
  
  console.log(`
+------------------------+
| FETCHING ${source.toUpperCase().padEnd(11)} DATA |
+------------------------+
`);
  
  let scraps = [];
  
  switch(source) {
    case 'pinboard':
      process.stdout.write('Fetching bookmarks from Pinboard API...');
      // Use recent endpoint for validation instead of all
      const response = await axios.get("https://api.pinboard.in/v1/posts/recent", {
        params: {
          auth_token: process.env.PINBOARD_TOKEN,
          format: "json",
          count: 5 // Just get 5 most recent
        }
      });
      const bookmarks = response.data.posts;
      console.log(chalk.green(` Found ${bookmarks.length} recent bookmarks`));
      
      process.stdout.write('Processing bookmarks...\n');
      scraps = await Promise.all(
        bookmarks.map(async (bookmark, i) => {
          process.stdout.write(`  [${i + 1}/${bookmarks.length}] Processing bookmark: ${bookmark.href.substring(0, 40)}...\r`);
          return await processBookmark(bookmark);
        })
      );
      console.log('\n');
      break;
      
    case 'mastodon':
      process.stdout.write('Fetching user ID...');
      const userId = await fetchUserId();
      console.log(chalk.green(` Found: ${userId}`));
      
      process.stdout.write('Fetching statuses...');
      const statuses = await fetchStatuses(userId);
      console.log(chalk.green(` Found ${statuses.length} statuses`));
      
      process.stdout.write('Processing first 5 statuses...\n');
      scraps = await Promise.all(
        statuses.slice(0, count).map(async (status, i) => {
          process.stdout.write(`  [${i + 1}/${count}] Processing status: ${status.id}\r`);
          return await processStatus(status);
        })
      );
      console.log('\n');
      break;
      
    case 'arena':
      process.stdout.write('Fetching blocks...');
      const blocks = await fetchAllBlocks();
      console.log(chalk.green(` Found ${blocks.length} blocks`));
      
      process.stdout.write('Processing first 5 blocks...\n');
      scraps = await Promise.all(
        blocks.slice(0, count).map(async (block, i) => {
          process.stdout.write(`  [${i + 1}/${count}] Processing block: ${block.title || block.id}\r`);
          return await processBlock(block);
        })
      );
      console.log('\n');
      break;
      
    case 'github':
      process.stdout.write('Fetching GitHub data...');
      const githubData = await fetchGithubData();
      const totalItems = Object.values(githubData).flat().length;
      console.log(chalk.green(` Found ${totalItems} items`));
      
      scraps = Object.values(githubData)
        .flat()
        .slice(0, count);
      console.log(`Processing first ${scraps.length} items...\n`);
      break;
  }

  const fetchDuration = endBenchmark(`fetch_${source}`);
  console.log(chalk.blue(`\nFetching ${source} took ${fetchDuration.toFixed(2)}ms`));

  startBenchmark(`process_${source}`);
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const scrap of scraps) {
    const { errors, warnings } = await validateScrap(scrap);
    totalErrors += errors.length;
    totalWarnings += warnings.length;
  }

  const processDuration = endBenchmark(`process_${source}`);
  console.log(chalk.blue(`Processing ${source} took ${processDuration.toFixed(2)}ms`));

  return { totalErrors, totalWarnings, processed: scraps.length };
}

// Main validation
async function main() {
  benchmarks.startTime = performance.now();
  const sources = process.argv[2] ? [process.argv[2]] : VALID_SOURCES;
  const results = {};

  console.log(chalk.blue('\nStarting validation at:', new Date().toISOString()));

  for (const source of sources) {
    if (!VALID_SOURCES.includes(source)) {
      console.log(chalk.red(`Invalid source: ${source}`));
      continue;
    }

    startBenchmark(`total_${source}`);
    const { totalErrors, totalWarnings, processed } = await validateSource(source);
    const sourceDuration = endBenchmark(`total_${source}`);
    
    results[source] = { 
      totalErrors, 
      totalWarnings, 
      processed,
      duration: sourceDuration 
    };
  }

  // Print summary with timing info
  console.log('\nValidation Summary:');
  Object.entries(results).forEach(([source, { totalErrors, totalWarnings, processed, duration }]) => {
    const status = totalErrors === 0 ? chalk.green('PASS') : chalk.red('FAIL');
    console.log(
      `${status} ${source}: ${processed} scraps, ${totalErrors} errors, ` +
      `${totalWarnings} warnings (${duration.toFixed(2)}ms)`
    );
  });

  const totalDuration = performance.now() - benchmarks.startTime;
  console.log(chalk.blue(`\nTotal validation time: ${totalDuration.toFixed(2)}ms`));

  // Save benchmarks to log file
  await saveBenchmarks();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 