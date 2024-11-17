-- Add type column if not exists
ALTER TABLE public.scraps 
ADD COLUMN IF NOT EXISTS type text;

-- Backfill types based on source and metadata
UPDATE public.scraps
SET type = 
  CASE 
    WHEN source = 'pinboard' THEN 'bookmark'
    WHEN source = 'mastodon' THEN 'status'
    WHEN source = 'arena' THEN 'block'
    WHEN source = 'github' AND metadata->>'type' = 'repository' THEN 'repo'
    WHEN source = 'github' AND metadata->>'type' = 'pull_request' THEN 'pr'
    WHEN source = 'github' AND metadata->>'type' = 'issue' THEN 'issue'
    WHEN source = 'github' AND metadata->>'type' = 'gist' THEN 'gist'
    WHEN source = 'github' AND metadata->>'type' = 'release' THEN 'release'
    WHEN source = 'github' AND metadata->>'type' = 'starred' THEN 'starred'
    ELSE source
  END; 