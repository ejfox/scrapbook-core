#!/usr/bin/env node

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { writeFile, mkdir } from 'fs/promises'

dotenv.config()

const DOMAIN_FAMILIES = {
  news: [
    'nytimes.com',
    'theguardian.com',
    'wired.com',
    'bloomberg.com',
    'propublica.org',
    'washingtonpost.com',
    'theatlantic.com',
    'npr.org',
    'apnews.com',
    'cnn.com',
    'latimes.com',
    '404media.co',
    'nysfocus.com',
    'newyorker.com',
    'vox.com',
    'nbcnews.com',
  ],
  codeResearch: [
    'github.com',
    'arxiv.org',
    'nature.com',
    'huggingface.co',
    'npmjs.com',
    'medium.com',
  ],
  reference: [
    'en.wikipedia.org',
    'lesswrong.com',
    'reddit.com',
  ],
  arenaText: [],
}

const DEFAULT_PER_BUCKET = 4

function parseArgs(argv) {
  const options = {
    out: 'data/relationship-audit/mixed-review-batch.json',
    perBucket: DEFAULT_PER_BUCKET,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out' && argv[i + 1]) {
      options.out = argv[i + 1]
      i += 1
    } else if (arg === '--per-bucket' && argv[i + 1]) {
      options.perBucket = Number.parseInt(argv[i + 1], 10)
      i += 1
    }
  }

  return options
}

function getSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!process.env.SUPABASE_URL || !key) {
    throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY')
  }

  return createClient(process.env.SUPABASE_URL, key, {
    auth: { persistSession: false },
  })
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function isThinOrBrokenContent(content = '') {
  const text = String(content)
  const lower = text.toLowerCase()
  if (!text || text.length < 180) return true
  if (lower.startsWith('error processing ')) return true
  if (/(^|\s)(about press copyright contact us creators advertise developers)(\s|$)/i.test(lower)) return true
  return false
}

function isImageFilenameLike(title = '', content = '') {
  const haystack = `${title} ${content}`.toLowerCase()
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(haystack)
}

function isVisualMediaUrl(url = '') {
  return /\.(png|jpe?g|gif|webp|mp4|mov)(\?|$)/i.test(url.toLowerCase())
}

async function fetchRecentScraps(supabase, source, limit = 250) {
  const { data, error } = await supabase
    .from('scraps')
    .select('scrap_id, source, title, url, content, updated_at')
    .eq('source', source)
    .not('content', 'is', null)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (error) {
    throw error
  }

  return data || []
}

function selectPinboardBuckets(scraps, perBucket) {
  const buckets = {
    news: [],
    codeResearch: [],
    reference: [],
  }

  for (const scrap of scraps) {
    if (isThinOrBrokenContent(scrap.content)) continue
    const host = hostFromUrl(scrap.url)
    if (!host || host.includes('youtube.com') || host.includes('youtu.be') || host.includes('x.com') || host.includes('twitter.com')) {
      continue
    }

    for (const [bucket, hosts] of Object.entries(DOMAIN_FAMILIES)) {
      if (bucket === 'arenaText') continue
      if (buckets[bucket].length >= perBucket) continue
      if (hosts.includes(host)) {
        buckets[bucket].push({
          scrap_id: scrap.scrap_id,
          source: scrap.source,
          title: scrap.title,
          url: scrap.url,
          bucket,
          host,
        })
        break
      }
    }
  }

  return buckets
}

function selectArenaText(scraps, perBucket) {
  const picked = []

  for (const scrap of scraps) {
    if (picked.length >= perBucket) break
    if (isThinOrBrokenContent(scrap.content)) continue
    if (isImageFilenameLike(scrap.title, scrap.content)) continue
    if (isVisualMediaUrl(scrap.url || '')) continue
    if ((scrap.url || '').includes('youtube.com') || (scrap.url || '').includes('youtu.be')) continue
    if ((scrap.url || '').includes('twitter.com') || (scrap.url || '').includes('x.com')) continue
    if ((scrap.url || '').includes('reddit.com')) continue
    if (!/\s/.test(String(scrap.content))) continue

    picked.push({
      scrap_id: scrap.scrap_id,
      source: scrap.source,
      title: scrap.title,
      url: scrap.url,
      bucket: 'arenaText',
      host: hostFromUrl(scrap.url),
    })
  }

  return picked
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const supabase = getSupabase()

  const [pinboard, arena] = await Promise.all([
    fetchRecentScraps(supabase, 'pinboard', 350),
    fetchRecentScraps(supabase, 'arena', 250),
  ])

  const pinboardBuckets = selectPinboardBuckets(pinboard, options.perBucket)
  const arenaBucket = selectArenaText(arena, options.perBucket)

  const items = [
    ...pinboardBuckets.news,
    ...pinboardBuckets.codeResearch,
    ...pinboardBuckets.reference,
    ...arenaBucket,
  ]

  const out = {
    generated_at: new Date().toISOString(),
    per_bucket: options.perBucket,
    counts: {
      news: pinboardBuckets.news.length,
      codeResearch: pinboardBuckets.codeResearch.length,
      reference: pinboardBuckets.reference.length,
      arenaText: arenaBucket.length,
      total: items.length,
    },
    items,
    scrap_ids: items.map((item) => item.scrap_id),
  }

  const dir = options.out.split('/').slice(0, -1).join('/')
  if (dir) {
    await mkdir(dir, { recursive: true })
  }
  await writeFile(options.out, `${JSON.stringify(out, null, 2)}\n`)
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error('Failed to build relationship review batch:', error.message)
  process.exit(1)
})
