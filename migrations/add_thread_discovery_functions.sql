-- Thread Context Discovery Database Functions
-- These enable fast, index-backed queries for finding related scraps

-- Required indexes for performance (if not already created)
-- GIN index for array overlap operations
CREATE INDEX IF NOT EXISTS idx_scraps_tags_gin
  ON scraps USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_scraps_concept_tags_gin
  ON scraps USING GIN (concept_tags);

-- Index for temporal queries
CREATE INDEX IF NOT EXISTS idx_scraps_published_at
  ON scraps (published_at DESC);

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_scraps_published_tags
  ON scraps (published_at DESC, tags);

-- Main function: Find related scraps by tag overlap
-- Returns scraps with overlapping tags from recent history
CREATE OR REPLACE FUNCTION find_related_by_tags(
  input_tags TEXT[],
  current_id UUID,
  days_back INTEGER DEFAULT 30,
  result_limit INTEGER DEFAULT 50,
  min_overlap INTEGER DEFAULT 2
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  summary TEXT,
  tags TEXT[],
  concept_tags TEXT[],
  published_at TIMESTAMPTZ,
  url TEXT,
  embedding vector(1536),
  tag_overlap_count INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.title,
    s.summary,
    s.tags,
    s.concept_tags,
    s.published_at,
    s.url,
    s.embedding,
    (
      SELECT COUNT(*)::INTEGER
      FROM unnest(COALESCE(s.tags, ARRAY[]::TEXT[])) AS tag
      WHERE tag = ANY(input_tags)
    ) AS tag_overlap_count
  FROM scraps s
  WHERE s.id != current_id
    AND s.published_at > NOW() - (days_back || ' days')::INTERVAL
    AND (
      -- Match on either tags or concept_tags
      COALESCE(s.tags, ARRAY[]::TEXT[]) && input_tags
      OR COALESCE(s.concept_tags, ARRAY[]::TEXT[]) && input_tags
    )
    -- Only return scraps with minimum overlap
    AND (
      SELECT COUNT(*)
      FROM unnest(COALESCE(s.tags, ARRAY[]::TEXT[])) AS tag
      WHERE tag = ANY(input_tags)
    ) >= min_overlap
  ORDER BY tag_overlap_count DESC, s.published_at DESC
  LIMIT result_limit;
END;
$$;

-- Helper function: Calculate cosine similarity
-- Requires pgvector extension (install with: CREATE EXTENSION vector)
-- Falls back gracefully if vectors are null
CREATE OR REPLACE FUNCTION cosine_similarity(
  vec1 vector,
  vec2 vector
)
RETURNS FLOAT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Handle null vectors
  IF vec1 IS NULL OR vec2 IS NULL THEN
    RETURN 0.0;
  END IF;

  -- pgvector's <=> operator returns cosine distance (0 = identical, 2 = opposite)
  -- We want similarity (1 = identical, -1 = opposite)
  RETURN 1.0 - (vec1 <=> vec2);
END;
$$;

-- Optional: Function to find related scraps using embeddings
-- More expensive but catches semantic relationships tags miss
CREATE OR REPLACE FUNCTION find_related_by_embedding(
  current_embedding vector,
  current_id UUID,
  days_back INTEGER DEFAULT 30,
  result_limit INTEGER DEFAULT 50,
  similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  summary TEXT,
  tags TEXT[],
  concept_tags TEXT[],
  published_at TIMESTAMPTZ,
  url TEXT,
  embedding vector(1536),
  semantic_score FLOAT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.title,
    s.summary,
    s.tags,
    s.concept_tags,
    s.published_at,
    s.url,
    s.embedding,
    (1.0 - (s.embedding <=> current_embedding)) AS semantic_score
  FROM scraps s
  WHERE s.id != current_id
    AND s.published_at > NOW() - (days_back || ' days')::INTERVAL
    AND s.embedding IS NOT NULL
    AND (1.0 - (s.embedding <=> current_embedding)) > similarity_threshold
  ORDER BY semantic_score DESC, s.published_at DESC
  LIMIT result_limit;
END;
$$;

-- Optional: Hybrid function that combines tag and embedding similarity
-- This is the most powerful approach but requires embeddings
CREATE OR REPLACE FUNCTION find_related_hybrid(
  input_tags TEXT[],
  current_embedding vector,
  current_id UUID,
  days_back INTEGER DEFAULT 30,
  result_limit INTEGER DEFAULT 50,
  min_tag_overlap INTEGER DEFAULT 2,
  semantic_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  summary TEXT,
  tags TEXT[],
  concept_tags TEXT[],
  published_at TIMESTAMPTZ,
  url TEXT,
  embedding vector(1536),
  tag_overlap_count INTEGER,
  semantic_score FLOAT,
  combined_score FLOAT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH tag_matches AS (
    SELECT * FROM find_related_by_tags(
      input_tags,
      current_id,
      days_back,
      result_limit * 2,  -- Get more candidates for semantic filtering
      min_tag_overlap
    )
  )
  SELECT
    tm.id,
    tm.title,
    tm.summary,
    tm.tags,
    tm.concept_tags,
    tm.published_at,
    tm.url,
    tm.embedding,
    tm.tag_overlap_count,
    CASE
      WHEN tm.embedding IS NOT NULL AND current_embedding IS NOT NULL
      THEN (1.0 - (tm.embedding <=> current_embedding))
      ELSE 0.0
    END AS semantic_score,
    -- Combined score: weight tag overlap and semantic similarity
    (
      (tm.tag_overlap_count::FLOAT / 10.0) * 0.4 +  -- Tag score (normalized, 40% weight)
      CASE
        WHEN tm.embedding IS NOT NULL AND current_embedding IS NOT NULL
        THEN (1.0 - (tm.embedding <=> current_embedding)) * 0.6  -- Semantic score (60% weight)
        ELSE 0.0
      END
    ) AS combined_score
  FROM tag_matches tm
  WHERE
    -- Either has good tag overlap OR good semantic similarity
    tm.tag_overlap_count >= min_tag_overlap
    OR (
      tm.embedding IS NOT NULL
      AND current_embedding IS NOT NULL
      AND (1.0 - (tm.embedding <=> current_embedding)) > semantic_threshold
    )
  ORDER BY combined_score DESC, tm.published_at DESC
  LIMIT result_limit;
END;
$$;

-- Performance: Create IVFFlat index for fast approximate nearest neighbor search
-- Only needed if using embedding-based discovery
-- Adjust lists parameter based on your dataset size:
-- - Small (<10k rows): lists = 10
-- - Medium (10k-100k): lists = 100
-- - Large (>100k): lists = sqrt(total_rows)
--
-- Uncomment when ready to use embeddings:
-- CREATE INDEX IF NOT EXISTS idx_scraps_embedding_ivfflat
--   ON scraps
--   USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = 100);

-- Grant execute permissions (adjust role as needed)
-- GRANT EXECUTE ON FUNCTION find_related_by_tags TO authenticated;
-- GRANT EXECUTE ON FUNCTION cosine_similarity TO authenticated;
-- GRANT EXECUTE ON FUNCTION find_related_by_embedding TO authenticated;
-- GRANT EXECUTE ON FUNCTION find_related_hybrid TO authenticated;

-- Example usage:
--
-- Find related scraps by tags only:
-- SELECT * FROM find_related_by_tags(
--   ARRAY['neural-networks', 'transformers', 'ai'],
--   '123e4567-e89b-12d3-a456-426614174000'::UUID,
--   30,  -- days back
--   50,  -- limit
--   2    -- min overlap
-- );
--
-- Find related scraps by embeddings:
-- SELECT * FROM find_related_by_embedding(
--   (SELECT embedding FROM scraps WHERE id = '...'::UUID),
--   '...'::UUID,
--   30,  -- days back
--   50,  -- limit
--   0.7  -- similarity threshold
-- );
--
-- Find using hybrid approach:
-- SELECT * FROM find_related_hybrid(
--   ARRAY['neural-networks', 'transformers'],
--   (SELECT embedding FROM scraps WHERE id = '...'::UUID),
--   '...'::UUID
-- );
