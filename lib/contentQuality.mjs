// Shared guards that stop the pipeline from producing garbage on dead/thin pages.
//
// Two failure modes this addresses:
//  1. Location hallucination — a near-empty fetched page (e.g. 74 chars of nav)
//     gives the model nothing real, so it fabricates a confident city.
//  2. Error-page summaries — the summarizer is fed a 404 / DNS-failure / "page
//     not found" page and dutifully summarizes the error as if it were content.

// Minimum real-content length before we trust a location extraction.
export const MIN_LOCATION_CONTENT = 200

// Hard signals: unambiguous browser/network/DNS/API failures. Match at any length.
const HARD_ERROR_RE =
  /(ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_\w+|ERR_TIMED_OUT|net::ERR|DNS_PROBE|this site can.?t be reached|took too long to respond|SSL_ERROR_|connection (was )?reset|refused to connect|request failed with status code|ECONNREFUSED|ETIMEDOUT|error processing https?:)/i

// Soft signals: 404 / gone / forbidden wording. Only trust these on SHORT pages —
// a real long article may mention "404" or "not found" incidentally.
const SOFT_ERROR_RE =
  /(\b404\b|page not found|page you (were looking for|requested)|page (cannot|can.?t|could ?n.?t) be found|page (doesn.?t|does not) exist|\b410 gone\b|\b403 forbidden\b|access denied|no longer available|this page isn.?t working)/i

/**
 * True when the fetched page content is an error / dead / unreachable page and
 * should NOT be summarized. Use at summary time on the raw fetched content.
 */
export function looksLikeErrorPage(text) {
  if (!text) return false
  const t = String(text)
  if (HARD_ERROR_RE.test(t)) return true
  // Soft wording only counts when the page is short (real articles are long).
  if (t.trim().length < 1500 && SOFT_ERROR_RE.test(t)) return true
  return false
}

/**
 * True when an ALREADY-GENERATED summary is actually describing an error page
 * (used by the cleanup pass over stored summaries, where the summary text is
 * long but explicitly narrates a 404 / DNS failure).
 */
// Strong, specific patterns that mean the SUMMARY is characterizing an error /
// blocked / not-found page — not merely a real page that happens to contain a
// phrase like "no longer available" or "access denied" in passing. Kept narrow
// on purpose so real product/article pages are never nuked.
// Network/DNS failures are definitive anywhere they appear.
const ANYWHERE_ERROR_RE = /net::ERR|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/i

// These only count near the START of the summary. A real page's summary may
// mention "404 Error Page" as one bullet deep in a long description of the
// site's design — but a summary that is genuinely ABOUT a dead page leads with
// it. Restricting to the head eliminates that false-positive class.
const HEAD_ERROR_PATTERNS = [
  /\(?\b404\b[^.\n]{0,25}(error|not[- ]?found|page)/i, // "404 Error Page", "404 not found"
  /\berror page\b/i, // "(404 Error Page)", "an Instagram error page"
  /\bpage not found\b/i,
  /bot[- ]?detection|bot detection block/i,
  /access denied[^.\n]{0,30}(block|bot|page|error)/i,
  /(this|the) (page|content|url|site)[^.\n]{0,45}(could ?n.?t|cannot|can.?t) be (found|reached|loaded|displayed)/i,
  /page you (were looking for|requested)[^.\n]{0,45}(not|no longer|cannot|could ?n.?t)/i,
  /site can.?t be reached/i,
]

export function summaryDescribesErrorPage(summary) {
  if (!summary) return false
  const s = String(summary)
  if (ANYWHERE_ERROR_RE.test(s)) return true
  const head = s.slice(0, 220) // only the opening frames it as an error page
  return HEAD_ERROR_PATTERNS.some((re) => re.test(head))
}

/**
 * True when there isn't enough real text to ground a location extraction.
 */
export function isThinForLocation(text) {
  return !text || String(text).trim().length < MIN_LOCATION_CONTENT
}
