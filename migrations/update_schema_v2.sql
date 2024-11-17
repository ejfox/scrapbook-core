-- Add new columns
ALTER TABLE public.scraps 
ADD COLUMN IF NOT EXISTS url text,
ADD COLUMN IF NOT EXISTS screenshot_url text,
ADD COLUMN IF NOT EXISTS location text,
ADD COLUMN IF NOT EXISTS title text,
ADD COLUMN IF NOT EXISTS latitude double precision,
ADD COLUMN IF NOT EXISTS longitude double precision,
ADD COLUMN IF NOT EXISTS published_at timestamp without time zone,
ADD COLUMN IF NOT EXISTS shared boolean DEFAULT false;

-- Create new indexes
CREATE INDEX IF NOT EXISTS scraps_url_idx ON public.scraps USING btree (url);
CREATE INDEX IF NOT EXISTS scraps_location_idx ON public.scraps USING btree (location);
CREATE INDEX IF NOT EXISTS scraps_geo_idx ON public.scraps USING btree (latitude, longitude);
CREATE INDEX IF NOT EXISTS scraps_type_idx ON public.scraps USING btree (type);
CREATE INDEX IF NOT EXISTS scraps_published_at_idx ON public.scraps USING btree (published_at);
CREATE INDEX IF NOT EXISTS scraps_shared_idx ON public.scraps USING btree (shared);

-- Migrate data from metadata to root level
UPDATE public.scraps
SET
  url = metadata->>'href',
  screenshot_url = metadata->>'screenshotUrl',
  location = metadata->>'location',
  title = COALESCE(metadata->>'title', content),
  latitude = (metadata->>'latitude')::double precision,
  longitude = (metadata->>'longitude')::double precision,
  published_at = COALESCE(
    (metadata->>'published_at')::timestamp without time zone,
    created_at
  );

-- Convert tags from text to jsonb if needed
ALTER TABLE public.scraps 
ALTER COLUMN tags TYPE jsonb USING 
  CASE 
    WHEN tags IS NULL THEN '[]'::jsonb
    WHEN tags::text = '' THEN '[]'::jsonb
    ELSE array_to_json(string_to_array(tags, ','))::jsonb
  END; 