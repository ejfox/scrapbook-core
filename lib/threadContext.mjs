/**
 * Thread Context Discovery
 *
 * Finds related scraps to create narrative thread awareness in AI summarization.
 * Uses a layered approach: tag-based pre-filter → semantic ranking → context formatting
 *
 * Philosophy: Like preparing mise en place - each layer refines what the previous discovered.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Configuration with Murphy's "Stupid Simple" defaults
const CONFIG = {
  ENABLE_THREAD_CONTEXT: process.env.ENABLE_THREAD_CONTEXT === 'true', // Default OFF (opt-in for testing)
  ENABLE_SEMANTIC_RANKING: false, // No embeddings = no semantic ranking

  TEMPORAL_WINDOW_DAYS: parseInt(process.env.THREAD_TEMPORAL_WINDOW) || 14, // Murphy's 2 weeks
  MIN_TAG_OVERLAP: parseInt(process.env.THREAD_MIN_TAG_OVERLAP) || 2,
  MAX_CANDIDATES: parseInt(process.env.THREAD_MAX_CANDIDATES) || 50,
  MAX_CONTEXT_ITEMS: parseInt(process.env.THREAD_MAX_CONTEXT) || 5,

  DEBUG: process.env.DEBUG === 'true'
}

/**
 * Layer 1: Fast Tag-Based Pre-filter (Murphy's "Stupid Simple" version)
 *
 * No database functions needed. Just a direct query with array overlap.
 * Ships TODAY.
 */
async function findCandidatesByTags(tags, currentScrapId, options = {}) {
  if (!tags || tags.length === 0) {
    return []
  }

  const temporalWindow = options.temporalWindow || CONFIG.TEMPORAL_WINDOW_DAYS
  const limit = options.limit || CONFIG.MAX_CANDIDATES

  try {
    // Calculate temporal window
    const windowStart = new Date()
    windowStart.setDate(windowStart.getDate() - temporalWindow)

    // Murphy's super simple approach: Get recent scraps, filter in JS
    // (Supabase JSONB array queries are finnicky, this just works)
    const { data, error } = await supabase
      .from('scraps')
      .select('id, title, summary, tags, concept_tags, published_at, created_at, url')
      .neq('id', currentScrapId)
      .gte('created_at', windowStart.toISOString())
      .not('summary', 'is', null) // Must have a summary
      .not('tags', 'is', null) // Must have tags
      .order('created_at', { ascending: false })
      .limit(limit * 3) // Get more since we'll filter locally

    if (error) {
      console.error('Error finding related scraps:', error)
      return []
    }

    if (!data || data.length === 0) {
      return []
    }

    // Calculate tag overlap locally (works with JSONB arrays)
    const scored = data
      .map(scrap => {
        const scrapTags = Array.isArray(scrap.tags) ? scrap.tags : []
        const overlap = tags.filter(tag => scrapTags.includes(tag))
        return {
          ...scrap,
          tag_overlap_count: overlap.length,
          overlapping_tags: overlap
        }
      })
      .filter(s => s.tag_overlap_count >= CONFIG.MIN_TAG_OVERLAP) // Filter by minimum overlap
      .sort((a, b) => b.tag_overlap_count - a.tag_overlap_count)
      .slice(0, limit) // Take top N

    const filtered = scored

    if (CONFIG.DEBUG) {
      console.log(`🏷️  Found ${filtered.length} candidates with tag overlap`)
    }

    return filtered
  } catch (error) {
    console.error('Error in findCandidatesByTags:', error)
    return []
  }
}

/**
 * Layer 2: Semantic Ranking (Optional)
 *
 * If embeddings are enabled and available, rank candidates by semantic similarity
 * using cosine distance. This catches conceptual connections that tags miss.
 */
async function rankBySemantic(candidates, currentEmbedding) {
  if (!CONFIG.ENABLE_SEMANTIC_RANKING || !currentEmbedding) {
    return candidates // Graceful degradation
  }

  // Filter candidates that have embeddings
  const withEmbeddings = candidates.filter(c => c.embedding)

  if (withEmbeddings.length === 0) {
    return candidates
  }

  // Calculate cosine similarity for each candidate
  // Note: In production, this could use pgvector's cosine distance operator
  // For now, we'll do a simple RPC call
  const scored = await Promise.all(
    withEmbeddings.map(async (scrap) => {
      const similarity = await calculateCosineSimilarity(
        currentEmbedding,
        scrap.embedding
      )
      return {
        ...scrap,
        semanticScore: similarity,
        connectionType: 'semantic-similarity'
      }
    })
  )

  // Filter by threshold and sort
  const filtered = scored
    .filter(s => s.semanticScore > CONFIG.SEMANTIC_THRESHOLD)
    .sort((a, b) => b.semanticScore - a.semanticScore)

  if (CONFIG.DEBUG) {
    console.log(`🧠 Semantic ranking: ${filtered.length}/${scored.length} above threshold`)
  }

  return filtered
}

/**
 * Layer 3: Context Formatting (Murphy's Simple Text Format)
 *
 * Plain text format for AI prompt. No fancy objects, just readable context.
 */
export function formatThreadContext(relatedScraps) {
  if (!relatedScraps || relatedScraps.length === 0) {
    return null
  }

  const formatted = relatedScraps
    .slice(0, CONFIG.MAX_CONTEXT_ITEMS)
    .map((scrap, i) => {
      const date = new Date(scrap.created_at || scrap.published_at).toISOString().split('T')[0]
      const title = scrap.title || scrap.url?.substring(0, 50) || 'Untitled'
      const summary = scrap.summary || 'No summary available'
      const tags = scrap.overlapping_tags?.join(', ') || scrap.tag_overlap_count + ' tags'

      // Extract first meaningful line from summary
      const summaryLines = summary.split('\n').filter(l => l.trim())
      const firstLine = summaryLines[0] || summary
      const snippet = firstLine
        .replace(/^[•\-\*]\s*/, '') // Remove bullet points
        .substring(0, 200)

      return `${i + 1}. [${date}] "${title}"
   Shared tags: ${tags}
   Summary: ${snippet}${snippet.length >= 200 ? '...' : ''}`
    }).join('\n\n')

  return `
RECENTLY SAVED RELATED BOOKMARKS:

${formatted}

NOTE: If this new bookmark relates to or continues a thread from above, mention it naturally in your summary. If there's no clear connection, just summarize the new content.`
}

/**
 * Calculate connection strength based on tag overlap and semantic scores
 */
function calculateStrength(scraps) {
  if (scraps.length === 0) return 'none'

  // Calculate average overlap/similarity
  const scores = scraps.map(s =>
    s.semanticScore || (s.tag_overlap_count || 0) / 10 // Normalize tag count to 0-1 range
  )

  const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length

  if (avgScore >= 0.8) return 'strong'
  if (avgScore >= 0.5) return 'medium'
  if (avgScore >= 0.3) return 'weak'
  return 'minimal'
}

/**
 * Helper: Calculate cosine similarity between two embedding vectors
 * Note: In production, use pgvector's built-in cosine distance for performance
 */
async function calculateCosineSimilarity(embedding1, embedding2) {
  // Simplified implementation - in production, use pgvector operator
  // For now, delegate to database function if available
  const { data, error } = await supabase.rpc('cosine_similarity', {
    vec1: embedding1,
    vec2: embedding2
  })

  if (error) {
    console.warn('Cosine similarity calculation failed:', error)
    return 0
  }

  return data
}

/**
 * Main Entry Point: Discover Thread Context
 *
 * Given tags for a new scrap, find related scraps and format them into
 * a context object suitable for AI prompt injection.
 *
 * @param {Object} scrap - The scrap being processed
 * @param {Object} options - Configuration overrides
 * @returns {Object|null} ThreadContext object or null if no context found
 */
export async function discoverThreadContext(scrap, options = {}) {
  if (!CONFIG.ENABLE_THREAD_CONTEXT) {
    return null // Feature disabled
  }

  const tags = scrap.tags || scrap.concept_tags || []

  if (tags.length === 0) {
    if (CONFIG.DEBUG) {
      console.log('📭 No tags available for thread discovery')
    }
    return null
  }

  try {
    // Layer 1: Tag-based pre-filter
    let candidates = await findCandidatesByTags(tags, scrap.id, options)

    if (candidates.length === 0) {
      if (CONFIG.DEBUG) {
        console.log('📭 No related scraps found')
      }
      return null
    }

    // Layer 2: Semantic ranking (if enabled)
    if (CONFIG.ENABLE_SEMANTIC_RANKING && scrap.embedding) {
      candidates = await rankBySemantic(candidates, scrap.embedding)
    }

    // Layer 3: Format context
    const threadContext = formatThreadContext(candidates)

    if (CONFIG.DEBUG && threadContext) {
      console.log(`🧵 Thread context: ${candidates.length} related scraps found`)
    }

    return threadContext

  } catch (error) {
    console.error('Error discovering thread context:', error)
    return null // Graceful failure
  }
}

/**
 * Database Function Definitions
 *
 * These should be created in Supabase/PostgreSQL for optimal performance:
 *
 * CREATE OR REPLACE FUNCTION find_related_by_tags(
 *   input_tags TEXT[],
 *   current_id UUID,
 *   days_back INTEGER DEFAULT 30,
 *   result_limit INTEGER DEFAULT 50,
 *   min_overlap INTEGER DEFAULT 2
 * )
 * RETURNS TABLE (
 *   id UUID,
 *   title TEXT,
 *   summary TEXT,
 *   tags TEXT[],
 *   concept_tags TEXT[],
 *   published_at TIMESTAMPTZ,
 *   url TEXT,
 *   tag_overlap_count INTEGER
 * )
 * LANGUAGE plpgsql
 * AS $$
 * BEGIN
 *   RETURN QUERY
 *   SELECT
 *     s.id,
 *     s.title,
 *     s.summary,
 *     s.tags,
 *     s.concept_tags,
 *     s.published_at,
 *     s.url,
 *     (
 *       SELECT COUNT(*)::INTEGER
 *       FROM unnest(s.tags) AS tag
 *       WHERE tag = ANY(input_tags)
 *     ) AS tag_overlap_count
 *   FROM scraps s
 *   WHERE s.id != current_id
 *     AND s.published_at > NOW() - (days_back || ' days')::INTERVAL
 *     AND s.tags && input_tags
 *   HAVING (
 *     SELECT COUNT(*)
 *     FROM unnest(s.tags) AS tag
 *     WHERE tag = ANY(input_tags)
 *   ) >= min_overlap
 *   ORDER BY tag_overlap_count DESC, s.published_at DESC
 *   LIMIT result_limit;
 * END;
 * $$;
 *
 * -- For semantic similarity (requires pgvector extension)
 * CREATE OR REPLACE FUNCTION cosine_similarity(
 *   vec1 vector,
 *   vec2 vector
 * )
 * RETURNS FLOAT
 * LANGUAGE plpgsql
 * AS $$
 * BEGIN
 *   RETURN 1 - (vec1 <=> vec2); -- pgvector cosine distance operator
 * END;
 * $$;
 */

export default {
  discoverThreadContext,
  formatThreadContext,
  CONFIG
}
