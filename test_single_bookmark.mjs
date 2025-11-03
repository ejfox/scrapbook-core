import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

async function testSingleBookmark() {
  console.log('🧪 Testing single bookmark processing\n')

  // Get a recent Pinboard bookmark without a summary
  const { data: scraps } = await supabase
    .from('scraps')
    .select('*')
    .eq('source', 'pinboard')
    .is('summary', null)
    .not('content', 'is', null)
    .neq('content', '')
    .limit(1)

  if (!scraps || scraps.length === 0) {
    console.log('No suitable test scrap found')
    return
  }

  const testScrap = scraps[0]
  console.log('Found test scrap:')
  console.log(`  Title: ${testScrap.title}`)
  console.log(`  URL: ${testScrap.url}`)
  console.log(`  Content length: ${testScrap.content?.length || 0}`)
  console.log(`  Has summary: ${!!testScrap.summary}`)
  console.log(`  Has relationships: ${!!testScrap.relationships}`)
  console.log(`  Scrap ID: ${testScrap.scrap_id}\n`)

  console.log('Now run:')
  console.log('  node scripts/index.mjs --pinboard --limit 1')
  console.log('\nThen check if the summary was saved by running:')
  console.log(`  node -e "import {createClient} from '@supabase/supabase-js'; import dotenv from 'dotenv'; dotenv.config(); const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); const {data} = await s.from('scraps').select('summary').eq('scrap_id', '${testScrap.scrap_id}').single(); console.log('Summary:', data.summary);"`)
}

testSingleBookmark().catch(console.error)
