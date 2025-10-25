#!/usr/bin/env node

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
// We'll implement our own functions for comparison
import chalk from 'chalk';

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://xmdylmbdeulxcqdbkfno.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseKey) {
  console.error(chalk.red('Error: SUPABASE_KEY not found in environment variables'));
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test scrap ID
const SCRAP_ID = 'pinboard-2919f157d9e754b7b79bed67ceb776ef'; // Mermaid ASCII tool

async function compareModels() {
  console.log(chalk.bold.cyan('\n📊 MODEL COMPARISON TEST\n'));

  // Fetch the scrap from database using scrap_id (the actual string ID)
  const { data: scrap, error } = await supabase
    .from('scraps')
    .select('*')
    .eq('scrap_id', SCRAP_ID)
    .single();

  if (error) {
    console.error('Error fetching scrap:', error);
    return;
  }

  console.log(chalk.bold('Testing scrap:'), scrap.title || scrap.url);
  console.log(chalk.dim(`URL: ${scrap.url}`));
  console.log(chalk.dim(`Content length: ${scrap.content?.length || 0} chars\n`));

  // Current DeepSeek output from database
  console.log(chalk.bold.yellow('1️⃣  CURRENT DEEPSEEK OUTPUT (from DB):'));
  console.log(chalk.cyan('Summary:'), scrap.summary || 'N/A');
  console.log(chalk.cyan('Tags:'), scrap.tags?.join(', ') || 'N/A');
  console.log(chalk.dim(`Summary length: ${scrap.summary?.length || 0} chars\n`));

  // Test with Claude 3.5 Sonnet
  console.log(chalk.bold.blue('2️⃣  TESTING WITH CLAUDE 3.5 SONNET:'));

  // Create a modified config to use Claude
  const claudeConfig = {
    modelId: 'anthropic/claude-3.5-sonnet:beta',
    temperature: 0.3,
    maxTokens: 500
  };

  try {
    // Generate summary with Claude
    console.log(chalk.dim('Generating summary with Claude...'));
    const claudeSummary = await generateSummaryWithModel(scrap.content, claudeConfig);
    console.log(chalk.cyan('Summary:'), claudeSummary);
    console.log(chalk.dim(`Summary length: ${claudeSummary?.length || 0} chars`));

    // Generate tags with Claude
    console.log(chalk.dim('\nGenerating tags with Claude...'));
    const claudeTags = await generateTagsWithModel(claudeSummary, claudeConfig);
    console.log(chalk.cyan('Tags:'), claudeTags.join(', '));

  } catch (error) {
    console.error(chalk.red('Error with Claude:'), error.message);
  }

  // Test with GPT-4o-mini for comparison
  console.log(chalk.bold.green('\n3️⃣  TESTING WITH GPT-4O-MINI:'));

  const gptConfig = {
    modelId: 'openai/gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 500
  };

  try {
    // Generate summary with GPT
    console.log(chalk.dim('Generating summary with GPT-4o-mini...'));
    const gptSummary = await generateSummaryWithModel(scrap.content, gptConfig);
    console.log(chalk.cyan('Summary:'), gptSummary);
    console.log(chalk.dim(`Summary length: ${gptSummary?.length || 0} chars`));

    // Generate tags with GPT
    console.log(chalk.dim('\nGenerating tags with GPT-4o-mini...'));
    const gptTags = await generateTagsWithModel(gptSummary, gptConfig);
    console.log(chalk.cyan('Tags:'), gptTags.join(', '));

  } catch (error) {
    console.error(chalk.red('Error with GPT:'), error.message);
  }

  console.log(chalk.bold.magenta('\n📈 COST COMPARISON:'));
  console.log(chalk.dim('DeepSeek v3.1: $0.00 (free tier)'));
  console.log(chalk.dim('Claude 3.5 Sonnet: ~$0.003-0.015 per request'));
  console.log(chalk.dim('GPT-4o-mini: ~$0.00015-0.0006 per request'));
}

// Helper function to generate summary with specific model
async function generateSummaryWithModel(content, config) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'X-Title': 'Scrapbook Model Comparison'
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that creates concise summaries. Respond only with the summary, no additional text.'
        },
        {
          role: 'user',
          content: `Summarize this content in 1-2 sentences:\n\n${content?.substring(0, 2000)}`
        }
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

// Helper function to generate tags with specific model
async function generateTagsWithModel(summary, config) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'X-Title': 'Scrapbook Model Comparison'
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        {
          role: 'system',
          content: 'Generate 2-3 relevant tags for categorizing this content. Return only lowercase tags separated by commas, no additional text.'
        },
        {
          role: 'user',
          content: summary
        }
      ],
      temperature: config.temperature,
      max_tokens: 50
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const tagsString = data.choices[0].message.content.trim();
  return tagsString.split(',').map(tag => tag.trim().toLowerCase());
}

// Run comparison
compareModels().catch(console.error);