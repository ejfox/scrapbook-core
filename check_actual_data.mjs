import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

async function checkActualData() {
  console.log("🔍 CHECKING WHAT DATA ACTUALLY EXISTS\n");

  // Get 5 recent scraps to see what fields they have
  const { data: recentScraps, error } = await supabase
    .from("scraps")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log("📋 SAMPLE OF 5 MOST RECENT SCRAPS:\n");

  recentScraps.forEach((scrap, i) => {
    console.log(`\n[${ i + 1}] ${scrap.title?.substring(0, 60) || "No title"}...`);
    console.log(`   ID: ${scrap.id}`);
    console.log(`   Source: ${scrap.source}`);
    console.log(`   Updated: ${scrap.updated_at}`);
    console.log("\n   Field Status:");
    console.log(`   - content: ${scrap.content ? "✅ " + scrap.content.length + " chars" : "❌"}`);
    console.log(`   - summary: ${scrap.summary ? "✅ " + scrap.summary.length + " chars" : "❌"}`);
    console.log(`   - ai_summary: ${scrap.ai_summary ? "✅ " + scrap.ai_summary.length + " chars" : "❌"}`);
    console.log(`   - tags: ${scrap.tags ? "✅ " + scrap.tags.length + " tags" : "❌"}`);
    console.log(`   - ai_tags: ${scrap.ai_tags ? "✅ " + scrap.ai_tags.length + " tags" : "❌"}`);
    console.log(`   - relationships: ${scrap.relationships ? "✅ " + JSON.stringify(scrap.relationships).length + " chars" : "❌"}`);
    console.log(`   - location: ${scrap.location || "❌"}`);
    console.log(`   - financial_analysis: ${scrap.financial_analysis ? "✅" : "❌"}`);
    console.log(`   - screenshot_url: ${scrap.screenshot_url ? "✅" : "❌"}`);
    console.log(`   - embedding: ${scrap.embedding ? "✅" : "❌"}`);
  });

  // Check what columns actually exist
  console.log("\n\n🗄️  CHECKING DATABASE SCHEMA:\n");
  const { data: columns, error: schemaError } = await supabase
    .from("scraps")
    .select("*")
    .limit(1);

  if (columns && columns[0]) {
    console.log("Available columns:", Object.keys(columns[0]).join(", "));
  }
}

checkActualData().catch(console.error);
