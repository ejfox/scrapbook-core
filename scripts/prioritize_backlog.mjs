import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

console.log('═'.repeat(60))
console.log('    ANALYZING BACKLOG FOR PRIORITIZATION')
console.log('═'.repeat(60))

// Get unprocessed scraps in batches
let allBacklog = []
let offset = 0
const batchSize = 1000

while (true) {
  const { data, error } = await supabase
    .from('scraps')
    .select('id, title, url, content, tags, created_at, source')
    .is('summary', null)
    .range(offset, offset + batchSize - 1)

  if (error) {
    console.error('Error:', error.message)
    break
  }

  if (!data || data.length === 0) break

  allBacklog = allBacklog.concat(data)
  console.log('Fetched', allBacklog.length, 'records...')
  offset += batchSize

  if (data.length < batchSize) break
}

console.log('\nTotal unprocessed:', allBacklog.length)

// Special tags that indicate user interest
const specialTags = ['!tobuy', '!inspo', '!tohire', '!toread', '!important', 'toread', 'tobuy']

// Quality domains
const qualityDomains = [
  'nytimes.com', 'theguardian.com', 'washingtonpost.com', 'propublica.org',
  'theintercept.com', 'arstechnica.com', 'wired.com', 'theverge.com',
  'github.com', 'arxiv.org', 'nature.com', 'newyorker.com', 'theatlantic.com',
  'bloomberg.com', 'reuters.com', 'simonwillison.net', 'substack.com',
]

// Score each scrap
const scored = allBacklog.map(s => {
  let score = 0
  const year = new Date(s.created_at).getFullYear()

  // Recency (0-30 points)
  if (year >= 2024) score += 30
  else if (year >= 2023) score += 25
  else if (year >= 2022) score += 20
  else if (year >= 2021) score += 15
  else if (year >= 2020) score += 10
  else if (year >= 2018) score += 5

  // Has content (0-20 points)
  const contentLen = s.content?.length || 0
  if (contentLen > 2000) score += 20
  else if (contentLen > 1000) score += 15
  else if (contentLen > 500) score += 10
  else if (contentLen > 100) score += 5

  // Has tags (0-15 points)
  const tagCount = s.tags?.length || 0
  if (tagCount >= 3) score += 15
  else if (tagCount >= 2) score += 10
  else if (tagCount >= 1) score += 5

  // Special tags (0-20 points)
  const hasSpecial = s.tags?.some(t =>
    specialTags.some(st => t.toLowerCase().includes(st)),
  )
  if (hasSpecial) score += 20

  // Quality domain (0-15 points)
  if (s.url && qualityDomains.some(d => s.url.includes(d))) {
    score += 15
  }

  return { id: s.id, title: s.title, url: s.url, year, score, tags: s.tags }
})

// Sort by score descending
scored.sort((a, b) => b.score - a.score)

// Distribution
console.log('\n📊 PRIORITY DISTRIBUTION:')
const tierDefs = [
  ['S-tier (70+)', 70, 999],
  ['A-tier (50-69)', 50, 69],
  ['B-tier (30-49)', 30, 49],
  ['C-tier (10-29)', 10, 29],
  ['D-tier (0-9)', 0, 9],
]

for (const [name, min, max] of tierDefs) {
  const count = scored.filter(s => s.score >= min && s.score <= max).length
  const bar = '█'.repeat(Math.min(50, Math.ceil(count/100)))
  console.log('  ' + name.padEnd(16), count.toString().padStart(5), bar)
}

// Budget calculations
console.log('\n💰 BUDGET OPTIONS:')
const budgets = [
  { name: '$20 budget', scraps: 900, cost: 20 },
  { name: '$40 budget', scraps: 1800, cost: 40 },
  { name: '$60 budget', scraps: 2700, cost: 60 },
  { name: '$100 budget', scraps: 4500, cost: 100 },
]

for (const b of budgets) {
  const subset = scored.slice(0, Math.min(b.scraps, scored.length))
  if (subset.length === 0) continue
  const minScore = subset[subset.length - 1]?.score || 0
  const years = subset.map(s => s.year)
  const minYear = Math.min(...years)
  const maxYear = Math.max(...years)
  const hours = Math.round(subset.length * 35 / 3600)
  console.log('\n  ' + b.name + ':')
  console.log('    Scraps: ' + subset.length + ' | Min score: ' + minScore + ' | Years: ' + minYear + '-' + maxYear)
  console.log('    Time: ~' + hours + ' hours')
}

// Top 15 samples
console.log('\n🏆 TOP 15 HIGHEST PRIORITY:')
scored.slice(0, 15).forEach((s, i) => {
  const title = (s.title || s.url || 'untitled').substring(0, 50)
  console.log('  ' + String(i+1).padStart(2) + '. [' + s.score + '] ' + s.year + ' | ' + title)
})

// Export IDs for $40 run
const top1800 = scored.slice(0, 1800).map(s => s.id)
fs.writeFileSync('./priority_ids.json', JSON.stringify(top1800, null, 2))
console.log('\n✅ Saved top 1,800 IDs to priority_ids.json')
