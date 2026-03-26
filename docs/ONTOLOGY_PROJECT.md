# Ontology Project

Date started: 2026-03-25

Purpose:
- Design a hand-tuned investigative ontology for Scrapbook
- Optimize for research, intelligence mapping, anomaly detection, co-occurrence analysis, narrative backtracking, and journalist-facing provenance

Working structure:
- `Architecture`
  - graph layers
  - node classes
  - provenance model
  - review and governance model
- `Ontology`
  - entity types
  - predicate registries
  - claim modes and states
  - allowed type pairings
- `Extraction and operations`
  - prompt design
  - normalization
  - canonicalization
  - backfills
  - UI and query projections

Current status:
- the major architectural shape is partially defined
- the project briefly drifted into ontology-registry detail
- the next step is to close the remaining architecture-level decisions before going deeper on predicate tuning

## Point 38: `Movement` Is A Core Entity Type, Not Just An Interpretive Overlay

Core decision:
- `Movement` is a first-class entity type in the core ontology

Reasoning:
- the growth, mutation, and inter-linking of people and movements is one of the central subjects of this system
- forcing movements into `Project`, `Artwork`, or an abstract `Concept` bucket would blur a key reporting surface
- movements behave as durable graph actors:
  - people lead them
  - people belong to them
  - organizations fund or target them
  - they develop geographically and institutionally over time

Working model:
- treat named political, social, ideological, religious, or cultural movements as `Movement`
- allow movement participation in core predicates such as:
  - `LEADS`
  - `FOUNDED`
  - `MEMBER_OF`
  - `ADVISES`
  - `FUNDS`
  - `DONATES_TO`
  - `PARTNERS_WITH`
  - `LOCATED_IN`
  - `INVESTIGATES`
  - `TARGETS`
  - `BANS`

Design implication:
- movement analysis is part of the sober evidence graph, not only a future interpretive layer
- abstract narrative/discourse phrases should still not be coerced into entities unless they are truly movement-like or later promoted into a controlled overlay

## Point 22: Derived Links Should Be Metadata-Bearing Edges, Not Nodes

Core decision:
- treat `derived` relationships as edges with metadata, not as first-class node objects

Reasoning:
- claims already carry the main epistemic burden in the graph
- making derived links into nodes would add graph bulk without enough additional clarity in V1
- what matters architecturally is whether a relationship is:
  - asserted directly by a document
  - quoted by a document
  - or synthesized across evidence
- that distinction can live cleanly on the edge itself

Working model:
- `Entity -> PREDICATE -> Entity`
- edge metadata carries fields like:
  - `is_derived`
  - `derived_from_claim_ids`
  - `derived_from_document_ids`
  - `derivation_method`
  - `support_count`
  - `last_recomputed_at`

Design implication:
- claims remain first-class nodes
- derived entity/entity links are projections or promoted summaries over underlying claim/document evidence
- UI and query layers can expose or hide derivation metadata without changing the core node model

## Point 23: Mentions Should Be Metadata-Bearing Edges, Not Nodes

Core decision:
- treat mentions as `Document -> Entity` edges with metadata, not as first-class nodes

Reasoning:
- mention instances do not need their own objecthood in V1
- turning mentions into nodes would add graph volume without improving the main reporting workflows
- what matters is that a document referenced an entity, where it happened, and how strongly or directly it happened

Working model:
- `Document -> MENTIONS -> Entity`
- edge metadata carries fields like:
  - `mention_text`
  - `normalized_text`
  - `snippet`
  - `offset_start`
  - `offset_end`
  - `mention_confidence`
  - `section`

Design implication:
- the graph stays lighter and easier to query
- provenance is preserved without multiplying low-level node types
- if later workflows require mention-instance review or annotation, the system can promote mention records without changing the core architecture

## Point 24: Document Format Should Stay In Metadata, Not In Node Types

Core decision:
- keep `Document` as a stable ontology class
- treat format distinctions like article, video, podcast, repo page, government page, newsletter, or social post as document metadata rather than separate ontology node types

Reasoning:
- these distinctions matter operationally and analytically, but they do not justify splitting the core document class
- source-format variation is better handled as filtering, ranking, and extraction context than as separate graph object classes
- this keeps the architecture stable even as new source formats are added

Working model:
- `Document` remains one node type
- metadata fields may include:
  - `document_kind`
  - `source_platform`
  - `mime_type`
  - `publisher`
  - `author`
  - `published_at`
  - `captured_at`

Design implication:
- extraction logic can branch on document metadata without fragmenting the ontology
- the graph can still be filtered by format, publisher, or medium when needed

## Point 25: Canonicalization Should Be A Separate Layer From Extraction

Core decision:
- separate extraction from canonicalization / identity resolution

Reasoning:
- document extraction should focus on local evidence:
  - what was mentioned
  - what was asserted
  - what relationship was expressed
- canonicalization should separately decide whether different surface forms resolve to the same underlying entity
- combining the two too early would make extraction brittle and harder to audit

Working model:
- extraction stage:
  - emits mention spans
  - emits claim candidates
  - emits provisional entity labels and types
- canonicalization stage:
  - resolves aliases
  - merges duplicate entities
  - links domains, handles, abbreviations, and long-form names
  - decides whether a surface form maps to an existing node or a new one

Examples:
- `NYT`
- `The New York Times`
- `nytimes.com`
  may all resolve to one `Organization`

Design implication:
- provenance remains tied to what the document literally said
- identity resolution can improve over time without rewriting raw extraction evidence
- backfills and alias tuning become much safer and more incremental

## Point 26: Source Artifacts Already Live In `scraps`; Extraction Storage Is A Separate Question

Core decision:
- the original source artifact is already preserved in the Scrapbook record layer
- ontology architecture should assume the following source materials can be recovered by `scrap_id`:
  - raw scraped data
  - summary
  - screenshot

Reasoning:
- the system does not need to make the graph itself responsible for preserving original source material
- document provenance can point back to the canonical `scrap` record instead of duplicating source payloads into graph storage
- this keeps the graph focused on evidence structure rather than archival blob storage

Design implication:
- `Document` nodes should reference the underlying scrap record
- the open storage question is not whether source material survives
- the open storage question is whether raw extraction candidates and intermediate normalization output should also be preserved alongside the cleaned graph result

## Point 27: Extraction Output Should Be Versioned, But Kept Behind A Simple Surface

Core decision:
- ontology extraction output should be versioned
- the top-level document/graph shape should remain simple and intuitive
- older extraction runs should live in a history structure rather than sprawling top-level fields

Reasoning:
- the same scrap may be reprocessed by multiple ontology versions over time
- version history is necessary for:
  - backfills
  - regression detection
  - extractor comparison
  - safe iteration on prompts and normalization logic
- but exposing every run as peer top-level keys would make the data model messy and hard to reason about

Working model:
- simple current fields for the active graph interpretation
- a nested history blob, run log, or versioned extraction record for prior outputs
- each run should capture enough metadata to audit and compare:
  - extractor version
  - ontology version
  - run timestamp
  - normalization version
  - key output summary

Design implication:
- the system can evolve without erasing prior interpretations
- day-to-day reads stay simple
- deep audit and replay workflows still have access to versioned history when needed

## Point 28: Claims Should Be Global Objects, Not Home-Bound To One Document

Core decision:
- claims should be globally shared graph objects
- multiple documents may independently connect to the same claim

Reasoning:
- the same substantive claim can be:
  - asserted by one document
  - quoted by another
  - repeated by many sources
  - supported or contradicted across time
- forcing each claim to "belong" to one home document would weaken cross-source comparison and duplicate semantically identical claims

Working model:
- `Document -> ASSERTS -> Claim`
- `Document -> QUOTES -> Claim`
- `Document -> SUPPORTS -> Claim`
- `Document -> CONTRADICTS -> Claim`

Design implication:
- claim identity and claim canonicalization become important architectural layers
- provenance remains document-specific even when the claim object is shared
- the graph can represent independent repetition, corroboration, amplification, and contestation around the same claim

## Point 29: Claim Merging Should Be Conservative And De-Emphasized In V1

Core decision:
- do not treat claim merging as a major automatic feature in V1
- any claim merging should be highly conservative

Reasoning:
- bad claim merges would contaminate the graph in ways that are hard to unwind
- superficially similar claims often differ in:
  - subject scope
  - time
  - modality
  - quoted source
  - degree of certainty
- the utility of aggressive claim merging is lower than the risk of collapsing distinct assertions into one shared object

Design implication:
- prefer duplicate or near-duplicate claims over unsafe auto-merges
- shared claim identity should only be established when matching is strong and defensible
- the architecture should not depend on broad fuzzy claim deduplication to work well

## Point 30: Time Should Live In Metadata, Not In Special Temporal Objects

Core decision:
- model time primarily as metadata on documents, claims, and edges
- do not introduce special temporal node types or temporal modeling machinery in V1

Reasoning:
- most temporal needs in this system are practical:
  - when a document was published
  - when it was captured
  - when a claim was observed
  - when an edge was derived or updated
- those needs are well served by ordinary timestamps and intervals
- a more elaborate temporal ontology would add complexity without enough payoff

Working model:
- use fields like:
  - `published_at`
  - `captured_at`
  - `observed_at`
  - `asserted_at`
  - `valid_from`
  - `valid_to`
  - `last_recomputed_at`

Design implication:
- temporal filtering and timeline reconstruction should rely on metadata
- named public happenings can still be represented through claims, documents, and metadata without requiring a top-level `Event` type in V1
- time itself is not promoted into a separate object system

## Point 31: Use Supabase/Postgres As The Graph Source Of Truth

Core decision:
- keep `scraps` as the archival source record
- materialize ontology graph data into additional tables in Supabase/Postgres
- do not make Neo4j, MongoDB, or another external graph store the primary truth layer in V1

Reasoning:
- Supabase is already the operational center of this system
- Postgres is a strong fit for provenance-heavy, versioned, relational graph data
- the graph needs tight joins back to:
  - `scraps`
  - extraction history
  - canonical entities
  - claims
  - document metadata
- adding a second primary database now would create drift and maintenance overhead too early

Current product reality:
- Supabase officially supports extensions including:
  - `vector` / pgvector for embeddings and similarity search
  - `pg_graphql` for GraphQL access over relational schema
  - `ltree`, `pgrouting`, and other useful Postgres extensions
- but the official extension surface does not currently present a dedicated graph-database layer as the default answer

Design implication:
- V1 should use:
  - `scraps` for archival source material
  - additional relational graph tables for entities, claims, and edges
- optional projections may come later:
  - local SQLite exports for analysis
  - Neo4j or another graph-native read model if exploration needs justify it

## Point 32: `Scrap` Records And `Document` Nodes Are Related, But Not Identical

Core decision:
- do not collapse Scrapbook records and ontology-level documents into one concept

Reasoning:
- some `scraps` are direct captures of source documents
- but scraps may also refer to other documents that matter to the investigation and should exist in the graph even if they were never ingested as scraps
- examples include:
  - cited articles
  - leaked PDFs
  - court filings
  - reports
  - videos
  - source documents mentioned inside another scrap

Working model:
- `scrap`
  - archival record in Scrapbook
  - stores raw scrape data, summary, screenshot, and source metadata
- `Document`
  - ontology object representing a document in the world
  - may optionally link to a local `scrap_id` when that document has been ingested

Design implication:
- `Document` should remain a first-class ontology type
- graph evidence tables should be able to reference:
  - a `document_id`
  - and, when available, a linked `scrap_id`
- this preserves the ability to model cited or referenced documents that are not yet first-class Scrapbook records

## Point 33: `Document` Should Have Its Own Table, Separate From General Entity Nodes

Core decision:
- keep documents in a dedicated graph table rather than mixing them into the main entity/node table

Reasoning:
- documents play a different role from people, organizations, projects, tools, and locations
- documents are provenance-bearing source artifacts, not just semantic actors
- a separate table makes it easier to keep document-specific fields and lifecycle concerns clear:
  - `scrap_id`
  - publisher
  - author
  - publication date
  - capture date
  - URL
  - reliability metadata
  - extraction history

Design implication:
- the graph storage model should lean toward:
  - `graph_entities`
  - `graph_documents`
  - `graph_claims`
  - `graph_evidence`
- if a 3-table first cut is desired, `graph_entities` and `graph_documents` are still the first pair I would keep distinct

## Point 34: Use One Unified `graph_evidence` Table

Core decision:
- use one unified evidence table rather than splitting mentions and claim links into separate tables

Reasoning:
- the evidence layer is conceptually one thing:
  - provenance-bearing document edges
- splitting it too early would create unnecessary schema sprawl before the ontology is stable
- a unified table can still represent distinct evidentiary actions through typed edge kinds

Working model:
- one `graph_evidence` table handles document links such as:
  - `MENTIONS`
  - `ASSERTS`
  - `QUOTES`
  - `SUPPORTS`
  - `CONTRADICTS`

Design implication:
- the likely V1 graph storage shape is:
  - `graph_entities`
  - `graph_documents`
  - `graph_claims`
  - `graph_evidence`
- evidence rows should carry enough metadata to differentiate:
  - document-to-entity links
  - document-to-claim links
  - quoted spans
  - extractor/version provenance

## Point 35: Do Not Materialize Derived Network Edges In V1

Core decision:
- do not store a separate derived `graph_edges` table in V1
- compute entity-to-entity network views from claims and evidence when needed

Reasoning:
- duplicated state is undesirable here
- a materialized edge table would introduce:
  - recomputation logic
  - staleness risk
  - synchronization complexity
- the ontology is still stabilizing, so derived network projections should remain flexible

Working model:
- canonical storage remains:
  - `graph_entities`
  - `graph_documents`
  - `graph_claims`
  - `graph_evidence`
- user-facing network edges are derived from:
  - claim subject/object/predicate structure
  - supporting and contradicting evidence
  - derivation metadata at query time or export time

Design implication:
- the graph should preserve one source of truth for evidence and claims
- if later performance or product needs demand it, a materialized edge projection can be added as a secondary optimization rather than a foundational table

## Point 36: Graph Processing Should Be Separate From Scrap Ingestion

Core decision:
- do not make ontology graph writes part of the inline scrap ingestion path
- treat graph processing as a separate downstream step

Reasoning:
- ingestion should remain focused on capturing and preserving source material
- the ontology layer will evolve quickly and should be able to reprocess scraps independently
- separating these concerns improves:
  - resilience
  - replayability
  - backfills
  - debugging
  - versioned extractor iteration

Working model:
- scrap ingestion:
  - stores source artifact
  - stores summary / screenshot / other enrichment as needed
- graph processing:
  - runs asynchronously or as a queued follow-up step
  - reads from `scraps`
  - writes to graph tables
  - can be rerun under new ontology or extractor versions

Design implication:
- graph state becomes a projection over the archival layer, not a required side effect of ingestion success
- ingestion remains operational even if graph extraction is temporarily noisy, broken, or under revision

## Point 37: Graph Processing Must Be Idempotent By Scrap And Version

Core decision:
- graph processing should be idempotent for a given:
  - `scrap_id`
  - extractor version
  - ontology version

Reasoning:
- safe replay and backfill behavior depends on deterministic reruns
- repeated processing of the same scrap under the same version should not create duplicate graph rows
- this is especially important because graph processing is intentionally downstream and rerunnable

Working model:
- rerunning the same scrap/version combination should:
  - no-op if the output is unchanged
  - or replace/update the prior run cleanly
- version changes should create new history or supersede prior graph interpretations without corrupting provenance

Design implication:
- graph tables will need stable keys or uniqueness rules tied to:
  - source scrap
  - evidence target
  - claim identity
  - processing version metadata
- idempotency is a core architectural requirement, not an implementation detail

## Point 38: Failed Graph Runs Should Preserve Partial Output

Core decision:
- preserve partial graph-processing output when a run fails
- do not require graph writes to be all-or-nothing in V1

Reasoning:
- partial output can still be valuable for:
  - debugging extractor behavior
  - inspecting borderline evidence
  - understanding where a run broke
  - comparing failure modes across versions
- in an iterative ontology system, losing all intermediate work on failure would make diagnosis slower and more opaque

Working model:
- a graph-processing run may leave behind:
  - partial entities
  - partial claims
  - partial evidence rows
- but the run must also carry explicit status metadata such as:
  - `run_status`
  - `is_partial`
  - `error_stage`
  - `error_message`

Design implication:
- partial outputs must be clearly marked so they are not mistaken for settled graph state
- query and UI layers should be able to filter to:
  - complete runs only
  - or include partial runs for audit/debug workflows

## Point 1: Documents Must Be First-Class Internally

Core decision:
- `scraps` / source documents are first-class objects in the system architecture

Reasoning:
- Investigative and reporting workflows need provenance, chronology, and auditability
- A clean entity-to-entity graph is useful, but insufficient on its own
- Reporters need to backtrack from any inferred relationship to the exact documents that mentioned, asserted, or implied it
- Time-aware story reconstruction depends on preserving the documentary trail, not just abstracting it away into entity links

Implications:
- The ontology should model documents as first-class nodes internally
- The user-facing graph may still emphasize entities, claims, and networks, but it must remain traceable back to documents
- We should prefer an evidence-bearing graph model over a purely abstract semantic graph

Working model:
- `Document -> MENTIONS -> Entity`
- `Document -> ASSERTS -> Claim`
- `Claim -> INVOLVES -> Entity`
- `Entity -> RELATED_TO -> Entity` should be derived or promoted from documentary evidence, not treated as the only primary layer

Why this is Point 1:
- This is a foundational architectural choice, not a minor extraction rule
- It determines how provenance, confidence, time, and narrative reconstruction will work across the whole ontology

Open question for next step:
- Should the ontology explicitly separate:
  - observed mentions
  - document claims/assertions
  - derived cross-document relationships
  or start with a flatter model?

## Point 2: Separate Mentions, Claims, and Derived Links

Core decision:
- The ontology should explicitly separate:
  - `mentions`
  - `claims/assertions`
  - `derived links`

Reasoning:
- A mention is not an assertion
- A document can name an entity without making a substantive claim about it
- Derived cross-document links should remain distinguishable from directly asserted claims
- This separation is necessary for investigative rigor, anomaly analysis, and transparent provenance

Implications:
- The graph should have at least three semantic layers:
  - documentary mention layer
  - documentary assertion layer
  - system-derived synthesis layer
- Any high-level entity-to-entity relationship should be explainable from underlying documents and claims

## Point 3: Claims Are First-Class Nodes

Core decision:
- Claims should be modeled as first-class nodes, not merely as typed edges

Reasoning:
- Claim nodes make it possible to:
  - represent quoted or reported assertions precisely
  - compare multiple sources making the same or competing claims
  - track confidence, contradiction, and evolution over time
  - attach provenance, dates, language, and evidentiary status directly to the claim itself

Why this matters:
- Investigative reporting often hinges on contested assertions, repeated allegations, and partial corroboration
- A graph that treats claims as nodes will be much more useful for journalism than one that collapses everything into entity edges

Working model:
- `Document -> MENTIONS -> Entity`
- `Document -> ASSERTS -> Claim`
- `Claim -> HAS_SUBJECT -> Entity`
- `Claim -> HAS_OBJECT -> Entity`
- `Claim -> HAS_PREDICATE -> ClaimType`
- `DerivedLink -> SUPPORTED_BY -> Claim`

Open question for next step:
- What kinds of claims should exist at the ontology level?

## Point 4: Start With Investigative Relationship Families

Initial claim families to optimize first:

- Employment / role
  - `WORKS_FOR`
  - `LEADS`
  - `ADVISES`
  - `SERVES_ON`
  - `FOUNDED`

- Association / affiliation
  - `ALIGNED_WITH`
  - `CONNECTED_TO`

- Funding / backing
  - `FUNDED_BY`
  - `BACKED_BY`
  - `SPONSORED_BY`
  - `SUPPORTED_BY`

- Membership
  - `MEMBER_OF`
  - `BELONGS_TO`
  - `PARTICIPATES_IN`

- Donations / contributions
  - `DONATED_TO`
  - `RECEIVED_DONATION_FROM`
  - `CONTRIBUTED_TO`

- Speech / publication / appearance
  - `SAID`
  - `WROTE`
  - `PUBLISHED`
  - `QUOTED`
  - `APPEARED_IN`
  - `APPEARED_WITH`
  - `MENTIONED`

- Ownership / control
  - `OWNS`
  - `CONTROLS`
  - `OPERATES`
  - `MANAGES`
  - `SUBSIDIARY_OF`

- Transactions / formal relationships
  - `CONTRACTED_WITH`
  - `INVESTED_IN`
  - `ACQUIRED`
  - `PARTNERED_WITH`

- Policy / institutional action
  - `SUED`
  - `BANNED`
  - `SANCTIONED`
  - `APPROVED`
  - `RAIDED`
  - `INVESTIGATED`

- Coordination / influence
  - `ORGANIZED_WITH`
  - `COORDINATED_WITH`
  - `AMPLIFIED`
  - `PROMOTED`
  - `LOBBIED`

- Location / jurisdiction
  - `BASED_IN`
  - `LOCATED_IN`
  - `OPERATES_IN`
  - `REGISTERED_IN`

Reasoning:
- These are high-value relationship families for journalism, network mapping, and hidden-structure discovery
- They are especially useful when tracing organizational ecosystems, ideological clusters, influence networks, and money flows
- They also create room for narrative reconstruction through public statements, publication trails, appearances, and institutional actions

Important caution:
- broad association relations are potentially dangerous because they can become junk-drawer edges
- the ontology should avoid vague relationship types that collapse distinct forms of connection into one ambiguous bucket

Open question for next step:
- How strict should `associated with` be?

## Point 5: Ban `IS_ASSOCIATED_WITH`

Core decision:
- Do not use `IS_ASSOCIATED_WITH` as an ontology relationship

Reasoning:
- It is too broad to be journalistically rigorous
- It invites weak, muddy, or conspiratorial graph connections
- It collapses many distinct realities into one vague edge
- It makes the graph harder to defend, interpret, and explain to end-users

Replacement approach:
- Prefer specific asserted relationships whenever possible:
  - `WORKS_FOR`
  - `MEMBER_OF`
  - `FUNDED_BY`
  - `DONATED_TO`
  - `APPEARED_WITH`
  - `QUOTED`
  - `PARTNERED_WITH`
  - `CONTRACTED_WITH`
  - etc.

- `ALIGNED_WITH` may be allowed, but only under stricter conditions:
  - it must be grounded in documentary evidence
  - it should be tied to explicit source support
  - it should not be used as a lazy fallback for uncertain extraction

Design implication:
- The ontology should force specificity
- When specificity is unavailable, the system should prefer:
  - a `MENTIONS` edge
  - a claim node with weak/conflicted status
  - or no semantic relationship at all

## Point 6: Initial Entity Types For V1

Accepted as first-class for V1:
- `Person`
- `Organization`
- `Project`
- `Artwork`
- `Tool`
- `Model`
- `Dataset`
- `Location`
- `Document`
- `Claim`

Rationale:
- `Person` and `Organization` remain the primary investigative actors
- `Project` captures campaigns, initiatives, operations, editorial efforts, investigations, and named undertakings without over-fragmenting into product-marketing distinctions
- `Artwork` deserves its own lane because artistic works circulate, influence, and get interpreted differently from campaigns or investigations
- `Tool` is preferred over a broader `Technology` label because it is more concrete and operationally legible
- `Model` deserves separation from `Tool`, especially for AI systems that behave as distinct technical, economic, and cultural actors
- `Dataset` deserves separation from both `Document` and `Tool`, especially for data journalism, evidence tracing, and source-quality analysis
- `Location` is important enough for jurisdiction, co-location, institutional footprint, and geographic story tracing to be first-class
- `Document` and `Claim` are core evidence-layer objects and must be explicitly modeled

Deferred / excluded for now:
- `Event`
- `Concept`

Current stance on `Event`:
- removed from V1 after checking the real exported corpus
- the current graph snapshot showed zero clean `Event` nodes and zero `Event` edges
- event-like strings are showing up mostly as noisy generic entities, titles, or article phrases rather than stable reusable nodes
- the current extractor heuristics for `Event` are also too loose to justify keeping the type
- if the corpus later proves that named public events deserve promotion, `Event` can return as a deliberate second-stage type

Current stance on `Concept`:
- not rejected outright
- still under consideration
- likely too mushy for open extraction unless constrained by curation or controlled vocabularies

Current stance on `Dataset`:
- promoted to a top-level V1 type
- should not be collapsed into `Tool` or `Document`
- subtype distinctions matter here more than they do for many other entity classes
- dataset size and shape are important top-level descriptive properties, not incidental metadata
- likely future subtype dimensions include:
  - tabular dataset
  - geospatial dataset
  - leaked dataset
  - government dataset
  - training dataset
  - benchmark dataset
  - archive / corpus
  - index / registry

Working dataset metadata priorities:
- `dataset_kind` / subtype
- row count
- column count
- file count
- byte size / storage size
- record granularity
- update cadence
- source origin
- access level

## Point 9: `Document` And `Dataset` Are Distinguished By Primary Use

Core decision:
- distinguish `Document` from `Dataset` by what the thing is primarily for

Working rule:
- `Document`
  - primarily meant to be read
- `Dataset`
  - primarily meant to be queried, analyzed, computed over, or otherwise used as structured data

Examples:
- article, report PDF, court filing, memo, transcript, newsletter issue -> `Document`
- CSV, parquet file, spreadsheet, registry, corpus, training set, benchmark, shapefile -> `Dataset`

Reasoning:
- this boundary matches actual journalistic workflow better than file format alone
- it keeps the ontology aligned with how an artifact functions in research, not just how it is packaged
- it prevents structured evidence sources from being hidden inside the generic `Document` bucket

Design implication:
- extraction and normalization should classify by primary use, not by superficial extension or MIME type alone
- document metadata may still describe attached files or embedded tables
- dataset metadata may still reference accompanying documentation

## Point 11: Dataset Kind And Scale Are First-Class Descriptors

Core decision:
- treat dataset subtype and dataset scale as first-class descriptive properties of `Dataset` nodes

Reasoning:
- for data journalism, a dataset is not fully legible without knowing both:
  - what kind of dataset it is
  - how large or structurally significant it is
- a `2.4GB` leaked archive and a `10k` row municipal registry are both datasets, but they imply very different reporting workflows, risks, and opportunities

Working model:
- `Dataset` nodes should carry prominent fields for:
  - kind / subtype
  - row count
  - column count
  - file count
  - byte size
  - structural notes

Design implication:
- dataset classification should not stop at "this is a dataset"
- the ontology should preserve enough top-level dataset description to support prioritization, filtering, and investigative reasoning

## Point 12: `Dataset` And `Model` Should Support Multi-Axial Typing

Core decision:
- do not force `Dataset` or `Model` into a single subtype label
- allow multiple orthogonal descriptors to coexist on the same node

Reasoning:
- datasets and models are often best understood through overlapping dimensions rather than one exclusive class
- forcing a single subtype would erase useful distinctions that matter for reporting and analysis

Examples:
- a dataset may be:
  - `government`
  - `geospatial`
  - `tabular`
  - `archive`
- a model may be:
  - `foundation`
  - `vision`
  - `open-weight`
  - `fine-tuned`

Design implication:
- subtype systems for `Dataset` and `Model` should be tag-like, structured, and multi-valued
- the ontology should support compositional description rather than exclusive buckets for these classes

## Point 10: Hybrids Should Be Split Into Linked Nodes, Not Dual-Typed

Core decision:
- when an artifact bundle contains both narrative and structured data, model them as separate linked nodes rather than one dual-typed object

Working rule:
- a report and its dataset should become:
  - one `Document` node
  - one `Dataset` node
- the same applies to similar hybrids such as:
  - documentation plus downloadable data
  - notebook/report plus underlying table export
  - repository plus bundled dataset

Reasoning:
- dual-typing creates ambiguity at the exact point where the ontology should become more precise
- splitting them preserves function, provenance, and reuse
- it also makes it easier to express relationships like:
  - `Document -> DESCRIBES -> Dataset`
  - `Dataset -> DOCUMENTED_BY -> Document`
  - `Tool -> USES -> Dataset`

Design implication:
- extraction and normalization should be willing to emit multiple linked nodes from one scrap when the source clearly contains distinct document and dataset artifacts

Design implication:
- the ontology should begin with a relatively tight actor/evidence model
- abstract semantic categories should be added only when they improve reporting workflows more than they add ambiguity

## Point 7: `Location` Stays First-Class And Should Usually Be Promoted To Nodes

Core decision:
- `Location` remains a top-level ontology type
- real place references should usually be promoted into `Location` nodes rather than being treated only as document metadata

Reasoning:
- place is often part of the hidden structure of a story, not just background context
- geographic recurrence can reveal:
  - jurisdictional overlap
  - institutional clustering
  - operational footprint
  - shared scenes of action
  - narrative threads across otherwise disconnected scraps
- this aligns with an investigative stance that treats places as durable coordinates in the network, not decorative attributes

Working principle:
- named places should generally become nodes when they refer to real locations in the world
- document metadata can still store raw place strings and geocoding details
- ontology-level `Location` nodes provide the reusable canonical place layer above that metadata

Examples of likely `Location` nodes:
- `Los Angeles`
- `Gaza`
- `Silicon Valley`
- `The Pentagon`
- `Rikers Island`
- `Mar-a-Lago`

## Point 8: `Person` Includes Handles, Pseudonyms, And Online Identities

Core decision:
- keep `Person` broad enough to include:
  - legal names
  - pseudonyms
  - screen names
  - account handles
  - online identities that function as person-like actors

Reasoning:
- investigative corpora often encounter people first through usernames, aliases, or partial identities rather than stable legal names
- forcing a separate ontology type too early would fragment the graph and slow useful linkage work
- it is better to represent these as person-like actors first and deduplicate or relate them later when stronger identity evidence emerges

Working principle:
- if a handle or pseudonym behaves like a person in the corpus, it can live as a `Person`
- aliases, uncertain identity links, and later deduplication can connect multiple representations when needed

Design implication:
- identity resolution should support:
  - alias links
  - possible-same-person links
  - later canonical merges
  without requiring a separate top-level type for handles in V1

## Point 7: `Project`, `Artwork`, `Tool`, And `Model` Stay Separate

Core decision:
- `Project`, `Artwork`, `Tool`, and `Model` should remain distinct top-level entity types

Definitions:

- `Project`
  - non-technical or mixed-domain undertaking
  - campaign, initiative, program, operation, effort, editorial series, investigation, named undertaking, or organized body of work
  - may include technical components, but is not primarily classified by being a software/tooling artifact

- `Artwork`
  - artistic or cultural work with a distinct identity as a work
  - may include visual art, music, film, installations, performances, books, or other authored creative works
  - should not be collapsed into `Project` just because it involves effort or production

- `Tool`
  - software, code repository, technical platform, application, framework, utility, protocol implementation, or operational technical system
  - often produced, maintained, or controlled by an organization

- `Model`
  - a trained computational model, especially AI/ML models that behave as distinct technical, economic, or cultural entities
  - may be embedded in tools or platforms, but should not be collapsed into them

Examples:
- `Project 2025` -> `Project`
- a reporting initiative -> `Project`
- an art installation, film, album, or zine -> `Artwork`
- `jina-ai/clip-as-service` -> `Tool`
- a code repo, CLI, framework, or platform product -> `Tool`
- `GPT-4o`, `Claude`, or `Llama 3` -> `Model`

Reasoning:
- investigative work often needs to distinguish between:
  - an undertaking or organized effort
  - a creative work
  - the technical artifact used to execute, support, or scale that effort
- many organizations produce tools, and many tools sit inside larger projects
- models now behave as distinct objects of reporting, governance, branding, deployment, and influence
- collapsing these types would make it harder to map operational relationships clearly

Design implication:
- extraction and normalization rules should prefer:
  - `Artwork` for authored creative works
  - `Tool` for technical artifacts
  - `Model` for AI/ML model systems
  - `Project` for broader efforts, campaigns, programs, and named undertakings

## Point 8: `Publication` Is Not A Top-Level Entity In V1

Core decision:
- `Publication` should not be a separate top-level entity type in V1

Modeling approach:
- media outlets, newsletters, magazines, channels, and similar publishing bodies should generally be modeled as `Organization`
- individual articles, posts, newsletters, episodes, reports, and other source artifacts should be modeled as `Document`

Reasoning:
- this avoids duplicating the same real-world actor as both a publication and an organization
- it keeps the ontology tighter and easier to normalize
- it matches the investigative need to distinguish:
  - the publishing body
  - the documentary artifact it produced

Examples:
- `Semafor` -> `Organization`
- `404 Media` -> `Organization`
- a specific Semafor article -> `Document`
- a specific newsletter issue -> `Document`

Design implication:
- publishing activity should be captured through relationships, not a separate top-level publication entity
- likely relationships include:
  - `PUBLISHED`
  - `WROTE`
  - `QUOTED`
  - `APPEARED_IN`

## Point 9: `Concept` Should Be Controlled, Not Open-Extracted

Core decision:
- `Concept` should not be open-extracted in V1
- if included, it should come from a constrained, pre-seeded vocabulary

Working idea:
- seed a bounded concept layer, possibly on the order of `128-1024` concepts
- derive that vocabulary from existing notes, research interests, reporting domains, philosophical traditions, political frameworks, and recurring narrative abstractions

Reasoning:
- freeform concept extraction will likely turn the ontology into abstract soup
- it does not fit the otherwise sober, evidence-driven, investigative posture of the graph
- a controlled concept layer can still be valuable for analysis, clustering, and narrative framing without weakening ontological discipline

Design implication:
- `Concept` should behave more like a curated analytical overlay than a default extracted entity class
- concepts should be introduced intentionally, normalized aggressively, and expanded only with editorial control

Current stance:
- `Concept` remains deferred from the core V1 extraction schema
- likely future role: controlled vocabulary / overlay layer

## Point 10: Every Claim Needs Explicit Evidentiary Status

Core decision:
- every `Claim` should carry an explicit evidentiary / epistemic status from day one

Why this is mandatory:
- journalism, OSINT, and investigative workflows depend on distinguishing:
  - direct observation
  - reported assertions
  - quotations
  - allegations
  - inference
  - contradiction
  - uncertainty
- two documents may reference the same underlying proposition with very different evidentiary weight
- without explicit status, the graph will flatten radically different kinds of statements into misleading equivalence

Initial direction:
- the status enum should be designed intentionally, not improvised
- it should borrow discipline from journalism, intelligence analysis, and source-evaluation practice
- we should separate:
  - what kind of claim act this is
  - how reliable / direct the evidence is
  - whether the claim is contested or contradicted

Candidate statuses for discussion:
- `observed`
- `asserted`
- `reported`
- `quoted`
- `alleged`
- `derived`
- `contradicted`
- `uncertain`

Likely design implication:
- one enum may not be enough
- we may eventually want at least two dimensions:
  - claim mode / evidentiary posture
  - verification / confidence / contestation state

Working principle:
- the ontology should preserve epistemic nuance, not collapse it

## Point 11: Separate `claim_mode` From `claim_state`

Core decision:
- `Claim` should have at least two distinct evaluative dimensions:
  - `claim_mode`
  - `claim_state`

Definitions:

- `claim_mode`
  - what kind of statement act the claim represents
  - examples:
    - `observed`
    - `quoted`
    - `reported`
    - `asserted`
    - `alleged`
    - `derived`

- `claim_state`
  - the current standing of the claim in the system
  - examples:
    - `unreviewed`
    - `plausible`
    - `supported`
    - `contested`
    - `contradicted`
    - `uncertain`

Reasoning:
- a statement can be accurately quoted and still be false
- a derived inference can be well supported without being directly asserted in any one document
- an allegation can be solidly documented as an allegation without being established as fact

Design implication:
- the graph should support explicit evidentiary relationships around claims, not just internal status fields
- likely relationship patterns include:
  - `Document -> ASSERTS -> Claim`
  - `Document -> QUOTES -> Claim`
  - `Document -> CONTRADICTS -> Claim`
  - `Document -> SUPPORTS -> Claim`
  - `Claim -> CONFIRMED_BY -> Document`
  - `Claim -> CONTESTED_BY -> Document`
  - `Claim -> DERIVED_FROM -> Claim`

Working principle:
- the status of a claim should be explainable from provenance-bearing graph structure, not only from a scalar field

## Point 12: Source Reliability Lives On `Document`

Core decision:
- reliability / credibility metadata should live on `Document`, not primarily on `Claim`

Reasoning:
- the document is the provenance-bearing source artifact
- source quality, directness, editorial posture, and documentary trustworthiness are attributes of the source material itself
- claims should retain:
  - `claim_mode`
  - `claim_state`
  - provenance links
  - support / contradiction structure
- but not necessarily a separate redundant credibility score as a first move

Design implication:
- `Document` should carry source-evaluation metadata
- `Claim` should derive its standing from:
  - originating documents
  - supporting documents
  - contradicting documents
  - review status and editorial interpretation

Working principle:
- trust starts with source artifacts
- claim standing is built from evidence, not guessed in isolation

## Point 13: `claim_state` Should Be Hybrid

Core decision:
- `claim_state` should be managed through a hybrid model

Meaning:
- the system may propose a claim state
- a human/editor may review, override, or lock that state
- the ontology should preserve whether the current state is:
  - machine-inferred
  - human-reviewed
  - human-overridden
  - editorially locked

Reasoning:
- the system is useful for triage and scale
- investigative reporting requires human judgment for consequential interpretations
- editorial intervention should not destroy provenance about how a claim arrived at its current standing

Design implication:
- claim-state governance should be explicit, not hidden
- the graph should preserve both:
  - current effective state
  - how that state was established

## Point 14: Editorial Review Lives In Metadata For V1

Core decision:
- editorial review / override activity should live in claim metadata for V1, not as first-class review-event nodes

Examples:
- `reviewed_by`
- `reviewed_at`
- `overridden_by`
- `overridden_at`
- `locked_by`
- `locked_at`
- `state_origin`

Reasoning:
- this preserves governance and auditability without overcomplicating the first ontology version
- if newsroom/editorial workflows become heavier later, review-event nodes can be introduced as a second-stage extension

Working principle:
- keep the first implementation sober and tractable
- preserve enough metadata so future migration to richer review-event modeling remains possible

## Point 15: Predicates Must Come From A Hand-Tuned Approved Registry

Core decision:
- only approved predicates may exist in the ontology
- the model should not invent production predicates
- ontology quality should come from deliberate predicate design, not downstream cleanup of improvisation

Reasoning:
- freeform predicates are one of the fastest ways to destroy graph consistency
- even a provisional predicate lane would create pressure toward silent ontology drift
- for this project, it is better to work hard up front and make the predicate set comprehensive and editorially defensible

Design implication:
- extraction must map claims onto the approved predicate registry
- if a document does not support a known predicate cleanly, the system should:
  - fall back to `MENTIONS`
  - preserve the claim text for review
  - or produce no semantic claim edge

Working principle:
- predicate precision is a core editorial asset
- ontology drift is a product failure, not a minor inconvenience

## Point 16: The Approved Predicate Registry Should Be Rich, Not Minimal

Core decision:
- the approved predicate registry should likely land in the rough range of `64-128` predicates

Reasoning:
- the ontology is being designed for investigative, journalistic, and network-analysis use
- an overly compressed predicate set would force too many distinct realities into broad buckets
- that would weaken anomaly detection, money-flow mapping, influence analysis, and narrative reconstruction

Design implication:
- the registry should be:
  - hand-tuned
  - comprehensive
  - internally organized
  - extraction-friendly

Likely requirement:
- predicates will need families, definitions, and mapping guidance
- a flat unstructured list of 64-128 predicates would be too brittle without:
  - category grouping
  - exact definitions
  - allowed subject/object type combinations
  - examples and anti-examples

Working principle:
- this should be a serious editorial vocabulary, not a toy schema

## Point 17: Predicates Use Canonical Direction Only

Core decision:
- predicates should exist in one canonical direction only
- inverse views should be derived later in query logic, UI logic, or graph projections

Examples:
- keep `Person -[WORKS_FOR]-> Organization`
- do not also define `Organization -[EMPLOYS]-> Person` as an equal first-class predicate in V1

Reasoning:
- this sharply reduces ontological duplication
- it keeps the approved predicate registry more tractable even at `64-128` predicates
- it simplifies extraction instructions and review logic
- it makes normalization and backfilling materially easier

Design implication:
- every approved predicate will need a declared canonical direction
- inverse language can still exist in prompts and parsing, but must normalize to the canonical predicate

## Point 18: Every Predicate Needs Type Constraints

Core decision:
- every approved predicate should declare allowed subject/object type pairings

Reasoning:
- a clean predicate list is not enough if predicates can attach to nonsensical type combinations
- type constraints create a real ontological guardrail during extraction, normalization, and review
- this is especially important in a graph that includes:
  - actor entities
  - evidence entities
  - technical entities
  - location/document nodes

Working model:
- each predicate should declare:
  - canonical direction
  - allowed subject types
  - allowed object types
  - examples
  - anti-examples

Enforcement behavior:
- if extraction proposes an illegal type pairing, the system should not silently accept it
- instead it should:
  - reject the claim
  - remap it if a better predicate exists
  - downgrade to `MENTIONS`
  - or route it for review

## Point 19: Predicates May Support Multiple Allowed Pairings

Core decision:
- a single predicate may support multiple subject/object pairings when the semantics are genuinely the same

Example:
- `FUNDS` may legitimately support:
  - `Person -> Organization`
  - `Organization -> Project`
  - `Organization -> Event`

Reasoning:
- this keeps the ontology rich without exploding into unnecessary predicate variants
- separate predicates should only be created when the meaning actually changes, not merely because the type pairing changes

Working principle:
- use one predicate across multiple pairings when the underlying semantics are stable
- split predicates only when the meaning materially diverges

## Point 20: Keep Document And Semantic Predicates In Separate Registries

Core decision:
- maintain two predicate registries rather than one unified list:
  - `document predicates`
  - `semantic predicates`

Reasoning:
- evidence-layer verbs and semantic-network verbs do not play the same ontological role
- `Document -> QUOTES -> Person` is fundamentally different from `Person -> WORKS_FOR -> Organization`
- keeping them together would blur provenance mechanics with world-model mechanics
- the split will make extraction prompts, normalization, validation, and UI behavior easier to reason about

Working model:
- `document predicates`
  - govern how documents relate to entities, claims, and source artifacts
  - examples:
    - `MENTIONS`
    - `ASSERTS`
    - `QUOTES`
    - `PUBLISHES`
    - `AUTHORS`

- `semantic predicates`
  - govern the meaning-bearing relationships among people, organizations, projects, tools, and locations
  - examples:
    - `WORKS_FOR`
    - `FUNDS`
    - `MEMBER_OF`
    - `CONTRACTS_WITH`
    - `LOCATED_IN`
    - `DEVELOPS`

Design implication:
- each registry should have its own:
  - review rules
  - allowed type pairings
  - extraction guidance
  - promotion / derivation logic
- `document predicates` should be treated as evidence-bearing and provenance-critical
- `semantic predicates` should be treated as the curated network vocabulary used for investigative analysis

## Point 21: Fold `REPORTS` Into `ASSERTS`

Core decision:
- do not keep separate `REPORTS` and `ASSERTS` predicates in the document registry
- use `ASSERTS` as the canonical document-to-claim predicate for now

Reasoning:
- the distinction is intellectually real, but too fine-grained for the first operational registry
- keeping both would add review complexity before the broader document registry is even stabilized
- claim nuance can still be carried by:
  - `claim_mode`
  - source text
  - quotation structure
  - document reliability metadata

Design implication:
- normalize any would-be `REPORTS` edge to `ASSERTS`
- reserve `QUOTES` for cases where the document is explicitly relaying someone else's words
- let downstream claim interpretation distinguish:
  - direct documentary assertion
  - reported allegation
  - summarized reporting
  without multiplying top-level document predicates too early
