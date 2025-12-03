-- Add meta_summary field to scraps table
-- This stores a ~140 character synthesis of all analysis outputs
-- Run this in Supabase SQL editor or via migration

ALTER TABLE scraps
ADD COLUMN IF NOT EXISTS meta_summary TEXT;

-- Create index for efficient searching
CREATE INDEX IF NOT EXISTS idx_scraps_meta_summary ON scraps(meta_summary);

-- Add comment for documentation
COMMENT ON COLUMN scraps.meta_summary IS 'A ~140 character synthesis of all AI analysis outputs (summary, tags, relationships, location, etc.) for quick previews and sharing';
