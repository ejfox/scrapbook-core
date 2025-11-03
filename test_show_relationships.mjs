import { completion } from "./scripts/llmService.mjs";

// Test models
const models = [
  "mistralai/mistral-large-2411",
  "openai/gpt-4o",
  "google/gemini-2.5-flash",
  "deepseek/deepseek-chat-v3.1",
  "qwen/qwen-2.5-72b-instruct",
  "anthropic/claude-3.5-haiku",
];

// Rich content with many relationships
const content = `Jeffrey Epstein helped broker a security cooperation agreement between Israel and Mongolia in 2017.
Ehud Barak, former Israeli Prime Minister and Defense Minister, visited Mongolia in April 2013, just one month after leaving his defense post.
The leaked emails show intimate, often daily correspondence between Epstein and Barak from 2013-2016.
Terje Rød-Larsen, president of the International Peace Institute and key Oslo Accords mediator, coordinated his Mongolia visit with Barak's.
Rød-Larsen was a key mediator in the 1993 and 1995 Oslo Accords when Barak led the IDF.
Epstein had personal ties to Ehud Olmert and other Israeli political figures.
The deal involved promoting Israeli defense industry interests and cyber surveillance technology in Mongolia.
President Tsakhiagiin Elbegdorj met with Barak during the Mongolia visit.
Handala, a pro-Palestinian hacking group with speculated ties to Iran, leaked these emails.
Distributed Denial of Secrets (DDoSecrets) published the leaked materials.
Friends of the IDF received donations from Epstein to support Israeli military interests.
The International Peace Institute, led by Rød-Larsen, was part of Epstein's network.
Barak's consulting business aimed to increase penetration of Israeli spy tech in foreign markets.
The Special Operations Forces Training Center near Ulaanbaatar was toured by Barak.
Epstein coordinated events from behind the scenes during the Mongolia meetings.`;

const prompt = `Extract ALL relationships from this text.

Format each relationship as:
- [Entity A] → [relationship type] → [Entity B]

Include people, organizations, countries, and concepts.
Be specific about the relationship type.
Extract as many relationships as possible.`;

console.log("🔗 DETAILED RELATIONSHIP EXTRACTION COMPARISON");
console.log("=" .repeat(80));
console.log("\nContent: Mongolia/Israel Security Deal Article\n");

for (const model of models) {
  const modelName = model.split("/")[1].toUpperCase();

  console.log("\n" + "=".repeat(80));
  console.log(`🤖 ${modelName}`);
  console.log("=".repeat(80));

  try {
    const response = await completion({
      model,
      prompt: content + "\n\n" + prompt,
      max_tokens: 800,
      temperature: 0.3,
    });

    const relationships = (response?.content || response || "")
      .split("\n")
      .filter(line => line.includes("→"))
      .map(line => line.trim());

    console.log(`\nFound ${relationships.length} relationships:\n`);

    // Show first 8 relationships
    relationships.slice(0, 8).forEach((rel, i) => {
      console.log(`${i + 1}. ${rel}`);
    });

    if (relationships.length > 8) {
      console.log(`\n... and ${relationships.length - 8} more relationships`);
    }

    // Show interesting patterns
    const epsteinRels = relationships.filter(r => r.includes("Epstein")).length;
    const barakRels = relationships.filter(r => r.includes("Barak")).length;
    const mongoliaRels = relationships.filter(r => r.toLowerCase().includes("mongolia")).length;

    console.log("\n📊 Focus areas:");
    console.log(`   • Epstein relationships: ${epsteinRels}`);
    console.log(`   • Barak relationships: ${barakRels}`);
    console.log(`   • Mongolia-related: ${mongoliaRels}`);

  } catch (error) {
    console.log(`\n❌ Error: ${error.message}`);
  }
}

console.log("\n" + "=".repeat(80));
console.log("\n🎯 ANALYSIS:");
console.log("• Notice how different models structure relationships differently");
console.log("• Some models extract more granular connections");
console.log("• Others focus on high-level relationships");
console.log("• Quality varies in specificity of relationship types");
