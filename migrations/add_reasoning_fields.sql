-- Add AI reasoning fields to scraps table
-- Run this in Supabase SQL editor or via migration

-- Add content_type field (news, opinion, tutorial, research, product, discussion)
ALTER TABLE scraps
ADD COLUMN IF NOT EXISTS content_type TEXT;

-- Add concept_tags field (hierarchical semantic concepts)
ALTER TABLE scraps
ADD COLUMN IF NOT EXISTS concept_tags TEXT[];

-- Add extraction_confidence field (AI quality scores)
ALTER TABLE scraps
ADD COLUMN IF NOT EXISTS extraction_confidence JSONB;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_scraps_content_type ON scraps(content_type);
CREATE INDEX IF NOT EXISTS idx_scraps_concept_tags ON scraps USING GIN(concept_tags);
CREATE INDEX IF NOT EXISTS idx_scraps_extraction_confidence ON scraps USING GIN(extraction_confidence);

-- Add comments for documentation
COMMENT ON COLUMN scraps.content_type IS 'Content format classification: news, opinion, tutorial, research, product, discussion';
COMMENT ON COLUMN scraps.concept_tags IS 'Hierarchical semantic concept tags extracted by AI (e.g., immigration_policy, climate_change)';
COMMENT ON COLUMN scraps.extraction_confidence IS 'AI confidence scores for each extracted field: {summary: 0.9, tags: 0.85, relationships: 0.7}';
