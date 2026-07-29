/**
 * AI Newsworthiness Evaluator
 *
 * Evaluates whether a scrap should be tagged !news based on editorial significance.
 * Aims for ~3 !news items per day - only the most important stories.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fetch from 'node-fetch'
import { getApiEndpoint } from '../lib/config.mjs'

dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// Cheap but capable model for yes/no decisions
const MODEL = 'openai/gpt-4o-mini'

/**
 * Get count of !news items from today
 */
async function getTodaysNewsCount() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Fetch recent scraps and filter client-side (jsonb array contains is tricky)
  const { data, error } = await supabase
    .from('scraps')
    .select('id, tags')
    .gte('created_at', today.toISOString())
    .limit(500)

  if (error) {
    console.error('Error fetching today\'s scraps:', error)
    return 0
  }

  const newsCount = (data || []).filter(s => s.tags?.includes('!news')).length
  return newsCount
}

/**
 * Get recent !news items for context (what we've already flagged)
 */
async function getRecentNewsItems(limit = 5) {
  // Fetch more and filter client-side
  const { data, error } = await supabase
    .from('scraps')
    .select('title, summary, url, tags')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('Error fetching recent scraps:', error)
    return []
  }

  return (data || [])
    .filter(s => s.tags?.includes('!news'))
    .slice(0, limit)
}

/**
 * Evaluate if a scrap is newsworthy enough for !news tag
 *
 * @param {Object} scrap - The scrap to evaluate
 * @param {Object} options - Options including scrapId for tracking
 * @returns {Object} { isNewsworthy: boolean, reason: string }
 */
export async function evaluateNewsworthiness(scrap, options = {}) {
  const { scrapId } = options

  // Quick filters - skip obvious non-news
  const dominated = [
    'tutorial', 'howto', 'product', 'tool', 'documentation',
    'recipe', 'review', 'opinion', 'personal', 'entertainment',
  ]

  if (scrap.content_type && dominated.includes(scrap.content_type)) {
    return { isNewsworthy: false, reason: 'Content type not news' }
  }

  // Check today's quota
  const todaysCount = await getTodaysNewsCount()
  if (todaysCount >= 5) {
    // Hard cap - but still evaluate in case it's REALLY important
    // We'll be extra strict in the prompt
  }

  // Get recent news for context
  const recentNews = await getRecentNewsItems(3)
  const recentNewsSummary = recentNews
    .map(n => `- ${n.title?.substring(0, 80)}`)
    .join('\n')

  const prompt = `You are an editorial news curator. Your job is to identify the 3 MOST SIGNIFICANT news stories each day.

TODAY'S !NEWS COUNT: ${todaysCount}/3 (target is ~3 per day)

RECENT !NEWS ITEMS (for context, avoid duplicates):
${recentNewsSummary || '(none yet today)'}

EVALUATE THIS ITEM:
Title: ${scrap.title || 'untitled'}
URL: ${scrap.url || 'no url'}
Tags: ${(scrap.tags || []).join(', ')}
Content Type: ${scrap.content_type || 'unknown'}

Summary:
${(scrap.summary || '').substring(0, 1500)}

CRITERIA FOR !NEWS (must meet ALL):
1. BREAKING or SIGNIFICANT - Major event, policy change, scandal, disaster, or development
2. BROAD IMPACT - Affects many people, not just a niche audience
3. TIMELY - Happening now or very recently, not evergreen content
4. NOT a duplicate of something already in !news

AUTOMATIC DISQUALIFIERS:
- Tutorials, how-tos, product reviews
- Opinion pieces, editorials (unless major figure)
- Entertainment news (unless truly major cultural moment)
- Local news (unless has broader implications)
- Old news being resurfaced
- Promotional content

${todaysCount >= 3 ? 'NOTE: We already have 3+ news items today. Only flag this if it is EXCEPTIONALLY important (major breaking news level).' : ''}

Respond with ONLY a JSON object:
{"newsworthy": true/false, "reason": "one sentence explanation"}`

  try {
    // Route through the OpenRouter proxy the rest of the app uses — the bare
    // OPENROUTER_API_KEY 401s ("User not found") against openrouter.ai directly.
    const response = await fetch(`${getApiEndpoint('openrouter')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://scrapbook.ejfox.com',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'user', content: prompt },
        ],
        max_tokens: 100,
        temperature: 0.1, // Low temp for consistent decisions
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Newsworthiness API error: ${response.status} - ${errorText}`)
      return { isNewsworthy: false, reason: 'API error' }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()

    if (!content) {
      return { isNewsworthy: false, reason: 'Empty response' }
    }

    // Parse JSON response
    try {
      // Handle potential markdown code blocks
      const jsonStr = content.replace(/```json\n?|\n?```/g, '').trim()
      const result = JSON.parse(jsonStr)
      return {
        isNewsworthy: result.newsworthy === true,
        reason: result.reason || 'No reason provided',
      }
    } catch (parseError) {
      console.error('Failed to parse newsworthiness response:', content)
      return { isNewsworthy: false, reason: 'Parse error' }
    }
  } catch (error) {
    console.error('Newsworthiness evaluation error:', error)
    return { isNewsworthy: false, reason: error.message }
  }
}

/**
 * Apply !news tag to a scrap if newsworthy
 * Returns updated tags array
 */
export async function applyNewsworthinessTag(scrap, options = {}) {
  const currentTags = scrap.tags || []

  // Already has !news
  if (currentTags.includes('!news')) {
    return { tags: currentTags, evaluated: false, reason: 'Already has !news' }
  }

  const { isNewsworthy, reason } = await evaluateNewsworthiness(scrap, options)

  if (isNewsworthy) {
    return {
      tags: ['!news', ...currentTags],
      evaluated: true,
      isNewsworthy: true,
      reason,
    }
  }

  return {
    tags: currentTags,
    evaluated: true,
    isNewsworthy: false,
    reason,
  }
}

// CLI for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const testScrap = {
    title: process.argv[2] || 'Test Article',
    summary: process.argv[3] || 'This is a test summary about something happening.',
    url: 'https://example.com/test',
    tags: ['politics', 'news'],
    content_type: 'article',
  }

  console.log('Testing newsworthiness evaluation...')
  console.log('Scrap:', testScrap.title)

  const result = await evaluateNewsworthiness(testScrap)
  console.log('Result:', result)
}
