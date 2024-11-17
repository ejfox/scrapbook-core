-- Add new metadata column if not exists
ALTER TABLE public.scraps 
ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Move scrap_id to metadata.shortId
UPDATE public.scraps 
SET metadata = COALESCE(metadata, '{}'::jsonb) || 
  jsonb_build_object('shortId', scrap_id);

-- Make id the primary identifier
ALTER TABLE public.scraps
DROP CONSTRAINT IF EXISTS scraps_scrap_id_key; 