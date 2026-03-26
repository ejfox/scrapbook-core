# Relationship Extraction Audit: Phase 1

Date: 2026-03-25

## Sample

- Source: `pinboard`
- Mode: dry-run re-extraction
- Batch size: `20`
- Artifact: [data/relationship-audit/pinboard-sample-20.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/pinboard-sample-20.clean.json)

## Summary

- `20` scraps processed
- `19` scraps produced at least one relationship
- `21` total relationships extracted
- `16` relationships were `CREATED`
- `14` relationships were title-derived `creator -> artwork/video-title`
- `3` relationships were suspicious `WORKS_FOR`

## Main Failure Pattern

The sample was dominated by YouTube watch-later content embedded in Pinboard. The extractor is currently treating video/channel metadata as if it were investigative semantic content.

This produces low-value edges like:

- `Pixlriffs -> CREATED -> "Setting Up Storage & House Details..."`
- `Bon Appétit -> CREATED -> "Pro Chefs Upgrade Popcorn..."`
- `NYT Cooking -> CREATED -> "Is Cooking for Yourself Worth It?..."`

These are not exactly wrong, but they are weak graph material for the intelligence/reporting use case. They mostly restate page titles.

## More Serious Errors

### Hallucinated or cross-document leakage

- `Operators Tactics Episode 1 (Radio Comms)` produced:
  - `Trevor Paglen -> CREATED -> ImageNet Roulette`

This appears unrelated to the scrap title and is a strong sign the model can still leak memorized or irrelevant facts when the page content is thin or noisy.

### Over-interpretive employment claims

Examples:

- `Peter Cook -> WORKS_FOR -> Louisiana Channel`
- `J. Kenji López-Alt -> WORKS_FOR -> The crumpet shop in pike place market`
- `Alan Rockefeller -> WORKS_FOR -> Mushroom Appreciation`

These are likely inferred from appearances, mentions, or channel context rather than explicit employment evidence.

## Interpretation

The ontology itself is in better shape than before. The extractor now emits typed, constrained predicates and uses OpenRouter correctly. The remaining weakness is source-specific overreach.

This is now primarily a precision problem:

- too much extraction from page title / channel metadata
- too much willingness to turn video authorship into graph claims
- too much willingness to promote mention/appearance into `WORKS_FOR`

## Recommended Next Patch Set

### 1. Add source/modality-aware suppression rules

For YouTube-like scraps:

- do not emit `CREATED` solely from page title + channel attribution
- require transcript or description evidence beyond the title shell
- if evidence is only title metadata, prefer no semantic edge

### 2. Strengthen evidence anchoring

Require evidence snippets to appear verbatim in the source content or in a clearly extractable field, instead of allowing the model to paraphrase unsupported claims.

### 3. Tighten predicate guidance for appearances

Disallow mapping “featured on”, “appeared in”, or “mentioned by” into:

- `WORKS_FOR`
- `LEADS`
- `MEMBER_OF`

unless the source explicitly states formal affiliation.

### 4. Add a low-value edge filter

Down-rank or drop edges where:

- target is effectively the document title
- predicate is `CREATED`
- source is just the channel/publisher

This may still be useful in a media graph later, but it is not high-priority reporting signal right now.

### 5. Run a mixed-source sample next

The next review batch should not be only recent Pinboard/YouTube-adjacent scraps. It should intentionally sample:

- investigative/news article pages
- GitHub pages
- government documents
- ordinary web articles

to distinguish source-specific failure from general ontology failure.

## Phase 2 Result

After adding source-aware suppression for thin YouTube/video shell pages and stricter formal-affiliation filtering:

- Re-run artifact: [data/relationship-audit/pinboard-sample-20-phase2.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/pinboard-sample-20-phase2.clean.json)
- Same `20`-scrap batch now produced:
  - `0` non-empty scraps
  - `0` relationships

That is the correct result for this specific batch.

Interpretation:

- the previous signal was almost entirely modality noise
- the new suppression is successfully preventing title/channel shells from polluting the graph
- the next evaluation should focus on mixed-source documents that actually contain article/report-style text

## Mixed-Source Review Batch

Artifacts:

- [data/relationship-audit/mixed-review-batch-v2.stdout.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v2.stdout.json)
- [data/relationship-audit/mixed-review-batch-v2-results.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v2-results.clean.json)
- [data/relationship-audit/mixed-review-batch-v5-results.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v5-results.clean.json)
- [data/relationship-audit/mixed-review-batch-v7-results.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v7-results.clean.json)
- [data/relationship-audit/mixed-review-batch-v8-results.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v8-results.clean.json)

Batch composition:

- `4` news articles
- `4` GitHub/code research pages
- `3` text-bearing Arena items

### Mixed-source results

- `news`: `2/4` non-empty, `4` total relationships
- `codeResearch`: `3/4` non-empty, `5` total relationships
- `arenaText`: `3/3` non-empty, `3` total relationships

### What looks good

- YouTube shell noise is no longer dominating the batch.
- Arena art/reference items are yielding plausible `CREATED` edges.
- GitHub model/tool relations can work when the page is explicit enough.

### What still needs work

#### 1. News recall is still weak

Three of the four news items produced either nothing or only one shallow edge.

This suggests one of:

- content extraction is still too lossy for article pages
- the prompt is too conservative for long-form reporting
- the ontology lacks some of the predicates these stories naturally want

#### 2. Role labels are still being mistaken for organizations

Example:

- `Amy Reichert -> WORKS_FOR -> Licensed private investigator`

This should be rejected. It is an occupation/descriptor, not an organization node.

#### 3. Some event/media-production edges are still low-value

Examples:

- `Nick Shirley -> CREATED -> Video purporting to expose...`
- `Amy Reichert -> CREATED -> Videos claiming a similar scheme...`

These are semantically plausible but low-value for the reporting graph. They describe content production inside a story, not durable network structure.

#### 4. GitHub mode needs its own judgment rules

Examples:

- `ttylag -> INTEGRATES_WITH -> Homebrew`
- `ttylag -> INTEGRATES_WITH -> Go`
- `Mitchellh -> FOUNDED -> Vouch`

These are not catastrophic, but they show that repository pages want specialized logic:

- install/distribution channels are not the same as integrations
- maintainer/developer language is not always `FOUNDED`

#### 5. Generic technical nouns are still typed too literally

Examples:

- `Datacenters -> USES -> Gas-fired power`
- `DHS officers -> USES -> Less lethal weapons`

These may be textually grounded, but they are not yet the investigative-level actor/entity choices we want.

## Next Tuning Targets

### 1. Add role/occupation suppression

Reject organization targets like:

- `licensed private investigator`
- `columnist`
- `researcher`
- similar profession-only labels

### 2. Add low-value media-production suppression for news pages

On article/report pages, down-rank or drop `CREATED` edges when the target is just a descriptive phrase for a video or content item inside the story.

### 3. Add GitHub-specific extraction guidance

For repository pages:

- prefer `DEVELOPS` over `FOUNDED` for maintainers/authors
- avoid treating install methods as `INTEGRATES_WITH`
- treat hosting/distribution separately from semantic integration

### 4. Revisit content extraction for long-form article pages

If the article text arriving at relationship extraction is too summary-like or lossy, news recall will stay weak no matter how good the ontology gets.

## Phase 3-5 Hardening Result

This pass implemented:

- role and occupation suppression for formal affiliation predicates
- low-value media-production suppression on article/report pages
- GitHub-specific extraction and post-normalization rules
- raw-content-first extraction, with summary only as supplemental context
- anchored-evidence filtering for article-like and GitHub documents

Artifacts:

- [data/relationship-audit/mixed-review-batch-v5-results.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v5-results.json)
- [data/relationship-audit/mixed-review-batch-v5-results.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v5-results.clean.json)

### Before/after delta

- `v2`: `12` relationships across `8` non-empty scraps
- `v5`: `5` relationships across `4` non-empty scraps

Removed between `v2` and `v5`:

- occupation-target hallucinations like `Amy Reichert -> WORKS_FOR -> Licensed private investigator`
- low-value article-page `CREATED` edges for generic videos/posts
- GitHub install/distribution noise like `INTEGRATES_WITH -> Homebrew` and `HOSTED_ON -> cbrunnkvist/tap`
- copied-example recovery leakage like `Los Angeles -> LOCATED_IN -> California`

### Current `v5` signal

- `Rubén Castillo -> LEADS -> Illinois Accountability Commission`
- `Vouch -> USES -> Nushell`
- `David Cain -> CREATED -> Your Lifestyle Has Already Been Designed`

These are plausibly useful graph edges.

### Residual issues after `v5`

#### 1. Generic actor typing is still weak

Example:

- `Federal officers -> USES -> Less lethal weapons`

The edge is textually grounded, but `Federal officers` is still a mushy actor class rather than a clean canonical entity.

#### 2. GitHub recall may now be too conservative

Examples that dropped out:

- `MLXAudio -> DEVELOPS -> Sortformer`
- `ttylag -> HOSTED_ON -> GitHub`

The next pass should recover high-value repository relations without reopening Homebrew/install noise.

#### 3. Some operational claims still need a stronger claim layer

Example:

- `Arizona Department of Corrections -> DEVELOPS -> inmate management software`

This may be true, but it still wants a clearer distinction between semantic fact, reported claim, and quoted allegation.

## Phase 6 LLM Reviewer Pivot

This pass deliberately shifted away from regex-heavy semantic pruning and toward a second LLM adjudication layer.

Current architecture:

- extraction LLM proposes typed candidate relationships
- trivial deterministic cleanup still removes obvious junk
- review LLM adjudicates candidate relationships with source-aware rules
  - generic actor labels
  - GitHub installation/distribution noise
  - article/report descriptive claims versus durable semantic facts
  - weak or unsupported paraphrases

Artifacts:

- [data/relationship-audit/mixed-review-batch-v7-results.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v7-results.json)
- [data/relationship-audit/mixed-review-batch-v7-results.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v7-results.clean.json)

### Before/after delta

- `v5`: `5` relationships across `4` non-empty scraps
- `v7`: `2` relationships across `2` non-empty scraps

The surviving `v7` relationships are:

- `MLXAudio -> DEVELOPS -> Sortformer speaker diarization model`
- `David Cain -> CREATED -> Your Lifestyle Has Already Been Designed`

### What improved in `v7`

- generic actor edges like `Federal officers -> USES -> Less lethal weapons` were removed
- repo-side nonsense like `Ghostty -> DEVELOPS -> Vouch` was removed
- GitHub extraction now keeps the strongest repository relation instead of several medium-quality ones

### Tradeoff

The reviewer-heavy version is probably too conservative right now.

In particular, it now drops some relations that were plausible in `v5`/`v6`, such as:

- `Rubén Castillo -> LEADS -> Illinois Accountability Commission`
- `Arizona Department of Corrections -> DEVELOPS -> inmate management software`

That is not necessarily wrong. It shows the review layer is enforcing a much stricter standard for what counts as a durable semantic fact. But it also means recall has likely swung too far down.

## Phase 7 Claim-Mode Routing

This pass added a new distinction in the extraction path:

- `claim_mode: asserted`
- `claim_mode: reported`

The intent is:

- keep durable semantic facts in the main asserted lane
- recover softer article/report signal as reported claims instead of dropping it outright

Implementation notes:

- the reviewer prompt now has separate `approved_relationships` and `reported_claims`
- `claim_mode` now survives normalization in [lib/relationshipExtraction.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/lib/relationshipExtraction.mjs)
- graph projection now preserves `rel.raw.claim_mode` in [lib/graphProjection.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/lib/graphProjection.mjs)

Artifacts:

- [data/relationship-audit/mixed-review-batch-v8-results.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v8-results.json)
- [data/relationship-audit/mixed-review-batch-v8-results.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v8-results.clean.json)
- [data/relationship-audit/mixed-review-batch-v8-diagnostics.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v8-diagnostics.clean.json)

### Result

The plumbing works, but the reviewer still is not choosing the `reported` lane in the batch.

`v8` remained effectively as conservative as `v7`:

- `11` scraps processed
- `2` surviving relationships
- both survived as `claim_mode: asserted`

Current survivors:

- `MLXAudio -> DEVELOPS -> Sortformer speaker diarization model`
- `David Cain -> CREATED -> Your Lifestyle Has Already Been Designed`

### Interpretation

This is no longer a schema problem. It is now a reviewer-prompt problem.

The LLM is still acting like the task is binary keep/drop, even though the output schema allows a softer `reported` lane. That means the next gain will come from:

- stronger few-shot examples for `reported_claims`
- clearer source-specific instructions for when an article/report relation should be downgraded rather than dropped
- maybe requiring the reviewer to justify every drop with a typed reason so we can audit its over-pruning

## Phase 8 Reviewer Telemetry

This pass did not touch reviewer prompting. It added instrumentation around the reviewer so prompt work can be guided by real shrinkage numbers instead of only artifact-reading.

Implementation:

- [scripts/aiRelationshipExtraction.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/aiRelationshipExtraction.mjs) now exposes `extractRelationshipsDetailed()`
- [scripts/reextract_relationships_v2.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/reextract_relationships_v2.mjs) now supports `--include-diagnostics`
- [scripts/summarize_relationship_review_batch.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/summarize_relationship_review_batch.mjs) summarizes a diagnostics artifact
- [package.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/package.json) now exposes `npm run relationships:summary`

Diagnostics artifact:

- [data/relationship-audit/mixed-review-batch-v8-diagnostics.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v8-diagnostics.clean.json)

Current telemetry for the mixed review batch:

- `11` scraps processed
- `39` raw candidates from the extractor
- `4` candidates survived deterministic pre-review filtering
- `3` candidates survived reviewer adjudication
- `2` final relationships survived all stages
- `4` scraps triggered recovery mode
- source mode split:
  - `5` article
  - `4` github
  - `2` default

This is the most useful current tuning signal:

- the biggest shrinkage is happening before and during reviewer adjudication
- the reviewer is not yet using `reported_claims`
- the next reviewer-tuning work should be measured against these numbers, not just the final relationship count

## Phase 9 Reported Claim Survival Fix

This pass fixed the last-stage normalization bug that was still dropping article/report relationships after the reviewer had correctly classified them as `reported`.

Implementation:

- [lib/relationshipExtraction.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/lib/relationshipExtraction.mjs)
  - `isLowValueRelationship()` now lets `claim_mode: reported` bypass the later durable-fact heuristics after the core structural checks have passed
- [scripts/aiRelationshipExtraction.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/aiRelationshipExtraction.mjs)
  - diagnostics can now optionally include `raw_candidates`, `pre_review_candidates`, `post_review_candidates`, and `final_relationships` for targeted debugging

Targeted probe result:

- `arena-10872669`
  - now survives as:
    - `Arizona Department of Corrections -> DEVELOPS -> Inmate management software`
    - `claim_mode: reported`
- `pinboard-886f9115c0ee00dd6045790ad1d6e801`
  - now preserves:
    - `Donald Trump -> LEADS -> Immigration Crackdown`
    - `claim_mode: asserted`

What this means:

- the claim-mode plumbing is now working end to end
- `reported` relationships are no longer being lost after reviewer adjudication
- the remaining tuning problem is batch-level recall and candidate quality, not claim-mode storage or final-stage claim-mode handling

## Phase 10 Prompt Teaching Pass

This pass taught the extractor and reviewer with more explicit, corpus-grounded few-shot examples instead of relying on one generic review example and broad instructions.

Implementation:

- [scripts/aiRelationshipExtraction.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/aiRelationshipExtraction.mjs)
  - extraction examples now include:
    - explicit article/report relationships
    - source-bound but still extractable article relationships
    - GitHub `DEVELOPS` examples
  - extraction prompt now includes negative counterexamples for:
    - generic actors
    - occupation-label targets
    - GitHub install/distribution noise
    - low-value in-story media production
  - reviewer prompt now includes multiple labeled keep/drop/report cases instead of a single mixed example
  - reviewer schema now allows optional `drop_reason` so future telemetry can quantify over-pruning by class

Probe results after the teaching pass:

- `arena-10872669`
  - `Arizona Department of Corrections -> DEVELOPS -> Inmate management software`
  - `claim_mode: reported`
- `pinboard-5f1ba268a567abb58199a48ea4a055b7`
  - `MLXAudio -> DEVELOPS -> Sortformer speaker diarization model`
  - `claim_mode: asserted`
- `pinboard-886f9115c0ee00dd6045790ad1d6e801`
  - `Donald Trump -> LEADS -> Immigration Crackdown`
  - `claim_mode: asserted`
- `pinboard-c2b96ee9a72cda97902d5a3ebf860dbd`
  - still produces `0` relationships, which is acceptable for the current stricter GitHub mode

Interpretation:

- the extractor/reviewer layer is now better taught on the exact cases that were failing in your archive
- `reported` has become a real operating lane rather than just a schema idea
- the next tuning step should be broader batch evaluation, not another round of purely theoretical prompt changes

## Resume State

### Current best review artifacts

- batch definition:
  - [data/relationship-audit/mixed-review-batch-v2.stdout.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v2.stdout.json)
- run output:
  - [data/relationship-audit/mixed-review-batch-v8-results.clean.json](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/data/relationship-audit/mixed-review-batch-v8-results.clean.json)
- targeted debug probe:
  - `arena-10872669`
  - `pinboard-886f9115c0ee00dd6045790ad1d6e801`

### Useful commands

Rebuild the current mixed review batch:

```bash
npm run relationships:batch > data/relationship-audit/mixed-review-batch-v2.stdout.json
```

Run dry-run re-extraction against an explicit review batch:

```bash
npm run relationships:reextract -- --batch-file data/relationship-audit/mixed-review-batch-v2.stdout.json --force --dry-run > data/relationship-audit/mixed-review-batch-v8-results.json
```

Run the same batch with reviewer diagnostics:

```bash
npm run relationships:reextract -- --batch-file data/relationship-audit/mixed-review-batch-v2.stdout.json --force --dry-run --include-diagnostics > data/relationship-audit/mixed-review-batch-v8-diagnostics.json
```

Summarize a diagnostics artifact:

```bash
npm run relationships:summary -- --file data/relationship-audit/mixed-review-batch-v8-diagnostics.clean.json
```

### Next patch focus

1. rerun the mixed review batch with the new prompt teaching and compare against `v8`
2. aggregate `drop_reason` telemetry so we can see where pruning is still too aggressive
3. improve article-batch recall now that `reported` claims can survive the pipeline
4. keep GitHub in the stricter asserted lane unless the repository text explicitly signals softer attribution
5. decide whether to add a second article-specific extraction pass for long-form investigative pieces
