import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

async function migrateSchema() {
  console.log('Starting schema v2 migration...')

  const { data: scraps, error } = await supabase
    .from('scraps')
    .select('*')

  if (error) {
    console.error('Failed to fetch scraps:', error)
    return
  }

  for (const scrap of scraps) {
    const updates = {
      url: scrap.metadata?.href,
      screenshot_url: scrap.metadata?.screenshotUrl,
      location: scrap.metadata?.location,
      title: scrap.metadata?.title || scrap.content,
      latitude: scrap.metadata?.latitude,
      longitude: scrap.metadata?.longitude,
      published_at: scrap.metadata?.published_at || scrap.created_at,
      shared: false,
    }

    const { error: updateError } = await supabase
      .from('scraps')
      .update(updates)
      .eq('id', scrap.id)

    if (updateError) {
      console.error(`Failed to update scrap ${scrap.id}:`, updateError)
    }
  }

  console.log('Migration complete')
}

migrateSchema().catch(console.error)
