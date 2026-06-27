-- ============================================================================
-- 00_init_scraps_recovery.sql
-- Full reconstruction of the `public.scraps` table after the table was DROPped.
-- Idempotent: safe to run multiple times. Creates table, indexes, grants.
--
-- Column set derived from:
--   - scripts/index.mjs upsert/insert objects (source of truth for writes)
--   - migrations/*.sql (incremental ALTERs)
--   - CLAUDE.md documented schema
--
-- Notes:
--   * scrap_id is UNIQUE — required for the pipeline's ON CONFLICT (scrap_id) upsert.
--   * embedding* columns are jsonb placeholders (ENABLE_EMBEDDINGS=false). Convert
--     to pgvector later if/when semantic search is re-enabled.
--   * RLS is intentionally left DISABLED + GRANT to anon, matching prior behavior
--     (the app writes with the anon key). SECURITY FOLLOW-UP: move the app to a
--     real service_role key and enable RLS once recovery is complete.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.scraps (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scrap_id                text UNIQUE,
  source                  text,
  type                    text,
  url                     text,
  title                   text,
  content                 text,
  summary                 text,
  meta_summary            text,
  tags                    jsonb DEFAULT '[]'::jsonb,
  concept_tags            text[],
  relationships           jsonb,
  location                text,
  latitude                double precision,
  longitude               double precision,
  financial_analysis      jsonb,
  extraction_confidence   jsonb,
  content_type            text,
  screenshot_url          text,
  metadata                jsonb DEFAULT '{}'::jsonb,
  shared                  boolean DEFAULT false,
  graph_imported          boolean DEFAULT false,
  embedding               jsonb,
  embedding_nomic         jsonb,
  image_embedding         jsonb,
  processing_instance_id  text,
  processing_started_at   timestamptz,
  published_at            timestamptz,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- In case the table already existed in a partial state, ensure every column is present.
ALTER TABLE public.scraps
  ADD COLUMN IF NOT EXISTS scrap_id               text,
  ADD COLUMN IF NOT EXISTS source                 text,
  ADD COLUMN IF NOT EXISTS type                   text,
  ADD COLUMN IF NOT EXISTS url                    text,
  ADD COLUMN IF NOT EXISTS title                  text,
  ADD COLUMN IF NOT EXISTS content                text,
  ADD COLUMN IF NOT EXISTS summary                text,
  ADD COLUMN IF NOT EXISTS meta_summary           text,
  ADD COLUMN IF NOT EXISTS tags                   jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS concept_tags           text[],
  ADD COLUMN IF NOT EXISTS relationships          jsonb,
  ADD COLUMN IF NOT EXISTS location               text,
  ADD COLUMN IF NOT EXISTS latitude               double precision,
  ADD COLUMN IF NOT EXISTS longitude              double precision,
  ADD COLUMN IF NOT EXISTS financial_analysis     jsonb,
  ADD COLUMN IF NOT EXISTS extraction_confidence  jsonb,
  ADD COLUMN IF NOT EXISTS content_type           text,
  ADD COLUMN IF NOT EXISTS screenshot_url         text,
  ADD COLUMN IF NOT EXISTS metadata               jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS shared                 boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS graph_imported         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS embedding              jsonb,
  ADD COLUMN IF NOT EXISTS embedding_nomic        jsonb,
  ADD COLUMN IF NOT EXISTS image_embedding        jsonb,
  ADD COLUMN IF NOT EXISTS relationships_raw      jsonb,  -- pre-normalization model output; never-lose-info safety net + future re-mining
  ADD COLUMN IF NOT EXISTS processing_meta        jsonb,  -- per-field provenance: which model/prompt version produced each field
  ADD COLUMN IF NOT EXISTS processing_instance_id text,
  ADD COLUMN IF NOT EXISTS processing_started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS published_at           timestamptz,
  ADD COLUMN IF NOT EXISTS created_at             timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz DEFAULT now();

-- Guarantee scrap_id uniqueness (required by ON CONFLICT upsert).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scraps_scrap_id_key'
  ) THEN
    ALTER TABLE public.scraps ADD CONSTRAINT scraps_scrap_id_key UNIQUE (scrap_id);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS scraps_url_idx          ON public.scraps USING btree (url);
CREATE INDEX IF NOT EXISTS scraps_source_idx       ON public.scraps USING btree (source);
CREATE INDEX IF NOT EXISTS scraps_type_idx         ON public.scraps USING btree (type);
CREATE INDEX IF NOT EXISTS scraps_location_idx     ON public.scraps USING btree (location);
CREATE INDEX IF NOT EXISTS scraps_geo_idx          ON public.scraps USING btree (latitude, longitude);
CREATE INDEX IF NOT EXISTS scraps_published_at_idx ON public.scraps USING btree (published_at);
CREATE INDEX IF NOT EXISTS scraps_created_at_idx   ON public.scraps USING btree (created_at);
CREATE INDEX IF NOT EXISTS scraps_shared_idx       ON public.scraps USING btree (shared);
CREATE INDEX IF NOT EXISTS scraps_content_type_idx ON public.scraps USING btree (content_type);
CREATE INDEX IF NOT EXISTS scraps_concept_tags_idx ON public.scraps USING GIN (concept_tags);
CREATE INDEX IF NOT EXISTS scraps_processing_idx   ON public.scraps USING btree (processing_instance_id);

-- Privileges: the pipeline authenticates with the anon key. Grant access and
-- keep RLS disabled to replicate the pre-deletion behavior.
GRANT ALL ON public.scraps TO anon, authenticated, service_role;

COMMENT ON TABLE public.scraps IS 'Recovered scrapbook table — reconstructed 2026-06-27 after accidental DROP. Re-ingested + re-enhanced from the Pinboard archive.';
