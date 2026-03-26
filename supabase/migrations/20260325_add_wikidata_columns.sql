-- Add Wikidata entity resolution columns to graph_entities
-- Run in Supabase SQL editor after add_graph_tables_v1.sql

ALTER TABLE public.graph_entities
  ADD COLUMN IF NOT EXISTS wikidata_qid TEXT,
  ADD COLUMN IF NOT EXISTS external_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS wikidata_label TEXT,
  ADD COLUMN IF NOT EXISTS wikidata_description TEXT,
  ADD COLUMN IF NOT EXISTS wikidata_match_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS wikidata_last_resolved_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_entities_wikidata_qid
  ON public.graph_entities (wikidata_qid)
  WHERE wikidata_qid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_graph_entities_external_ids
  ON public.graph_entities USING GIN (external_ids);

CREATE INDEX IF NOT EXISTS idx_graph_entities_wikidata_match_confidence
  ON public.graph_entities (wikidata_match_confidence)
  WHERE wikidata_match_confidence IS NOT NULL;

COMMENT ON COLUMN public.graph_entities.wikidata_qid IS 'Wikidata entity QID (e.g. Q937 for Albert Einstein). Primary external identifier for entity resolution.';
COMMENT ON COLUMN public.graph_entities.external_ids IS 'Additional external identifiers keyed by namespace (e.g. {"musicbrainz": "...", "openalex": "...", "ror": "..."}).';
COMMENT ON COLUMN public.graph_entities.wikidata_label IS 'Canonical label from Wikidata in English.';
COMMENT ON COLUMN public.graph_entities.wikidata_description IS 'Short description from Wikidata in English.';
COMMENT ON COLUMN public.graph_entities.wikidata_match_confidence IS 'Confidence score (0-1) of the Wikidata match. NULL means unresolved.';
COMMENT ON COLUMN public.graph_entities.wikidata_last_resolved_at IS 'Timestamp of last Wikidata resolution attempt, whether successful or not.';
