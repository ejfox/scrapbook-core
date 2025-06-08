#!/usr/bin/env node

import axios from 'axios';
import chalk from 'chalk';
import { program } from 'commander';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { formatDistanceToNow, parseISO, format } from 'date-fns';

dotenv.config();

const LOKI_URL = 'https://loki.tools.ejfox.com';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

program
  .name('log-detective')
  .description('🕵️ Investigate what went wrong with your scrapbook processing')
  .version('1.0.0');

program
  .command('investigate')
  .description('Analyze recent logs and processing issues')
  .option('-d, --days <days>', 'Look back N days', '7')
  .option('-s, --source <source>', 'Focus on specific source')
  .action(investigate);

program
  .command('timeline')
  .description('Show processing timeline with errors')
  .option('-d, --days <days>', 'Look back N days', '3')
  .action(showTimeline);

program
  .command('health-degradation')
  .description('Find when processing quality started declining')
  .action(findHealthDegradation);

async function investigate(options) {
  console.log(chalk.cyan('🕵️ Log Detective - Investigating Processing Issues\n'));
  
  const daysBack = parseInt(options.days);
  const now = new Date();
  const startTime = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  
  console.log(chalk.blue(`🔍 Analyzing logs from ${format(startTime, 'MMM dd')} to ${format(now, 'MMM dd')}\n`));
  
  try {
    // 1. Check Loki logs for errors
    console.log(chalk.yellow('📜 Checking Loki logs for errors...'));
    const errors = await queryLokiErrors(startTime, now, options.source);
    
    // 2. Check database for processing gaps  
    console.log(chalk.yellow('🗄️ Checking database for processing patterns...'));
    const dbAnalysis = await analyzeDatabasePatterns(startTime, now, options.source);
    
    // 3. Cross-reference with successful processing
    console.log(chalk.yellow('✅ Finding successful processing examples...'));
    const successes = await findSuccessfulProcessing(startTime, now);
    
    // Display findings
    displayInvestigationResults(errors, dbAnalysis, successes, daysBack);
    
  } catch (error) {
    console.error(chalk.red('❌ Investigation failed:'), error.message);
  }
}

async function queryLokiErrors(startTime, endTime, source) {
  const query = source ? 
    `{job="scrapbook"} |~ "error|Error|ERROR" |= "${source}"` :
    `{job="scrapbook"} |~ "error|Error|ERROR"`;
  
  const startNano = Math.floor(startTime.getTime() * 1000000).toString(); // Convert to nanoseconds
  const endNano = Math.floor(endTime.getTime() * 1000000).toString();
  
  try {
    const url = `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(query)}&start=${startNano}&end=${endNano}&limit=100`;
    
    const response = await axios.get(url);
    
    if (response.data?.data?.result?.length > 0) {
      const errors = [];
      response.data.data.result.forEach(stream => {
        if (stream.values) {
          stream.values.forEach(([timestamp, logLine]) => {
            errors.push({
              timestamp: new Date(parseInt(timestamp) / 1000000), // Convert from nanoseconds
              message: logLine,
              labels: stream.stream
            });
          });
        }
      });
      return errors.sort((a, b) => b.timestamp - a.timestamp);
    }
    
    return [];
  } catch (error) {
    console.warn(chalk.yellow(`⚠️ Could not query Loki: ${error.message}`));
    return [];
  }
}

async function analyzeDatabasePatterns(startTime, endTime, source) {
  let query = supabase
    .from('scraps')
    .select('*')
    .gte('created_at', startTime.toISOString())
    .lte('created_at', endTime.toISOString())
    .order('created_at', { ascending: false });
  
  if (source) {
    query = query.eq('source', source);
  }
  
  const { data: scraps, error } = await query;
  if (error) throw error;
  
  // Analyze patterns
  const analysis = {
    total: scraps.length,
    bySources: {},
    missingFields: {
      summary: 0,
      embedding: 0,
      screenshot: 0,
      tags: 0
    },
    processingInstances: {},
    timeGaps: []
  };
  
  scraps.forEach(scrap => {
    // By source
    if (!analysis.bySources[scrap.source]) {
      analysis.bySources[scrap.source] = { total: 0, healthy: 0 };
    }
    analysis.bySources[scrap.source].total++;
    
    // Missing fields
    if (!scrap.summary || scrap.summary.trim() === '') analysis.missingFields.summary++;
    if (!scrap.embedding) analysis.missingFields.embedding++;
    if (!scrap.screenshot_url && scrap.url) analysis.missingFields.screenshot++;
    if (!scrap.tags || scrap.tags.length === 0) analysis.missingFields.tags++;
    
    // Check if healthy
    const isHealthy = scrap.summary && scrap.embedding && (scrap.screenshot_url || !scrap.url);
    if (isHealthy) analysis.bySources[scrap.source].healthy++;
    
    // Processing instances
    if (scrap.processing_instance_id) {
      if (!analysis.processingInstances[scrap.processing_instance_id]) {
        analysis.processingInstances[scrap.processing_instance_id] = 0;
      }
      analysis.processingInstances[scrap.processing_instance_id]++;
    }
  });
  
  // Find time gaps in processing
  if (scraps.length > 1) {
    for (let i = 0; i < scraps.length - 1; i++) {
      const current = new Date(scraps[i].created_at);
      const next = new Date(scraps[i + 1].created_at);
      const gapHours = (current - next) / (1000 * 60 * 60);
      
      if (gapHours > 6) { // Gaps longer than 6 hours
        analysis.timeGaps.push({
          start: next,
          end: current,
          hours: gapHours
        });
      }
    }
  }
  
  return analysis;
}

async function findSuccessfulProcessing(startTime, endTime) {
  const { data: healthyScraps, error } = await supabase
    .from('scraps')
    .select('*')
    .gte('created_at', startTime.toISOString())
    .lte('created_at', endTime.toISOString())
    .not('summary', 'is', null)
    .not('embedding', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (error) throw error;
  
  return healthyScraps || [];
}

function displayInvestigationResults(errors, dbAnalysis, successes, daysBack) {
  console.log(chalk.green(`\n📊 Investigation Results (Last ${daysBack} days):\n`));
  
  // Database Analysis
  console.log(chalk.blue('🗄️ Database Analysis:'));
  console.log(`  Total scraps processed: ${dbAnalysis.total}`);
  
  console.log('\n  By Source:');
  Object.entries(dbAnalysis.bySources).forEach(([source, stats]) => {
    const healthPercent = stats.total > 0 ? Math.round((stats.healthy / stats.total) * 100) : 0;
    const healthColor = healthPercent > 50 ? 'green' : healthPercent > 20 ? 'yellow' : 'red';
    console.log(`    ${source.padEnd(10)}: ${stats.total} total, ${stats.healthy} healthy (${chalk[healthColor](healthPercent + '%')})`);
  });
  
  console.log('\n  Missing Fields:');
  Object.entries(dbAnalysis.missingFields).forEach(([field, count]) => {
    const percent = dbAnalysis.total > 0 ? Math.round((count / dbAnalysis.total) * 100) : 0;
    console.log(`    ${field.padEnd(12)}: ${count} missing (${percent}%)`);
  });
  
  // Processing Instances
  if (Object.keys(dbAnalysis.processingInstances).length > 0) {
    console.log('\n  Processing Instances:');
    Object.entries(dbAnalysis.processingInstances)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([instance, count]) => {
        console.log(`    ${instance}: ${count} scraps`);
      });
  }
  
  // Time Gaps
  if (dbAnalysis.timeGaps.length > 0) {
    console.log(chalk.yellow('\n⏰ Processing Gaps Found:'));
    dbAnalysis.timeGaps.slice(0, 5).forEach(gap => {
      console.log(`    ${format(gap.start, 'MMM dd HH:mm')} → ${format(gap.end, 'MMM dd HH:mm')} (${Math.round(gap.hours)}h gap)`);
    });
  }
  
  // Loki Errors
  if (errors.length > 0) {
    console.log(chalk.red('\n🚨 Recent Errors from Loki:'));
    errors.slice(0, 10).forEach(error => {
      const timeAgo = formatDistanceToNow(error.timestamp);
      console.log(`  ${chalk.gray(timeAgo + ' ago')}: ${error.message.substring(0, 100)}...`);
    });
    
    // Error patterns
    const errorTypes = {};
    errors.forEach(error => {
      const message = error.message.toLowerCase();
      if (message.includes('openrouter')) errorTypes.openrouter = (errorTypes.openrouter || 0) + 1;
      if (message.includes('screenshot')) errorTypes.screenshot = (errorTypes.screenshot || 0) + 1;
      if (message.includes('embedding')) errorTypes.embedding = (errorTypes.embedding || 0) + 1;
      if (message.includes('timeout')) errorTypes.timeout = (errorTypes.timeout || 0) + 1;
      if (message.includes('rate limit')) errorTypes.rateLimit = (errorTypes.rateLimit || 0) + 1;
    });
    
    if (Object.keys(errorTypes).length > 0) {
      console.log('\n  Error Patterns:');
      Object.entries(errorTypes)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
          console.log(`    ${type}: ${count} errors`);
        });
    }
  }
  
  // Successful Processing
  if (successes.length > 0) {
    console.log(chalk.green('\n✅ Recent Successful Processing Examples:'));
    successes.slice(0, 3).forEach(scrap => {
      const timeAgo = formatDistanceToNow(new Date(scrap.created_at));
      console.log(`  ${chalk.gray(timeAgo + ' ago')}: ${scrap.source} - ${scrap.title?.substring(0, 50) || scrap.scrap_id}`);
    });
  } else {
    console.log(chalk.red('\n❌ No fully healthy scraps found in this period!'));
  }
  
  // Recommendations
  console.log(chalk.cyan('\n💡 Recommendations:'));
  
  if (dbAnalysis.missingFields.embedding > dbAnalysis.total * 0.8) {
    console.log('  • Run embedding repair: npm run doctor:repair --type embedding --limit 50');
  }
  
  if (dbAnalysis.missingFields.summary > dbAnalysis.total * 0.5) {
    console.log('  • Run summary repair: npm run doctor:repair --type summary --limit 20');
  }
  
  if (errors.some(e => e.message.includes('openrouter'))) {
    console.log('  • Check OpenRouter API key and credits');
  }
  
  if (dbAnalysis.timeGaps.length > 2) {
    console.log('  • Investigate why processing stopped during gap periods');
    console.log('  • Consider setting up monitoring alerts for processing failures');
  }
}

async function showTimeline(options) {
  console.log(chalk.cyan('📅 Processing Timeline\n'));
  
  const daysBack = parseInt(options.days);
  const now = new Date();
  const startTime = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  
  // Get scraps by hour
  const { data: scraps, error } = await supabase
    .from('scraps')
    .select('created_at, source, summary, embedding, screenshot_url')
    .gte('created_at', startTime.toISOString())
    .order('created_at', { ascending: true });
  
  if (error) {
    console.error(chalk.red('❌ Error fetching timeline:'), error.message);
    return;
  }
  
  // Group by hour
  const hourlyData = {};
  scraps.forEach(scrap => {
    const hour = format(new Date(scrap.created_at), 'MMM dd HH:00');
    if (!hourlyData[hour]) {
      hourlyData[hour] = { total: 0, healthy: 0, sources: {} };
    }
    hourlyData[hour].total++;
    if (scrap.summary && scrap.embedding) {
      hourlyData[hour].healthy++;
    }
    hourlyData[hour].sources[scrap.source] = (hourlyData[hour].sources[scrap.source] || 0) + 1;
  });
  
  // Display timeline
  Object.entries(hourlyData).forEach(([hour, data]) => {
    const healthPercent = Math.round((data.healthy / data.total) * 100);
    const healthIcon = healthPercent > 80 ? '🟢' : healthPercent > 50 ? '🟡' : '🔴';
    const sources = Object.entries(data.sources).map(([s, c]) => `${s}:${c}`).join(' ');
    
    console.log(`${healthIcon} ${hour} - ${data.total} scraps (${healthPercent}% healthy) [${sources}]`);
  });
}

async function findHealthDegradation() {
  console.log(chalk.cyan('📉 Finding When Health Started Declining\n'));
  
  // Get scraps from last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const { data: scraps, error } = await supabase
    .from('scraps')
    .select('created_at, summary, embedding, screenshot_url')
    .gte('created_at', thirtyDaysAgo.toISOString())
    .order('created_at', { ascending: true });
  
  if (error) {
    console.error(chalk.red('❌ Error fetching health data:'), error.message);
    return;
  }
  
  // Group by day and calculate health scores
  const dailyHealth = {};
  scraps.forEach(scrap => {
    const day = format(new Date(scrap.created_at), 'MMM dd');
    if (!dailyHealth[day]) {
      dailyHealth[day] = { total: 0, healthy: 0 };
    }
    dailyHealth[day].total++;
    if (scrap.summary && scrap.embedding) {
      dailyHealth[day].healthy++;
    }
  });
  
  // Find the decline point
  const days = Object.entries(dailyHealth).map(([day, data]) => ({
    day,
    health: Math.round((data.healthy / data.total) * 100),
    total: data.total
  }));
  
  console.log('📊 Daily Health Scores:');
  days.forEach(({ day, health, total }) => {
    const icon = health > 80 ? '🟢' : health > 50 ? '🟡' : health > 20 ? '🟠' : '🔴';
    console.log(`  ${icon} ${day}: ${health}% healthy (${total} scraps)`);
  });
  
  // Find significant drops
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const curr = days[i];
    const drop = prev.health - curr.health;
    
    if (drop > 30) {
      console.log(chalk.red(`\n🚨 Significant health drop detected:`));
      console.log(`  ${prev.day}: ${prev.health}% → ${curr.day}: ${curr.health}% (${drop}% drop)`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { investigate, showTimeline, findHealthDegradation };