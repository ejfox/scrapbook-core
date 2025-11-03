import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

(async () => {
  // Get most recently updated scraps with summaries
  const { data, error } = await supabase
    .from('scraps')
    .select('id, title, summary, tags, created_at, updated_at')
    .not('summary', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('📊 MOST RECENTLY PROCESSED SCRAPS\n' + '='.repeat(60))

  data.forEach((scrap, i) => {
    console.log(`\n📌 Item ${i+1}: ${scrap.title?.slice(0, 50)}...`)
    console.log(`🆔 ID: ${scrap.id}`)
    console.log(`📅 Created: ${new Date(scrap.created_at).toLocaleDateString()}`)
    console.log(`🔄 Updated: ${new Date(scrap.updated_at).toLocaleString()}`)
    console.log(`🏷️ Tags: ${scrap.tags?.join(', ') || 'none'}`)
    console.log(`\n📝 Summary (${scrap.summary?.length} chars):`)

    // Show bullet points if present
    const bullets = scrap.summary?.split('\n').filter(line => line.trim().startsWith('•'))
    if (bullets && bullets.length > 0) {
      console.log(`✨ Contains ${bullets.length} bullet points:`)
      bullets.slice(0, 3).forEach(b => console.log(`  ${b.slice(0, 100)}...`))
      if (bullets.length > 3) console.log(`  ... and ${bullets.length - 3} more`)
    } else {
      console.log(scrap.summary?.slice(0, 400))
      if (scrap.summary?.length > 400) console.log('...[truncated]')
    }
    console.log('\n' + '-'.repeat(60))
  })
})()
