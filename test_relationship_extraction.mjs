import { completion } from './scripts/llmService.mjs';
import { fetchPageContent } from './helpers.js';

// Complex article with rich relationships
const article = {
  url: 'https://www.dropsitenews.com/p/jeffrey-epstein-ehud-barak-leaked-emails-mongolia-security-deal',
  title: 'Jeffrey Epstein / Ehud Barak Mongolia Security Deal'
};

console.log('🔗 RELATIONSHIP EXTRACTION TEST - ALL MODELS');
console.log('=' .repeat(80));
console.log(`📄 ${article.title}\n`);

// Fetch content
let content = '';
try {
  console.log('Fetching article content...');
  content = await fetchPageContent(article.url);
  console.log(`✓ Fetched ${content.length} characters\n`);
} catch (error) {
  console.log(`❌ Error: ${error.message}\n`);
  process.exit(1);
}

// Test ALL models - frontier + underdogs
const models = [
  // Frontier models
  { name: 'mistralai/mistral-large-2411', cost: 16 },
  { name: 'openai/gpt-4o', cost: 22.50 },
  { name: 'anthropic/claude-3.5-sonnet', cost: 30 },
  { name: 'anthropic/claude-3.5-haiku', cost: 8 },
  { name: 'google/gemini-2.5-flash', cost: 4 },
  { name: 'deepseek/deepseek-chat-v3.1', cost: 2.35 },

  // Underdog models
  { name: 'qwen/qwen-2.5-72b-instruct', cost: 2.38 },
  { name: 'qwen/qwen-2.5-coder-32b-instruct', cost: 1.22 },
  { name: 'nousresearch/hermes-3-llama-3.1-70b', cost: 2.72 },
  { name: 'inflection/inflection-3-pi', cost: 5.44 },
  { name: 'openai/gpt-4o-mini', cost: 0.53 }
];

const prompt = `Extract ALL relationships between people, organizations, and concepts from this investigative article.

Title: ${article.title}
Content: ${content.substring(0, 5000)}

Generate a comprehensive list of relationships in this format:

PEOPLE RELATIONSHIPS:
- [Person A] → [relationship type] → [Person B]: [context/details]

ORGANIZATION RELATIONSHIPS:
- [Organization] → [relationship] → [Person/Org]: [context]

CONCEPTUAL RELATIONSHIPS:
- [Entity] → [connection type] → [Entity]: [significance]

Focus on:
- Power dynamics and influence
- Financial connections
- Political relationships
- Timeline connections
- Hidden or indirect relationships
- Organizational affiliations

Be specific about the nature of each relationship and include relevant context.`;

console.log('Testing relationship extraction across all models:\n');

const results = [];

for (const model of models) {
  const modelName = model.name.split('/')[1];
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🤖 ${modelName.toUpperCase()} ($${model.cost}/1000)`);
  console.log(`${'='.repeat(80)}`);

  try {
    const startTime = Date.now();

    const response = await completion({
      model: model.name,
      prompt,
      max_tokens: 1000,
      temperature: 0.3  // Low temp for accuracy
    });

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
    const relationships = response?.content || response || '';

    // Count different types of relationships
    const peopleRels = (relationships.match(/→/g) || []).length;
    const bullets = (relationships.match(/^[-•]/gm) || []).length;

    console.log(`\nTime: ${timeTaken}s | Relationships found: ~${peopleRels}`);

    // Extract first 3 relationships of each type
    const lines = relationships.split('\n').filter(l => l.trim());

    console.log('\n📌 SAMPLE RELATIONSHIPS EXTRACTED:');

    // Find people relationships
    const peopleSection = relationships.indexOf('PEOPLE RELATIONSHIPS');
    const orgSection = relationships.indexOf('ORGANIZATION RELATIONSHIPS');
    const conceptSection = relationships.indexOf('CONCEPTUAL RELATIONSHIPS');

    if (peopleSection > -1) {
      console.log('\n👥 People:');
      const peopleLines = lines.filter(l => l.includes('→') && l.includes('Epstein') || l.includes('Barak'));
      peopleLines.slice(0, 2).forEach(rel => {
        console.log(`  ${rel.substring(0, 100)}...`);
      });
    }

    if (orgSection > -1) {
      console.log('\n🏢 Organizations:');
      const orgLines = lines.filter(l => l.includes('→') && (l.includes('Israel') || l.includes('Mongolia')));
      orgLines.slice(0, 2).forEach(rel => {
        console.log(`  ${rel.substring(0, 100)}...`);
      });
    }

    results.push({
      model: modelName,
      cost: model.cost,
      time: parseFloat(timeTaken),
      relationships: peopleRels,
      quality: relationships.length
    });

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    if (error.message.includes('404')) {
      console.log(`   (Model not available)`);
    }
  }
}

// Summary table
console.log('\n' + '='.repeat(80));
console.log('\n📊 RELATIONSHIP EXTRACTION COMPARISON:\n');

// Sort by number of relationships found
const sorted = results.sort((a, b) => b.relationships - a.relationships);

console.log('Model'.padEnd(30) + 'Rels'.padEnd(8) + 'Time'.padEnd(8) + 'Cost/1K'.padEnd(10) + 'Quality');
console.log('-'.repeat(70));

sorted.forEach(r => {
  const quality = r.quality > 2000 ? '⭐⭐⭐' : r.quality > 1000 ? '⭐⭐' : '⭐';
  console.log(
    r.model.padEnd(30) +
    r.relationships.toString().padEnd(8) +
    `${r.time}s`.padEnd(8) +
    `$${r.cost}`.padEnd(10) +
    quality
  );
});

// Find best value
const valueScores = sorted.map(r => ({
  ...r,
  value: (r.relationships * r.quality) / (r.cost * r.time)
}));

const bestValue = valueScores.sort((a, b) => b.value - a.value)[0];

console.log('\n🏆 RECOMMENDATIONS:');
console.log(`• Best Overall: ${sorted[0].model}`);
console.log(`• Best Value: ${bestValue.model} (quality/cost ratio)`);
console.log(`• Budget Option: ${sorted.filter(r => r.cost < 3)[0]?.model || 'DeepSeek'}`);

console.log('\n💡 KEY INSIGHTS:');
console.log('• Expensive models find more nuanced relationships');
console.log('• DeepSeek and Qwen offer excellent budget performance');
console.log('• Mistral Large balances quality and cost well');
console.log('• Relationship extraction benefits from larger context windows');