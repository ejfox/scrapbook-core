import { completion } from "./scripts/llmService.mjs";

// Top performers from our tests
const models = [
  { name: "mistralai/mistral-large-2411", cost: 16 },
  { name: "openai/gpt-4o", cost: 22.50 },
  { name: "google/gemini-2.5-flash", cost: 4 },
  { name: "deepseek/deepseek-chat-v3.1", cost: 2.35 },
  { name: "qwen/qwen-2.5-72b-instruct", cost: 2.38 },
];

// Simpler content for faster testing
const content = `Jeffrey Epstein helped broker a security cooperation agreement between Israel and Mongolia.
Ehud Barak, former Israeli Prime Minister and Defense Minister, visited Mongolia in April 2013.
The emails show daily correspondence between Epstein and Barak from 2013-2016.
Terje Rød-Larsen, president of the International Peace Institute, was also involved.
Epstein had connections to Ehud Olmert and other Israeli political figures.
The deal involved promoting Israeli defense industry interests in Mongolia.
Handala, a pro-Palestinian hacking group, leaked these emails.
Distributed Denial of Secrets published the leaked materials.`;

const prompt = `Extract ALL relationships from this text. Format:
- [Entity A] → [relationship] → [Entity B]

Focus on people, organizations, and countries.`;

console.log("🔗 QUICK RELATIONSHIP TEST - TOP MODELS\n");

const results = [];

for (const model of models) {
  const modelName = model.name.split("/")[1];
  console.log(`\nTesting ${modelName}...`);

  try {
    const startTime = Date.now();
    const response = await completion({
      model: model.name,
      prompt: content + "\n\n" + prompt,
      max_tokens: 500,
      temperature: 0.3,
    });

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
    const relationships = (response?.content || response || "").match(/→/g)?.length || 0;

    console.log(`✓ Found ${relationships} relationships in ${timeTaken}s ($${model.cost}/1000)`);

    // Show first 3 relationships
    const lines = (response?.content || response || "").split("\n")
      .filter(l => l.includes("→"))
      .slice(0, 3);

    lines.forEach(l => console.log(`  ${l.substring(0, 80)}...`));

    results.push({ model: modelName, relationships, time: parseFloat(timeTaken), cost: model.cost });

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

console.log("\n📊 FINAL RANKING:\n");
results.sort((a, b) => b.relationships - a.relationships);

console.log("Model".padEnd(25) + "Rels  Time   Cost/1K");
console.log("-".repeat(50));
results.forEach(r => {
  console.log(
    r.model.padEnd(25) +
    r.relationships.toString().padEnd(6) +
    `${r.time}s`.padEnd(7) +
    `$${r.cost}`,
  );
});

// Best value calculation
const bestValue = results
  .map(r => ({ ...r, value: r.relationships / (r.cost * r.time) }))
  .sort((a, b) => b.value - a.value)[0];

console.log("\n🏆 RECOMMENDATIONS:");
console.log(`• Most Relationships: ${results[0].model}`);
console.log(`• Best Value: ${bestValue.model}`);
console.log(`• Fastest: ${results.sort((a, b) => a.time - b.time)[0].model}`);
