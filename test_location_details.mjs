import { completion } from './scripts/llmService.mjs';
import { fetchPageContent } from './helpers.js';

// Test with the two specific URLs
const testArticles = [
  {
    url: 'https://www.dropsitenews.com/p/jeffrey-epstein-ehud-barak-leaked-emails-mongolia-security-deal',
    title: 'Jeffrey Epstein / Ehud Barak Mongolia Security Deal',
    expectedLocations: ['Mongolia', 'Israel', 'Iran']
  },
  {
    url: 'https://www.timesunion.com/hudsonvalley/outdoors/article/schunnemunk-meadows-trail-opens-hudson-highlands-21056627.php',
    title: 'Schunnemunk Meadows Trail Opens Hudson Highlands',
    expectedLocations: ['Hudson Valley', 'Hudson Highlands', 'Schunnemunk', 'Orange County', 'New York']
  }
];

// Test models
const models = [
  'deepseek/deepseek-chat-v3.1:free',
  'google/gemini-2.0-flash-001',
  'openai/gpt-4o-mini',
  'anthropic/claude-3.5-haiku',
  'google/gemini-2.5-flash'
];

const systemPrompt = `You are an expert location extraction specialist. You ONLY output valid JSON with no explanations.

Find ALL locations mentioned including:
- Countries, states, provinces
- Cities, towns, counties
- Neighborhoods, regions, valleys
- Specific landmarks, trails, parks
- Geographic features

Choose the PRIMARY location based on what the article is mainly about.`;

console.log('🔬 DETAILED LOCATION EXTRACTION TEST\n');
console.log('=' .repeat(80));

for (const article of testArticles) {
  console.log(`\n📄 ${article.title}`);
  console.log(`Expected locations: ${article.expectedLocations.join(', ')}`);
  console.log('-'.repeat(80));

  // Fetch content
  let content = '';
  try {
    console.log('Fetching content...');
    content = await fetchPageContent(article.url);
    console.log(`✓ Fetched ${content.length} characters\n`);
  } catch (error) {
    console.log(`❌ Could not fetch: ${error.message}\n`);
    content = article.title;
  }

  const userPrompt = `Extract ALL locations from this article. Return ONLY this JSON:

{
  "primary": "the main location this article is about",
  "locations": [
    {
      "name": "location name",
      "type": "country|state|city|county|region|landmark|trail",
      "confidence": 0.9,
      "context": "brief context"
    }
  ]
}

Article URL: ${article.url}
Title: ${article.title}
Content: ${content.substring(0, 3000)}`;

  for (const model of models) {
    const modelShort = model.split('/')[1].substring(0, 25).padEnd(25);

    try {
      const response = await completion({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1000,
        temperature: 0.2
      });

      // Parse response
      let result = { primary: null, locations: [] };
      try {
        const responseText = response?.content || response || '';
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}') + 1;

        if (jsonStart !== -1 && jsonEnd > 0) {
          const jsonStr = responseText.slice(jsonStart, jsonEnd);
          result = JSON.parse(jsonStr);
        }
      } catch (e) {
        // Parse error
      }

      // Display results
      console.log(`\n🤖 ${modelShort}`);
      console.log(`   PRIMARY: ${result.primary || 'none selected'}`);

      if (result.locations && result.locations.length > 0) {
        console.log(`   ALL LOCATIONS (${result.locations.length}):`);
        result.locations.forEach((loc, i) => {
          const conf = loc.confidence ? ` (${loc.confidence})` : '';
          const type = loc.type ? ` [${loc.type}]` : '';
          console.log(`     ${i + 1}. ${loc.name}${type}${conf}`);
          if (loc.context && i < 3) {
            console.log(`        → ${loc.context.substring(0, 60)}...`);
          }
        });
      } else {
        console.log(`   No locations extracted`);
      }

    } catch (error) {
      console.log(`\n🤖 ${modelShort}`);
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  console.log('\n' + '='.repeat(80));
}

console.log('\n📊 ANALYSIS:\n');
console.log('For the Epstein/Mongolia article:');
console.log('• PRIMARY should be "Mongolia" (the security deal location)');
console.log('• Should also find "Israel", "Iran", etc.');
console.log('\nFor the Schunnemunk Trail article:');
console.log('• PRIMARY should be "Schunnemunk" or "Hudson Highlands"');
console.log('• Should also find "Orange County", "New York", "Hudson Valley"');