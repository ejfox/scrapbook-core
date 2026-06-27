#!/usr/bin/env node
/**
 * browser_extract.mjs — "browser tier" content extraction for hard-bot paywalled
 * sites (NYT, WSJ, Bloomberg...) that defeat plain fetch + cookies. Drives the
 * REAL Chrome binary with a DEDICATED, persistent automation profile you log into
 * once. Real Chrome fingerprint beats bot detection; your real login beats the
 * paywall. Reusable: log in once per site, then batch-extract forever.
 *
 * Modes:
 *   --login [url]    Open a visible Chrome window so you can sign in (default NYT).
 *                    Logs in are persisted to the automation profile. Close the
 *                    window (or Ctrl-C) when done.
 *   --url <url>      Extract one URL's article text (prints JSON to stdout).
 *   --urls-file <f>  Extract every URL (one per line) in file f.
 *
 * The automation profile lives in data/chrome-profile (gitignored). It is SEPARATE
 * from your normal Chrome profiles, so it never conflicts with a running Chrome.
 */
import { addExtra } from 'puppeteer-extra'
import puppeteerVanilla from 'puppeteer'
import Stealth from 'puppeteer-extra-plugin-stealth'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import fs from 'fs'
import path from 'path'

// Stealth patches the automation tells (navigator.webdriver, CDP runtime, etc.)
// that hard-bot sites like NYT/Akamai fingerprint. Required to get past them.
const puppeteer = addExtra(puppeteerVanilla)
puppeteer.use(Stealth())

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PROFILE_DIR = path.resolve(process.cwd(), 'data/chrome-profile')

function parseArgs(argv) {
  const o = { mode: null, url: null, urlsFile: null, headless: 'new' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--login') { o.mode = 'login'; if (argv[i + 1] && !argv[i + 1].startsWith('--')) o.url = argv[++i] }
    else if (argv[i] === '--url') { o.mode = 'url'; o.url = argv[++i] }
    else if (argv[i] === '--urls-file') { o.mode = 'urls'; o.urlsFile = argv[++i] }
    else if (argv[i] === '--headful') { o.headless = false }
  }
  return o
}

async function launch(headless) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true })
  return puppeteer.launch({
    executablePath: CHROME,
    userDataDir: PROFILE_DIR,
    headless,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
    defaultViewport: headless ? { width: 1280, height: 1800 } : null,
  })
}

async function extractFromPage(page, url) {
  // networkidle2 + scroll + settle: NYT-style articles hydrate client-side, so we
  // must wait for the body to render before reading it (domcontentloaded is too early).
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {})
  await new Promise((r) => setTimeout(r, 3000))

  const html = await page.content()
  const dom = new JSDOM(html, { url })
  const article = new Readability(dom.window.document).parse()
  if (article && article.textContent && article.length >= 300) {
    return { url, title: article.title, content: article.textContent, length: article.length, method: 'browser_readability' }
  }
  // Fallback: pull article paragraphs / visible body text straight from the rendered DOM.
  const domText = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('article p, section[name=articleBody] p')].map((p) => p.innerText).join('\n')
    return ps.length > 200 ? ps : (document.body?.innerText || '')
  })
  return { url, title: await page.title(), content: domText, length: domText.length, method: 'browser_dom' }
}

async function loginMode(url) {
  const target = url || 'https://www.nytimes.com/login'
  console.error(`Opening a visible Chrome window at ${target}.`)
  console.error('Sign in to your subscription(s) (NYT, WSJ, etc.), then just CLOSE the window when done.')
  const browser = await launch(false)
  const page = (await browser.pages())[0] || await browser.newPage()
  await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => {})
  // Wait until the user closes the window; cookies persist to the profile dir on close.
  await new Promise((resolve) => {
    browser.on('disconnected', resolve)
    setTimeout(() => { try { browser.close() } catch {} resolve() }, 10 * 60 * 1000) // 10-min safety cap
  })
  console.error('Login session saved to data/chrome-profile.')
}

async function extractMode(urls, headless) {
  const browser = await launch(headless)
  const out = []
  try {
    const page = (await browser.pages())[0] || await browser.newPage()
    for (const url of urls) {
      try {
        const r = await extractFromPage(page, url)
        out.push(r)
        console.error(`  ${r.length} chars [${r.method}] :: ${(r.title || '').slice(0, 50)}`)
      } catch (e) {
        out.push({ url, content: '', length: 0, error: e.message })
        console.error(`  FAIL ${e.message.slice(0, 60)} :: ${url.slice(0, 50)}`)
      }
    }
  } finally {
    await browser.close()
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
}

const o = parseArgs(process.argv.slice(2))
if (o.mode === 'login') await loginMode(o.url)
else if (o.mode === 'url') await extractMode([o.url], o.headless)
else if (o.mode === 'urls') {
  const urls = fs.readFileSync(o.urlsFile, 'utf-8').split('\n').map((s) => s.trim()).filter(Boolean)
  await extractMode(urls, o.headless)
} else {
  console.error('Usage: node scripts/browser_extract.mjs --login [url] | --url <url> | --urls-file <file> [--headful]')
  process.exit(1)
}
