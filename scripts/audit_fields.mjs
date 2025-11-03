#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import chalk from "chalk";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

async function auditFields() {
  console.log(chalk.blue("📊 Auditing field completeness for recent 64 scraps...\n"));

  // Get the 64 most recent scraps
  const { data: scraps, error } = await supabase
    .from("scraps")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(64);

  if (error) {
    console.error(chalk.red("Error fetching scraps:"), error);
    return;
  }

  console.log(chalk.green(`✓ Fetched ${scraps.length} scraps\n`));

  // Fields to check
  const fields = [
    "summary",
    "tags",
    "relationships",
    "location",
    "financial_analysis",
    "screenshot_url",
    "concept_tags",
    "content_type",
    "extraction_confidence",
    "embedding",
    "embedding_nomic",
  ];

  // Count completeness
  const counts = {};
  fields.forEach(field => {
    counts[field] = scraps.filter(s => {
      const value = s[field];
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "string") return value.trim().length > 0;
      if (typeof value === "object") return Object.keys(value).length > 0;
      return true;
    }).length;
  });

  // Print results
  console.log(chalk.bold("Field Completeness:"));
  console.log(chalk.gray("─".repeat(60)));

  fields.forEach(field => {
    const count = counts[field];
    const percentage = ((count / scraps.length) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(count / scraps.length * 40));
    const color = percentage >= 90 ? chalk.green : percentage >= 50 ? chalk.yellow : chalk.red;

    console.log(
      color(`${field.padEnd(20)} ${count}/${scraps.length} (${percentage}%) ${bar}`),
    );
  });

  console.log(chalk.gray("─".repeat(60)));

  // Sample a few scraps to show actual data
  console.log(chalk.blue("\n📋 Sample data from 3 recent scraps:\n"));

  scraps.slice(0, 3).forEach((scrap, i) => {
    console.log(chalk.cyan(`[${i + 1}] ${scrap.title || "[no title]"}`));
    console.log(chalk.gray(`    URL: ${scrap.url}`));

    fields.forEach(field => {
      const value = scrap[field];
      let status = "❌";
      let preview = "null";

      if (value !== null && value !== undefined) {
        if (Array.isArray(value)) {
          if (value.length > 0) {
            status = "✅";
            preview = `[${value.length} items]`;
            if (field === "ai_tags") preview += ` ${value.slice(0, 3).join(", ")}`;
            if (field === "relationships") preview += ` e.g. ${value[0]?.from || "N/A"} → ${value[0]?.to || "N/A"}`;
          }
        } else if (typeof value === "string" && value.trim().length > 0) {
          status = "✅";
          preview = value.substring(0, 60) + (value.length > 60 ? "..." : "");
        } else if (typeof value === "object" && Object.keys(value).length > 0) {
          status = "✅";
          preview = JSON.stringify(value).substring(0, 60) + "...";
        }
      }

      console.log(`    ${status} ${field.padEnd(20)} ${chalk.gray(preview)}`);
    });
    console.log();
  });
}

auditFields();
