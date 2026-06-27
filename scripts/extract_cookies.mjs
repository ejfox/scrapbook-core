#!/usr/bin/env node
/**
 * extract_cookies.mjs — pull cookies for specific domains directly out of Chrome's
 * cookie store on macOS and write them to data/cookies.json, the way yt-dlp's
 * --cookies-from-browser does. Lets the content extractor use the user's own
 * subscriptions (e.g. NYT) to fetch paywalled content they are entitled to.
 *
 * Algorithm (matches yt-dlp yt_dlp/cookies.py MacChromeCookieDecryptor):
 *   - key from Keychain: `security find-generic-password -w -a Chrome -s "Chrome Safe Storage"`
 *   - PBKDF2-HMAC-SHA1(password, salt="saltysalt", iterations=1003, keylen=16)
 *   - AES-128-CBC, IV = 16 spaces, "v10"-prefixed values
 *   - strip a leading 32-byte SHA256 host hash from plaintext when meta.version >= 24
 *
 * Usage:
 *   node scripts/extract_cookies.mjs --domains nytimes.com,theatlantic.com [--profile Default]
 *
 * SECURITY: writes live session cookies to data/cookies.json (gitignored). The first
 * run pops a macOS Keychain dialog ("security wants to use Chrome Safe Storage") —
 * click Allow. Only the named domains are written; the rest of your jar is untouched.
 */
import { execSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'

function parseArgs(argv) {
  const out = { profile: 'Default', domains: [], outFile: 'data/cookies.json' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--domains' && argv[i + 1]) { out.domains = argv[++i].split(',').map((s) => s.trim()).filter(Boolean) }
    else if (argv[i] === '--profile' && argv[i + 1]) { out.profile = argv[++i] }
    else if (argv[i] === '--out' && argv[i + 1]) { out.outFile = argv[++i] }
  }
  return out
}

function getKeychainKey() {
  // -w writes only the password; -a account, -s service
  const pw = execSync('security find-generic-password -w -a Chrome -s "Chrome Safe Storage"', {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (!pw) throw new Error('Empty Keychain password for "Chrome Safe Storage"')
  return crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1')
}

function decryptV10(encrypted, key, stripHashPrefix) {
  if (!encrypted || encrypted.length < 3) return null
  const version = encrypted.slice(0, 3).toString('latin1')
  if (version !== 'v10') {
    // Not encrypted with the keychain scheme (rare); treat remainder as plaintext.
    return encrypted.toString('utf-8')
  }
  const ciphertext = encrypted.slice(3)
  const iv = Buffer.alloc(16, ' ')
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv)
  decipher.setAutoPadding(true) // removes PKCS7 padding
  let plaintext
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    return null
  }
  // Chrome >= v24 metadata prepends a 32-byte SHA256(host_key) integrity hash.
  if (stripHashPrefix && plaintext.length >= 32) plaintext = plaintext.slice(32)
  return plaintext.toString('utf-8')
}

function hostMatchesDomain(hostKey, domain) {
  const h = hostKey.replace(/^\./, '').toLowerCase()
  return h === domain || h.endsWith('.' + domain)
}

function main() {
  const { profile, domains, outFile } = parseArgs(process.argv.slice(2))
  if (!domains.length) {
    console.error('Usage: node scripts/extract_cookies.mjs --domains nytimes.com,theatlantic.com [--profile Default]')
    process.exit(1)
  }

  const cookiesPath = path.join(os.homedir(), 'Library/Application Support/Google/Chrome', profile, 'Cookies')
  if (!fs.existsSync(cookiesPath)) {
    console.error(`Cookie store not found for profile "${profile}": ${cookiesPath}`)
    process.exit(1)
  }

  console.error('Requesting Chrome Safe Storage key from Keychain (approve the macOS dialog if it appears)...')
  const key = getKeychainKey()

  // Copy the DB to avoid the lock held by a running Chrome.
  const tmp = path.join(os.tmpdir(), `_chrome_cookies_${Date.now()}.db`)
  fs.copyFileSync(cookiesPath, tmp)
  let result = {}
  try {
    const db = new Database(tmp, { readonly: true })
    const metaVersion = Number(db.prepare("SELECT value FROM meta WHERE key='version'").get()?.value || 0)
    const stripHashPrefix = metaVersion >= 24
    const rows = db.prepare('SELECT host_key, name, encrypted_value, value FROM cookies').all()
    db.close()

    for (const domain of domains) {
      const matched = rows.filter((r) => hostMatchesDomain(r.host_key, domain))
      const pairs = []
      for (const r of matched) {
        let val = r.value
        if ((!val || val.length === 0) && r.encrypted_value && r.encrypted_value.length) {
          val = decryptV10(r.encrypted_value, key, stripHashPrefix)
        }
        if (val && r.name) pairs.push(`${r.name}=${val}`)
      }
      if (pairs.length) {
        result[domain] = pairs.join('; ')
        console.error(`  ${domain}: ${pairs.length} cookies`)
      } else {
        console.error(`  ${domain}: 0 cookies (are you signed in on profile "${profile}"?)`)
      }
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }

  // Merge with any existing cookies.json so multiple runs accumulate domains.
  const outPath = path.resolve(process.cwd(), outFile)
  let existing = {}
  try { if (fs.existsSync(outPath)) existing = JSON.parse(fs.readFileSync(outPath, 'utf-8')) } catch {}
  const merged = { ...existing, ...result }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2))
  console.error(`\nWrote ${Object.keys(result).length} domain(s) to ${outFile} (total: ${Object.keys(merged).length})`)
}

main()
