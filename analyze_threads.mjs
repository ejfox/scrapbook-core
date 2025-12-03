import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// Get recent scraps
const { data, error } = await supabase
  .from('scraps')
  .select('title, tags, location, created_at')
  .gte('created_at', '2025-11-15')
  .not('tags', 'is', null)
  .order('created_at', { ascending: false })
  .limit(100)

if (error) {
  console.error(error)
  process.exit(1)
}

// Group by specific tags (not broad ones)
const tagCounts = {}
const broadTags = ['politics', 'news', 'article', 'journalism', 'tech', 'coding', 'tool', 'resource', 'opensource']

data.forEach(s => {
  s.tags.forEach(tag => {
    if (!broadTags.includes(tag)) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1
    }
  })
})

console.log('\nTags with 3+ scraps (last 2 weeks, excluding broad tags):')
Object.entries(tagCounts)
  .filter(([tag, count]) => count >= 3)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([tag, count]) => console.log(`  ${tag}: ${count} scraps`))

// Look for Hudson Valley stories
const hvStories = data.filter(s => s.location && s.location.includes('Hudson Valley'))
console.log(`\nHudson Valley stories: ${hvStories.length}`)
hvStories.slice(0, 5).forEach(s => console.log(`  ${s.created_at.split('T')[0]} | ${s.title?.substring(0, 60)}`))
