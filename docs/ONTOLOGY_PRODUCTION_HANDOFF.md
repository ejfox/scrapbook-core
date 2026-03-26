# Ontology Production Handoff

Date: 2026-03-26

Current state:

- new ingestion already calls the new typed relationship extractor in [scripts/index.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/index.mjs)
- production defaults are now:
  - `relationshipAnalysis`: `openai/gpt-4o-mini`
  - `relationshipReview`: `openai/gpt-4o-mini`
  - `relationshipJudge`: `openai/gpt-5.4`
- current best validation artifact is [mixed-review-batch-defaults-v2.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-defaults-v2.clean.json)

Best current batch result:

- `11` scraps processed
- `5` final relationships
- `5` non-empty scraps
- `3` `asserted`
- `2` `reported`

## Outstanding Work

### 1. Large-batch re-extraction

Run the new extractor against a materially larger sample, then the full target corpus if quality holds.

Goal:

- confirm `defaults-v2` quality outside the tiny mixed batch
- catch new modality-specific failures before full migration

Suggested command:

```bash
npm run relationships:reextract -- --source pinboard --limit 200 --dry-run --include-diagnostics
```

### 2. Full relationship migration

Re-extract and write cleaned typed relationships back onto historical scraps.

Goal:

- replace legacy flat/noisy `scraps.relationships`
- make graph backfills operate on better source material

Suggested command shape:

```bash
npm run relationships:reextract -- --source pinboard --limit 500 --force
```

Then repeat by source or in batches.

### 3. Graph rebuild from cleaned relationships

After re-extraction, rerun the graph projection/backfill pipeline.

Goal:

- populate `graph_documents`
- populate `graph_entities`
- populate `graph_claims`
- populate `graph_evidence`
  from cleaner typed relationships

Relevant files:

- [scripts/backfill_graph_v1.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/backfill_graph_v1.mjs)
- [lib/graphProjection.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/lib/graphProjection.mjs)

### 4. Post-backfill audit

Rerun graph export and quality audit after the cleaned relationship migration.

Goal:

- compare provisional entity rate
- compare junk node rate
- compare bad predicate rate
- confirm `reported` claims survive into graph structures as intended

Relevant files:

- [scripts/export_entity_graph.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/export_entity_graph.mjs)
- [docs/ENTITY_GRAPH_AUDIT.md](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/docs/ENTITY_GRAPH_AUDIT.md)

### 5. Add recurring regression batch

Keep a small stable review batch and run it whenever prompts, models, or ontology rules change.

Goal:

- prevent silent regressions
- track recall vs precision over time

Relevant files:

- [scripts/build_relationship_review_batch.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/build_relationship_review_batch.mjs)
- [scripts/reextract_relationships_v2.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/reextract_relationships_v2.mjs)
- [scripts/summarize_relationship_review_batch.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/summarize_relationship_review_batch.mjs)

### 6. Finish the council bakeoff under the hardened runner

The council bakeoff system is now resumable and repaired, but the best finished artifact still needs a clean full run under the hardened version.

Goal:

- get a definitive extraction/judge comparison artifact
- render the full HTML report
- decide whether to test stronger candidate extractors than `gpt-4o-mini`

Relevant files:

- [scripts/bakeoff_relationship_models.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/bakeoff_relationship_models.mjs)
- [scripts/rejudge_relationship_bakeoff.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/rejudge_relationship_bakeoff.mjs)
- [scripts/render_relationship_bakeoff_report.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/render_relationship_bakeoff_report.mjs)

### 7. Wikidata resolution pass

Graph entity resolution exists structurally but still needs a real pass after the graph is rebuilt from better relationships.

Goal:

- bind `wikidata_qid` where appropriate
- reduce duplicate people/org/location nodes
- improve graph navigability and downstream enrichment

Relevant files:

- [lib/wikidataResolver.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/lib/wikidataResolver.mjs)
- [scripts/resolve_wikidata.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/resolve_wikidata.mjs)
- [migrations/add_wikidata_columns.sql](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/migrations/add_wikidata_columns.sql)

## Known Weak Spots

- article/report extraction still wants more examples for subtle institutional and investigative claims
- `Project` is carrying some broad narrative/program load and may need tighter boundaries later
- the current ontology still does not fully model `Movement`/narrative/discourse distinctions beyond the first useful cut
- the bakeoff output files should eventually default to clean JSON without npm/log preambles when redirected

## Recommended Next Move

If resuming tomorrow, do this in order:

1. run a `200`-scrap dry-run re-extraction on the most important source
2. inspect failures
3. if quality holds, do the real write pass
4. rebuild graph tables
5. rerun graph audit
