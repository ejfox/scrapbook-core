const MAX_JUDGE_CONTENT_CHARS = 2000

export const DEFAULT_JUDGE_COUNCIL = [
  {
    id: 'archivist',
    name: 'The Archivist',
    model: 'openai/gpt-5.4',
    imperative: 'Only keep what the source actually justifies.',
    bias: 'provenance, textual support, claim_mode discipline',
    rewards: [
      'directly grounded entities and predicates',
      'correct asserted versus reported distinctions',
      'tight evidence discipline',
    ],
    penalizes: [
      'unsupported leaps',
      'paraphrase drift',
      'entities not clearly grounded in the source',
    ],
  },
  {
    id: 'investigator',
    name: 'The Investigator',
    model: 'anthropic/claude-sonnet-4.5',
    imperative: 'Keep the relationships a reporter would actually chase.',
    bias: 'network utility, power, money, coordination, movements',
    rewards: [
      'high-value actor links',
      'subtle but important source-bound claims',
      'keeping reported claims instead of dropping useful leads',
    ],
    penalizes: [
      'over-pruning real signal',
      'missing high-value movement and institutional links',
      'keeping low-value descriptive trivia',
    ],
  },
  {
    id: 'ontologist',
    name: 'The Ontologist',
    model: 'anthropic/claude-opus-4.1',
    imperative: 'Protect long-term graph cleanliness.',
    bias: 'type discipline, predicate fit, ontology hygiene',
    rewards: [
      'clean entity typing',
      'correct predicate choice',
      'stable graph-worthy objects',
    ],
    penalizes: [
      'abstract soup',
      'coercing concepts into concrete types',
      'schema-polluting near misses',
    ],
  },
]

const JUDGE_WEIGHTS = {
  archivist: 0.42,
  investigator: 0.22,
  ontologist: 0.36,
}

function truncateForJudge(content = '') {
  if (content.length <= MAX_JUDGE_CONTENT_CHARS) return content
  return `${content.slice(0, 1600)}\n\n[TRUNCATED]\n\n${content.slice(-300)}`
}

function summarizeRelationships(relationships = []) {
  return relationships.map((relationship) => ({
    source: relationship.source,
    type: relationship.type,
    target: relationship.target,
    claim_mode: relationship.claim_mode || 'asserted',
    evidence: relationship.evidence || null,
  }))
}

export function parseJudgeCouncilArg(value) {
  if (!value) return []

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, ...rest] = entry.split('=')
      return {
        id: id?.trim(),
        model: rest.join('=').trim(),
      }
    })
    .filter((entry) => entry.id && entry.model)
}

export function buildJudgeCouncil({ judgeModel = null, judgeCouncil = null } = {}) {
  if (judgeCouncil && judgeCouncil.length > 0) {
    const overrides = new Map(judgeCouncil.map((entry) => [entry.id, entry.model]))
    return DEFAULT_JUDGE_COUNCIL.map((judge) => ({
      ...judge,
      model: overrides.get(judge.id) || judge.model,
    }))
  }

  if (judgeModel) {
    return [
      {
        id: 'generalist',
        name: 'The Generalist',
        model: judgeModel,
        imperative: 'Choose the cleanest and most useful extraction output.',
        bias: 'balanced precision and utility',
        rewards: [
          'grounded, graph-worthy edges',
          'good claim_mode choices',
          'clean type and predicate fit',
        ],
        penalizes: [
          'junk edges',
          'unsupported claims',
          'ontology pollution',
        ],
      },
    ]
  }

  return DEFAULT_JUDGE_COUNCIL
}

function buildJudgeMessages(scrap, perModelOutputs, judge) {
  const modelPayload = perModelOutputs.map((row) => ({
    model: row.model,
    diagnostics: {
      source_mode: row.diagnostics?.source_mode || null,
      used_recovery: row.diagnostics?.used_recovery || false,
      relationship_count: row.relationships.length,
      claim_mode_counts: row.diagnostics?.claim_mode_counts || {},
    },
    relationships: summarizeRelationships(row.relationships),
  }))

  return [
    {
      role: 'system',
      content: `${judge.name}. Imperative: ${judge.imperative}
Bias: ${judge.bias}
Reward: ${judge.rewards.join('; ')}
Penalize: ${judge.penalizes.join('; ')}
Return JSON only.`,
    },
    {
      role: 'user',
      content: `Judge these ontology extraction outputs for one investigative scrap.

Return:
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

Scoring:
5 strongest
4 good
3 mixed
2 weak
1 mostly bad
0 unusable

Scrap:
${JSON.stringify({
    scrap_id: scrap.scrap_id,
    source: scrap.source,
    title: scrap.title,
    url: scrap.url,
    summary: scrap.summary || null,
    content_excerpt: truncateForJudge(scrap.content || ''),
  }, null, 2)}

Outputs:
${JSON.stringify(modelPayload, null, 2)}`,
    },
  ]
}

function emptyJudgePayload(error = 'no_judge_response') {
  return {
    winner: null,
    scores: [],
    bad_edges: [],
    good_edges: [],
    error,
  }
}

function parseJudgePayload(response) {
  if (!response) {
    return emptyJudgePayload()
  }

  const fencedMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch ? fencedMatch[1].trim() : response.trim()

  let payload
  try {
    payload = JSON.parse(candidate)
  } catch {
    const firstBrace = candidate.indexOf('{')
    const lastBrace = candidate.lastIndexOf('}')
    payload = JSON.parse(candidate.slice(firstBrace, lastBrace + 1))
  }

  return {
    winner: payload.winner || null,
    scores: Array.isArray(payload.scores) ? payload.scores : [],
    bad_edges: Array.isArray(payload.bad_edges) ? payload.bad_edges : [],
    good_edges: Array.isArray(payload.good_edges) ? payload.good_edges : [],
  }
}

async function repairJudgePayload({
  rawResponse,
  judge,
  candidateModels,
  completion,
  scrapId,
  taskType,
}) {
  const repairResponse = await completion({
    temperature: 0,
    maxTokens: 1200,
    model: judge.model,
    scrapId,
    taskType: `${taskType}:repair`,
    messages: [
      {
        role: 'system',
        content: 'Convert the following judge output into valid JSON only. Do not add commentary.',
      },
      {
        role: 'user',
        content: `Return exactly:
{
  "winner": "model id or null",
  "scores": [{"model": "model id", "score": 0, "verdict": "", "notes": ""}],
  "good_edges": [{"model": "model id", "edge": "", "reason": ""}],
  "bad_edges": [{"model": "model id", "edge": "", "reason": ""}]
}

Allowed model ids:
${JSON.stringify(candidateModels, null, 2)}

Raw judge output:
${rawResponse}`,
      },
    ],
  })

  return parseJudgePayload(repairResponse)
}

function computeConsensus(judges, candidateModels) {
  const scoreMap = new Map(candidateModels.map((model) => [model, {
    model,
    total_score: 0,
    weighted_score: 0,
    judge_wins: 0,
    judge_scores: {},
    verdicts: {},
  }]))

  for (const judge of judges) {
    const weight = JUDGE_WEIGHTS[judge.id] || (1 / Math.max(judges.length, 1))
    if (judge.winner && scoreMap.has(judge.winner)) {
      scoreMap.get(judge.winner).judge_wins += 1
    }

    for (const score of judge.scores || []) {
      const bucket = scoreMap.get(score.model)
      if (!bucket) continue
      const numeric = Number(score.score) || 0
      bucket.total_score += numeric
      bucket.weighted_score += numeric * weight
      bucket.judge_scores[judge.id] = numeric
      bucket.verdicts[judge.id] = {
        verdict: score.verdict || '',
        notes: score.notes || '',
      }
    }
  }

  const scores = Array.from(scoreMap.values())
    .map((bucket) => ({
      model: bucket.model,
      score: Number(bucket.weighted_score.toFixed(3)),
      average_score: Number((bucket.total_score / Math.max(judges.length, 1)).toFixed(3)),
      judge_wins: bucket.judge_wins,
      role_scores: bucket.judge_scores,
      role_verdicts: bucket.verdicts,
      verdict: Object.entries(bucket.verdicts)
        .map(([id, row]) => `${id}: ${row.verdict}`)
        .join(' | '),
      notes: Object.entries(bucket.verdicts)
        .map(([id, row]) => `${id}: ${row.notes}`)
        .join(' | '),
    }))
    .sort((left, right) => (
      right.score - left.score
      || right.judge_wins - left.judge_wins
      || right.average_score - left.average_score
      || candidateModels.indexOf(left.model) - candidateModels.indexOf(right.model)
    ))

  const winners = new Set(judges.map((judge) => judge.winner).filter(Boolean))

  return {
    winner: scores[0]?.model || null,
    disagreement_count: Math.max(0, winners.size - 1),
    scores,
    good_edges: judges.flatMap((judge) => (judge.good_edges || []).map((edge) => ({
      ...edge,
      judge_id: judge.id,
      judge_name: judge.name,
      judge_model: judge.model,
    }))),
    bad_edges: judges.flatMap((judge) => (judge.bad_edges || []).map((edge) => ({
      ...edge,
      judge_id: judge.id,
      judge_name: judge.name,
      judge_model: judge.model,
    }))),
  }
}

export async function judgeScrapWithCouncil({
  scrap,
  perModelOutputs,
  judges,
  completion,
  taskType = 'relationshipModelBakeoffJudge',
}) {
  const judgeResults = []

  for (const judge of judges) {
    const response = await completion({
      messages: buildJudgeMessages(scrap, perModelOutputs, judge),
      temperature: 0,
      maxTokens: 1800,
      model: judge.model,
      scrapId: scrap.scrap_id,
      taskType: `${taskType}:${judge.id}`,
    })

    let payload
    try {
      payload = parseJudgePayload(response)
    } catch {
      payload = await repairJudgePayload({
        rawResponse: response,
        judge,
        candidateModels: perModelOutputs.map((row) => row.model),
        completion,
        scrapId: scrap.scrap_id,
        taskType: `${taskType}:${judge.id}`,
      })
    }

    judgeResults.push({
      id: judge.id,
      name: judge.name,
      model: judge.model,
      imperative: judge.imperative,
      bias: judge.bias,
      ...payload,
    })
  }

  const consensus = computeConsensus(
    judgeResults,
    perModelOutputs.map((row) => row.model),
  )

  return {
    winner: consensus.winner,
    disagreement_count: consensus.disagreement_count,
    scores: consensus.scores,
    good_edges: consensus.good_edges,
    bad_edges: consensus.bad_edges,
    judges: judgeResults,
  }
}

export function aggregateCouncilResults(scrapResults, models) {
  const aggregate = {
    models: {},
    judges: {},
    judged_scraps: scrapResults.length,
  }

  for (const model of models) {
    aggregate.models[model] = {
      wins: 0,
      total_score: 0,
      scored_scraps: 0,
      relationship_count: 0,
      reported_count: 0,
      asserted_count: 0,
      bad_edge_mentions: 0,
      good_edge_mentions: 0,
      per_judge_average: {},
    }
  }

  for (const row of scrapResults) {
    if (row.judgment?.winner && aggregate.models[row.judgment.winner]) {
      aggregate.models[row.judgment.winner].wins += 1
    }

    for (const modelResult of row.model_results) {
      const bucket = aggregate.models[modelResult.model]
      bucket.relationship_count += modelResult.relationships.length
      for (const relationship of modelResult.relationships) {
        if ((relationship.claim_mode || 'asserted') === 'reported') {
          bucket.reported_count += 1
        } else {
          bucket.asserted_count += 1
        }
      }
    }

    for (const score of row.judgment?.scores || []) {
      if (!aggregate.models[score.model]) continue
      aggregate.models[score.model].total_score += Number(score.score) || 0
      aggregate.models[score.model].scored_scraps += 1
    }

    for (const judge of row.judgment?.judges || []) {
      if (!aggregate.judges[judge.id]) {
        aggregate.judges[judge.id] = {
          name: judge.name,
          model: judge.model,
          wins_by_model: {},
        }
      }
      if (judge.winner) {
        aggregate.judges[judge.id].wins_by_model[judge.winner] = (
          aggregate.judges[judge.id].wins_by_model[judge.winner] || 0
        ) + 1
      }

      for (const score of judge.scores || []) {
        const bucket = aggregate.models[score.model]
        if (!bucket) continue
        if (!bucket.per_judge_average[judge.id]) {
          bucket.per_judge_average[judge.id] = {
            total: 0,
            count: 0,
          }
        }
        bucket.per_judge_average[judge.id].total += Number(score.score) || 0
        bucket.per_judge_average[judge.id].count += 1
      }
    }

    for (const edge of row.judgment?.bad_edges || []) {
      if (aggregate.models[edge.model]) {
        aggregate.models[edge.model].bad_edge_mentions += 1
      }
    }

    for (const edge of row.judgment?.good_edges || []) {
      if (aggregate.models[edge.model]) {
        aggregate.models[edge.model].good_edge_mentions += 1
      }
    }
  }

  for (const model of models) {
    const bucket = aggregate.models[model]
    bucket.average_score = bucket.scored_scraps > 0
      ? Number((bucket.total_score / bucket.scored_scraps).toFixed(3))
      : null

    for (const [judgeId, row] of Object.entries(bucket.per_judge_average)) {
      bucket.per_judge_average[judgeId] = row.count > 0
        ? Number((row.total / row.count).toFixed(3))
        : null
    }
  }

  return aggregate
}
