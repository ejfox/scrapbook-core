#!/usr/bin/env node

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import chalk from 'chalk';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://xmdylmbdeulxcqdbkfno.supabase.co',
  process.env.SUPABASE_KEY
);

async function checkQuality() {
  console.log(chalk.bold.cyan('🎯 CHECKING AI OUTPUT QUALITY FROM GEMINI 2.5 FLASH\n'));

  // Get recently processed items
  const { data, error } = await supabase
    .from('scraps')
    .select('scrap_id, title, summary, tags, relationships, url')
    .not('summary', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(chalk.green(`Found ${data.length} recently processed items\n`));

  // Show detailed examples
  data.slice(0, 5).forEach((item, i) => {
    console.log(chalk.bold.yellow(`📝 Example ${i+1}:`));
    console.log(chalk.dim(`Title: ${item.title || 'No title'}`));
    console.log(chalk.dim(`URL: ${item.url?.substring(0, 60)}...`));

    console.log(chalk.cyan('\nSummary:'));
    console.log(item.summary);

    if (item.tags?.length > 0) {
      console.log(chalk.magenta(`\nTags: ${item.tags.join(', ')}`));
    }

    if (item.relationships?.length > 0) {
      console.log(chalk.green(`\nRelationships/Entities (${item.relationships.length}):`));
      item.relationships.slice(0, 5).forEach(rel => {
        console.log(`  • ${rel.type}: ${rel.name}`);
      });
    }


    console.log(chalk.dim('\n' + '─'.repeat(60) + '\n'));
  });

  // Stats
  const stats = {
    avgSummaryLength: data.reduce((sum, d) => sum + (d.summary?.length || 0), 0) / data.length,
    avgTags: data.reduce((sum, d) => sum + (d.tags?.length || 0), 0) / data.length,
    withRelationships: data.filter(d => d.relationships?.length > 0).length
  };

  console.log(chalk.bold.blue('📊 QUALITY METRICS:'));
  console.log(chalk.dim(`Average summary length: ${Math.round(stats.avgSummaryLength)} chars`));
  console.log(chalk.dim(`Average tags per item: ${stats.avgTags.toFixed(1)}`));
  console.log(chalk.dim(`Items with relationships: ${stats.withRelationships}/${data.length}`));
}

checkQuality().catch(console.error);