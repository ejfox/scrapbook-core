-- Drop existing data and constraints
TRUNCATE TABLE public.scraps;

-- Update schema with new columns
ALTER TABLE public.scraps 
ADD COLUMN IF NOT EXISTS url text,
ADD COLUMN IF NOT EXISTS screenshot_url text,
ADD COLUMN IF NOT EXISTS location text,
ADD COLUMN IF NOT EXISTS title text,
ADD COLUMN IF NOT EXISTS latitude double precision,
ADD COLUMN IF NOT EXISTS longitude double precision,
ADD COLUMN IF NOT EXISTS type text,
ADD COLUMN IF NOT EXISTS published_at timestamp without time zone,
ADD COLUMN IF NOT EXISTS shared boolean DEFAULT false;

-- Add performance indexes
CREATE INDEX IF NOT EXISTS scraps_url_idx ON public.scraps USING btree (url);
CREATE INDEX IF NOT EXISTS scraps_location_idx ON public.scraps USING btree (location);
CREATE INDEX IF NOT EXISTS scraps_geo_idx ON public.scraps USING btree (latitude, longitude);
CREATE INDEX IF NOT EXISTS scraps_type_idx ON public.scraps USING btree (type);
CREATE INDEX IF NOT EXISTS scraps_published_at_idx ON public.scraps USING btree (published_at);
CREATE INDEX IF NOT EXISTS scraps_shared_idx ON public.scraps USING btree (shared); 