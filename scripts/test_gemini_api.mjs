#!/usr/bin/env node

import 'dotenv/config';
import chalk from 'chalk';

async function testGeminiAPI() {
  console.log(chalk.cyan('Testing Gemini 2.0 Flash API directly...\n'));

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error(chalk.red('Error: OPENROUTER_API_KEY not found'));
    return;
  }

  console.log(chalk.dim(`API Key configured: ${apiKey.substring(0, 10)}...`));

  try {
    console.log(chalk.yellow('Sending test request to Gemini...'));

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Title': 'Scrapbook Test'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'user',
            content: 'Respond with just: "Gemini Flash is working!" and nothing else.'
          }
        ],
        temperature: 0.1,
        max_tokens: 20
      })
    });

    const data = await response.json();

    if (response.ok && data.choices) {
      console.log(chalk.green('✅ Success!'));
      console.log(chalk.cyan('Response:'), data.choices[0].message.content);
      console.log(chalk.dim(`Tokens used: ${data.usage?.total_tokens || 'N/A'}`));
    } else {
      console.log(chalk.red('❌ Error:'));
      console.log(chalk.red('Status:'), response.status);
      console.log(chalk.red('Message:'), data.error?.message || JSON.stringify(data));

      if (response.status === 429) {
        console.log(chalk.yellow('\n⚠️  Rate limit hit. This is normal for free tier models.'));
        console.log(chalk.yellow('The system should automatically handle this with retries.'));
      }
    }

    // Test fallback
    if (response.status === 429) {
      console.log(chalk.cyan('\nTesting fallback to DeepSeek...'));

      const fallbackResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-Title': 'Scrapbook Test'
        },
        body: JSON.stringify({
          model: 'deepseek/deepseek-chat-v3.1:free',
          messages: [
            {
              role: 'user',
              content: 'Respond with just: "DeepSeek fallback is working!" and nothing else.'
            }
          ],
          temperature: 0.1,
          max_tokens: 20
        })
      });

      const fallbackData = await fallbackResponse.json();

      if (fallbackResponse.ok && fallbackData.choices) {
        console.log(chalk.green('✅ Fallback successful!'));
        console.log(chalk.cyan('Response:'), fallbackData.choices[0].message.content);
      }
    }

  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
  }
}

testGeminiAPI();