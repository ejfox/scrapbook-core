// Screenshot quality scoring — the shared brains behind the quality gate.
//
// Two-stage funnel:
//   Stage A (cheap, no LLM): fetch a tiny proportional derivative of the
//     Cloudinary image and read aspect ratio + entropy + dominant-colour share.
//     Catches CSS-less giants, blank/near-blank captures, and (via capture_status)
//     HTTP error pages — the bulk of the garbage, for free.
//   Stage B (only the ambiguous middle): a vision verdict folded into the
//     existing summarize-from-screenshot call (~free), which judges the actual
//     pixels so "Cloudflare docs" reads as content but a Cloudflare interstitial
//     reads as captcha.
//
// Analysis uses a `w_64` proportional derivative over plain HTTP — accurate
// aspect (proportional resize preserves it) + representative entropy/colour,
// and ZERO Cloudinary Admin-API calls (no rate-limit risk across ~8k rows).

import sharp from 'sharp'
import { summarizeFromScreenshot } from '../scripts/aiSummarization.mjs'

const HARD_ERROR_STATUSES = new Set([400, 401, 403, 404, 410, 429, 500, 502, 503])

// Insert a Cloudinary transformation right after `/upload/` so we fetch a small
// proportional PNG (64px wide, height auto). PNG avoids JPEG block artifacts
// polluting the entropy read.
export function derivativeUrl(screenshotUrl, transform = 'w_64,c_scale,f_png') {
  if (!screenshotUrl || !screenshotUrl.includes('/upload/')) return screenshotUrl
  return screenshotUrl.replace('/upload/', `/upload/${transform}/`)
}

// Fetch the derivative and compute pixel statistics. Returns null on fetch/decode
// failure (caller routes that to the review lane rather than guessing).
export async function analyzePixels(screenshotUrl, { timeoutMs = 15000 } = {}) {
  const url = derivativeUrl(screenshotUrl)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let buf
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) return null
    buf = Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }

  try {
    const img = sharp(buf)
    const meta = await img.metadata()
    const width = meta.width || 1
    const height = meta.height || 1
    const aspectRatio = height / width // tall pages (CSS-less giants) → large

    // Grayscale raw pixels for entropy + dominant-shade share.
    const { data } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true })
    const n = data.length
    // 16-bin histogram: coarse enough that near-identical shades group together,
    // so a "mostly white" page reads as one dominant bin.
    const bins = new Array(16).fill(0)
    for (let i = 0; i < n; i++) bins[data[i] >> 4]++
    let maxBin = 0
    let entropy = 0
    for (const c of bins) {
      if (c > maxBin) maxBin = c
      if (c > 0) { const p = c / n; entropy -= p * Math.log2(p) }
    }
    const dominantPct = maxBin / n // 0..1 share of the single most common shade

    return { width, height, aspectRatio, entropy, dominantPct }
  } catch {
    return null
  }
}

// Stage A: deterministic verdict from capture status + pixel stats.
// Returns { lane: 'accept'|'reject'|'stageB', category, score, reason }.
export function stageAVerdict({ captureStatus, pixels }) {
  if (captureStatus != null && HARD_ERROR_STATUSES.has(captureStatus)) {
    return { lane: 'reject', category: 'error_page', score: 0.05, reason: `http ${captureStatus}` }
  }
  if (!pixels) {
    return { lane: 'stageB', category: 'unknown', score: 0.5, reason: 'no pixel data' }
  }
  // Thresholds calibrated on a 157-shot corpus sample (entropy p50≈1.6, p75≈2.25;
  // dominant p50≈0.66, p75≈0.87; aspect p50≈2.5, p90≈6.3). Aggressive rejects are
  // safe here: the caller auto-recaptures rejects with the new cookie+networkidle
  // engine, so a false "blank" self-heals on recapture rather than losing data.
  const { aspectRatio, dominantPct, entropy } = pixels
  if (dominantPct >= 0.90 || entropy < 1.3) {
    return { lane: 'reject', category: 'blank', score: 0.05, reason: `blank (dom ${dominantPct.toFixed(2)}, ent ${entropy.toFixed(1)})` }
  }
  if (aspectRatio > 9) {
    return { lane: 'reject', category: 'css_broken', score: 0.1, reason: `giant aspect ${aspectRatio.toFixed(1)}` }
  }
  // Auto-accept the visually-busy top quartile — very likely real content.
  if (
    (captureStatus == null || captureStatus === 200) &&
    aspectRatio >= 0.4 && aspectRatio <= 6.5 && dominantPct < 0.70 && entropy >= 2.2
  ) {
    return { lane: 'accept', category: 'content', score: 0.9, reason: 'clean content' }
  }
  return { lane: 'stageB', category: 'unknown', score: 0.5, reason: 'ambiguous' }
}

// Full gate for a single scrap. `allowVision` gates the paid Stage-B call.
// Returns the columns to persist + a human-readable reason.
export async function gateScrap(scrap, { allowVision = true } = {}) {
  const signals = {}
  const pixels = scrap.screenshot_url ? await analyzePixels(scrap.screenshot_url) : null
  if (pixels) {
    signals.aspect = +pixels.aspectRatio.toFixed(2)
    signals.dominantPct = +pixels.dominantPct.toFixed(3)
    signals.entropy = +pixels.entropy.toFixed(2)
  }
  try { signals.domain = new URL(scrap.url).hostname.replace(/^www\./, '') } catch { /* no url */ }

  const a = stageAVerdict({ captureStatus: scrap.capture_status, pixels })
  if (a.lane !== 'stageB') {
    return {
      screenshot_quality: a.lane,
      quality_category: a.category,
      quality_score: a.score,
      quality_signals: signals,
      reason: `A:${a.reason}`,
    }
  }

  // Stage B — ambiguous middle. Fold the free vision verdict.
  if (!allowVision || !scrap.screenshot_url) {
    return {
      screenshot_quality: 'review',
      quality_category: a.category,
      quality_score: a.score,
      quality_signals: signals,
      reason: 'A:ambiguous → review (vision off)',
    }
  }

  let verdict = null
  try {
    const res = await summarizeFromScreenshot(scrap.screenshot_url, {
      scrapId: scrap.scrap_id, url: scrap.url, title: scrap.title, returnVerdict: true,
    })
    verdict = res?.verdict || null
    if (res?.summary) signals.gotSummary = true
  } catch { /* vision failed → review */ }

  if (!verdict) {
    return {
      screenshot_quality: 'review',
      quality_category: 'unknown',
      quality_score: 0.5,
      quality_signals: signals,
      reason: 'B:no verdict → review',
    }
  }

  signals.visionConfidence = verdict.confidence
  const good = verdict.category === 'content' && verdict.is_real_content
  const bad = ['login_wall', 'captcha', 'error_page', 'cookie_wall', 'blank', 'css_broken'].includes(verdict.category)

  if (good && verdict.confidence >= 0.7) {
    return { screenshot_quality: 'accept', quality_category: 'content', quality_score: verdict.confidence, quality_signals: signals, reason: `B:content ${verdict.confidence.toFixed(2)}` }
  }
  if (bad && verdict.confidence >= 0.8) {
    return { screenshot_quality: 'reject', quality_category: verdict.category, quality_score: +(1 - verdict.confidence).toFixed(2), quality_signals: signals, reason: `B:${verdict.category} ${verdict.confidence.toFixed(2)}` }
  }
  // Low-confidence or borderline → human.
  return { screenshot_quality: 'review', quality_category: verdict.category, quality_score: verdict.confidence, quality_signals: signals, reason: `B:low-conf ${verdict.category} ${verdict.confidence.toFixed(2)}` }
}
