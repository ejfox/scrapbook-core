#!/usr/bin/env node

import "dotenv/config";
import chalk from "chalk";

async function listGeminiModels() {
  console.log(chalk.cyan("Fetching available models from OpenRouter...\n"));

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
    });

    const data = await response.json();

    if (data.data) {
      // Filter for Gemini models
      const geminiModels = data.data.filter(model =>
        model.id.toLowerCase().includes("gemini"),
      );

      console.log(chalk.bold("Available Gemini Models:\n"));

      geminiModels.forEach(model => {
        const isFree = model.id.includes(":free");
        const color = isFree ? chalk.green : chalk.yellow;

        console.log(color(`${model.id}`));
        console.log(chalk.dim(`  Context: ${model.context_length || "N/A"} tokens`));
        console.log(chalk.dim(`  Input: $${model.pricing?.prompt || 0} per 1K tokens`));
        console.log(chalk.dim(`  Output: $${model.pricing?.completion || 0} per 1K tokens`));
        console.log();
      });

      // Show recommended paid models
      const paidGemini = geminiModels.filter(m => !m.id.includes(":free"));
      if (paidGemini.length > 0) {
        console.log(chalk.bold.cyan("\n💎 Recommended Paid Models for Speed:\n"));

        // Sort by price (cheapest first)
        paidGemini.sort((a, b) =>
          (a.pricing?.prompt || 0) - (b.pricing?.prompt || 0),
        );

        paidGemini.slice(0, 3).forEach(model => {
          const totalCostPer1K = (
            (model.pricing?.prompt || 0) * 0.2 + // Assume 200 input tokens
            (model.pricing?.completion || 0) * 0.05 // Assume 50 output tokens
          ).toFixed(4);

          console.log(chalk.yellow(`${model.id}`));
          console.log(chalk.green(`  Estimated cost: $${totalCostPer1K} per 1K scraps`));
        });
      }

    } else {
      console.error(chalk.red("Failed to fetch models"));
      console.error(data);
    }

  } catch (error) {
    console.error(chalk.red("Error:"), error.message);
  }
}

listGeminiModels();
