#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

console.log('\n🔍 AUDITING MOST RECENT 1,000 SCRAPS\n')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

// Get 1000 most recent scraps
const { data: recentScraps } = await supabase
  .from('scraps')
  .select('scrap_id, created_at, source, summary, tags, relationships, concept_tags, location, screenshot_url, content, metadata')
  .order('created_at', { ascending: false })
  .limit(1000)

if (!recentScraps) {
  console.log('No scraps found')
  process.exit(1)
}

console.log(`📊 Analyzed: ${recentScraps.length} scraps`)

// Calculate completeness
const withSummary = recentScraps.filter(s => s.summary).length
const withTags = recentScraps.filter(s => s.tags?.length > 0).length
const withRels = recentScraps.filter(s => s.relationships?.length > 0).length
const withConcepts = recentScraps.filter(s => s.concept_tags?.length > 0).length
const withLocation = recentScraps.filter(s => s.location).length
const withScreenshot = recentScraps.filter(s => s.screenshot_url).length
const withContent = recentScraps.filter(s => s.content?.length > 100).length

console.log(`\n📈 COMPLETENESS:\n`)
console.log(`  Summaries:        ${withSummary} (${((withSummary/1000)*100).toFixed(1)}%)`)
console.log(`  Tags:             ${withTags} (${((withTags/1000)*100).toFixed(1)}%)`)
console.log(`  Relationships:    ${withRels} (${((withRels/1000)*100).toFixed(1)}%)`)
console.log(`  Thread Concepts:  ${withConcepts} (${((withConcepts/1000)*100).toFixed(1)}%)`)
console.log(`  Location:         ${withLocation} (${((withLocation/1000)*100).toFixed(1)}%)`)
console.log(`  Screenshots:      ${withScreenshot} (${((withScreenshot/1000)*100).toFixed(1)}%)`)
console.log(`  Has Content:      ${withContent} (${((withContent/1000)*100).toFixed(1)}%)`)

// Source breakdown
const bySource = {}
recentScraps.forEach(s => {
  bySource[s.source] = (bySource[s.source] || 0) + 1
})

console.log(`\n📂 BY SOURCE:\n`)
Object.entries(bySource)
  .sort((a, b) => b[1] - a[1])
  .forEach(([source, count]) => {
    console.log(`  ${source}: ${count} (${((count/1000)*100).toFixed(1)}%)`)
  })

// Time range
const oldest = recentScraps[recentScraps.length - 1]
const newest = recentScraps[0]
const ageInDays = Math.floor((new Date(newest.created_at) - new Date(oldest.created_at)) / (1000 * 60 * 60 * 24))

console.log(`\n📅 TIME RANGE:\n`)
console.log(`  Newest: ${new Date(newest.created_at).toLocaleDateString()}`)
console.log(`  Oldest: ${new Date(oldest.created_at).toLocaleDateString()}`)
console.log(`  Span: ${ageInDays} days`)

// Quality samples
const fullyProcessed = recentScraps.filter(s =>
  s.summary && s.tags?.length > 0 && s.relationships?.length > 0 && s.concept_tags?.length > 0
)

const unprocessed = recentScraps.filter(s =>
  !s.summary && !s.relationships?.length
)

console.log(`\n🎯 QUALITY BREAKDOWN:\n`)
console.log(`  Fully Processed (all AI fields): ${fullyProcessed.length} (${((fullyProcessed.length/1000)*100).toFixed(1)}%)`)
console.log(`  Unprocessed (no AI data): ${unprocessed.length} (${((unprocessed.length/1000)*100).toFixed(1)}%)`)
console.log(`  Partially Processed: ${1000 - fullyProcessed.length - unprocessed.length} (${(((1000 - fullyProcessed.length - unprocessed.length)/1000)*100).toFixed(1)}%)`)

// Avg relationship count for those that have them
const avgRels = withRels > 0
  ? recentScraps.filter(s => s.relationships?.length).reduce((sum, s) => sum + s.relationships.length, 0) / withRels
  : 0

const avgConceptTags = withConcepts > 0
  ? recentScraps.filter(s => s.concept_tags?.length).reduce((sum, s) => sum + s.concept_tags.length, 0) / withConcepts
  : 0

console.log(`\n📊 QUALITY METRICS:\n`)
console.log(`  Avg Relationships per scrap (when present): ${avgRels.toFixed(1)}`)
console.log(`  Avg Thread Concepts per scrap (when present): ${avgConceptTags.toFixed(1)}`)

// Show a few examples of fully processed scraps
if (fullyProcessed.length > 0) {
  console.log(`\n✨ SAMPLE: Fully Processed Scraps\n`)
  fullyProcessed.slice(0, 3).forEach((s, i) => {
    console.log(`[${i+1}] ${s.source} - Created: ${new Date(s.created_at).toLocaleDateString()}`)
    console.log(`    Tags: ${s.tags.slice(0, 5).join(', ')}`)
    console.log(`    Concepts: ${s.concept_tags.slice(0, 3).join(', ')}`)
    console.log(`    Relationships: ${s.relationships.length}`)
    console.log('')
  })
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
