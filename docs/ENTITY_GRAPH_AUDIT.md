# Entity Graph Audit

Date: 2026-03-25

## Scope

Audit of the locally exported entity graph derived from `scraps.relationships`.

Export source:
- `data/entity-graph/latest/graph.json`
- `data/entity-graph/latest/nodes.json`
- `data/entity-graph/latest/edges.json`

Exporter:
- `scripts/export_entity_graph.mjs`

## Current Graph Snapshot

- Scraps with relationships: `878`
- Raw relationships: `24,446`
- Discarded relationships: `4,897`
- Nodes: `17,553`
- Edges: `18,978`

Source distribution:
- `pinboard`: `865`
- `arena`: `13`

## Key Findings

### 1. Most stored relationships are legacy flat edges with no entity typing

Shape counts from Supabase:
- Typed edges: `647`
- Flat edges: `18,902`
- Malformed items: `4,897`

This explains why the exported graph is overwhelmingly typed as `Entity`.

Relevant code:
- `scripts/aiRelationshipExtraction.mjs` returns flat edges: `{ source, target, relationship }`
- `scripts/index.mjs` validates only the flat shape before writing to `scraps.relationships`
- `tests/validate_scraps.mjs` expects nested typed edges: `{ source: {name,type}, target: {name,type}, type }`

This is the biggest structural mismatch in the system.

### 2. Discarded relationships are mostly empty inner arrays, not random corruption

Malformed breakdown:
- Empty inner arrays: `4,891`
- Entity-only objects: `6`

This means the main malformed write path is highly specific and probably fixable at the parser or assignment layer.

### 3. The graph is polluted by URL/menu/footer extraction

Examples:
- `URL`
- `article`
- `Video`
- `About`
- `Contact Us`
- `Developers`
- direct URLs like `https://...`

Footer/menu edge patterns are prominent:
- `HAS_SECTION`
- `HAS_FEATURE`
- `HAS_URL`
- `IS_A`

Examples from top edges:
- `YouTube -> Contact Us`
- `YouTube -> About`
- `YouTube -> Press`
- `URL -> uxdesign.cc`

This is low-value graph material and dominates high-degree nodes.

### 4. Relationship vocabulary is too broad and page-structure-heavy

Top relationship types by total weight:
- `INCLUDES` `711`
- `HAS_FEATURE` `394`
- `IS_A` `367`
- `HAS_SECTION` `306`
- `PROVIDES` `273`
- `OFFERS` `245`

These are not wrong in isolation, but they skew toward marketing copy and site chrome instead of durable conceptual links.

### 5. Type detection is underpowered and internally inconsistent

Observed symptoms:
- Graph has `17,280` nodes typed as `Entity`
- Previous spot-checks already showed misclassification like `"New York" -> Person`
- Tests and validators expect typed edges, but active extraction still persists untyped edges

### 6. Pinboard dominates the graph, so page extraction quality matters most

Nearly all relationship-bearing scraps come from Pinboard. This means:
- improvements to page-content cleaning will move the graph more than extractor tweaks alone
- footer/nav stripping should be prioritized

## Recommended Tuning Order

### Priority 1: Unify on one typed relationship schema

Target shape:

```json
{
  "source": { "name": "OpenAI", "type": "Organization" },
  "target": { "name": "ChatGPT", "type": "Product" },
  "type": "DEVELOPS"
}
```

Actions:
- Update `scripts/aiRelationshipExtraction.mjs` to return typed nested edges
- Update `scripts/index.mjs` validation to accept the typed shape
- Keep backward compatibility for legacy flat rows during reads/exports
- Add a migration/backfill path for historical flat edges

### Priority 2: Add post-extraction graph hygiene filters

Before saving relationships, reject entities that are:
- raw URLs
- generic placeholders like `URL`, `article`, `video`, `page`, `content`
- navigation/footer labels like `About`, `Press`, `Terms`, `Privacy`, `Contact Us`, `Developers`
- single punctuation tokens or one-character junk
- standalone years/numeric fragments unless clearly event-like

This should happen in a normalization layer after extraction, not only in prompting.

### Priority 3: Tighten page-content extraction for Pinboard

The extractor is probably seeing site chrome along with content.

Actions:
- strip nav/footer/header/sidebar text before relationship extraction
- ignore repeated boilerplate sections
- reduce emphasis on domain/title/url-only material
- prefer article body over global page text

### Priority 4: Narrow the allowed relationship vocabulary

Prefer durable semantic edges such as:
- `AUTHORED_BY`
- `WORKS_FOR`
- `ACQUIRED`
- `USES`
- `LOCATED_IN`
- `PART_OF`
- `FOUNDED`
- `DEVELOPED_BY`
- `PUBLISHES`
- `MENTIONS`

De-emphasize or drop low-value structural relations such as:
- `HAS_SECTION`
- `HAS_URL`
- `HAS_FEATURE`
- `OFFERS_FEATURE`
- `HELPS_WITH`
- `HELPS_TO`

### Priority 5: Improve entity typing heuristics and canonicalization

Actions:
- move explicit location matching ahead of person-name heuristics
- maintain curated type aliases for common orgs/products/technologies
- canonicalize casing and duplicates (`YouTube` vs `youtube`)
- treat repository names, domains, and file names separately from people/orgs

### Priority 6: Separate entities from relationships if both are desired

The `entity-only` malformed objects suggest at least one path may be extracting entities rather than edges.

If entity lists are useful, store them separately:
- `entities`: list of typed nodes
- `relationships`: list of typed edges

Do not overload `relationships` with both.

## Suggested Implementation Sequence

1. Make the active extractor emit typed nested edges.
2. Add a `normalizeRelationships()` layer that:
   - accepts old and new formats
   - rejects junk entities
   - canonicalizes names/types
3. Apply that normalization before writing to Supabase.
4. Re-export the graph and compare:
   - node count
   - edge count
   - `% typed`
   - junk-node count
   - top relationship-type distribution
5. Backfill historical rows if the new graph is materially better.

## Success Metrics

Good next-pass targets:
- typed relationships from `647` to `>90%` of new writes
- discarded relationships from `4,897` to near zero
- generic `Entity` nodes from `17,280` to a minority of nodes
- footer/nav/url nodes reduced by `>80%`
- top edges dominated by semantic relations, not site chrome
