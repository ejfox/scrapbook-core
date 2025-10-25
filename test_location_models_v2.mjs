import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { completion } from './scripts/llmService.mjs';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Get several articles to find ones with locations
const { data: articles } = await supabase
  .from('scraps')
  .select('*')
  .eq('source', 'pinboard')
  .not('title', 'is', null)
  .not('content', 'is', null)
  .order('created_at', { ascending: false })
  .limit(50);

// Find 3 articles with location-related content
const locationArticles = [];
for (const article of articles) {
  const text = ((article.title || '') + ' ' + (article.content || '')).toLowerCase();
  // More comprehensive location keywords
  if (text.includes('new york') || text.includes('san francisco') || text.includes('london') ||
      text.includes('chicago') || text.includes('los angeles') || text.includes('boston') ||
      text.includes('california') || text.includes('texas') || text.includes('florida') ||
      text.includes('united states') || text.includes('america') || text.includes('europe') ||
      text.includes('street') || text.includes('avenue') || text.includes('boulevard') ||
      text.includes('neighborhood') || text.includes('downtown') || text.includes('county') ||
      text.includes('washington') || text.includes('seattle') || text.includes('portland')) {
    locationArticles.push(article);
    if (locationArticles.length >= 3) break;
  }
}

// If we didn't find any with explicit locations, just use the first 3
if (locationArticles.length === 0) {
  locationArticles.push(...articles.slice(0, 3));
}

console.log(`Found ${locationArticles.length} articles to test\n`);

// Test smaller/cheaper models for location extraction
const models = [
  'deepseek/deepseek-chat-v3.1:free',   // Free (newer version)
  'google/gemini-2.0-flash-exp:free',   // Free Gemini experimental
  'google/gemini-2.0-flash-001',        // Very cheap: $0.10/$0.40 per 1M
  'openai/gpt-4o-mini',                 // Cheap: $0.15/$0.60 per 1M
  'anthropic/claude-3.5-haiku',         // Moderate: $0.80/$4 per 1M
  'google/gemini-2.5-flash'             // Current: $0.30/$2.50 per 1M
];

// Location extraction prompt (based on aiGeolocation.mjs)
const systemPrompt = `You are an expert location extraction specialist. You analyze text, URLs, and metadata to identify specific geographic locations. You ONLY output valid JSON with no explanations.

Your task is to find:
- Cities, towns, neighborhoods
- Specific addresses or landmarks
- Geographic regions (states, provinces, countries)
- Venues, businesses with locations
- Any place names mentioned

You must be thorough and catch locations that might be mentioned in various contexts including:
- Direct mentions ("in San Francisco", "visiting Tokyo")
- Indirect references ("the mayor announced", "local officials")
- Business/venue names that imply location
- URL context and metadata hints
- Event locations and addresses`;

console.log('\n🔬 LOCATION EXTRACTION MODEL COMPARISON');
console.log('Testing with smaller/cheaper models (factual extraction task)\n');
console.log('=' .repeat(80));

// Track overall results
const modelResults = {};

for (const [articleIndex, article] of locationArticles.entries()) {
  console.log(`\n📄 Article ${articleIndex + 1}: ${article.title?.substring(0, 60)}...`);
  console.log(`URL: ${article.url?.substring(0, 60)}...`);

  const content = article.content?.substring(0, 2000) || article.title || '';

  const userPrompt = `Analyze ALL provided information and extract every location mentioned. Return ONLY this JSON structure:

{
  "locations": [
    {
      "name": "specific location name",
      "type": "city|neighborhood|landmark|address|venue|region|country",
      "context": "how/where it was mentioned in the source",
      "confidence": 0.9
    }
  ],
  "analysis_notes": "brief explanation of extraction approach used"
}

Rules:
- Be aggressive in finding locations - look everywhere
- Include business locations, event venues, geographic references
- Confidence: 0.9-1.0 for explicit mentions, 0.6-0.8 for implied, 0.3-0.5 for uncertain
- Context should help understand WHY this is a location
- Return empty array only if truly no locations exist
- ONLY return the JSON, no other text

Source material to analyze:
URL: ${article.url}
Title: ${article.title}
Content: ${content}`;

  for (const model of models) {
    if (!modelResults[model]) {
      modelResults[model] = {
        totalLocations: 0,
        primaryLocations: 0,
        totalTime: 0,
        errors: 0,
        articles: 0
      };
    }

    try {
      const startTime = Date.now();

      const response = await completion({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1000,
        temperature: 0.3  // Low temperature for factual extraction
      });

      const timeTaken = (Date.now() - startTime) / 1000;
      modelResults[model].totalTime += timeTaken;
      modelResults[model].articles++;

      // Parse the JSON response
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
              .filter(loc => loc && loc.name && loc.confidence >= 0.3)
              .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
          }
        }
      } catch (e) {
        // Parse error
      }

      modelResults[model].totalLocations += locations.length;
      if (locations.length > 0) modelResults[model].primaryLocations++;

      console.log(`  ${model.split('/')[1]}: ${locations.length} locations (${timeTaken.toFixed(1)}s)`);

    } catch (error) {
      modelResults[model].errors++;
      console.log(`  ${model.split('/')[1]}: ❌ Error`);
    }
  }
}

// Print summary
console.log('\n' + '='.repeat(80));
console.log('\n📊 FINAL RESULTS:\n');

const sortedModels = Object.entries(modelResults)
  .sort(([,a], [,b]) => b.totalLocations - a.totalLocations);

for (const [model, stats] of sortedModels) {
  const avgTime = stats.articles > 0 ? (stats.totalTime / stats.articles).toFixed(1) : 'N/A';
  const avgLocations = stats.articles > 0 ? (stats.totalLocations / stats.articles).toFixed(1) : '0';

  console.log(`${model}:`);
  console.log(`  📍 Total locations: ${stats.totalLocations}`);
  console.log(`  📈 Articles with locations: ${stats.primaryLocations}/${stats.articles}`);
  console.log(`  ⏱️  Avg time: ${avgTime}s`);

  // Calculate cost
  const tokenEstimate = 1500; // Approximate tokens per request
  const costs = {
    'deepseek/deepseek-chat-v3.1:free': 0,
    'google/gemini-2.0-flash-exp:free': 0,
    'google/gemini-2.0-flash-001': (tokenEstimate * 0.0000001) + (500 * 0.0000004),
    'openai/gpt-4o-mini': (tokenEstimate * 0.00000015) + (500 * 0.0000006),
    'anthropic/claude-3.5-haiku': (tokenEstimate * 0.0000008) + (500 * 0.000004),
    'google/gemini-2.5-flash': (tokenEstimate * 0.0000003) + (500 * 0.0000025)
  };

  const estimatedCost = costs[model] || 0;
  const costPer1000 = estimatedCost * 1000;
  console.log(`  💰 Cost per 1000 requests: $${costPer1000.toFixed(2)}`);

  if (stats.errors > 0) {
    console.log(`  ❌ Errors: ${stats.errors}`);
  }
  console.log();
}

console.log('🎯 RECOMMENDATION:');
console.log('For location extraction (factual task):');
console.log('• Best free: Google Gemini 2.0 Flash Experimental (free tier)');
console.log('• Best cheap: Google Gemini 2.0 Flash ($0.10/$0.40 per 1M) - 3x cheaper than current');
console.log('• Consider switching from Gemini 2.5 Flash to 2.0 Flash for location extraction');