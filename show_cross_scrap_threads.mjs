#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// Get 10 recent scraps to find connections
const { data: scraps, error } = await supabase
  .from('scraps')
  .select('scrap_id, title, url, tags, concept_tags, relationships')
  .not('summary', 'is', null)
  .order('updated_at', { ascending: false })
  .limit(10)

if (error) {
  console.error('Query error:', error)
  process.exit(1)
}

console.log('\n🧵 CROSS-SCRAP THREAD DETECTION\n')
console.log('Looking for narrative threads connecting recent scraps...\n')

// Build entity index from relationships
const entityIndex = new Map() // entity -> [scrap_ids that mention it]
const conceptIndex = new Map() // concept -> [scrap_ids that have it]

scraps.forEach(scrap => {
  // Index entities from relationships
  if (scrap.relationships?.length) {
    scrap.relationships.forEach(rel => {
      const entities = [rel.source, rel.target].filter(e => e && e !== 'undefined')
      entities.forEach(entity => {
        if (!entityIndex.has(entity)) {
          entityIndex.set(entity, [])
        }
        if (!entityIndex.get(entity).includes(scrap.scrap_id)) {
          entityIndex.get(entity).push(scrap.scrap_id)
        }
      })
    })
  }

  // Index concept tags
  if (scrap.concept_tags?.length) {
    scrap.concept_tags.forEach(concept => {
      if (!conceptIndex.has(concept)) {
        conceptIndex.set(concept, [])
      }
      conceptIndex.get(concept).push(scrap.scrap_id)
    })
  }
})

// Find entities that appear in multiple scraps
const crossScrapEntities = Array.from(entityIndex.entries())
  .filter(([entity, scrapIds]) => scrapIds.length > 1)
  .sort((a, b) => b[1].length - a[1].length)

// Find concepts that appear in multiple scraps
const crossScrapConcepts = Array.from(conceptIndex.entries())
  .filter(([concept, scrapIds]) => scrapIds.length > 1)
  .sort((a, b) => b[1].length - a[1].length)

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('🔗 SHARED ENTITIES (appearing in multiple scraps):')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

if (crossScrapEntities.length === 0) {
  console.log('  No shared entities found in recent scraps.\n')
} else {
  crossScrapEntities.slice(0, 5).forEach(([entity, scrapIds]) => {
    console.log(`\n📌 "${entity}" appears in ${scrapIds.length} scraps:`)
    scrapIds.forEach(scrapId => {
      const scrap = scraps.find(s => s.scrap_id === scrapId)
      console.log(`   • ${scrap.title?.substring(0, 70) || scrap.url?.substring(0, 70)}`)
    })
  })
}

console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('🧵 NARRATIVE THREADS (concepts spanning multiple scraps):')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

if (crossScrapConcepts.length === 0) {
  console.log('  No shared concept threads found in recent scraps.\n')
} else {
  crossScrapConcepts.slice(0, 5).forEach(([concept, scrapIds]) => {
    console.log(`\n🔥 Thread: "${concept}" connects ${scrapIds.length} scraps:`)
    scrapIds.forEach(scrapId => {
      const scrap = scraps.find(s => s.scrap_id === scrapId)
      console.log(`   • ${scrap.title?.substring(0, 70) || scrap.url?.substring(0, 70)}`)
    })
  })
}

// Show some example relationships from 3 scraps
console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('🔬 SAMPLE RELATIONSHIPS (from 3 recent scraps):')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

scraps.slice(0, 3).forEach((scrap, i) => {
  if (scrap.relationships?.length) {
    console.log(`\n[${i+1}] ${scrap.title?.substring(0, 70) || 'No title'}`)
    scrap.relationships.slice(0, 3).forEach(rel => {
      if (rel.source && rel.target && rel.relationship) {
        console.log(`    ${rel.source} --[${rel.relationship}]--> ${rel.target}`)
      }
    })
  }
})

console.log('\n')
