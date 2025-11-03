import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

async function audit(limit = null) {
  // Build base query
  let baseQuery = supabase.from('scraps')

  // If limit specified, get all scraps and take the most recent N
  if (limit) {
    baseQuery = baseQuery.select('*').order('created_at', { ascending: false }).limit(limit)
  } else {
    baseQuery = baseQuery.select('*')
  }

  // Get the data for targeted scraps
  const { data: targetScraps } = await baseQuery
  const total = targetScraps.length
  const targetIds = targetScraps.map(s => s.id)

  const fields = [
    'summary',
    'tags',
    'concept_tags',
    'relationships',
    'location',
    'financial_analysis',
    'screenshot_url',
    'embedding',
    'embedding_nomic',
    'image_embedding',
  ]

  console.log('🔍 BACKLOG AUDIT')
  console.log('================')
  console.log(`Analyzing: ${limit ? 'Most recent ' + limit : 'All'} scraps`)
  console.log(`Total: ${total}\n`)

  const results = []

  for (const field of fields) {
    // Count directly from the data we already fetched
    const withField = limit
      ? targetScraps.filter(s => s[field] !== null).length
      : (await supabase
        .from('scraps')
        .select('*', { count: 'exact', head: true })
        .not(field, 'is', null)
      ).count

    const missing = total - (withField || 0)
    const percent = ((withField || 0) / total * 100).toFixed(1)
    const status = percent > 80 ? '✅' : percent > 50 ? '⚠️' : '❌'

    results.push({ field, withField: withField || 0, missing, percent, status })
  }

  // Sort by percent ascending (worst first)
  results.sort((a, b) => parseFloat(a.percent) - parseFloat(b.percent))

  for (const r of results) {
    console.log(`${r.status} ${r.field.padEnd(20)} ${r.withField.toString().padStart(5)} / ${total} (${r.percent}%)`)
  }

  // Calculate overall health score
  const avgPercent = results.reduce((sum, r) => sum + parseFloat(r.percent), 0) / results.length
  console.log(`\n📊 Overall Health Score: ${avgPercent.toFixed(1)}%`)
}

// Get limit from command line
const limit = process.argv[2] ? parseInt(process.argv[2]) : null
audit(limit)
