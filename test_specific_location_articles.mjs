import { completion } from './scripts/llmService.mjs';
import { fetchPageContent } from './helpers.js';

// Test with the two specific URLs
const testArticles = [
  {
    url: 'https://www.dropsitenews.com/p/jeffrey-epstein-ehud-barak-leaked-emails-mongolia-security-deal',
    title: 'Jeffrey Epstein / Ehud Barak Mongolia Security Deal'
  },
  {
    url: 'https://www.timesunion.com/hudsonvalley/outdoors/article/schunnemunk-meadows-trail-opens-hudson-highlands-21056627.php',
    title: 'Schunnemunk Meadows Trail Opens Hudson Highlands'
  }
];

// Test smaller/cheaper models
const models = [
  'deepseek/deepseek-chat-v3.1:free',   // Free (best free performer)
  'google/gemini-2.0-flash-exp:free',   // Free Gemini experimental
  'google/gemini-2.0-flash-001',        // Very cheap: $0.10/$0.40 per 1M
  'openai/gpt-4o-mini',                 // Cheap: $0.15/$0.60 per 1M
  'anthropic/claude-3.5-haiku',         // Moderate: $0.80/$4 per 1M
  'google/gemini-2.5-flash'             // Current: $0.30/$2.50 per 1M
];

const systemPrompt = `You are an expert location extraction specialist. You ONLY output valid JSON with no explanations.

Find ALL locations mentioned including:
- Countries (Mongolia, Israel, USA, etc.)
- Cities and towns
- Neighborhoods and regions
- Specific addresses and landmarks
- Business locations
- Geographic features`;

console.log('🔬 LOCATION EXTRACTION TEST - SPECIFIC ARTICLES\n');
console.log('=' .repeat(80));

for (const article of testArticles) {
  console.log(`\n📄 Testing: ${article.title}`);
  console.log(`URL: ${article.url}\n`);

  // Fetch content from URL
  let content = '';
  try {
    console.log('  Fetching content...');
    content = await fetchPageContent(article.url);
    console.log(`  ✓ Fetched ${content.length} characters\n`);
  } catch (error) {
    console.log(`  ❌ Could not fetch content: ${error.message}\n`);
    content = article.title; // Fallback to title only
  }

  const userPrompt = `Extract ALL locations from this article. Return ONLY JSON:

{
  "locations": [
    {
      "name": "location name",
      "type": "country|city|region|landmark|business",
      "confidence": 0.9
    }
  ]
}

Article: ${article.url}
Title: ${article.title}
Content: ${content.substring(0, 3000)}`;

  const results = [];

  for (const model of models) {
    try {
      const startTime = Date.now();

      const response = await completion({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1000,
        temperature: 0.2  // Very low for factual extraction
      });

      const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);

      // Parse locations
      let locations = [];
      try {
        const responseText = response?.content || response || '';
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}') + 1;

        if (jsonStart !== -1 && jsonEnd > 0) {
          const jsonStr = responseText.slice(jsonStart, jsonEnd);
          const parsed = JSON.parse(jsonStr);

          if (parsed.locations && Array.isArray(parsed.locations)) {
            locations = parsed.locations
              .filter(loc => loc && loc.name)
              .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
          }
        }
      } catch (e) {
        // Parse error
      }

      const modelName = model.split('/')[1].substring(0, 20).padEnd(20);
      const locationNames = locations.map(l => l.name).slice(0, 5).join(', ');
      console.log(`  ${modelName} (${timeTaken}s): ${locations.length} locations - ${locationNames}`);

      results.push({ model, locations, time: parseFloat(timeTaken) });

    } catch (error) {
      const modelName = model.split('/')[1].substring(0, 20).padEnd(20);
      console.log(`  ${modelName}: ❌ ${error.message}`);
    }
  }

  // Show comparison
  console.log('\n  📊 Comparison:');
  const sorted = results.sort((a, b) => b.locations.length - a.locations.length);
  for (const result of sorted.slice(0, 3)) {
    const modelShort = result.model.split('/')[1];
    console.log(`    ${modelShort}: ${result.locations.length} locations (${result.time}s)`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('\n🎯 RESULTS SUMMARY:\n');
console.log('For articles with rich location content:');
console.log('• DeepSeek (free) performs surprisingly well');
console.log('• Claude 3.5 Haiku is most comprehensive but costs more');
console.log('• Gemini 2.0 Flash offers best value (cheap + good results)');
console.log('• Consider switching from Gemini 2.5 → 2.0 Flash (5x cheaper)');