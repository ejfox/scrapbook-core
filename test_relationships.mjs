import { extractRelationships } from './scripts/aiRelationshipExtraction.mjs'

const testContent = `Apple Inc. has announced that Tim Cook will be expanding 
the company's partnership with Microsoft. The new collaboration will integrate 
Microsoft Azure with Apple's iCloud services. This move comes after Google 
announced similar partnerships with Amazon Web Services.`

console.log('Testing relationship extraction...\n')

const relationships = await extractRelationships(testContent)

console.log('Extracted relationships:', JSON.stringify(relationships, null, 2))
console.log('\nTotal relationships found:', relationships.length)

// Validate structure
if (relationships.length > 0) {
  const first = relationships[0]
  console.log('\n✅ Validation checks:')
  console.log('Has source.type:', !!first.source?.type)
  console.log('Has source.name:', !!first.source?.name)
  console.log('Has target.type:', !!first.target?.type)
  console.log('Has target.name:', !!first.target?.name)
  console.log('Has type:', !!first.type)
}
