-- Graph Schema V1
-- Run in Supabase SQL editor or as a migration after reviewing the ontology build spec.
-- Keeps scraps as the archival source of truth and materializes graph state separately.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.graph_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  type_axes TEXT[] NOT NULL DEFAULT '{}',
  aliases TEXT[] NOT NULL DEFAULT '{}',
  canonical_status TEXT NOT NULL DEFAULT 'provisional',
  is_provisional BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_graph_entities_type
  ON public.graph_entities (entity_type);

CREATE INDEX IF NOT EXISTS idx_graph_entities_type_axes
  ON public.graph_entities USING GIN (type_axes);

CREATE INDEX IF NOT EXISTS idx_graph_entities_aliases
  ON public.graph_entities USING GIN (aliases);

CREATE INDEX IF NOT EXISTS idx_graph_entities_metadata
  ON public.graph_entities USING GIN (metadata);

COMMENT ON TABLE public.graph_entities IS 'Canonical and provisional semantic actors for the ontology graph.';
COMMENT ON COLUMN public.graph_entities.entity_key IS 'Stable application-level key used for idempotent upserts and canonicalization.';
COMMENT ON COLUMN public.graph_entities.entity_type IS 'Top-level ontology type such as Person, Organization, Project, Artwork, Tool, Model, Dataset, or Location.';

CREATE TABLE IF NOT EXISTS public.graph_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_key TEXT NOT NULL UNIQUE,
  scrap_id UUID REFERENCES public.scraps(id) ON DELETE SET NULL,
  url TEXT,
  title TEXT,
  document_kind TEXT,
  source TEXT,
  publisher TEXT,
  author TEXT,
  published_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  reliability JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_extractor_version TEXT,
  active_ontology_version TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  is_partial BOOLEAN NOT NULL DEFAULT FALSE,
  last_processed_at TIMESTAMPTZ,
  extraction_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_documents_scrap_id_unique
  ON public.graph_documents (scrap_id)
  WHERE scrap_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_graph_documents_document_kind
  ON public.graph_documents (document_kind);

CREATE INDEX IF NOT EXISTS idx_graph_documents_source
  ON public.graph_documents (source);

CREATE INDEX IF NOT EXISTS idx_graph_documents_published_at
  ON public.graph_documents (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_graph_documents_processing_status
  ON public.graph_documents (processing_status);

CREATE INDEX IF NOT EXISTS idx_graph_documents_metadata
  ON public.graph_documents USING GIN (metadata);

COMMENT ON TABLE public.graph_documents IS 'Ontology-level documents. A document may optionally link back to a Scrapbook scrap record.';
COMMENT ON COLUMN public.graph_documents.document_key IS 'Stable application-level key used for idempotent upserts and non-scrap documents.';

CREATE TABLE IF NOT EXISTS public.graph_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_key TEXT NOT NULL UNIQUE,
  subject_entity_id UUID NOT NULL REFERENCES public.graph_entities(id) ON DELETE CASCADE,
  predicate TEXT NOT NULL,
  object_entity_id UUID NOT NULL REFERENCES public.graph_entities(id) ON DELETE CASCADE,
  claim_mode TEXT NOT NULL DEFAULT 'asserted',
  claim_state TEXT NOT NULL DEFAULT 'unreviewed',
  asserted_at TIMESTAMPTZ,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  raw_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_graph_claims_subject
  ON public.graph_claims (subject_entity_id);

CREATE INDEX IF NOT EXISTS idx_graph_claims_object
  ON public.graph_claims (object_entity_id);

CREATE INDEX IF NOT EXISTS idx_graph_claims_predicate
  ON public.graph_claims (predicate);

CREATE INDEX IF NOT EXISTS idx_graph_claims_claim_mode
  ON public.graph_claims (claim_mode);

CREATE INDEX IF NOT EXISTS idx_graph_claims_claim_state
  ON public.graph_claims (claim_state);

CREATE INDEX IF NOT EXISTS idx_graph_claims_metadata
  ON public.graph_claims USING GIN (metadata);

COMMENT ON TABLE public.graph_claims IS 'Shared claim objects connecting semantic actors through ontology predicates.';
COMMENT ON COLUMN public.graph_claims.claim_key IS 'Stable deterministic key for conservative exact-match claim identity.';

CREATE TABLE IF NOT EXISTS public.graph_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_key TEXT NOT NULL UNIQUE,
  document_id UUID NOT NULL REFERENCES public.graph_documents(id) ON DELETE CASCADE,
  edge_kind TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  entity_id UUID REFERENCES public.graph_entities(id) ON DELETE CASCADE,
  claim_id UUID REFERENCES public.graph_claims(id) ON DELETE CASCADE,
  snippet TEXT,
  mention_text TEXT,
  offset_start INTEGER,
  offset_end INTEGER,
  confidence DOUBLE PRECISION,
  extractor_version TEXT,
  ontology_version TEXT,
  processing_status TEXT NOT NULL DEFAULT 'complete',
  is_partial BOOLEAN NOT NULL DEFAULT FALSE,
  error_stage TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT graph_evidence_target_kind_check
    CHECK (target_kind IN ('entity', 'claim')),
  CONSTRAINT graph_evidence_target_ref_check
    CHECK (
      (target_kind = 'entity' AND entity_id IS NOT NULL AND claim_id IS NULL) OR
      (target_kind = 'claim' AND claim_id IS NOT NULL AND entity_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_graph_evidence_document
  ON public.graph_evidence (document_id);

CREATE INDEX IF NOT EXISTS idx_graph_evidence_edge_kind
  ON public.graph_evidence (edge_kind);

CREATE INDEX IF NOT EXISTS idx_graph_evidence_entity
  ON public.graph_evidence (entity_id);

CREATE INDEX IF NOT EXISTS idx_graph_evidence_claim
  ON public.graph_evidence (claim_id);

CREATE INDEX IF NOT EXISTS idx_graph_evidence_processing_status
  ON public.graph_evidence (processing_status);

CREATE INDEX IF NOT EXISTS idx_graph_evidence_versions
  ON public.graph_evidence (extractor_version, ontology_version);

CREATE INDEX IF NOT EXISTS idx_graph_evidence_metadata
  ON public.graph_evidence USING GIN (metadata);

COMMENT ON TABLE public.graph_evidence IS 'Unified provenance-bearing document edges such as MENTIONS, ASSERTS, QUOTES, SUPPORTS, and CONTRADICTS.';
COMMENT ON COLUMN public.graph_evidence.evidence_key IS 'Stable application-level key used for idempotent evidence upserts.';

