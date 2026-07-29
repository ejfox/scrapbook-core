// Domain policy + cookie loading for the screenshot capture engine.
//
// Single source of truth for auth cookies is data/cookies.json — the SAME file
// contentExtractor.mjs already uses, in the SAME format:
//   { "nytimes.com": "cookie1=val; cookie2=val", "x.com": "auth_token=…; ct0=…" }
// The value is the raw Cookie request-header string for that domain (DevTools →
// Network → any request → Request Headers → cookie). Gitignored — never commit.
//
// We parse that header string into Puppeteer cookie objects so page.setCookie()
// can unwall logged-in-only pages (X/Twitter/Instagram/Facebook).

import { readFileSync, existsSync } from 'fs'
import path from 'path'

// Hosts that (a) require auth cookies to render real content and (b) look best
// in a portrait card. Matched by exact host or parent domain.
export const SOCIAL_HOSTS = [
  'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'linkedin.com',
  'threads.net', 'tiktok.com',
]

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() }
  catch { return '' }
}

// True if the URL belongs to a login-walled social platform.
export function isSocialUrl(url) {
  const host = hostOf(url)
  if (!host) return false
  return SOCIAL_HOSTS.some(d => host === d || host.endsWith('.' + d))
}

let _cookieMap = null
function loadCookieMap() {
  if (_cookieMap !== null) return _cookieMap
  _cookieMap = {}
  try {
    const p = path.resolve(process.cwd(), 'data/cookies.json')
    if (existsSync(p)) _cookieMap = JSON.parse(readFileSync(p, 'utf-8')) || {}
  } catch (e) {
    console.warn('Could not load data/cookies.json:', e.message)
    _cookieMap = {}
  }
  return _cookieMap
}

// Find the cookie value for a URL by exact host or any parent-domain key.
// Returns { domain, value } where value is either a header string or an array.
function cookieEntryForUrl(url) {
  const host = hostOf(url)
  if (!host) return null
  const map = loadCookieMap()
  for (const domain of Object.keys(map)) {
    if (host === domain || host.endsWith('.' + domain)) {
      return { domain, value: map[domain] }
    }
  }
  return null
}

// Parse a raw "a=b; c=d" Cookie header into Puppeteer cookie objects scoped to
// the domain. Leading-dot domain so subdomains (cooking.nytimes.com) match too.
function headerToCookies(header, domain) {
  return String(header)
    .split(';')
    .map(pair => pair.trim())
    .filter(Boolean)
    .map(pair => {
      const eq = pair.indexOf('=')
      if (eq === -1) return null
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (!name) return null
      return { name, value, domain: '.' + domain, path: '/' }
    })
    .filter(Boolean)
}

// Public: Puppeteer cookie objects for this URL, or [] if none configured.
// Accepts both the header-string format (like nytimes) and a pre-built array
// of Puppeteer cookie objects (in case a future export writes objects directly).
export function getCookiesForUrl(url) {
  const entry = cookieEntryForUrl(url)
  if (!entry) return []
  const { domain, value } = entry
  if (Array.isArray(value)) {
    // Already cookie objects — ensure a domain is set.
    return value
      .filter(c => c && c.name)
      .map(c => ({ path: '/', domain: c.domain || '.' + domain, ...c }))
  }
  if (typeof value === 'string') return headerToCookies(value, domain)
  return []
}
