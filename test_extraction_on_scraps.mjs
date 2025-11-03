#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { extractContentWithRetry } from './scripts/contentExtractor.mjs'

dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

console.log('\n🧪 TESTING CONTENT EXTRACTION ON RANDOM SCRAPS\n')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

// Get 9 random Pinboard scraps
const { data: scraps, error } = await supabase
  .from('scraps')
  .select('scrap_id, url, title, content, source')
  .eq('source', 'pinboard')
  .not('url', 'is', null)
  .order('created_at', { ascending: false })
  .limit(100)

if (error) {
  console.error('Query error:', error)
  process.exit(1)
}

// Pick 9 random ones
const randomScraps = scraps.sort(() => Math.random() - 0.5).slice(0, 9)

console.log(`Testing on ${randomScraps.length} random Pinboard scraps...\n`)

let successCount = 0
let failCount = 0

for (const scrap of randomScraps) {
  const currentContentLength = scrap.content?.length || 0

  console.log(`\n📄 ${scrap.title?.substring(0, 60) || 'No title'}`)
  console.log(`   URL: ${scrap.url}`)
  console.log(`   Current content: ${currentContentLength} chars`)
  console.log('   ─'.repeat(30))

  try {
    const startTime = Date.now()
    const result = await extractContentWithRetry(scrap.url, {
      timeout: 10000,
      maxRetries: 1,
    })
    const duration = Date.now() - startTime

    if (result?.content) {
      successCount++
      const improvement = result.content.length - currentContentLength
      console.log(`   ✅ Success (${duration}ms)`)
      console.log(`   Extracted: ${result.content.length} chars`)
      console.log(`   Improvement: ${improvement > 0 ? '+' : ''}${improvement} chars`)
      console.log(`   Title from page: ${result.title}`)
      console.log(`   Byline: ${result.byline || 'N/A'}`)
      console.log(`   Site: ${result.siteName || 'N/A'}`)
      console.log(`   Preview: ${result.content.substring(0, 120).replace(/\n/g, ' ')}...`)
    } else {
      failCount++
      console.log(`   ❌ Failed (${duration}ms) - Readability couldn't parse`)
    }
  } catch (error) {
    failCount++
    console.log(`   ❌ Error: ${error.message}`)
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`\n📊 RESULTS: ${successCount}/${randomScraps.length} successful (${((successCount/randomScraps.length)*100).toFixed(1)}%)`)
console.log(`   ✅ Success: ${successCount}`)
console.log(`   ❌ Failed: ${failCount}\n`)
