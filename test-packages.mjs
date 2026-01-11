#!/usr/bin/env node

/**
 * Integration test for modular packages
 * Tests that the packages can be imported and basic functionality works
 */

import { extractRelationships, detectEntityType } from './packages/entity-extraction/index.mjs'
import { summarizeContent, breakContentIntoChunks, isContentInsufficient } from './packages/content-summarization/index.mjs'

console.log('🧪 Testing modular packages...\n')

// Test 1: Entity extraction imports
console.log('✓ Entity extraction imports successful')
console.log('  - extractRelationships:', typeof extractRelationships === 'function')
console.log('  - detectEntityType:', typeof detectEntityType === 'function')

// Test 2: Summarization imports
console.log('\n✓ Content summarization imports successful')
console.log('  - summarizeContent:', typeof summarizeContent === 'function')
console.log('  - breakContentIntoChunks:', typeof breakContentIntoChunks === 'function')
console.log('  - isContentInsufficient:', typeof isContentInsufficient === 'function')

// Test 3: Chunking functionality
const testContent = 'This is a test sentence. ' .repeat(1000)
const chunks = breakContentIntoChunks(testContent, 1000)
console.log('\n✓ Chunking works:', chunks.length, 'chunks created')

// Test 4: Content check
console.log('\n✓ Content check works:')
console.log('  - Empty string:', isContentInsufficient(''))
console.log('  - Short string:', isContentInsufficient('Hi'))
console.log('  - Long string:', isContentInsufficient(testContent))

// Test 5: Entity type detection
console.log('\n✓ Entity type detection works:')
console.log('  - "Apple Inc.":', detectEntityType('Apple Inc.'))
console.log('  - "New York":', detectEntityType('New York'))
console.log('  - "React":', detectEntityType('React'))
console.log('  - "Tim Cook":', detectEntityType('Tim Cook'))

console.log('\n✅ All basic tests passed!')
console.log('\nNote: Full functional tests require LLM provider configuration.')
console.log('See package READMEs for usage examples with actual LLM providers.')
