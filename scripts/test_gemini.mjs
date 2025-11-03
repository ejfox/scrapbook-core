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

async function testGeminiSwitch() {
  console.log(chalk.bold.cyan("\n🚀 TESTING GEMINI 2.0 FLASH CONFIGURATION\n"));

  // Check the configured model
  const summaryModel = getModelForTask("summarization");
  const taggingModel = getModelForTask("tagging");

  console.log(chalk.bold("Current Configuration:"));
  console.log(chalk.cyan("Summarization Model:"), summaryModel);
  console.log(chalk.cyan("Tagging Model:"), taggingModel);

  if (summaryModel !== "google/gemini-2.0-flash-exp:free") {
    console.error(chalk.red("⚠️  Configuration not updated! Still using:"), summaryModel);
    return;
  }

  console.log(chalk.green("\n✅ Configuration updated to Gemini Flash!\n"));

  // Test summarization
  console.log(chalk.bold.yellow("Testing Summarization:"));
  console.log(chalk.dim("Processing..."));

  const startTime = Date.now();

  try {
    const summary = await summarizeContent(TEST_CONTENT, {
      taskType: "summarization",
      scrapId: "test-gemini-switch",
    });

    const summaryTime = Date.now() - startTime;

    console.log(chalk.cyan("Summary:"), summary);
    console.log(chalk.dim(`Length: ${summary?.length || 0} chars`));
    console.log(chalk.green(`Time: ${summaryTime}ms`));

    // Test tag generation
    console.log(chalk.bold.yellow("\nTesting Tag Generation:"));
    console.log(chalk.dim("Processing..."));

    const tagStartTime = Date.now();
    const tags = await metaSummaryToTags(summary, {
      taskType: "tagging",
      scrapId: "test-gemini-switch",
    });

    const tagTime = Date.now() - tagStartTime;

    console.log(chalk.cyan("Tags:"), tags.join(", "));
    console.log(chalk.green(`Time: ${tagTime}ms`));

    // Compare with previous DeepSeek performance
    console.log(chalk.bold.magenta("\n📊 PERFORMANCE COMPARISON:"));
    console.log(chalk.dim("Previous (DeepSeek):"));
    console.log(chalk.dim("  • Summary: ~2459ms"));
    console.log(chalk.dim("  • Tags: ~2277ms"));
    console.log(chalk.dim("  • Total: ~4736ms"));

    console.log(chalk.green("\nNow (Gemini Flash):"));
    console.log(chalk.green(`  • Summary: ${summaryTime}ms`));
    console.log(chalk.green(`  • Tags: ${tagTime}ms`));
    console.log(chalk.green(`  • Total: ${summaryTime + tagTime}ms`));

    const speedup = (4736 / (summaryTime + tagTime)).toFixed(1);
    console.log(chalk.bold.green(`\n⚡ Speed improvement: ${speedup}x faster!`));

  } catch (error) {
    console.error(chalk.red("Error during test:"), error.message);
    console.error(chalk.dim("Full error:"), error);
  }
}

// Run the test
testGeminiSwitch().catch(console.error);
