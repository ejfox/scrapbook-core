import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { completion } from './scripts/llmService.mjs'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

// Get a recent article with likely location content
const { data: articles } = await supabase
  .from('scraps')
  .select('*')
  .eq('source', 'pinboard')
  .not('title', 'is', null)
  .not('content', 'is', null)
  .order('created_at', { ascending: false })
  .limit(5)

// Find an article with location-related content
const article = articles.find(a => {
  const text = (a.title + ' ' + (a.content || '')).toLowerCase()
  return text.includes('city') || text.includes('state') || text.includes('country') ||
         text.includes('street') || text.includes('town') || text.includes('new york') ||
         text.includes('san francisco') || text.includes('london') || text.includes('county')
}) || articles[0]

console.log('📚 Testing article:', article.title?.substring(0, 100))
console.log('URL:', article.url)
console.log('\n' + '='.repeat(80))

const content = article.content?.substring(0, 3000) || article.title || ''

// Test smaller/cheaper models for location extraction
const models = [
  'deepseek/deepseek-chat:free',        // Free
  'meta-llama/llama-3.1-8b-instruct:free', // Free
  'google/gemini-2.0-flash-001',        // Very cheap: $0.10/$0.40 per 1M
  'openai/gpt-4o-mini',                 // Cheap: $0.15/$0.60 per 1M
  'anthropic/claude-3.5-haiku',         // Moderate: $0.80/$4 per 1M
  'google/gemini-2.5-flash',             // Current: $0.30/$2.50 per 1M
]

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
- Event locations and addresses`

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
Content: ${content}`

console.log('\n🔬 LOCATION EXTRACTION MODEL COMPARISON')
console.log('Testing with smaller/cheaper models (less creative task)\n')

for (const model of models) {
  try {
    console.log(`\n🤖 Testing ${model}:`)
    const startTime = Date.now()

    const response = await completion({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1000,
      temperature: 0.3,  // Low temperature for factual extraction
    })

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1)

    // Parse the JSON response
    let locations = []
    let primaryLocation = null
    try {
      const responseText = response?.content || response || ''
      const jsonStart = responseText.indexOf('{')
      const jsonEnd = responseText.lastIndexOf('}') + 1

      if (jsonStart !== -1 && jsonEnd > 0) {
        const jsonStr = responseText.slice(jsonStart, jsonEnd)
        const parsed = JSON.parse(jsonStr)

        if (parsed.locations && Array.isArray(parsed.locations)) {
          locations = parsed.locations
            .filter(loc => loc && loc.name && loc.confidence >= 0.3)
            .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))

          primaryLocation = locations[0]?.name || null
        }
      }
    } catch (e) {
      console.log(`⚠️  Parse error: ${e.message}`)
    }

    console.log(`⏱️  Time: ${timeTaken}s`)
    console.log(`📍 Primary location: ${primaryLocation || 'none found'}`)
    console.log(`🗺️  Total locations found: ${locations.length}`)

    if (locations.length > 0) {
      console.log(`📊 Confidence levels: ${locations.map(l => `${l.name} (${l.confidence})`).slice(0, 3).join(', ')}`)
    }

    // Estimate cost (rough calculation)
    const tokenEstimate = 1500 // Approximate tokens for prompt + response
    const costs = {
      'deepseek/deepseek-chat:free': 0,
      'meta-llama/llama-3.1-8b-instruct:free': 0,
      'google/gemini-2.0-flash-001': (tokenEstimate * 0.0000001) + (500 * 0.0000004),
      'openai/gpt-4o-mini': (tokenEstimate * 0.00000015) + (500 * 0.0000006),
      'anthropic/claude-3.5-haiku': (tokenEstimate * 0.0000008) + (500 * 0.000004),
      'google/gemini-2.5-flash': (tokenEstimate * 0.0000003) + (500 * 0.0000025),
    }

    const estimatedCost = costs[model] || 0
    console.log(`💰 Estimated cost per request: $${estimatedCost.toFixed(8)}`)

  } catch (error) {
    console.log(`❌ Error: ${error.message}`)
  }
}

console.log('\n' + '='.repeat(80))
console.log('\n📊 RECOMMENDATION:')
console.log('For location extraction (factual, not creative):')
console.log('• Best free option: DeepSeek or Llama 3.1 8B')
console.log('• Best paid option: Gemini 2.0 Flash ($0.10/$0.40 per 1M tokens)')
console.log('• Current: Gemini 2.5 Flash ($0.30/$2.50 per 1M tokens)')
