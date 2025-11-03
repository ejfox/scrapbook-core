import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

async function checkRecentlyProcessed() {
  // Get 5 recently updated scraps
  const { data, error } = await supabase
    .from("scraps")
    .select("id, title, url, summary, tags, relationships, location, updated_at, created_at")
    .order("updated_at", { ascending: false })
    .limit(8);

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log("🔍 CHECKING RECENTLY PROCESSED SCRAPS");
  console.log("=" .repeat(80));

  let totalFields = 0;
  let populatedFields = 0;

  data.forEach((scrap, i) => {
    console.log(`\nScrap #${i+1}: ${scrap.title?.substring(0, 50) || "[no title]"}...`);
    console.log(`ID: ${scrap.id}`);
    console.log(`URL: ${scrap.url?.substring(0, 60)}...`);
    console.log("---");

    // Check each field
    const summaryCheck = scrap.summary ? "✅" : "❌";
    const tagsCheck = scrap.tags && scrap.tags.length > 0 ? "✅" : "❌";
    const relationshipsCheck = scrap.relationships && scrap.relationships.length > 0 ? "✅" : "❌";
    const locationsCheck = scrap.location ? "✅" : "❌";

    console.log(`${summaryCheck} Summary: ${scrap.summary ? scrap.summary.length + " chars" : "MISSING"}`);
    console.log(`${tagsCheck} Tags: ${scrap.tags ? scrap.tags.length + " tags" : "MISSING"}`);
    console.log(`${relationshipsCheck} Relationships: ${scrap.relationships ? scrap.relationships.length + " found" : "MISSING"}`);
    console.log(`${locationsCheck} Locations: ${scrap.location ? JSON.stringify(scrap.location).length + " chars" : "MISSING"}`);
    console.log(`⏰ Updated: ${new Date(scrap.updated_at).toLocaleString()}`);

    // Track completeness
    totalFields += 4;
    if (scrap.summary) populatedFields++;
    if (scrap.tags && scrap.tags.length > 0) populatedFields++;
    if (scrap.relationships && scrap.relationships.length > 0) populatedFields++;
    if (scrap.location) populatedFields++;

    if (scrap.summary) {
      console.log(`\n📝 Summary preview: ${scrap.summary.substring(0, 200)}...`);
      const facts = (scrap.summary.match(/[•\-\*]/g) || []).length;
      if (facts > 0) {
        console.log(`   📊 Contains ${facts} bullet points/facts`);
      }
    }

    if (scrap.tags && scrap.tags.length > 0) {
      console.log(`🏷️ Tags: ${scrap.tags.slice(0, 10).join(", ")}${scrap.tags.length > 10 ? "..." : ""}`);
      const singleWords = scrap.tags.filter(t => !t.includes("-") && !t.includes("_")).length;
      console.log(`   Quality: ${singleWords}/${scrap.tags.length} are single words`);
    }

    if (scrap.relationships && scrap.relationships.length > 0) {
      console.log(`🔗 First relationship: ${scrap.relationships[0]}`);
    }

    console.log("-".repeat(80));
  });

  // Summary stats
  console.log("\n📊 OVERALL STATISTICS:");
  console.log(`• Field completion rate: ${Math.round((populatedFields/totalFields)*100)}% (${populatedFields}/${totalFields} fields)`);
  console.log(`• Items checked: ${data.length}`);

  // Check if we're actually updating or just creating new entries
  const recentlyCreated = data.filter(s => {
    const created = new Date(s.created_at);
    const updated = new Date(s.updated_at);
    const diff = updated - created;
    return diff < 60000; // Created in last minute
  });

  if (recentlyCreated.length === data.length) {
    console.log("⚠️ WARNING: All items are newly created, not updates to existing items!");
  } else {
    console.log(`✅ ${data.length - recentlyCreated.length} items are updates to existing entries`);
  }
}

checkRecentlyProcessed();
