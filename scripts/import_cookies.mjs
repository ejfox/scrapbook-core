#!/usr/bin/env node
// Normalize a browser cookie export into data/cookies.json (domain-keyed header
// strings), which both contentExtractor.mjs and the screenshot engine read.
//
//   node scripts/import_cookies.mjs <export.json> [domainKey]
//
// <export.json> is what the "Cookie-Editor" / "EditThisCookie" extensions produce:
// an array of { name, value, domain, ... } objects (export the site while logged
// in). Groups cookies by registrable domain and MERGES into data/cookies.json
// without clobbering other domains. If [domainKey] is given, ALL cookies are
// filed under that key (useful when an export mixes sub-domains).
//
// data/cookies.json is gitignored — these are sensitive session cookies, keep
// them local. This script prints counts only, never cookie values.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'

const [, , exportPath, forcedKey] = process.argv
if (!exportPath) {
  console.error('usage: node scripts/import_cookies.mjs <export.json> [domainKey]')
  process.exit(1)
}

let raw
try { raw = JSON.parse(readFileSync(exportPath, 'utf-8')) }
catch (e) { console.error(`Could not read ${exportPath}: ${e.message}`); process.exit(1) }

const cookies = Array.isArray(raw) ? raw : (Array.isArray(raw?.cookies) ? raw.cookies : null)
if (!cookies) { console.error('Expected a JSON array of cookie objects (Cookie-Editor export).'); process.exit(1) }

// registrable-ish domain: strip leading dot + a single leading subdomain label
// so "www.x.com" / ".x.com" both file under "x.com". Good enough for our host
// matching (getCookiesForUrl matches host === key || host.endsWith('.'+key)).
function domainKeyFor(d) {
  let host = String(d || '').replace(/^\./, '').toLowerCase()
  const parts = host.split('.')
  if (parts.length > 2) host = parts.slice(-2).join('.')
  return host
}

const grouped = {}
for (const c of cookies) {
  if (!c?.name) continue
  const key = forcedKey || domainKeyFor(c.domain)
  if (!key || key === '.') continue
  ;(grouped[key] ||= []).push(`${c.name}=${c.value}`)
}

const outPath = path.resolve(process.cwd(), 'data/cookies.json')
if (!existsSync(path.dirname(outPath))) mkdirSync(path.dirname(outPath), { recursive: true })
const current = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf-8')) : {}

for (const [key, pairs] of Object.entries(grouped)) {
  current[key] = pairs.join('; ')
  console.log(`  ${key}: ${pairs.length} cookie(s)`)
}
writeFileSync(outPath, JSON.stringify(current, null, 2) + '\n')
console.log(`\nMerged ${Object.keys(grouped).length} domain(s) into ${outPath}`)
console.log(`data/cookies.json now has keys: ${Object.keys(current).join(', ')}`)
