#!/usr/bin/env node
// Parse Safari's binary Cookies.binarycookies and emit a Cookie-Editor-style
// JSON array ({name,value,domain}) for cookies whose domain matches a filter.
// Pipe the result into import_cookies.mjs.
//
//   node scripts/safari_cookies_to_json.mjs nytimes.com > /tmp/nyt.json
//   node scripts/import_cookies.mjs /tmp/nyt.json nytimes.com
//
// Reads Safari's cookie store (requires the terminal to have Full Disk Access).
// Prints ONLY to the given output; never logs cookie values to stderr.
import { readFileSync, existsSync } from 'fs'
import os from 'os'

const filter = (process.argv[2] || '').toLowerCase()

const CANDIDATES = [
  `${os.homedir()}/Library/Cookies/Cookies.binarycookies`,
  `${os.homedir()}/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies`,
]
const path = CANDIDATES.find((p) => existsSync(p))
if (!path) {
  console.error('No Safari Cookies.binarycookies found.')
  process.exit(1)
}

const buf = readFileSync(path)
if (buf.toString('ascii', 0, 4) !== 'cook') {
  console.error('Not a binarycookies file (bad magic).')
  process.exit(1)
}

const cStr = (off) => {
  let end = off
  while (end < buf.length && buf[end] !== 0) end++
  return buf.toString('utf8', off, end)
}

const numPages = buf.readUInt32BE(4)
const pageSizes = []
let p = 8
for (let i = 0; i < numPages; i++) { pageSizes.push(buf.readUInt32BE(p)); p += 4 }

const out = []
let pageStart = p
for (let i = 0; i < numPages; i++) {
  const base = pageStart
  const numCookies = buf.readUInt32LE(base + 4)
  for (let c = 0; c < numCookies; c++) {
    const cookieOff = buf.readUInt32LE(base + 8 + c * 4)
    const rec = base + cookieOff
    const urlOff = buf.readUInt32LE(rec + 16)
    const nameOff = buf.readUInt32LE(rec + 20)
    const valueOff = buf.readUInt32LE(rec + 28)
    const domain = cStr(rec + urlOff)
    const name = cStr(rec + nameOff)
    const value = cStr(rec + valueOff)
    if (!name) continue
    if (filter && !domain.toLowerCase().includes(filter)) continue
    out.push({ name, value, domain })
  }
  pageStart += pageSizes[i]
}

process.stdout.write(JSON.stringify(out, null, 2) + '\n')
console.error(`Extracted ${out.length} cookie(s)${filter ? ` matching "${filter}"` : ''} from Safari.`)
