#!/usr/bin/env node

import 'dotenv/config';
import chalk from 'chalk';

// Test content - using a real example from the logs
const TEST_CONTENT = `
AlexanderGrooff/mermaid-ascii: Render Mermaid graphs inside your terminal

A Python package that allows you to render Mermaid diagrams directly in your terminal as ASCII art.
This tool converts Mermaid syntax into ASCII output, making it perfect for visualizing diagrams in
command-line environments without needing a graphical interface.

Key Features:
- Supports various Mermaid diagram types including flowcharts, sequence diagrams, and more
- Simple command-line interface for quick diagram generation
- Can be integrated into documentation tools and scripts
- Useful for README files and terminal-based documentation
- Lightweight alternative to graphical diagram tools

Installation: pip install mermaid-ascii
Usage: mermaid-ascii input.mmd

GitHub: https://github.com/AlexanderGrooff/mermaid-ascii
`;

async function compareModels() {
  console.log(chalk.bold.cyan('\n📊 MODEL COMPARISON TEST\n'));
  console.log(chalk.dim('Testing with sample content about mermaid-ascii tool\n'));

  // Test with DeepSeek (current model)
  console.log(chalk.bold.yellow('1️⃣  DEEPSEEK V3.1 (FREE):'));
  await testModel('deepseek/deepseek-chat-v3.1:free', TEST_CONTENT);

  // Test with Claude 3.5 Sonnet
  console.log(chalk.bold.blue('\n2️⃣  CLAUDE 3.5 SONNET:'));
  await testModel('anthropic/claude-3.5-sonnet:beta', TEST_CONTENT);

  // Test with GPT-4o-mini
  console.log(chalk.bold.green('\n3️⃣  GPT-4O-MINI:'));
  await testModel('openai/gpt-4o-mini', TEST_CONTENT);

  // Test with Google Gemini Flash (free)
  console.log(chalk.bold.magenta('\n4️⃣  GEMINI 2.0 FLASH (FREE):'));
  await testModel('google/gemini-2.0-flash-exp:free', TEST_CONTENT);

  console.log(chalk.bold.cyan('\n📈 COST COMPARISON:'));
  console.log(chalk.dim('DeepSeek v3.1: $0.00 (free tier)'));
  console.log(chalk.dim('Claude 3.5 Sonnet: ~$0.003 per 1K input + $0.015 per 1K output'));
  console.log(chalk.dim('GPT-4o-mini: ~$0.00015 per 1K input + $0.0006 per 1K output'));
  console.log(chalk.dim('Gemini Flash: $0.00 (free tier)'));
}

async function testModel(modelId, content) {
  try {
    // Generate summary
    console.log(chalk.dim('Generating summary...'));
    const startTime = Date.now();

    const summaryResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'X-Title': 'Scrapbook Model Comparison'
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that creates concise summaries. Respond only with the summary, no additional text.'
          },
          {
            role: 'user',
            content: `Summarize this content in 1-2 sentences:\n\n${content}`
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    const summaryData = await summaryResponse.json();

    if (summaryData.error) {
      console.error(chalk.red('Error:'), summaryData.error.message);
      return;
    }

    const summary = summaryData.choices[0].message.content.trim();
    const summaryTime = Date.now() - startTime;

    console.log(chalk.cyan('Summary:'), summary);
    console.log(chalk.dim(`Length: ${summary.length} chars, Time: ${summaryTime}ms`));

    // Generate tags
    console.log(chalk.dim('\nGenerating tags...'));
    const tagStartTime = Date.now();

    const tagsResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'X-Title': 'Scrapbook Model Comparison'
      },
      body: JSON.stringify({
        model: modelId,
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
        temperature: 0.3,
        max_tokens: 50
      })
    });

    const tagsData = await tagsResponse.json();

    if (tagsData.error) {
      console.error(chalk.red('Error:'), tagsData.error.message);
      return;
    }

    const tagsString = tagsData.choices[0].message.content.trim();
    const tags = tagsString.split(',').map(tag => tag.trim().toLowerCase());
    const tagTime = Date.now() - tagStartTime;

    console.log(chalk.cyan('Tags:'), tags.join(', '));
    console.log(chalk.dim(`Time: ${tagTime}ms`));

    // Show usage if available
    if (summaryData.usage) {
      console.log(chalk.dim(`Tokens: ${summaryData.usage.total_tokens} total (${summaryData.usage.prompt_tokens} in, ${summaryData.usage.completion_tokens} out)`));
    }

  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
  }
}

// Run comparison
if (!process.env.OPENROUTER_API_KEY) {
  console.error(chalk.red('Error: OPENROUTER_API_KEY not found in environment variables'));
  process.exit(1);
}

compareModels().catch(console.error);