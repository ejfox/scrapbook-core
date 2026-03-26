# Graph Schema V1

Date: 2026-03-25

Purpose:
- turn the ontology work into a first implementable Supabase/Postgres shape
- keep `scraps` as the archive of record
- materialize graph state into a small set of relational tables
- provide a conservative bridge from current `scraps.relationships` payloads

## V1 Scope

Core graph tables:
- `graph_entities`
- `graph_documents`
- `graph_claims`
- `graph_evidence`

Explicitly not in V1:
- materialized derived network edge table
- separate graph database
- aggressive claim merging
- fully normalized subtype tables

## Table Roles

### `graph_entities`

What lives here:
- `Person`
- `Organization`
- `Project`
- `Artwork`
- `Tool`
- `Model`
- `Dataset`
- `Location`

What does not live here:
- `Document`
- `Claim`

Why:
- these are the reusable semantic actors in the graph
- `Document` and `Claim` play different provenance roles and stay separate

Suggested core fields:
- `id`
- `entity_key`
- `display_name`
- `entity_type`
- `type_axes`
- `aliases`
- `canonical_status`
- `is_provisional`
- `metadata`
- `created_at`
- `updated_at`

### `graph_documents`

What lives here:
- documents in the world, whether or not they were ingested as scraps

Important distinction:
- a `scrap` is a local archival record
- a `Document` is an ontology object
- when a scrap directly captures a document, `graph_documents.scrap_id` links them

Suggested core fields:
- `id`
- `document_key`
- `scrap_id`
- `url`
- `title`
- `document_kind`
- `source`
- `publisher`
- `author`
- `published_at`
- `captured_at`
- `reliability`
- `metadata`
- `active_extractor_version`
- `active_ontology_version`
- `processing_status`
- `is_partial`
- `last_processed_at`
- `extraction_history`
- `created_at`
- `updated_at`

### `graph_claims`

What lives here:
- shared claim objects connecting semantic actors through approved predicates

Important stance:
- claims are global objects
- claim merging should remain conservative
- exact deterministic claim keys are fine
- fuzzy cross-document claim merging should be deferred

Suggested core fields:
- `id`
- `claim_key`
- `subject_entity_id`
- `predicate`
- `object_entity_id`
- `claim_mode`
- `claim_state`
- `asserted_at`
- `valid_from`
- `valid_to`
- `raw_text`
- `metadata`
- `created_at`
- `updated_at`

### `graph_evidence`

What lives here:
- provenance-bearing document edges

Examples:
- `Document -> MENTIONS -> Entity`
- `Document -> ASSERTS -> Claim`
- `Document -> QUOTES -> Claim`
- `Document -> SUPPORTS -> Claim`
- `Document -> CONTRADICTS -> Claim`

Suggested core fields:
- `id`
- `evidence_key`
- `document_id`
- `edge_kind`
- `target_kind`
- `entity_id`
- `claim_id`
- `snippet`
- `mention_text`
- `offset_start`
- `offset_end`
- `confidence`
- `extractor_version`
- `ontology_version`
- `processing_status`
- `is_partial`
- `error_stage`
- `error_message`
- `metadata`
- `created_at`
- `updated_at`

## V1 Processing Model

Source of truth:
- `scraps` stores raw scraped data, summary, screenshot, and source metadata

Graph pipeline:
1. ingestion stores or updates a scrap
2. graph processing runs downstream
3. graph processing reads from `scraps`
4. graph processing writes or updates rows in graph tables
5. user-facing network views are computed from claims plus evidence

Important architectural constraints:
- graph processing is versioned
- graph processing is idempotent by scrap and version
- partial runs may be preserved, but must be marked clearly
- canonicalization is separate from extraction

## Conservative Bridge From Current `scraps.relationships`

Current reality:
- most rows still store legacy flat relationships like:
  - `{ source, relationship, target }`
- only a minority are in the typed nested shape

Bridge rule:
- treat existing relationship payloads as claim candidates, not final truth

Projection strategy:
1. each scrap becomes one `graph_documents` row
2. each relationship yields:
   - up to two `graph_entities`
   - one `graph_claims` row
   - one `ASSERTS` evidence row
   - two `MENTIONS` evidence rows
3. current extractor type labels are mapped conservatively into ontology types
4. uncertain or legacy types remain provisional

Conservative type mapping for the bridge:
- `Person -> Person`
- `Organization -> Organization`
- `Location -> Location`
- `Technology -> Tool`
- `Product -> Tool` unless strong model heuristics say `Model`
- `Concept -> Unknown/provisional`
- `Event -> Unknown/provisional`
- missing type -> `Unknown/provisional`

Important note:
- this bridge is for migration preview and incremental backfill
- it is not the final ontology extraction system

## Why No Materialized `graph_edges` Table

V1 should compute network views from:
- `graph_claims`
- `graph_evidence`

Why:
- avoids duplicated state
- avoids sync drift
- keeps the first implementation focused on evidence and claims

## First Implementation Order

1. create the four graph tables
2. add unique keys and indexes
3. run a preview projection from current `scraps.relationships`
4. inspect provisional types and noisy predicates
5. tighten normalization rules
6. build the first true graph-processing job

## Immediate Open Items

- final approved predicate registry
- final `claim_mode` enum
- final `claim_state` enum
- entity canonicalization rules
- dataset subtype vocabulary
- model subtype vocabulary
- whether a dedicated `graph_runs` support table is needed
