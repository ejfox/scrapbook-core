// Integration functions for Scrap Doctor with existing processing pipeline

import { generateScreenshot } from './generateScreenshot.mjs'
import { summarizeContent } from './aiSummarization.mjs'
import { generateEmbedding } from './llmService.mjs'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

export async function repairScrapWithRealFunctions(scrap, repairTypes, options = {}) {
  const updates = {}
  const results = {}

  if (!Array.isArray(repairTypes)) {
    repairTypes = [repairTypes]
  }

  for (const repairType of repairTypes) {
    try {
      switch (repairType) {
      case 'summary':
        if ((!scrap.summary || scrap.summary.trim() === '') && scrap.content) {
          if (options.skipAI) {
            updates.summary = `[Auto-repair] ${scrap.title || 'Content summary'}`
          } else {
            const summary = await summarizeContent(scrap.content, scrap.source)
            if (summary) {
              updates.summary = summary
              results.summary = 'generated'
            }
          }
        }
        break

      case 'embedding':
        if (!scrap.embedding && (scrap.content || scrap.summary)) {
          if (!options.skipAI) {
            const textToEmbed = scrap.summary || scrap.content || scrap.title
            const embedding = await generateEmbedding(textToEmbed)
            if (embedding) {
              updates.embedding = embedding
              results.embedding = 'generated'
            }
          }
        }
        break

      case 'screenshot':
        if (!scrap.screenshot_url && scrap.url && shouldTakeScreenshot(scrap)) {
          try {
            const screenshot = await generateScreenshot(scrap.url)
            if (screenshot?.url) {
              updates.screenshot_url = screenshot.url
              results.screenshot = 'generated'
            }
          } catch (error) {
            console.warn(`Screenshot failed for ${scrap.url}: ${error.message}`)
            results.screenshot = 'failed'
          }
        }
        break

      case 'tags':
        if ((!scrap.tags || scrap.tags.length === 0) && scrap.summary) {
          // Simple tag extraction from summary/content
          const tags = extractBasicTags(scrap.summary || scrap.content)
          if (tags.length > 0) {
            updates.tags = tags
            results.tags = 'extracted'
          }
        }
        break

      case 'metadata':
        if (scrap.metadata && typeof scrap.metadata === 'string') {
          try {
            JSON.parse(scrap.metadata)
          } catch {
            // Fix broken JSON metadata
            updates.metadata = {
              repair_note: 'Fixed malformed JSON',
              repair_timestamp: new Date().toISOString(),
              original_broken: scrap.metadata.substring(0, 200) + '...',
            }
            results.metadata = 'fixed'
          }
        }
        break

      case 'url_validation':
        // Check if URLs are still valid
        if (scrap.url) {
          try {
            const response = await fetch(scrap.url, { method: 'HEAD', timeout: 5000 })
            if (!response.ok) {
              updates.url_status = 'broken'
              updates.url_status_checked = new Date().toISOString()
              results.url_validation = 'marked_broken'
            } else {
              updates.url_status = 'valid'
              updates.url_status_checked = new Date().toISOString()
              results.url_validation = 'validated'
            }
          } catch {
            updates.url_status = 'unreachable'
            updates.url_status_checked = new Date().toISOString()
            results.url_validation = 'unreachable'
          }
        }
        break
      }
    } catch (error) {
      console.warn(`Failed to repair ${repairType} for ${scrap.scrap_id}: ${error.message}`)
      results[repairType] = 'error'
    }
  }

  // Add repair metadata
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString()
    updates.last_repaired_at = new Date().toISOString()
    updates.repair_history = JSON.stringify({
      timestamp: new Date().toISOString(),
      repairs: Object.keys(updates),
      results,
    })

    const { error } = await supabase
      .from('scraps')
      .update(updates)
      .eq('scrap_id', scrap.scrap_id)

    if (error) throw error
  }

  return results
}

export function shouldTakeScreenshot(scrap) {
  // Skip screenshots for certain types
  if (scrap.source === 'github' && scrap.type !== 'repository') return false
  if (scrap.source === 'mastodon') return false
  if (!scrap.url) return false

  // Skip if URL looks like an API endpoint or file
  const url = scrap.url.toLowerCase()
  if (url.includes('/api/') || url.endsWith('.json') || url.endsWith('.xml')) return false

  return true
}

export function extractBasicTags(text) {
  if (!text) return []

  const tags = new Set()

  // Common tech keywords
  const techKeywords = [
    'javascript', 'typescript', 'python', 'react', 'vue', 'angular', 'node',
    'docker', 'kubernetes', 'aws', 'github', 'git', 'api', 'database', 'sql',
    'machine learning', 'ai', 'data science', 'visualization', 'design',
    'frontend', 'backend', 'devops', 'security', 'performance', 'testing',
  ]

  const lowerText = text.toLowerCase()

  techKeywords.forEach(keyword => {
    if (lowerText.includes(keyword)) {
      tags.add(keyword.replace(' ', '-'))
    }
  })

  // Extract hashtags if they exist
  const hashtagMatches = text.match(/#(\w+)/g)
  if (hashtagMatches) {
    hashtagMatches.forEach(tag => {
      tags.add(tag.substring(1).toLowerCase())
    })
  }

  // Extract domain from URLs as tags
  const urlMatches = text.match(/https?:\/\/([^/\s]+)/g)
  if (urlMatches) {
    urlMatches.forEach(url => {
      try {
        const domain = new URL(url).hostname.replace('www.', '')
        tags.add(domain)
      } catch {
        // Ignore invalid URLs
      }
    })
  }

  return Array.from(tags).slice(0, 10) // Limit to 10 tags
}

export async function findScrapsNeedingRepair(options = {}) {
  let query = supabase
    .from('scraps')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.source) {
    query = query.eq('source', options.source)
  }

  if (options.limit) {
    query = query.limit(options.limit)
  }

  const { data: scraps, error } = await query
  if (error) throw error

  return scraps.filter(scrap => {
    if (options.repairType) {
      return needsSpecificRepair(scrap, options.repairType)
    }

    // General repair needs
    return !scrap.summary ||
           !scrap.embedding ||
           (!scrap.screenshot_url && shouldTakeScreenshot(scrap)) ||
           !scrap.tags ||
           (scrap.tags && scrap.tags.length === 0)
  })
}

function needsSpecificRepair(scrap, repairType) {
  switch (repairType) {
  case 'summary':
    return !scrap.summary || scrap.summary.trim() === ''
  case 'embedding':
    return !scrap.embedding
  case 'screenshot':
    return !scrap.screenshot_url && shouldTakeScreenshot(scrap)
  case 'tags':
    return !scrap.tags || scrap.tags.length === 0
  case 'metadata':
    return scrap.metadata && typeof scrap.metadata === 'string' &&
             (() => { try { JSON.parse(scrap.metadata); return false } catch { return true } })()
  default:
    return false
  }
}
