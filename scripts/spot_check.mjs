#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const N = parseInt(process.argv[2] || '400', 10)

// Pull recent N scraps
const { data: scraps, error } = await supabase
  .from('scraps')
  .select('id, scrap_id, source, type, url, title, content, summary, tags, screenshot_url, financial_analysis, location, created_at')
  .order('created_at', { ascending: false })
  .limit(N)

if (error) { console.error(error); process.exit(1) }

const n = scraps.length
const pct = (x) => `${((x / n) * 100).toFixed(1)}%`

// Quality checks
const issues = {
  noUrl: [],
  noContentPlaceholder: [],
  noTitle: [],
  shortSummary: [],
  noSummary: [],
  noScreenshot: [],
  financialOnNonFinancial: [],
  duplicateSummary: [],
}

const summaryCounts = new Map()

for (const s of scraps) {
  const title = (s.title || '').trim()
  const summary = (s.summary || '').trim()
  const content = (s.content || '').trim()

  if (!s.url) issues.noUrl.push(s)
  if (/no content available/i.test(title) || /no content available/i.test(summary)) issues.noContentPlaceholder.push(s)
  if (!title) issues.noTitle.push(s)
  if (!summary) issues.noSummary.push(s)
  else if (summary.length < 40) issues.shortSummary.push(s)
  if (!s.screenshot_url) issues.noScreenshot.push(s)

  // financial_analysis populated but content clearly not financial
  if (s.financial_analysis && Object.keys(s.financial_analysis).length > 0) {
    const fa = JSON.stringify(s.financial_analysis).toLowerCase()
    const text = (title + ' ' + summary + ' ' + content).toLowerCase()
    const tickers = (s.financial_analysis.assets || []).map(a => (a.name || '') + ' ' + (a.ticker || ''))
    // heuristic: financial mentions a ticker/company not present in the text
    const bogus = tickers.some(t => {
      const name = t.split(' ')[0].toLowerCase()
      return name && name.length > 2 && !text.includes(name)
    })
    if (bogus) issues.financialOnNonFinancial.push({ s, tickers })
  }

  if (summary) {
    const key = summary.slice(0, 80)
    summaryCounts.set(key, (summaryCounts.get(key) || 0) + 1)
  }
}

for (const [key, count] of summaryCounts) {
  if (count > 2) issues.duplicateSummary.push({ key, count })
}

console.log(`\n=== SPOT CHECK: ${n} most-recent scraps ===\n`)
console.log(`Sources:`, Object.entries(scraps.reduce((a, s) => { a[s.source] = (a[s.source]||0)+1; return a }, {})).map(([k,v])=>`${k}:${v}`).join('  '))
console.log(`Types:  `, Object.entries(scraps.reduce((a, s) => { a[s.type] = (a[s.type]||0)+1; return a }, {})).map(([k,v])=>`${k}:${v}`).join('  '))

console.log(`\n--- Data quality issues ---`)
console.log(`null url:                    ${issues.noUrl.length.toString().padStart(4)} (${pct(issues.noUrl.length)})`)
console.log(`"No content available":      ${issues.noContentPlaceholder.length.toString().padStart(4)} (${pct(issues.noContentPlaceholder.length)})`)
console.log(`no title:                    ${issues.noTitle.length.toString().padStart(4)} (${pct(issues.noTitle.length)})`)
console.log(`no summary:                  ${issues.noSummary.length.toString().padStart(4)} (${pct(issues.noSummary.length)})`)
console.log(`short summary (<40ch):       ${issues.shortSummary.length.toString().padStart(4)} (${pct(issues.shortSummary.length)})`)
console.log(`no screenshot:               ${issues.noScreenshot.length.toString().padStart(4)} (${pct(issues.noScreenshot.length)})`)
console.log(`bogus financial_analysis:    ${issues.financialOnNonFinancial.length.toString().padStart(4)} (${pct(issues.financialOnNonFinancial.length)})`)

console.log(`\n--- Sample: "No content available" dead cards ---`)
issues.noContentPlaceholder.slice(0, 8).forEach(s => {
  console.log(`  ${s.source}/${s.type}  id=${s.scrap_id}  url=${s.url}  created=${s.created_at?.slice(0,10)}`)
})

console.log(`\n--- Sample: bogus financial_analysis (ticker not in text) ---`)
issues.financialOnNonFinancial.slice(0, 8).forEach(({ s, tickers }) => {
  console.log(`  "${(s.title||'').slice(0,55)}"`)
  console.log(`     tickers: ${tickers.join(', ')}`)
})

console.log(`\n--- Sample: missing screenshots (first 8) ---`)
issues.noScreenshot.slice(0, 8).forEach(s => {
  console.log(`  ${s.source}/${s.type}  "${(s.title||'[no title]').slice(0,50)}"  ${s.url || '(no url)'}`)
})

if (issues.duplicateSummary.length) {
  console.log(`\n--- Repeated/templated summaries (same first 80 chars, >2x) ---`)
  issues.duplicateSummary.slice(0, 8).forEach(({ key, count }) => console.log(`  ${count}x  "${key}..."`))
}
