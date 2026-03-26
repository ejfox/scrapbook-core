#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'

function parseArgs(argv) {
  const options = {
    input: null,
    output: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if ((arg === '--input' || arg === '--file') && argv[i + 1]) {
      options.input = argv[i + 1]
      i += 1
    } else if ((arg === '--output' || arg === '--out') && argv[i + 1]) {
      options.output = argv[i + 1]
      i += 1
    }
  }

  if (!options.input) {
    throw new Error('Usage: node scripts/render_relationship_bakeoff_report.mjs --input <json> [--output <html>]')
  }

  return options
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function modelSlug(model) {
  return model.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

function shortModel(model) {
  return model.split('/').pop() || model
}

function renderJudgeChips(scoreRow) {
  const roleScores = scoreRow?.role_scores || {}
  const chips = Object.entries(roleScores).map(([role, value]) => (
    `<span class="judge-chip"><strong>${escapeHtml(role)}</strong> ${escapeHtml(value)}</span>`
  ))
  return chips.length > 0 ? `<div class="judge-chips">${chips.join('')}</div>` : ''
}

function renderEdge(relationship) {
  return `<div class="edge">
    <div class="edge-head">
      <span class="edge-entity">${escapeHtml(relationship.source?.name)}</span>
      <span class="edge-predicate">${escapeHtml(relationship.type)}</span>
      <span class="edge-entity">${escapeHtml(relationship.target?.name)}</span>
    </div>
    <div class="edge-meta">
      <span>${escapeHtml(relationship.source?.type)} → ${escapeHtml(relationship.target?.type)}</span>
      <span class="claim-mode claim-mode-${escapeHtml((relationship.claim_mode || 'asserted').toLowerCase())}">${escapeHtml(relationship.claim_mode || 'asserted')}</span>
    </div>
    ${relationship.evidence ? `<div class="edge-evidence">${escapeHtml(relationship.evidence)}</div>` : ''}
  </div>`
}

function renderModelCard(modelResult, judgment) {
  const model = modelResult.model
  const scoreRow = (judgment?.scores || []).find((row) => row.model === model)
  const badEdges = (judgment?.bad_edges || []).filter((row) => row.model === model)
  const goodEdges = (judgment?.good_edges || []).filter((row) => row.model === model)
  const winner = judgment?.winner === model

  return `<article class="model-card ${winner ? 'winner' : ''}">
    <header class="model-card-head">
      <div>
        <h3>${escapeHtml(shortModel(model))}</h3>
        <p class="model-id">${escapeHtml(model)}</p>
      </div>
      <div class="score-badge">
        <span class="score">${scoreRow ? escapeHtml(scoreRow.score) : '–'}</span>
        <span class="verdict">${escapeHtml(scoreRow?.verdict || 'unscored')}</span>
      </div>
    </header>
    <div class="model-meta">
      <span>${modelResult.relationships.length} edges</span>
      <span>${escapeHtml(modelResult.diagnostics?.source_mode || 'unknown')}</span>
      <span>${modelResult.diagnostics?.used_recovery ? 'recovery' : 'default pass'}</span>
    </div>
    ${renderJudgeChips(scoreRow)}
    ${scoreRow?.notes ? `<p class="notes">${escapeHtml(scoreRow.notes)}</p>` : ''}
    <div class="edges">
      ${modelResult.relationships.length > 0
    ? modelResult.relationships.map(renderEdge).join('\n')
    : '<div class="empty-state">No surviving relationships</div>'}
    </div>
    ${(goodEdges.length > 0 || badEdges.length > 0) ? `<footer class="judge-foot">
      ${goodEdges.length > 0 ? `<div class="judge-good"><strong>Council liked:</strong> ${goodEdges.map((edge) => `${escapeHtml(edge.edge)} [${escapeHtml(edge.judge_id || 'judge')}]`).join('; ')}</div>` : ''}
      ${badEdges.length > 0 ? `<div class="judge-bad"><strong>Council flagged:</strong> ${badEdges.map((edge) => `${escapeHtml(edge.edge)} (${escapeHtml(edge.reason)}) [${escapeHtml(edge.judge_id || 'judge')}]`).join('; ')}</div>` : ''}
    </footer>` : ''}
  </article>`
}

function renderCouncilPanel(payload) {
  const judges = payload.judge_council || []
  if (judges.length === 0) return ''

  return `<section class="aggregate-panel">
    <div class="section-kicker">Council</div>
    <h2>Judge Imperatives</h2>
    <div class="judge-grid">
      ${judges.map((judge) => `
        <article class="judge-card">
          <div class="section-kicker">${escapeHtml(judge.id)}</div>
          <h3>${escapeHtml(judge.name)}</h3>
          <p class="notes"><strong>Imperative:</strong> ${escapeHtml(judge.imperative)}</p>
          <p class="notes"><strong>Model:</strong> ${escapeHtml(judge.model)}</p>
          <p class="notes"><strong>Bias:</strong> ${escapeHtml(judge.bias || '')}</p>
        </article>
      `).join('\n')}
    </div>
  </section>`
}

function renderAggregateTable(models, aggregate) {
  const judgeIds = Object.keys(aggregate.judges || {})
  const rows = models.map((model) => {
    const row = aggregate.models[model]
    return `<tr>
      <td class="sticky-model">${escapeHtml(shortModel(model))}</td>
      <td>${escapeHtml(model)}</td>
      <td>${escapeHtml(row.wins)}</td>
      <td>${row.average_score ?? '–'}</td>
      ${judgeIds.map((judgeId) => `<td>${row.per_judge_average?.[judgeId] ?? '–'}</td>`).join('')}
      <td>${escapeHtml(row.relationship_count)}</td>
      <td>${escapeHtml(row.asserted_count)}</td>
      <td>${escapeHtml(row.reported_count)}</td>
      <td>${escapeHtml(row.good_edge_mentions)}</td>
      <td>${escapeHtml(row.bad_edge_mentions)}</td>
    </tr>`
  }).join('\n')

  return `<section class="aggregate-panel">
    <div class="section-kicker">Aggregate</div>
    <h2>Model-Level Outcome</h2>
    <p class="section-copy">Wins and scores come from per-scrap judge comparisons. Relationship counts are raw surviving outputs after normalization and review.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Short Name</th>
            <th>Model</th>
            <th>Wins</th>
            <th>Weighted Avg</th>
            ${judgeIds.map((judgeId) => `<th>${escapeHtml(judgeId)}</th>`).join('')}
            <th>Edges</th>
            <th>Asserted</th>
            <th>Reported</th>
            <th>Good Flags</th>
            <th>Bad Flags</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </section>`
}

function renderScrapSection(result) {
  const judgment = result.judgment || {}
  const winner = judgment.winner ? shortModel(judgment.winner) : 'No winner'
  return `<section class="scrap-panel" id="${escapeHtml(result.scrap_id)}">
    <header class="scrap-head">
      <div class="scrap-meta">
        <div class="section-kicker">${escapeHtml(result.source)}</div>
        <h2>${escapeHtml(result.title)}</h2>
        <p class="scrap-id">${escapeHtml(result.scrap_id)}</p>
      </div>
      <div class="scrap-judge">
        <div class="winner-label">Council winner</div>
        <div class="winner-model">${escapeHtml(winner)}</div>
        ${judgment.disagreement_count ? `<div class="notes">${escapeHtml(String(judgment.disagreement_count))} disagreement(s)</div>` : ''}
      </div>
    </header>
    <div class="small-multiples">
      ${result.model_results.map((modelResult) => renderModelCard(modelResult, judgment)).join('\n')}
    </div>
  </section>`
}

function renderHtml(payload) {
  const generatedAt = new Date(payload.generated_at).toLocaleString()
  const models = payload.candidate_models || []
  const totalWins = Object.values(payload.aggregate?.models || {}).reduce((acc, row) => acc + (row.wins || 0), 0)
  const judgeLabel = payload.judge_council?.length
    ? `${payload.judge_council.length}-judge council`
    : payload.judge_model

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relationship Model Bakeoff</title>
  <style>
    :root {
      --paper: #f6f1e8;
      --ink: #1d1a17;
      --muted: #6a6258;
      --rule: rgba(29, 26, 23, 0.14);
      --panel: rgba(255, 252, 245, 0.88);
      --winner: #0d5c46;
      --reported: #975a16;
      --asserted: #204b77;
      --bad: #9b2226;
      --good: #386641;
      --accent: #c96f32;
      --shadow: 0 18px 50px rgba(57, 41, 29, 0.08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(201, 111, 50, 0.12), transparent 30%),
        radial-gradient(circle at top right, rgba(13, 92, 70, 0.08), transparent 28%),
        linear-gradient(180deg, #fbf7ef 0%, var(--paper) 100%);
      font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
      line-height: 1.5;
    }

    header.hero {
      padding: 4rem 5vw 2rem;
      border-bottom: 1px solid var(--rule);
    }

    .hero-grid {
      display: grid;
      gap: 2rem;
      grid-template-columns: 2.2fr 1fr;
      align-items: end;
    }

    .eyebrow, .section-kicker {
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-size: 0.72rem;
      color: var(--muted);
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    }

    h1, h2, h3 {
      margin: 0;
      line-height: 1.05;
      font-weight: 600;
    }

    h1 {
      font-size: clamp(2.6rem, 5vw, 5rem);
      max-width: 12ch;
      margin-top: 0.5rem;
    }

    .hero-copy, .section-copy, .notes, .edge-evidence, .scrap-id, .model-id {
      color: var(--muted);
    }

    .hero-stats {
      display: grid;
      gap: 0.75rem;
      padding: 1.25rem;
      background: var(--panel);
      border: 1px solid var(--rule);
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
    }

    .hero-stats dt {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    }

    .hero-stats dd {
      margin: 0.1rem 0 0.8rem;
      font-size: 1.25rem;
    }

    main {
      padding: 2rem 5vw 4rem;
      display: grid;
      gap: 2rem;
    }

    .aggregate-panel,
    .scrap-panel {
      background: var(--panel);
      border: 1px solid var(--rule);
      box-shadow: var(--shadow);
      padding: 1.5rem;
      backdrop-filter: blur(16px);
    }

    .table-wrap {
      overflow-x: auto;
      margin-top: 1rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
      font-size: 0.96rem;
    }

    th, td {
      padding: 0.8rem 0.6rem;
      border-bottom: 1px solid var(--rule);
      text-align: left;
      vertical-align: top;
    }

    th {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    }

    .sticky-model {
      font-weight: 700;
    }

    .scrap-head {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: end;
      margin-bottom: 1.25rem;
    }

    .winner-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    }

    .winner-model {
      font-size: 1.2rem;
      color: var(--winner);
      font-weight: 700;
    }

    .small-multiples {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }

    .model-card {
      border: 1px solid var(--rule);
      padding: 1rem;
      background: rgba(255, 255, 255, 0.55);
      display: grid;
      gap: 0.8rem;
    }

    .model-card.winner {
      border-color: rgba(13, 92, 70, 0.45);
      box-shadow: inset 0 0 0 1px rgba(13, 92, 70, 0.18);
    }

    .model-card-head {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: start;
    }

    .model-card h3 {
      font-size: 1.2rem;
      margin-bottom: 0.2rem;
    }

    .model-id, .scrap-id {
      font-size: 0.78rem;
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
      word-break: break-word;
    }

    .score-badge {
      min-width: 4.6rem;
      text-align: right;
    }

    .score {
      display: block;
      font-size: 1.7rem;
      font-weight: 700;
      color: var(--accent);
    }

    .verdict {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    }

    .model-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: var(--muted);
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    }

    .judge-grid {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      margin-top: 1rem;
    }

    .judge-card {
      border: 1px solid var(--rule);
      padding: 1rem;
      background: rgba(255, 255, 255, 0.55);
    }

    .judge-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
    }

    .judge-chip {
      font-size: 0.72rem;
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
      color: var(--muted);
      border: 1px solid var(--rule);
      padding: 0.15rem 0.4rem;
      border-radius: 999px;
    }

    .edges {
      display: grid;
      gap: 0.7rem;
    }

    .edge {
      border-top: 1px solid var(--rule);
      padding-top: 0.7rem;
    }

    .edge-head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      align-items: baseline;
      font-size: 1rem;
    }

    .edge-entity {
      font-weight: 700;
    }

    .edge-predicate {
      color: var(--accent);
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
      font-size: 0.8rem;
      letter-spacing: 0.12em;
    }

    .edge-meta {
      margin-top: 0.25rem;
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      font-size: 0.76rem;
      color: var(--muted);
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    }

    .claim-mode {
      padding: 0.1rem 0.35rem;
      border-radius: 999px;
      border: 1px solid currentColor;
    }

    .claim-mode-asserted { color: var(--asserted); }
    .claim-mode-reported { color: var(--reported); }

    .edge-evidence {
      margin-top: 0.45rem;
      font-size: 0.92rem;
    }

    .judge-foot {
      border-top: 1px dashed var(--rule);
      padding-top: 0.75rem;
      font-size: 0.84rem;
    }

    .judge-good { color: var(--good); }
    .judge-bad { color: var(--bad); margin-top: 0.45rem; }

    .empty-state {
      color: var(--muted);
      font-style: italic;
      padding-top: 0.2rem;
    }

    @media (max-width: 900px) {
      .hero-grid,
      .scrap-head {
        grid-template-columns: 1fr;
        display: grid;
      }
    }
  </style>
</head>
<body>
  <header class="hero">
    <div class="hero-grid">
      <div>
        <div class="eyebrow">Relationship Bakeoff</div>
        <h1>Model Comparison for Ontology Extraction</h1>
        <p class="hero-copy">A side-by-side read of extraction and reviewer behavior across the same curated scrap batch. This is meant to be read like an academic figure sheet, not a leaderboard gimmick.</p>
      </div>
      <dl class="hero-stats">
        <div>
          <dt>Generated</dt>
          <dd>${escapeHtml(generatedAt)}</dd>
        </div>
        <div>
          <dt>Judge Model</dt>
          <dd>${escapeHtml(judgeLabel)}</dd>
        </div>
        <div>
          <dt>Candidate Models</dt>
          <dd>${escapeHtml(String(models.length))}</dd>
        </div>
        <div>
          <dt>Judged Scraps</dt>
          <dd>${escapeHtml(String(payload.aggregate?.judged_scraps || 0))}</dd>
        </div>
        <div>
          <dt>Total Wins Assigned</dt>
          <dd>${escapeHtml(String(totalWins))}</dd>
        </div>
      </dl>
    </div>
  </header>
  <main>
    ${renderCouncilPanel(payload)}
    ${renderAggregateTable(models, payload.aggregate)}
    ${payload.results.map(renderScrapSection).join('\n')}
  </main>
</body>
</html>`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const payload = JSON.parse(await readFile(options.input, 'utf8'))
  const html = renderHtml(payload)
  const output = options.output || options.input.replace(/\.json$/i, '.html')
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, html)
  console.log(output)
}

main().catch((error) => {
  console.error('Failed to render relationship bakeoff report:', error.message)
  process.exit(1)
})
