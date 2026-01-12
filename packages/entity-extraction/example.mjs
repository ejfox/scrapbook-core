#!/usr/bin/env node

/**
 * Example usage of @scrapbook/entity-extraction
 * 
 * This example shows how to use the entity extraction package with OpenAI.
 * You can easily adapt this to use other LLM providers (Anthropic, OpenRouter, etc.)
 */

import { extractRelationships, detectEntityType } from './index.mjs'

// Mock LLM provider for demonstration
// Replace this with your actual LLM provider (OpenAI, Anthropic, etc.)
const mockLLMProvider = {
  async completion({ messages, temperature, maxTokens, model }) {
    console.log('🤖 LLM Provider called with:')
    console.log(`   Model: ${model || 'default'}`)
    console.log(`   Temperature: ${temperature}`)
    console.log(`   Max Tokens: ${maxTokens}`)
    console.log(`   Messages: ${messages.length} message(s)`)
    
    // This is a mock response - replace with your actual LLM call
    // For a real implementation, see the README for examples with OpenAI, Anthropic, etc.
    return `[Apple Inc.:Organization]-[ACQUIRED]->[Beats Electronics:Organization]
[Tim Cook:Person]-[CEO_OF]->[Apple Inc.:Organization]
[Dr. Dre:Person]-[FOUNDED]->[Beats Electronics:Organization]
[Jimmy Iovine:Person]-[FOUNDED]->[Beats Electronics:Organization]
[Beats Electronics:Organization]-[LOCATED_IN]->[Culver City:Location]
[Apple Inc.:Organization]-[HEADQUARTERS_IN]->[Cupertino:Location]`
  }
}

// Example content to analyze
const exampleContent = `
Apple Inc. acquired Beats Electronics for $3 billion in 2014, marking one of 
Apple's largest acquisitions. Tim Cook, the CEO of Apple, announced the deal 
at a press conference in Cupertino, California.

Beats Electronics was founded by Dr. Dre and music executive Jimmy Iovine in 2006.
The company, headquartered in Culver City, California, was known for its premium 
headphones and the Beats Music streaming service.

The acquisition brought not just the Beats brand to Apple, but also key talent 
including Dr. Dre and Jimmy Iovine, who joined Apple as executives. The deal 
helped Apple strengthen its position in the music industry and laid the groundwork 
for what would eventually become Apple Music.
`

async function main() {
  console.log('📚 Entity Extraction Example\n')
  console.log('='.repeat(60))
  
  console.log('\n📝 Content to analyze:')
  console.log(exampleContent.trim())
  
  console.log('\n' + '='.repeat(60))
  console.log('\n🔍 Extracting relationships...\n')
  
  try {
    const relationships = await extractRelationships(exampleContent, {
      llmProvider: mockLLMProvider,
      url: 'https://example.com/article',
    })
    
    console.log('\n✅ Extraction complete!\n')
    console.log('='.repeat(60))
    console.log('\n📊 Results:\n')
    
    if (relationships.length === 0) {
      console.log('No relationships found.')
    } else {
      console.log(`Found ${relationships.length} relationships:\n`)
      
      relationships.forEach((rel, index) => {
        console.log(`${index + 1}. [${rel.source}] --${rel.relationship}--> [${rel.target}]`)
        
        // Show detected entity types
        const sourceType = detectEntityType(rel.source)
        const targetType = detectEntityType(rel.target)
        console.log(`   Types: ${sourceType} → ${targetType}\n`)
      })
    }
    
    console.log('='.repeat(60))
    console.log('\n💡 Tips:')
    console.log('   - Replace mockLLMProvider with your actual LLM provider')
    console.log('   - See README.md for examples with OpenAI, Anthropic, OpenRouter')
    console.log('   - Provide a Supabase client for better context from existing data')
    console.log('   - Use detectEntityType() to classify entities')
    
  } catch (error) {
    console.error('\n❌ Error during extraction:')
    console.error(error.message)
    console.error('\nMake sure to:')
    console.error('1. Provide a valid llmProvider with a completion method')
    console.error('2. Set up your LLM API credentials')
    console.error('3. Check the README for implementation examples')
  }
}

// Run the example
main().catch(console.error)
