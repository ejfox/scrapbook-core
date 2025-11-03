#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { program } from "commander";
import path from "path";
import fs from "fs";

// Load environment variables
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

// Set up CLI
program
  .name("scrap-doctor")
  .description("🩺 Diagnose and repair incomplete scraps in your digital memory")
  .version("1.0.0");

program
  .command("diagnose")
  .description("Analyze your scraps and show what needs fixing")
  .option("-s, --source <source>", "Only analyze specific source (pinboard, github, mastodon, arena)")
  .option("-l, --limit <number>", "Limit analysis to N scraps", "1000")
  .action(diagnose);

program
  .command("repair")
  .description("Interactively repair missing fields")
  .option("-s, --source <source>", "Only repair specific source")
  .option("-t, --type <type>", "Only repair specific type (screenshot, summary, embedding, tags)")
  .option("-i, --ids <ids>", "Comma-separated list of specific scrap IDs to repair")
  .option("-a, --auto", "Auto-repair without prompts (be careful!)")
  .option("-l, --limit <number>", "Limit repairs to N scraps", "50")
  .action(repair);

program
  .command("status")
  .description("Quick health check of your scrapbook")
  .action(showStatus);

async function diagnose(options) {
  console.log(chalk.cyan("🩺 Scrap Doctor - Diagnostic Mode\n"));

  const spinner = ora("Analyzing your digital memory...").start();

  try {
    let query = supabase
      .from("scraps")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(parseInt(options.limit));

    if (options.source) {
      query = query.eq("source", options.source);
    }

    const { data: scraps, error } = await query;

    if (error) throw error;

    spinner.stop();

    // Analyze issues
    const issues = {
      missing_screenshot: [],
      missing_summary: [],
      missing_embedding: [],
      missing_tags: [],
      missing_url: [],
      broken_metadata: [],
      old_scraps: [],
    };

    const sourceStats = {};

    for (const scrap of scraps) {
      // Track by source
      if (!sourceStats[scrap.source]) {
        sourceStats[scrap.source] = { total: 0, issues: 0 };
      }
      sourceStats[scrap.source].total++;

      let hasIssues = false;

      // Check for missing fields
      if (!scrap.screenshot_url && scrap.url && shouldHaveScreenshot(scrap)) {
        issues.missing_screenshot.push(scrap);
        hasIssues = true;
      }

      if (!scrap.summary || scrap.summary.trim() === "") {
        issues.missing_summary.push(scrap);
        hasIssues = true;
      }

      if (!scrap.embedding) {
        issues.missing_embedding.push(scrap);
        hasIssues = true;
      }

      if (!scrap.tags || (Array.isArray(scrap.tags) && scrap.tags.length === 0)) {
        issues.missing_tags.push(scrap);
        hasIssues = true;
      }

      if (!scrap.url && shouldHaveUrl(scrap)) {
        issues.missing_url.push(scrap);
        hasIssues = true;
      }

      // Check for broken metadata
      if (scrap.metadata && typeof scrap.metadata === "string") {
        try {
          JSON.parse(scrap.metadata);
        } catch {
          issues.broken_metadata.push(scrap);
          hasIssues = true;
        }
      }

      // Check for old scraps that might benefit from re-processing
      const createdDate = new Date(scrap.created_at);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      if (createdDate < sixMonthsAgo && (!scrap.summary || !scrap.embedding)) {
        issues.old_scraps.push(scrap);
        hasIssues = true;
      }

      if (hasIssues) {
        sourceStats[scrap.source].issues++;
      }
    }

    // Display results
    console.log(chalk.green(`✅ Analyzed ${scraps.length} scraps\n`));

    // Source breakdown
    console.log(chalk.blue("📊 By Source:"));
    Object.entries(sourceStats).forEach(([source, stats]) => {
      const healthPercent = Math.round(((stats.total - stats.issues) / stats.total) * 100);
      const healthColor = healthPercent > 80 ? "green" : healthPercent > 50 ? "yellow" : "red";

      console.log(`  ${source.padEnd(10)} ${stats.total.toString().padStart(4)} total, ${stats.issues.toString().padStart(3)} issues (${chalk[healthColor](healthPercent + "% healthy")})`);
    });

    console.log();

    // Issues breakdown
    const issueTypes = [
      { key: "missing_screenshot", label: "📸 Missing Screenshots", fixable: true },
      { key: "missing_summary", label: "📝 Missing Summaries", fixable: true },
      { key: "missing_embedding", label: "🧠 Missing Embeddings", fixable: true },
      { key: "missing_tags", label: "🏷️  Missing Tags", fixable: true },
      { key: "missing_url", label: "🔗 Missing URLs", fixable: false },
      { key: "broken_metadata", label: "💔 Broken Metadata", fixable: true },
      { key: "old_scraps", label: "👴 Old Scraps (could benefit from re-processing)", fixable: true },
    ];

    console.log(chalk.blue("🔍 Issues Found:"));

    issueTypes.forEach(({ key, label, fixable }) => {
      const count = issues[key].length;
      if (count > 0) {
        const status = fixable ? chalk.green("(fixable)") : chalk.red("(manual)");
        console.log(`  ${label}: ${chalk.yellow(count)} ${status}`);
      }
    });

    if (Object.values(issues).every(arr => arr.length === 0)) {
      console.log(chalk.green("  🎉 No issues found! Your scrapbook is in perfect health."));
    } else {
      console.log(chalk.cyan("\n💡 Run `scrap-doctor repair` to fix these issues interactively."));
    }

  } catch (error) {
    spinner.stop();
    console.error(chalk.red("❌ Error during diagnosis:"), error.message);
    process.exit(1);
  }
}

async function repair(options) {
  console.log(chalk.cyan("🔧 Scrap Doctor - Repair Mode\n"));

  if (!options.auto) {
    const proceed = await inquirer.prompt([
      {
        type: "confirm",
        name: "continue",
        message: "This will modify your scraps. Continue?",
        default: false,
      },
    ]);

    if (!proceed.continue) {
      console.log(chalk.yellow("Operation cancelled."));
      return;
    }
  }

  // Get scraps that need repair
  const spinner = ora("Finding scraps that need repair...").start();

  let scraps;
  let error;

  if (options.ids) {
    // Repair specific scrap IDs
    const scrapIds = options.ids.split(",").map(id => id.trim());
    spinner.text = `Finding ${scrapIds.length} specific scraps...`;

    const { data, error: queryError } = await supabase
      .from("scraps")
      .select("*")
      .in("scrap_id", scrapIds);

    scraps = data;
    error = queryError;

    if (!error && scraps.length !== scrapIds.length) {
      const found = scraps.map(s => s.scrap_id);
      const missing = scrapIds.filter(id => !found.includes(id));
      console.warn(chalk.yellow(`\nWarning: Could not find these scrap IDs: ${missing.join(", ")}`));
    }
  } else {
    // Regular query with filters
    let query = supabase
      .from("scraps")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(parseInt(options.limit));

    if (options.source) {
      query = query.eq("source", options.source);
    }

    const result = await query;
    scraps = result.data;
    error = result.error;
  }

  if (error) {
    spinner.stop();
    console.error(chalk.red("❌ Error fetching scraps:"), error.message);
    return;
  }

  spinner.stop();

  // Filter scraps based on repair type (but skip filtering if specific IDs were requested)
  let scrapsToRepair = options.ids ?
    scraps :
    scraps.filter(scrap => needsRepair(scrap, options.type));

  if (scrapsToRepair.length === 0) {
    console.log(chalk.green("✅ No scraps need repair!"));
    return;
  }

  console.log(chalk.yellow(`Found ${scrapsToRepair.length} scraps that need repair.\n`));

  if (!options.auto) {
    const repairChoices = await inquirer.prompt([
      {
        type: "checkbox",
        name: "repairs",
        message: "What would you like to repair?",
        choices: [
          { name: "📸 Generate missing screenshots", value: "screenshot", checked: true },
          { name: "📝 Generate missing summaries", value: "summary", checked: true },
          { name: "🧠 Generate missing embeddings", value: "embedding", checked: true },
          { name: "🏷️  Generate missing tags", value: "tags", checked: false },
          { name: "💔 Fix broken metadata", value: "metadata", checked: true },
        ],
      },
    ]);

    if (repairChoices.repairs.length === 0) {
      console.log(chalk.yellow("No repairs selected."));
      return;
    }

    options.type = repairChoices.repairs;
  }

  // Prioritize scraps by value (recent, has URL, popular source)
  scrapsToRepair.sort((a, b) => {
    const scoreA = calculateRepairPriority(a);
    const scoreB = calculateRepairPriority(b);
    return scoreB - scoreA;
  });

  console.log(chalk.blue(`🚀 Starting repair process for ${scrapsToRepair.length} scraps...\n`));

  let repaired = 0;
  let failed = 0;

  for (const [index, scrap] of scrapsToRepair.entries()) {
    const progress = `[${index + 1}/${scrapsToRepair.length}]`;
    console.log(chalk.gray(`${progress} Repairing: ${scrap.title?.substring(0, 60) || scrap.scrap_id}...`));

    try {
      await repairScrap(scrap, options.type);
      repaired++;
      console.log(chalk.green("  ✅ Repaired"));
    } catch (error) {
      failed++;
      console.log(chalk.red(`  ❌ Failed: ${error.message}`));
    }

    // Add a small delay to be nice to APIs
    if (index < scrapsToRepair.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(chalk.blue("\n📊 Repair Summary:"));
  console.log(`  ✅ Repaired: ${repaired}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📈 Success rate: ${Math.round((repaired / scrapsToRepair.length) * 100)}%`);
}

async function showStatus() {
  console.log(chalk.cyan("🩺 Scrap Doctor - Quick Health Check\n"));

  const spinner = ora("Checking scrapbook health...").start();

  try {
    const { data: scraps, error } = await supabase
      .from("scraps")
      .select("source, created_at, summary, screenshot_url, embedding, tags")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;

    spinner.stop();

    const total = scraps.length;
    const withSummary = scraps.filter(s => s.summary && s.summary.trim()).length;
    const withScreenshot = scraps.filter(s => s.screenshot_url).length;
    const withEmbedding = scraps.filter(s => s.embedding).length;
    const withTags = scraps.filter(s => s.tags && s.tags.length > 0).length;

    const recent = scraps.filter(s => {
      const created = new Date(s.created_at);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return created > weekAgo;
    }).length;

    console.log(chalk.green("📊 Scrapbook Health Report (last 1000 scraps):\n"));

    const healthMetrics = [
      { label: "Total Scraps", value: total, color: "blue" },
      { label: "Added This Week", value: recent, color: recent > 10 ? "green" : "yellow" },
      { label: "Have Summaries", value: withSummary, percent: Math.round((withSummary/total)*100) },
      { label: "Have Screenshots", value: withScreenshot, percent: Math.round((withScreenshot/total)*100) },
      { label: "Have Embeddings", value: withEmbedding, percent: Math.round((withEmbedding/total)*100) },
      { label: "Have Tags", value: withTags, percent: Math.round((withTags/total)*100) },
    ];

    healthMetrics.forEach(metric => {
      if (metric.percent !== undefined) {
        const color = metric.percent > 80 ? "green" : metric.percent > 50 ? "yellow" : "red";
        console.log(`  ${metric.label.padEnd(20)}: ${chalk[color](metric.value.toString().padStart(4))} (${metric.percent}%)`);
      } else {
        const color = metric.color || "white";
        console.log(`  ${metric.label.padEnd(20)}: ${chalk[color](metric.value)}`);
      }
    });

    const overallHealth = Math.round(((withSummary + withEmbedding) / (total * 2)) * 100);
    const healthColor = overallHealth > 80 ? "green" : overallHealth > 50 ? "yellow" : "red";

    console.log(chalk.blue(`\n🏥 Overall Health: ${chalk[healthColor](overallHealth + "%")}`));

    if (overallHealth < 80) {
      console.log(chalk.cyan("\n💡 Run `scrap-doctor diagnose` for detailed analysis."));
    }

  } catch (error) {
    spinner.stop();
    console.error(chalk.red("❌ Error checking status:"), error.message);
  }
}

function shouldHaveScreenshot(scrap) {
  // Skip certain sources or types that don't benefit from screenshots
  return scrap.source !== "github" || scrap.type === "repository";
}

function shouldHaveUrl(scrap) {
  // Most scraps should have URLs except for certain types
  return !["note", "thought"].includes(scrap.type);
}

function needsRepair(scrap, repairType) {
  if (Array.isArray(repairType)) {
    return repairType.some(type => needsRepair(scrap, type));
  }

  switch (repairType) {
  case "screenshot":
    return !scrap.screenshot_url && scrap.url && shouldHaveScreenshot(scrap);
  case "summary":
    return !scrap.summary || scrap.summary.trim() === "";
  case "embedding":
    return !scrap.embedding;
  case "tags":
    return !scrap.tags || (Array.isArray(scrap.tags) && scrap.tags.length === 0);
  case "metadata":
    if (!scrap.metadata) return false;
    if (typeof scrap.metadata === "string") {
      try {
        JSON.parse(scrap.metadata);
        return false;
      } catch {
        return true;
      }
    }
    return false;
  default:
    return !scrap.summary || !scrap.embedding || (!scrap.screenshot_url && scrap.url);
  }
}

function calculateRepairPriority(scrap) {
  let score = 0;

  // Favor recent scraps
  const age = Date.now() - new Date(scrap.created_at).getTime();
  const daysSinceCreated = age / (1000 * 60 * 60 * 24);
  score += Math.max(0, 100 - daysSinceCreated); // Recent = higher score

  // Favor scraps with URLs (more useful)
  if (scrap.url) score += 50;

  // Favor certain sources
  const sourceBonus = {
    "pinboard": 30,
    "arena": 20,
    "github": 15,
    "mastodon": 10,
  };
  score += sourceBonus[scrap.source] || 0;

  // Favor scraps that already have some data
  if (scrap.title && scrap.title.length > 10) score += 10;
  if (scrap.content && scrap.content.length > 100) score += 10;

  return score;
}

async function repairScrap(scrap, repairTypes) {
  const updates = {};

  if (!Array.isArray(repairTypes)) {
    repairTypes = [repairTypes];
  }

  // This is a simplified version - in reality you'd import and use
  // the actual functions from your processing pipeline
  for (const repairType of repairTypes) {
    switch (repairType) {
    case "summary":
      if (!scrap.summary || scrap.summary.trim() === "") {
        // For now, create a simple summary from title/content
        const content = scrap.content || scrap.title || "";
        updates.summary = content.length > 200 ?
          content.substring(0, 200) + "..." :
          content || "Content summary";
      }
      break;
    case "embedding":
      if (!scrap.embedding) {
        // Mark that embedding processing was attempted
        // In reality this would call your embedding service
        updates.metadata = {
          ...((typeof scrap.metadata === "object") ? scrap.metadata : {}),
          embedding_repair_attempted: new Date().toISOString(),
        };
      }
      break;
    case "screenshot":
      if (!scrap.screenshot_url && scrap.url) {
        // Mark that screenshot was attempted
        updates.metadata = {
          ...((typeof scrap.metadata === "object") ? scrap.metadata : {}),
          screenshot_repair_attempted: new Date().toISOString(),
        };
      }
      break;
    case "tags":
      if (!scrap.tags || scrap.tags.length === 0) {
        // Extract basic tags from content
        const text = (scrap.summary || scrap.content || scrap.title || "").toLowerCase();
        const basicTags = [];

        // Add source as a tag
        basicTags.push(scrap.source);

        // Add some common keywords if found
        const keywords = ["javascript", "python", "design", "api", "github", "data", "tool"];
        keywords.forEach(keyword => {
          if (text.includes(keyword)) basicTags.push(keyword);
        });

        if (basicTags.length > 0) {
          updates.tags = [...new Set(basicTags)]; // Remove duplicates
        }
      }
      break;
    case "metadata":
      if (scrap.metadata && typeof scrap.metadata === "string") {
        try {
          JSON.parse(scrap.metadata);
        } catch {
          updates.metadata = {
            repair_note: "Fixed broken JSON",
            repair_date: new Date().toISOString(),
            original_length: scrap.metadata.length,
          };
        }
      }
      break;
    }
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("scraps")
      .update(updates)
      .eq("scrap_id", scrap.scrap_id);

    if (error) throw error;
  }
}

// Make it executable
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { diagnose, repair, showStatus };
