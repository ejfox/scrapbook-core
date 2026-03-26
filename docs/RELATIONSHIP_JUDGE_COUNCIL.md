# Relationship Judge Council

This bakeoff no longer assumes one blended "judge" for ontology extraction quality.

It uses a council of three judges with intentionally different imperatives:

## The Archivist

- Imperative: `Only keep what the source actually justifies.`
- Bias: provenance, textual support, claim mode discipline
- Rewards:
  - directly grounded entities and predicates
  - correct `asserted` vs `reported` choices
  - edges with clear documentary support
- Penalizes:
  - unsupported leaps
  - paraphrase drift
  - entities not clearly grounded in the source

## The Investigator

- Imperative: `Keep the relationships a reporter would actually chase.`
- Bias: network utility, power, money, coordination, movements
- Rewards:
  - high-value actor links
  - subtle but important source-bound claims
  - reported claims that preserve real leads
- Penalizes:
  - over-pruning real signal
  - missing movement or institutional dynamics
  - low-value descriptive trivia

## The Ontologist

- Imperative: `Protect long-term graph cleanliness.`
- Bias: type discipline, predicate fit, ontology hygiene
- Rewards:
  - clean entity typing
  - correct predicate choice
  - stable graph-worthy objects
- Penalizes:
  - abstract soup
  - coercing concepts into concrete types
  - schema-polluting near misses

## Scoring Schema

Each judge scores each candidate model output on a `0-5` scale:

- `5`: strongest
- `4`: good
- `3`: mixed
- `2`: weak
- `1`: mostly bad
- `0`: unusable

Each judge returns:

```json
{
  "winner": "model id",
  "scores": [
    {
      "model": "model id",
      "score": 0,
      "verdict": "short phrase",
      "notes": "short reason"
    }
  ],
  "good_edges": [
    {
      "model": "model id",
      "edge": "Source -[TYPE]-> Target",
      "reason": "short reason"
    }
  ],
  "bad_edges": [
    {
      "model": "model id",
      "edge": "Source -[TYPE]-> Target",
      "reason": "short reason"
    }
  ]
}
```

## Council Consensus

Per-model consensus is computed from weighted judge scores:

- `Archivist`: `0.42`
- `Investigator`: `0.22`
- `Ontologist`: `0.36`

This weighting reflects the current project priority:

- provenance and support matter most
- ontology pollution is dangerous
- investigative utility matters, but cannot override unsupported or graph-damaging output

Consensus payload adds:

- `winner`
- `disagreement_count`
- weighted `scores`
- aggregated `good_edges`
- aggregated `bad_edges`
- raw per-judge decisions under `judges`

## CLI

Bakeoff supports either one judge model or a full council:

```bash
npm run relationships:bakeoff -- \
  --batch-file data/relationship-audit/mixed-review-batch-v2.stdout.json \
  --judge-council archivist=openai/gpt-5.4,investigator=anthropic/claude-sonnet-4.5,ontologist=anthropic/claude-opus-4.1
```

Rejudge supports the same:

```bash
npm run relationships:rejudge -- \
  --input data/relationship-audit/relationship-model-bakeoff-v1.json \
  --judge-council archivist=openai/gpt-5.4,investigator=anthropic/claude-sonnet-4.5,ontologist=anthropic/claude-opus-4.1
```

## Current Implementation

Core code:

- [lib/relationshipJudgeCouncil.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/lib/relationshipJudgeCouncil.mjs)
- [scripts/bakeoff_relationship_models.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/bakeoff_relationship_models.mjs)
- [scripts/rejudge_relationship_bakeoff.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/rejudge_relationship_bakeoff.mjs)
- [scripts/render_relationship_bakeoff_report.mjs](/Users/ejfox/code/SCRAPBOOK/scrapbook-core/scripts/render_relationship_bakeoff_report.mjs)

This is deliberately prompt-light compared with the extraction pipeline. The council prompts are short on purpose; the differentiation comes from imperative and bias, not giant prompt walls.
