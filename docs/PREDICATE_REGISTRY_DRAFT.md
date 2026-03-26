# Predicate Registry Draft

Date: 2026-03-25

Status:
- early hand-tuned draft
- grounded in current Scrapbook corpus and exported entity graph
- not yet final

## Corpus Grounding

Relationship-bearing scraps are currently dominated by:
- YouTube pages
- GitHub pages
- investigative/news articles
- government/institutional pages
- some commerce/product pages

Representative domains from current corpus:
- `youtube.com`
- `github.com`
- `nytimes.com`
- `wired.com`
- `404media.co`
- `theintercept.com`
- `politico.com`
- `semafor.com`
- `.gov` pages
- some shopping/product sites like `etsy.com`

## What The Current Extractor Gets Wrong

Current top predicates include:
- `HAS_SECTION`
- `HAS_FEATURE`
- `HAS_URL`
- `PROVIDES`
- `OFFERS`
- `INCLUDES`
- `IS_A`

These mostly reflect:
- page chrome
- navigation menus
- product marketing copy
- generic page structure

They are not a good foundation for an investigative ontology.

## Predicates To Ban From The Semantic Claim Layer

These may still exist as metadata or document parsing artifacts, but should not be approved semantic predicates:

- `HAS_SECTION`
- `HAS_SUBSECTION`
- `HAS_FEATURE`
- `OFFERS_FEATURE`
- `HAS_URL`
- `HAS_SOCIAL_MEDIA`
- `HAS_POLICY`
- `HAS_OBJECTIVE`
- `HAS_TITLE`
- `HAS_COMPONENT`
- `HAS_CATEGORY`
- `HAS_PRODUCT_CATEGORY`
- `HAS_RESOURCE`
- `HAS_EXAMPLE`
- `LISTS`
- `INCLUDES`
- `INCLUDE`
- `CONTAINS`
- `HAS`
- `IS`
- `FOR`
- `TYPE_OF`
- `IS_A_TYPE_OF`
- `PUBLISHED_ON` as a semantic relation

## Predicates We Should Salvage Or Refine From Current Data

Observed in real scraps and worth keeping in more disciplined form:

- `WORKS_FOR`
- `FOUNDED_BY` / `FOUNDER_OF`
- `CO_FOUNDED_BY`
- `MEMBER_OF`
- `REPRESENTS`
- `FUNDED`
- `INVESTED_IN`
- `DONATED_TO`
- `PARTNERS_WITH`
- `CONTRACTED_WITH`
- `SUPPLIES`
- `DEVELOPS`
- `USES`
- `LOCATED_IN`
- `PUBLISHES`
- `AUTHORED`
- `QUOTED`
- `INTERVIEWED_ON`
- `DETAINS`
- `TARGETS`
- `PROPOSES`
- `RESTRICTED_ACCESS_TO`

## Draft Predicate Families

This draft deliberately leans richer rather than smaller. It is intended as a serious editorial vocabulary, not a toy schema.

### 1. Document And Speech Acts

- `MENTIONS`
- `ASSERTS`
- `QUOTES`
- `SAYS`
- `WRITES`
- `PUBLISHES`
- `AUTHORS`
- `INTERVIEWS`
- `APPEARS_IN`
- `APPEARS_WITH`
- `FEATURES`

Grounded examples:
- article by Carl Zimmer
- Nick Denton interviewed on a podcast
- YouTube video featuring a speaker

### 2. Role, Employment, And Organizational Position

- `WORKS_FOR`
- `LEADS`
- `FOUNDS`
- `CO_FOUNDS`
- `ADVISES`
- `SERVES_ON`
- `MEMBER_OF`
- `REPRESENTS`
- `EMPLOYS`
- `MANAGES`

Grounded examples:
- `Carl Zimmer -> WORKS_FOR -> New York Times`
- `Nick Denton -> FOUNDED -> Gawker`

### 3. Funding, Finance, And Material Support

- `FUNDS`
- `FUNDED_BY`
- `BACKS`
- `BACKED_BY`
- `DONATES_TO`
- `RECEIVES_DONATION_FROM`
- `INVESTS_IN`
- `BACKS_FINANCIALLY`
- `GRANTS_TO`
- `SPONSORS`
- `CONTRACTS_WITH`
- `PAYS`

Grounded examples:
- `Jeffrey Epstein -> INVESTS_IN -> Valar Ventures`
- `Israeli Ministry of Defense -> FUNDS -> MIT Research Projects`
- `USDA -> PROVIDES_FUNDING_TO -> Maine DACF`

### 4. Ownership, Control, Production, And Operation

- `OWNS`
- `CONTROLS`
- `OPERATES`
- `ADMINISTERS`
- `DEVELOPS`
- `PRODUCES`
- `SUPPLIES`
- `USES`
- `DEPLOYS`
- `HOSTS`
- `MAINTAINS`
- `ENABLES`

Grounded examples:
- `Anthropic -> DEVELOPS -> Claude`
- `Elbit Systems -> SUPPLIES -> Israeli Military Drones`
- `YouTube -> HOSTS -> Video` but likely only at document/metadata layer

### 5. Coordination, Alignment, And Network Behavior

- `PARTNERS_WITH`
- `COORDINATES_WITH`
- `ORGANIZES_WITH`
- `ALIGNED_WITH`
- `COLLABORATES_WITH`
- `AMPLIFIES`
- `PROMOTES`
- `LOBBIES`
- `SUPPORTS`
- `OPPOSES`

Grounded examples:
- `MIT -> PARTNERS_WITH -> Elbit Systems`
- `AI critics -> FUNDS / INFLUENCES -> AI coverage`

Note:
- `ALIGNED_WITH` should remain tightly constrained and source-grounded
- `IS_ASSOCIATED_WITH` is banned

### 6. Policy, Enforcement, And Institutional Action

- `PROPOSES`
- `APPROVES`
- `BANS`
- `TARGETS`
- `RESTRICTS_ACCESS_TO`
- `INVESTIGATES`
- `SUES`
- `DETAINS`
- `DEPORTS`
- `SANCTIONS`
- `RAIDS`
- `CITES`

Grounded examples:
- `FCC -> TARGETS -> DJI`
- `MIT -> RESTRICTS_ACCESS_TO -> Internal Grant Database`
- `ICE -> DETAINS -> People`

### 7. Location, Jurisdiction, And Operational Footprint

- `LOCATED_IN`
- `BASED_IN`
- `OPERATES_IN`
- `REGISTERED_IN`
- `SHIPS_TO`
- `BORDERED_BY`
- `GOVERNS`
- `JURISDICTION_OVER`

Grounded examples:
- `Anthropic -> LOCATED_IN -> San Francisco`
- `New York State -> LOCATED_IN -> United States`

### 8. Tooling, Technical Stack, And Software Relations

- `BUILT_WITH`
- `WRITTEN_IN`
- `DEPENDS_ON`
- `INTEGRATES_WITH`
- `COMPATIBLE_WITH`
- `USES_MODEL`
- `USES_PROTOCOL`
- `USES_API`
- `HOSTED_ON`
- `FORKED_FROM`
- `EXTENDS`
- `AUTOMATES`

Grounded examples:
- GitHub repositories
- MCP servers
- code artifacts written in C, Python, etc.

### 9. Deferred Event Predicates

These are intentionally deferred for now.

Reasoning:
- the current corpus does not yet produce clean, stable `Event` nodes
- event-like material is mostly landing as noisy generic entities, titles, and one-off phrases
- these predicates may become useful later, but they are not well grounded enough for the first approved cut

Deferred examples:
- `ATTENDS`
- `SPEAKS_AT`
- `HOSTS_EVENT`
- `ORGANIZES_EVENT`
- `PARTICIPATES_IN`
- `OCCURS_IN`
- `ANNOUNCES_AT`
- `PROTESTS`

## Strong Candidate Predicates For The First Real Cut

If we had to start the hand-tuning pass today, these look like especially high-value keepers:

- `MENTIONS`
- `ASSERTS`
- `QUOTES`
- `PUBLISHES`
- `AUTHORS`
- `WORKS_FOR`
- `FOUNDS`
- `CO_FOUNDS`
- `LEADS`
- `MEMBER_OF`
- `REPRESENTS`
- `FUNDS`
- `FUNDED_BY`
- `DONATES_TO`
- `INVESTS_IN`
- `CONTRACTS_WITH`
- `PARTNERS_WITH`
- `OWNS`
- `CONTROLS`
- `OPERATES`
- `DEVELOPS`
- `SUPPLIES`
- `USES`
- `RESTRICTS_ACCESS_TO`
- `TARGETS`
- `DETAINS`
- `INVESTIGATES`
- `PROPOSES`
- `LOCATED_IN`
- `BASED_IN`
- `OPERATES_IN`
- `WRITTEN_IN`
- `INTEGRATES_WITH`
- `HOSTED_ON`
- `APPEARS_IN`
- `APPEARS_WITH`
- `SPEAKS_AT`

## Immediate Lessons From The Corpus

1. We need a hard split between:
   - semantic predicates
   - page-structure/document metadata

2. We should formalize two separate approved registries:
   - `document predicates`
   - `semantic predicates`

3. `document predicates` should carry provenance semantics first.
   - examples:
     - `MENTIONS`
     - `ASSERTS`
     - `QUOTES`
     - `PUBLISHES`
     - `AUTHORS`

4. `REPORTS` should not survive as its own document predicate in V1.
   - treat it as a normalization target into `ASSERTS`
   - preserve reporting nuance through `claim_mode`, quoted spans, and source text instead
5. News and investigative reporting already yield good seeds for:
   - money flows
   - staffing and governance
   - institutional action
   - quoted/public statements

6. GitHub and technical pages justify a real technical predicate family.

7. YouTube and media pages justify appearance/publication predicates, but also produce the most page-chrome junk.

8. Government pages justify:
   - administrative
   - jurisdictional
   - policy
   - enforcement predicates

## Open Design Questions

- Should predicates be stored only in one canonical direction?
- Which predicates belong in:
  - the `document` registry
  - versus the `semantic` registry
- Which predicates should be claim-only, not promoted directly to derived network edges?
