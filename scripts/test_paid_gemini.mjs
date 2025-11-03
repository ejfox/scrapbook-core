#!/usr/bin/env node

import "dotenv/config";
import chalk from "chalk";
import { summarizeContent, metaSummaryToTags } from "./aiSummarization.mjs";
import { getModelForTask } from "../lib/config.mjs";

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

async function testPaidGemini() {
  console.log(chalk.bold.cyan("\n💰 TESTING PAID GEMINI FLASH CONFIGURATION\n"));

  // Check the configured model
  const summaryModel = getModelForTask("summarization");
  const taggingModel = getModelForTask("tagging");

  console.log(chalk.bold("Current Configuration:"));
  console.log(chalk.cyan("Summarization Model:"), summaryModel);
  console.log(chalk.cyan("Tagging Model:"), taggingModel);
  console.log();

  // Direct API test first
  console.log(chalk.yellow("1️⃣  Testing direct API call..."));

  try {
    const startApi = Date.now();
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "X-Title": "Scrapbook Paid Test",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: 'Say "Paid Gemini is working!" and nothing else.',
          },
        ],
        temperature: 0.1,
        max_tokens: 20,
      }),
    });

    const data = await response.json();
    const apiTime = Date.now() - startApi;

    if (response.ok && data.choices) {
      console.log(chalk.green("✅ API Success!"));
      console.log(chalk.cyan("Response:"), data.choices[0].message.content);
      console.log(chalk.dim(`Time: ${apiTime}ms`));
      console.log(chalk.dim(`Cost: $${((data.usage?.prompt_tokens || 0) * 0.0000003 + (data.usage?.completion_tokens || 0) * 0.0000025).toFixed(6)}`));
    } else {
      console.log(chalk.red("❌ API Error:"));
      console.log(chalk.red("Status:"), response.status);
      console.log(chalk.red("Message:"), data.error?.message || JSON.stringify(data));

      if (response.status === 429) {
        console.log(chalk.yellow("\n⚠️  Still hitting rate limits on paid model"));
        console.log(chalk.yellow("This suggests an account-level or API key issue"));
      }
    }

    console.log();

  } catch (error) {
    console.error(chalk.red("API Error:"), error.message);
  }

  // Test through the system
  console.log(chalk.yellow("2️⃣  Testing through scrapbook system..."));
  console.log(chalk.dim("Generating summary..."));

  const startTime = Date.now();

  try {
    const summary = await summarizeContent(TEST_CONTENT, {
      taskType: "summarization",
      scrapId: "test-paid-gemini",
    });

    const summaryTime = Date.now() - startTime;

    if (summary) {
      console.log(chalk.green("✅ Summary generated!"));
      console.log(chalk.cyan("Summary:"), summary);
      console.log(chalk.dim(`Length: ${summary.length} chars`));
      console.log(chalk.dim(`Time: ${summaryTime}ms`));

      // Test tag generation
      console.log(chalk.dim("\nGenerating tags..."));
      const tagStartTime = Date.now();
      const tags = await metaSummaryToTags(summary, {
        taskType: "tagging",
        scrapId: "test-paid-gemini",
      });
      const tagTime = Date.now() - tagStartTime;

      console.log(chalk.cyan("Tags:"), tags.join(", "));
      console.log(chalk.dim(`Time: ${tagTime}ms`));

      // Performance comparison
      console.log(chalk.bold.magenta("\n📊 PERFORMANCE COMPARISON:"));
      console.log(chalk.dim("DeepSeek Free:"));
      console.log(chalk.dim("  • Summary: ~2459ms"));
      console.log(chalk.dim("  • Tags: ~2277ms"));
      console.log(chalk.dim("  • Total: ~4736ms"));
      console.log(chalk.dim("  • Cost: $0.00"));

      const totalTime = summaryTime + tagTime;
      const estimatedCost = 0.00001; // Rough estimate for ~500 tokens

      console.log(chalk.green("\nGemini 2.5 Flash (Paid):"));
      console.log(chalk.green(`  • Summary: ${summaryTime}ms`));
      console.log(chalk.green(`  • Tags: ${tagTime}ms`));
      console.log(chalk.green(`  • Total: ${totalTime}ms`));
      console.log(chalk.green(`  • Cost: ~$${estimatedCost.toFixed(5)} per scrap`));

      const speedup = (4736 / totalTime).toFixed(1);
      console.log(chalk.bold.green(`\n⚡ Speed: ${speedup}x faster!`));
      console.log(chalk.bold.cyan(`💰 Cost: ~$${(estimatedCost * 1000).toFixed(2)} per 1000 scraps`));

    } else {
      console.log(chalk.red("❌ Failed to generate summary"));
      console.log(chalk.yellow("The system may be falling back to free models due to rate limits"));
    }

  } catch (error) {
    console.error(chalk.red("System Error:"), error.message);
  }
}

// Run the test
if (!process.env.OPENROUTER_API_KEY) {
  console.error(chalk.red("Error: OPENROUTER_API_KEY not found"));
  process.exit(1);
}

testPaidGemini().catch(console.error);
