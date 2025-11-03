#!/usr/bin/env node
/**
 * PRE-FLIGHT HEALTH CHECK
 * Run this BEFORE spending money on processing
 * Validates that ALL AI services work end-to-end
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import chalk from "chalk";
import axios from "axios";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

const REQUIRED_ENV_VARS = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_KEY",
];

const OPTIONAL_ENV_VARS = [
  "PINBOARD_TOKEN",
  "GITHUB_TOKEN",
  "MASTODON_ACCESS_TOKEN",
  "ARENA_ACCESS_TOKEN",
];

class HealthCheck {
  constructor() {
    this.results = {
      env: { passed: 0, failed: 0, warnings: 0 },
      apis: { passed: 0, failed: 0, warnings: 0 },
      database: { passed: 0, failed: 0, warnings: 0 },
      ai: { passed: 0, failed: 0, warnings: 0 },
      overall: "UNKNOWN",
    };
    this.failures = [];
    this.warnings = [];
  }

  log(symbol, message, color = "white") {
    console.log(chalk[color](`${symbol} ${message}`));
  }

  pass(message) {
    this.log("✅", message, "green");
  }

  fail(message, category = "overall") {
    this.log("❌", message, "red");
    this.failures.push({ category, message });
  }

  warn(message) {
    this.log("⚠️ ", message, "yellow");
    this.warnings.push(message);
  }

  async checkEnvironment() {
    console.log(chalk.bold.blue("\n🔍 CHECKING ENVIRONMENT VARIABLES\n"));

    // Check required vars
    for (const varName of REQUIRED_ENV_VARS) {
      if (process.env[varName] && process.env[varName] !== "dummy") {
        this.pass(`${varName} is set`);
        this.results.env.passed++;
      } else {
        this.fail(`${varName} is missing or set to 'dummy'`, "env");
        this.results.env.failed++;
      }
    }

    // Check optional vars
    for (const varName of OPTIONAL_ENV_VARS) {
      if (process.env[varName]) {
        this.pass(`${varName} is set (optional)`);
      } else {
        this.warn(`${varName} is not set (optional - some features disabled)`);
        this.results.env.warnings++;
      }
    }
  }

  async checkOpenRouterCredits() {
    console.log(chalk.bold.blue("\n💰 CHECKING OPENROUTER CREDITS\n"));

    try {
      const response = await axios.get("https://openrouter.ai/api/v1/auth/key", {
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
      });

      const data = response.data.data;
      console.log(chalk.gray(`  Account: ${data.label || "Unknown"}`));
      console.log(chalk.gray(`  Usage: $${data.usage?.toFixed(2) || "0.00"}`));
      console.log(chalk.gray(`  Limit: ${data.limit ? "$" + data.limit : "Unlimited"}`));
      console.log(chalk.gray(`  Rate Limit: ${data.rate_limit?.requests || "Unknown"}`));

      if (data.limit && data.usage >= data.limit) {
        this.fail("OpenRouter: Credit limit reached!", "apis");
        this.results.apis.failed++;
        return false;
      }

      if (data.limit && data.usage > data.limit * 0.9) {
        this.warn(`OpenRouter: 90% of credit limit used ($${data.usage.toFixed(2)}/$${data.limit})`);
        this.results.apis.warnings++;
      } else {
        this.pass("OpenRouter: Credits available");
        this.results.apis.passed++;
      }

      return true;
    } catch (error) {
      this.fail(`OpenRouter API check failed: ${error.message}`, "apis");
      this.results.apis.failed++;
      return false;
    }
  }

  async checkOpenAIKey() {
    console.log(chalk.bold.blue("\n🤖 CHECKING OPENAI API\n"));

    try {
      const response = await axios.get("https://api.openai.com/v1/models", {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      });

      this.pass("OpenAI: API key valid");
      this.results.apis.passed++;
      return true;
    } catch (error) {
      if (error.response?.status === 401) {
        this.fail("OpenAI: Invalid API key", "apis");
      } else {
        this.fail(`OpenAI: API check failed - ${error.message}`, "apis");
      }
      this.results.apis.failed++;
      return false;
    }
  }

  async checkDatabase() {
    console.log(chalk.bold.blue("\n🗄️  CHECKING DATABASE\n"));

    try {
      // Check connection
      const { count, error: countError } = await supabase
        .from("scraps")
        .select("*", { count: "exact", head: true });

      if (countError) throw countError;

      this.pass(`Database: Connected (${count?.toLocaleString()} scraps)`);
      this.results.database.passed++;

      // Check write permissions
      const testId = `test-health-check-${Date.now()}`;
      const { error: insertError } = await supabase
        .from("scraps")
        .insert({
          scrap_id: testId,
          source: "health-check",
          type: "test",
          content: "test",
          title: "Health Check Test",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          tags: ["test"],
        });

      if (insertError) throw new Error(`Write test failed: ${insertError.message}`);

      // Clean up test record
      await supabase.from("scraps").delete().eq("scrap_id", testId);

      this.pass("Database: Write permissions OK");
      this.results.database.passed++;

      return true;
    } catch (error) {
      this.fail(`Database: ${error.message}`, "database");
      this.results.database.failed++;
      return false;
    }
  }

  async testAISummarization() {
    console.log(chalk.bold.blue("\n📝 TESTING AI SUMMARIZATION (This will cost ~$0.001)\n"));

    try {
      const testContent = `
        This is a test article about artificial intelligence and machine learning.
        It discusses how neural networks can process information and make predictions.
        The article also covers best practices for training models and evaluating performance.
      `.trim();

      console.log(chalk.gray("  Sending test request to OpenRouter..."));

      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "google/gemini-2.0-flash-exp:free",
          messages: [
            {
              role: "user",
              content: `Summarize this in 1-2 sentences:\n\n${testContent}`,
            },
          ],
        },
        {
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );

      const summary = response.data.choices[0]?.message?.content;

      if (summary && summary.length > 10) {
        this.pass("AI Summarization: Working correctly");
        console.log(chalk.gray(`  Summary: "${summary.substring(0, 100)}..."`));
        this.results.ai.passed++;
        return true;
      } else {
        this.fail("AI Summarization: Generated empty summary", "ai");
        this.results.ai.failed++;
        return false;
      }
    } catch (error) {
      this.fail(`AI Summarization: ${error.response?.data?.error?.message || error.message}`, "ai");
      this.results.ai.failed++;
      return false;
    }
  }

  async testEmbeddings() {
    console.log(chalk.bold.blue("\n🧠 TESTING EMBEDDINGS (This will cost ~$0.0001)\n"));

    try {
      console.log(chalk.gray("  Sending test request to OpenAI..."));

      const response = await axios.post(
        "https://api.openai.com/v1/embeddings",
        {
          model: "text-embedding-3-small",
          input: "This is a test sentence for embeddings.",
        },
        {
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );

      const embedding = response.data.data[0]?.embedding;

      if (embedding && Array.isArray(embedding) && embedding.length > 0) {
        this.pass(`Embeddings: Working correctly (${embedding.length} dimensions)`);
        this.results.ai.passed++;
        return true;
      } else {
        this.fail("Embeddings: Generated empty embedding", "ai");
        this.results.ai.failed++;
        return false;
      }
    } catch (error) {
      this.fail(`Embeddings: ${error.response?.data?.error?.message || error.message}`, "ai");
      this.results.ai.failed++;
      return false;
    }
  }

  async testEndToEnd() {
    console.log(chalk.bold.blue("\n🔄 END-TO-END TEST (This will cost ~$0.005)\n"));

    try {
      const testScrapId = `test-e2e-${Date.now()}`;
      const testContent = "This is a comprehensive test of the entire scrapbook pipeline including summarization and embeddings.";

      // 1. Generate summary
      console.log(chalk.gray("  Step 1: Generating summary..."));
      const summaryResponse = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "google/gemini-2.0-flash-exp:free",
          messages: [{
            role: "user",
            content: `Summarize in 1 sentence: ${testContent}`,
          }],
        },
        {
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );

      const summary = summaryResponse.data.choices[0]?.message?.content;
      if (!summary) throw new Error("Summary generation failed");
      console.log(chalk.gray("  ✓ Summary generated"));

      // 2. Generate embedding
      console.log(chalk.gray("  Step 2: Generating embedding..."));
      const embeddingResponse = await axios.post(
        "https://api.openai.com/v1/embeddings",
        {
          model: "text-embedding-3-small",
          input: testContent,
        },
        {
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );

      const embedding = embeddingResponse.data.data[0]?.embedding;
      if (!embedding) throw new Error("Embedding generation failed");
      console.log(chalk.gray("  ✓ Embedding generated"));

      // 3. Save to database
      console.log(chalk.gray("  Step 3: Saving to database..."));
      const { error: insertError } = await supabase
        .from("scraps")
        .insert({
          scrap_id: testScrapId,
          source: "health-check",
          type: "test",
          content: testContent,
          summary: summary,
          title: "End-to-End Test",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          tags: ["test"],
        });

      if (insertError) throw new Error(`Database save failed: ${insertError.message}`);
      console.log(chalk.gray("  ✓ Saved to database"));

      // 4. Verify it was saved correctly
      console.log(chalk.gray("  Step 4: Verifying saved data..."));
      const { data: saved, error: fetchError } = await supabase
        .from("scraps")
        .select("summary, content")
        .eq("scrap_id", testScrapId)
        .single();

      if (fetchError) throw new Error(`Verification failed: ${fetchError.message}`);
      if (!saved.summary) throw new Error("Summary was not saved!");
      if (saved.summary !== summary) throw new Error("Summary mismatch!");
      console.log(chalk.gray("  ✓ Data verified"));

      // 5. Clean up
      await supabase.from("scraps").delete().eq("scrap_id", testScrapId);
      console.log(chalk.gray("  ✓ Cleanup complete"));

      this.pass("End-to-End: Complete pipeline working correctly");
      this.results.ai.passed++;
      return true;
    } catch (error) {
      this.fail(`End-to-End: ${error.message}`, "ai");
      this.results.ai.failed++;
      return false;
    }
  }

  printSummary() {
    console.log(chalk.bold.blue("\n\n╔══════════════════════════════════════╗"));
    console.log(chalk.bold.blue("║        HEALTH CHECK SUMMARY          ║"));
    console.log(chalk.bold.blue("╚══════════════════════════════════════╝\n"));

    const categories = [
      { name: "Environment", data: this.results.env },
      { name: "API Services", data: this.results.apis },
      { name: "Database", data: this.results.database },
      { name: "AI Services", data: this.results.ai },
    ];

    categories.forEach(({ name, data }) => {
      const status = data.failed > 0 ? "❌" : data.warnings > 0 ? "⚠️ " : "✅";
      console.log(`${status} ${name.padEnd(20)} ${data.passed} passed, ${data.failed} failed, ${data.warnings} warnings`);
    });

    const totalFailed = this.results.env.failed + this.results.apis.failed + this.results.database.failed + this.results.ai.failed;
    const totalWarnings = this.results.env.warnings + this.results.apis.warnings + this.results.database.warnings + this.results.ai.warnings;

    console.log("\n" + "─".repeat(50) + "\n");

    if (totalFailed === 0 && totalWarnings === 0) {
      this.results.overall = "HEALTHY";
      console.log(chalk.bold.green("🎉 SYSTEM HEALTHY - Safe to process scraps!\n"));
      return true;
    } else if (totalFailed === 0) {
      this.results.overall = "DEGRADED";
      console.log(chalk.bold.yellow("⚠️  SYSTEM DEGRADED - Some features may not work\n"));
      console.log(chalk.yellow("Warnings:"));
      this.warnings.forEach(w => console.log(chalk.yellow(`  • ${w}`)));
      console.log();
      return true;
    } else {
      this.results.overall = "CRITICAL";
      console.log(chalk.bold.red("🚨 SYSTEM CRITICAL - DO NOT PROCESS SCRAPS!\n"));
      console.log(chalk.red("Critical failures:"));
      this.failures.forEach(f => console.log(chalk.red(`  • ${f.message}`)));
      console.log();
      console.log(chalk.red("Fix these issues before adding credits or running processing.\n"));
      return false;
    }
  }

  async run() {
    console.log(chalk.bold.cyan("\n╔══════════════════════════════════════╗"));
    console.log(chalk.bold.cyan("║   SCRAPBOOK HEALTH CHECK v1.0        ║"));
    console.log(chalk.bold.cyan("╚══════════════════════════════════════╝\n"));

    await this.checkEnvironment();
    await this.checkDatabase();
    await this.checkOpenRouterCredits();
    await this.checkOpenAIKey();
    await this.testAISummarization();
    await this.testEmbeddings();
    await this.testEndToEnd();

    const isHealthy = this.printSummary();

    process.exit(isHealthy ? 0 : 1);
  }
}

// Run health check
const healthCheck = new HealthCheck();
healthCheck.run().catch(console.error);
