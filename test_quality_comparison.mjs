import { completion } from './scripts/llmService.mjs'
import { fetchPageContent } from './helpers.js'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

// Get a recent interesting article
const { data: articles } = await supabase
  .from('scraps')
  .select('*')
  .eq('source', 'pinboard')
  .not('title', 'is', null)
  .order('created_at', { ascending: false })
  .limit(10)

// Pick an article with substance
const article = articles.find(a =>
  a.content && a.content.length > 1000,
) || articles[0]

console.log('🆚 QUALITY COMPARISON: OLD vs NEW CONFIG')
console.log('=' .repeat(80))
console.log(`\n📄 Testing with: ${article.title}`)
console.log(`URL: ${article.url}\n`)

// Fetch full content
let content = article.content || ''
try {
  if (article.url && content.length < 2000) {
    console.log('Fetching full content...')
    const fullContent = await fetchPageContent(article.url)
    if (fullContent && fullContent.length > content.length) {
      content = fullContent
      console.log(`✓ Fetched ${fullContent.length} characters\n`)
    }
  }
} catch (error) {
  console.log('Using cached content\n')
}

// Summary generation prompt
const summaryPrompt = `Analyze this article and generate a rich, insightful summary.

Title: ${article.title}
URL: ${article.url}
Content: ${content.substring(0, 4000)}

Create:
1. A compelling 2-3 sentence overview
2. 5-7 fascinating specific facts or insights
3. Key themes and why this matters

Be creative, insightful, and engaging.`

// Test configurations
const configs = [
  {
    name: 'OLD CONFIG',
    models: {
      summary: 'google/gemini-2.5-flash',
      tags: 'openai/gpt-4o-mini',
      location: 'google/gemini-2.5-flash',
    },
    cost: {
      summary: 4,
      tags: 0.53,
      location: 4,
    },
  },
  {
    name: 'NEW CONFIG',
    models: {
      summary: 'mistralai/mistral-large-2411',
      tags: 'openai/gpt-4o-mini',
      location: 'deepseek/deepseek-chat-v3.1',
    },
    cost: {
      summary: 16,
      tags: 0.53,
      location: 0.40,
    },
  },
]

console.log('=' .repeat(80))
console.log('COMPARING SUMMARIES')
console.log('=' .repeat(80))

for (const config of configs) {
  console.log(`\n🔧 ${config.name}`)
  console.log(`Summary model: ${config.models.summary} ($${config.cost.summary}/1000)`)
  console.log('-'.repeat(80))

  try {
    const startTime = Date.now()

    // Generate summary
    const response = await completion({
      model: config.models.summary,
      prompt: summaryPrompt,
      max_tokens: 1000,
      temperature: 0.7,
    })

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1)
    const summary = response?.content || response || ''

    console.log(`\n⏱️  Time: ${timeTaken}s`)
    console.log(`📝 Length: ${summary.length} characters`)
    console.log('\n--- SUMMARY ---\n')
    console.log(summary)

    // Count quality metrics
    const bullets = (summary.match(/[•\-*]\s/g) || []).length
    const numbers = (summary.match(/\d+/g) || []).length

    console.log('\n📊 Metrics:')
    console.log(`  • Bullet points: ${bullets}`)
    console.log(`  • Data points: ${numbers}`)

  } catch (error) {
    console.log(`❌ Error: ${error.message}`)
  }
}

// Now test tags
const tagPrompt = `Select appropriate tags for this content.
Title: ${article.title}
Content: ${content.substring(0, 2000)}

Available tags: javascript, python, data, visualization, api, security, database, machinelearning, opensource, tool, tutorial, design

Return only comma-separated lowercase single-word tags.`

console.log('\n' + '=' .repeat(80))
console.log('COMPARING TAGS')
console.log('=' .repeat(80))

for (const config of configs) {
  console.log(`\n🔧 ${config.name}`)

  const response = await completion({
    model: config.models.tags,
    prompt: tagPrompt,
    max_tokens: 100,
    temperature: 0.3,
  })

  const tags = (response?.content || response || '')
    .toLowerCase()
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0)

  console.log(`🏷️  Tags: ${tags.join(', ')}`)
}

// Test location extraction
const locationPrompt = `Extract locations from: ${article.title}
${content.substring(0, 1000)}

Return format: [Location] → [Type]`

console.log('\n' + '=' .repeat(80))
console.log('COMPARING LOCATION EXTRACTION')
console.log('=' .repeat(80))

for (const config of configs) {
  console.log(`\n🔧 ${config.name}`)
  console.log(`Location model: ${config.models.location} ($${config.cost.location}/1000)`)

  const response = await completion({
    model: config.models.location,
    prompt: locationPrompt,
    max_tokens: 200,
    temperature: 0.2,
  })

  const locations = (response?.content || response || '')
    .split('\n')
    .filter(l => l.includes('→'))
    .slice(0, 3)

  console.log('📍 Locations found:')
  locations.forEach(l => console.log(`  ${l}`))
}

console.log('\n' + '=' .repeat(80))
console.log('💰 COST COMPARISON (per 1000 items)')
console.log('=' .repeat(80))

for (const config of configs) {
  const total = config.cost.summary + config.cost.tags + config.cost.location
  console.log(`\n${config.name}:`)
  console.log(`  Summary: $${config.cost.summary}`)
  console.log(`  Tags: $${config.cost.tags}`)
  console.log(`  Location: $${config.cost.location}`)
  console.log(`  TOTAL: $${total.toFixed(2)}`)
}

console.log('\n🎯 VERDICT:')
console.log('Compare the quality above. If NEW CONFIG produces better summaries,')
console.log('run: node scripts/scrap_doctor_ai.mjs repair --limit 10 --auto')
console.log('to start processing with the optimized models!')
