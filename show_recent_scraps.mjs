#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// Get 5 recently updated scraps with AI data
const { data: scraps, error } = await supabase
  .from('scraps')
  .select('title, url, summary, tags, relationships, content_type, concept_tags, extraction_confidence, updated_at')
  .not('summary', 'is', null)
  .order('updated_at', { ascending: false })
  .limit(5)

if (error) {
  console.error('Query error:', error)
  process.exit(1)
}

if (!scraps || scraps.length === 0) {
  console.log('No scraps found with summaries')
  process.exit(0)
}

console.log(`\n📚 Recently Processed Scraps (${scraps.length}):\n`)
scraps.forEach((scrap, i) => {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`📄 [${i+1}] ${scrap.title?.substring(0, 80) || 'No title'}`)
  console.log(`🔗 ${scrap.url?.substring(0, 80)}`)
  console.log(`🕒 Updated: ${new Date(scrap.updated_at).toLocaleString()}`)
  console.log(`📝 Type: ${scrap.content_type || 'unknown'}`)

  if (scrap.summary) {
    console.log(`\n💭 Summary:\n   ${scrap.summary.substring(0, 300)}...`)
  }

  if (scrap.tags?.length) {
    console.log(`\n🏷️  Tags: ${scrap.tags.join(', ')}`)
  }

  if (scrap.concept_tags?.length) {
    console.log(`\n🧵 Thread Concepts: ${scrap.concept_tags.join(', ')}`)
  }

  if (scrap.relationships?.length) {
    console.log(`\n🔗 Relationships (${scrap.relationships.length}):`)
    scrap.relationships.slice(0, 5).forEach(rel => {
      console.log(`   • ${rel.source} --[${rel.relationship}]--> ${rel.target}`)
    })
    if (scrap.relationships.length > 5) {
      console.log(`   ... and ${scrap.relationships.length - 5} more`)
    }
  }

  if (scrap.extraction_confidence) {
    const conf = scrap.extraction_confidence
    console.log(`\n📊 Confidence: Summary: ${(conf.summary * 100).toFixed(0)}% | Tags: ${(conf.tags * 100).toFixed(0)}% | Rels: ${(conf.relationships * 100).toFixed(0)}%`)
  }
})
console.log('\n')
