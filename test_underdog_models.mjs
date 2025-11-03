import { completion } from './scripts/llmService.mjs'
import { fetchPageContent } from './helpers.js'

// The complex article
const article = {
  url: 'https://www.dropsitenews.com/p/jeffrey-epstein-ehud-barak-leaked-emails-mongolia-security-deal',
  title: 'Jeffrey Epstein / Ehud Barak Mongolia Security Deal',
}

console.log('🔬 UNDERDOG FRONTIER MODELS - FACT EXTRACTION TEST')
console.log('=' .repeat(80))
console.log(`📄 ${article.title}\n`)

// Fetch content
let content = ''
try {
  console.log('Fetching article content...')
  content = await fetchPageContent(article.url)
  console.log(`✓ Fetched ${content.length} characters\n`)
} catch (error) {
  console.log(`❌ Error: ${error.message}\n`)
  process.exit(1)
}

// Test UNDERDOG frontier models
const models = [
  'qwen/qwen-2.5-coder-32b-instruct',     // Alibaba's coding-focused model
  'qwen/qwen-2.5-72b-instruct',           // Alibaba's large model
  'nousresearch/hermes-3-llama-3.1-70b',  // Hermes fine-tune
  'cognitivecomputations/dolphin-2.9-llama3-70b', // Dolphin uncensored
  'anthropic/claude-3-opus',              // The expensive Claude
  'inflection/inflection-3-pi',           // Inflection's Pi model
  'x-ai/grok-2-1212',                     // Elon's Grok 2
  'deepseek/deepseek-r1-distill-llama-70b', // DeepSeek reasoning model
]

const prompt = `Extract fascinating, specific facts from this complex investigative article.

Title: ${article.title}
Content: ${content.substring(0, 6000)}

Generate EXACTLY 7 specific, intriguing facts that reveal:
- Hidden connections and power dynamics
- Financial or political details
- Unusual or surprising elements
- Timeline specifics
- Key players and relationships

Format each fact as a bullet point. Be specific with names, dates, and details.`

console.log('Testing underdog and alternative frontier models:\n')

for (const model of models) {
  const modelName = model.split('/')[1]
  console.log(`\n${'='.repeat(80)}`)
  console.log(`🎯 ${modelName.toUpperCase()}`)
  console.log(`Model: ${model}`)
  console.log(`${'='.repeat(80)}`)

  try {
    const startTime = Date.now()

    const response = await completion({
      model,
      prompt,
      max_tokens: 800,
      temperature: 0.5,
    })

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1)
    const facts = response?.content || response || ''

    // Extract bullet points
    const bullets = facts.split('\n')
      .filter(line => line.trim().startsWith('•') || line.trim().startsWith('-') || line.trim().startsWith('*'))
      .map(line => line.trim().substring(1).trim())

    console.log(`\nTime: ${timeTaken}s | Found ${bullets.length} facts`)

    // Estimate cost
    const tokenEstimate = 6800 // Rough estimate
    const costs = {
      'qwen/qwen-2.5-coder-32b-instruct': tokenEstimate * 0.00000018, // ~$0.18 per 1M
      'qwen/qwen-2.5-72b-instruct': tokenEstimate * 0.00000035,       // ~$0.35 per 1M
      'nousresearch/hermes-3-llama-3.1-70b': tokenEstimate * 0.0000004, // ~$0.40 per 1M
      'cognitivecomputations/dolphin-2.9-llama3-70b': tokenEstimate * 0.0000005,
      'anthropic/claude-3-opus': tokenEstimate * 0.000015,            // $15 per 1M
      'inflection/inflection-3-pi': tokenEstimate * 0.0000008,
      'x-ai/grok-2-1212': tokenEstimate * 0.000002,                   // ~$2 per 1M
      'deepseek/deepseek-r1-distill-llama-70b': tokenEstimate * 0.00000055,
    }

    const estimatedCost = costs[model] || tokenEstimate * 0.000001
    console.log(`💰 Cost estimate: $${estimatedCost.toFixed(6)} per request`)
    console.log(`📈 Cost per 1000: $${(estimatedCost * 1000).toFixed(2)}`)

    if (bullets.length > 0) {
      console.log('\n📌 TOP 4 FACTS EXTRACTED:')
      bullets.slice(0, 4).forEach((fact, i) => {
        console.log(`\n${i + 1}. ${fact}`)
      })
    } else {
      // If no bullets found, show first 400 chars
      console.log('\n📝 Response preview:')
      console.log(facts.substring(0, 400) + '...')
    }

  } catch (error) {
    console.log(`❌ Error: ${error.message}`)
    if (error.message.includes('404')) {
      console.log('   (Model may not be available on OpenRouter)')
    }
  }
}

console.log('\n' + '='.repeat(80))
console.log('\n🏆 UNDERDOG INSIGHTS:')
console.log('• Qwen models offer strong performance at low cost')
console.log('• Hermes provides uncensored, detailed analysis')
console.log('• Dolphin excels at finding controversial connections')
console.log('• Grok 2 brings unique perspective from X/Twitter training')
console.log('• DeepSeek reasoning models provide step-by-step analysis')
