import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

async function checkContentAndSummaries() {
  console.log('🔍 CHECKING CONTENT VS SUMMARIES\n')

  // Check how many have actual content
  const { count: totalScraps } = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })

  const { count: withContent } = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })
    .not('content', 'is', null)
    .neq('content', '')

  const { count: withLongContent } = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })
    .gt('content', 100)  // More than 100 chars

  console.log(`Total scraps: ${totalScraps}`)
  console.log(`With any content: ${withContent} (${((withContent/totalScraps)*100).toFixed(1)}%)`)
  console.log(`With substantial content (>100 chars): ${withLongContent} (${((withLongContent/totalScraps)*100).toFixed(1)}%)`)

  // Get some scraps with good content
  console.log('\n📋 SCRAPS WITH ACTUAL CONTENT:\n')

  const { data: goodScraps } = await supabase
    .from('scraps')
    .select('id, title, content, summary, source, url')
    .not('content', 'is', null)
    .neq('content', '')
    .order('updated_at', { ascending: false })
    .limit(5)

  goodScraps?.forEach((scrap, i) => {
    console.log(`\n[${i+1}] ${scrap.title?.substring(0, 60) || 'No title'}...`)
    console.log(`   Source: ${scrap.source}`)
    console.log(`   URL: ${scrap.url?.substring(0, 70)}...`)
    console.log(`   Content: ${scrap.content?.length || 0} chars`)
    console.log(`   Summary: ${scrap.summary ? '✅ ' + scrap.summary.length + ' chars' : '❌ MISSING'}`)

    if (scrap.content && scrap.content.length > 50) {
      console.log('\n   Content preview:')
      console.log(`   "${scrap.content.substring(0, 200)}..."`)
    }
  })

  // Check what's going wrong with Pinboard
  console.log('\n\n🔍 PINBOARD SCRAPS STATUS:\n')

  const { count: totalPinboard } = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'pinboard')

  const { count: pinboardWithContent } = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'pinboard')
    .not('content', 'is', null)
    .neq('content', '')

  const { count: pinboardWithSummary } = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'pinboard')
    .not('summary', 'is', null)

  console.log(`Total Pinboard scraps: ${totalPinboard}`)
  console.log(`With content: ${pinboardWithContent} (${((pinboardWithContent/totalPinboard)*100).toFixed(1)}%)`)
  console.log(`With summaries: ${pinboardWithSummary} (${((pinboardWithSummary/totalPinboard)*100).toFixed(1)}%)`)
}

checkContentAndSummaries().catch(console.error)
