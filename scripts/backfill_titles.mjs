#!/usr/bin/env node
/**
 * Backfill titles for scraps that have "[no title]" or empty titles but have summaries
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

function generateTitleFromSummary(summary, url) {
  if (!summary || summary.trim().length === 0) {
    if (url) {
      try {
        const urlObj = new URL(url)
        const pathParts = urlObj.pathname.split('/').filter(p => p && p !== 'index.html')
        if (pathParts.length > 0) {
          const lastPart = pathParts[pathParts.length - 1]
            .replace(/[-_]/g, ' ')
            .replace(/\.[^.]+$/, '')
          return lastPart.charAt(0).toUpperCase() + lastPart.slice(1)
        }
        return urlObj.hostname.replace('www.', '')
      } catch {
        return null
      }
    }
    return null
  }

  const cleanSummary = summary
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .trim()

  const lines = cleanSummary.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
      let title = trimmed.slice(1).trim()
      if (title.length > 100) title = title.slice(0, 97) + '...'
      if (title.length > 10) return title
    }
  }

  const firstSentence = cleanSummary.split('. ')[0]
  if (firstSentence && firstSentence.length > 10) {
    let title = firstSentence.trim()
    if (title.length > 100) title = title.slice(0, 97) + '...'
    return title
  }

  const short = cleanSummary.slice(0, 100).trim()
  return cleanSummary.length > 100 ? short + '...' : short
}

async function main() {
  console.log('Finding scraps with missing/placeholder titles that have summaries...\n')

  // Find scraps with missing or "[no title]" titles that have summaries
  const { data: scraps, error } = await supabase
    .from('scraps')
    .select('id, scrap_id, title, url, summary')
    .or('title.is.null,title.eq.,title.eq.[no title]')
    .not('summary', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching scraps:', error)
    process.exit(1)
  }

  console.log(`Found ${scraps.length} scraps to fix\n`)

  let fixed = 0
  let failed = 0

  for (const scrap of scraps) {
    const newTitle = generateTitleFromSummary(scrap.summary, scrap.url)

    if (!newTitle) {
      console.log(`✗ Could not generate title for ${scrap.url}`)
      failed++
      continue
    }

    const { error: updateError } = await supabase
      .from('scraps')
      .update({ title: newTitle, updated_at: new Date().toISOString() })
      .eq('id', scrap.id)

    if (updateError) {
      console.log(`✗ Failed to update ${scrap.id}: ${updateError.message}`)
      failed++
    } else {
      const domain = scrap.url ? new URL(scrap.url).hostname.replace('www.', '') : 'unknown'
      console.log(`✓ ${domain}: ${newTitle.substring(0, 60)}...`)
      fixed++
    }
  }

  console.log(`\nDone! Fixed ${fixed}, failed ${failed}`)
}

main()
