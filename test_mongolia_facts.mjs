import { completion } from './scripts/llmService.mjs'
import { fetchPageContent } from './helpers.js'

// The complex article about Epstein, Barak, and Mongolia
const article = {
  url: 'https://www.dropsitenews.com/p/jeffrey-epstein-ehud-barak-leaked-emails-mongolia-security-deal',
  title: 'Jeffrey Epstein / Ehud Barak Mongolia Security Deal',
}

console.log('🔬 FACT EXTRACTION TEST - MONGOLIA/ISRAEL ARTICLE')
console.log('=' .repeat(80))
console.log(`📄 ${article.title}\n`)

// Fetch full content
let content = ''
try {
  console.log('Fetching article content...')
  content = await fetchPageContent(article.url)
  console.log(`✓ Fetched ${content.length} characters\n`)
} catch (error) {
  console.log(`❌ Error fetching: ${error.message}\n`)
  process.exit(1)
}

// Test 6 frontier models
const models = [
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
  'anthropic/claude-3.5-haiku',
  'mistralai/mistral-large-2411',
  'google/gemini-2.5-flash',
  'deepseek/deepseek-chat-v3.1',
]

const prompt = `Extract the most interesting, specific facts from this complex article about Jeffrey Epstein, Ehud Barak, and Mongolia.

Title: ${article.title}
Content: ${content.substring(0, 6000)}

Generate EXACTLY 7 fascinating, specific facts that capture the complexity and intrigue of this story. Focus on:
- Specific details about the security deal
- Key players and their relationships
- Unusual or surprising elements
- Financial details
- Timeline and sequence of events
- Connections and implications

Format each fact as a clear, standalone statement starting with a bullet point.`

console.log('Testing each model to extract facts from this complex story:\n')

for (const model of models) {
  const modelName = model.split('/')[1]
  console.log(`\n${'='.repeat(80)}`)
  console.log(`🤖 ${modelName.toUpperCase()}`)
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

    console.log(`\nTime: ${timeTaken}s | Found ${bullets.length} facts\n`)

    // Show first 4 facts
    console.log('📌 KEY FACTS EXTRACTED:')
    bullets.slice(0, 4).forEach((fact, i) => {
      console.log(`\n${i + 1}. ${fact}`)
    })

    if (bullets.length > 4) {
      console.log(`\n[... and ${bullets.length - 4} more facts]`)
    }

  } catch (error) {
    console.log(`❌ Error: ${error.message}`)
  }
}

console.log('\n' + '='.repeat(80))
console.log('\n🎯 ANALYSIS:')
console.log('Notice how different models emphasize different aspects:')
console.log('• Some focus on financial details')
console.log('• Others on political implications')
console.log('• Some extract more technical/security aspects')
console.log('• Creative models find more unusual connections')
