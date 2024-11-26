import { completion, MODELS, PROMPTS } from "./llmService.mjs";
import { summarizeContent, metaSummaryToTags } from "./aiSummarization.mjs";
import { extractLocation } from "./aiGeolocation.mjs";
import { extractRelationships } from "./aiRelationshipExtraction.mjs";
import { generateMastodonTags } from "./aiMastodonSummarization.mjs";
import { summarizeGitHubActivity } from "./aiGithubSummarization.mjs";
import chalk from "chalk";
import { performance } from "perf_hooks";
import axios from "axios";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";

console.log(
  chalk.cyan(`
╔═══════════════════════════════════════╗
║         AI VALIDATION UTILITY         ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║
║    [STATUS: INITIALIZING TESTS]       ║
╚═══════════════════════════════════════╝
`)
);

// Test data
const TEST_CONTENT = [
  `While working from a cafe in the East Village, New York City, I've been exploring Vue.js 3.0's Composition API...`,
  `The ref() and reactive() functions are core utilities for managing reactive state in Vue.js applications...`,
];

async function checkCredits() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log(chalk.yellow("⚠️  OpenRouter API key not configured"));
    return false;
  }

  try {
    const response = await axios.get(`${OPENROUTER_API_URL}/auth/key`, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    console.log(chalk.cyan("\n📊 Raw API Response:"));
    console.log(chalk.cyan("━".repeat(50)));
    console.log(JSON.stringify(response.data, null, 2));
    console.log(chalk.cyan("━".repeat(50)));

    if (!response.data?.data) {
      throw new Error("No data received from OpenRouter API");
    }

    const { usage, limit, limit_remaining, is_free_tier } = response.data.data;

    // Check limit_remaining first!
    if (limit_remaining <= 0) {
      console.error(
        chalk.red("\n❌ No credits remaining!") +
          chalk.yellow(
            "\nPlease add more credits at https://openrouter.ai/credits"
          )
      );
      console.log(chalk.gray("\nCredit Details:"));
      console.log(chalk.gray(`Limit Remaining: ${limit_remaining}`));
      console.log(chalk.gray(`Usage: ${usage}`));
      console.log(chalk.gray(`Limit: ${limit}`));
      return false;
    }

    // Create a visual representation of credit usage
    const usagePercent = (usage / limit) * 100;
    const creditBar = `[${"=".repeat(Math.floor(usagePercent / 5))}${" ".repeat(
      20 - Math.floor(usagePercent / 5)
    )}]`;

    console.log(chalk.cyan("\n📊 OpenRouter Credits Status:"));
    console.log(chalk.cyan("━".repeat(50)));
    console.log(
      `Account Type: ${chalk.blue(is_free_tier ? "Free Tier" : "Paid")}`
    );
    console.log(
      `Usage: ${chalk.yellow(usage)} / ${chalk.yellow(
        limit
      )} (${usagePercent.toFixed(1)}%)`
    );
    console.log(
      `Credits Remaining: ${
        limit_remaining > 10
          ? chalk.green(limit_remaining.toFixed(2))
          : chalk.yellow(limit_remaining.toFixed(2))
      }`
    );
    console.log(`${creditBar} ${usagePercent.toFixed(1)}%`);
    console.log(chalk.cyan("━".repeat(50)));

    if (usage >= limit) {
      console.error(
        chalk.red("\n❌ Credit limit exceeded! Tests cannot proceed.")
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(chalk.red("\n❌ Error checking credits:"));
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Headers:`, error.response.headers);
      console.error(`Data:`, error.response.data);
    } else if (error.request) {
      console.error("No response received from API");
      console.error(error.request);
    } else {
      console.error(`Error: ${error.message}`);
    }
    return false;
  }
}

async function runTests() {
  // Check credits first
  const hasCredits = await checkCredits();
  if (!hasCredits) {
    console.log(
      chalk.yellow("\n⚠️  Skipping tests due to insufficient credits")
    );
    process.exit(1);
    return;
  }

  console.log(chalk.green("\n✅ Credit check passed. Starting tests...\n"));

  // Rest of your test code...
  for (const content of TEST_CONTENT) {
    console.log("\n" + "=".repeat(50));
    console.log("Testing content:", content.substring(0, 100) + "...");

    // Test summarization
    console.log("\n[TESTING SUMMARIZATION]");
    try {
      console.time("Summary Generation");
      const summary = await summarizeContent(content);
      console.timeEnd("Summary Generation");
      console.log(chalk.green("✓ Summary:"), summary);

      if (summary) {
        console.time("Tag Generation");
        const tags = await metaSummaryToTags(summary);
        console.timeEnd("Tag Generation");
        console.log(chalk.green("✓ Tags:"), tags);
      }
    } catch (error) {
      console.error(chalk.red("❌ Error in summarization:"), error);
    }

    // Test location extraction
    console.log("\n[TESTING LOCATION]");
    try {
      console.time("Location Extraction");
      const location = await extractLocation(content);
      console.timeEnd("Location Extraction");
      console.log(chalk.green("✓ Location:"), location);
    } catch (error) {
      console.error(chalk.red("❌ Error in location extraction:"), error);
    }

    // Test relationship extraction
    console.log("\n[TESTING RELATIONSHIPS]");
    try {
      console.time("Relationship Extraction");
      const relationships = await extractRelationships(content);
      console.timeEnd("Relationship Extraction");
      console.log(chalk.green("✓ Relationships:"), relationships);
    } catch (error) {
      console.error(chalk.red("❌ Error in relationship extraction:"), error);
    }
  }
}

// Run tests with error handling
runTests().catch((error) => {
  console.error(chalk.red("\n❌ Fatal error:"), error);
  process.exit(1);
});
