# Screenshot Quality Overhaul — Handoff / Resume Note

_Last updated: 2026-07-29. Plan: `~/.claude/plans/shiny-plotting-starlight.md`._

## TL;DR
Built a full screenshot quality pipeline (capture-engine rewrite → automated gate → auto-recapture → human triage). **Migration applied, gate verified correct on real data, recapture actively healing scraps.** Code is written & syntax-clean but **NOT committed yet** (still on `main`).

## State at handoff
- **DB quality columns are LIVE** (migration `20260729000000_add_screenshot_quality.sql` pushed via `supabase db push`).
- Gate run on 200 recent shots: **~27% accept / ~73% reject** (blank/walls + CSS-less giants) — confirmed the corpus is genuinely full of bad captures.
- Recapture healing works: verified reject→accept (CSS-less giants heal via the new `networkidle2`+`fonts.ready` wait).
- **Recapture pass #1 complete: healed=15 (giants), stillBad=131 (walls/CAPTCHAs — need social cookies), terminal=0.** Those 131 are at recapture attempt 1/2; a 2nd `recapture` run after cookies are added will heal social walls, then cap the rest terminal.
- Current counts: accept 69, reject 127, review 4, **ungated (NULL) ~9786**, total 9986, missing summary ~2968.
- OpenRouter proxy credits: **funded (~$35 added this session)** — vision calls return 200.

## Background processes (DIED on restart — both resumable, just re-run)
1. **Summary backfill:** `node scripts/resummarize_parallel.mjs 5` (log `/tmp/resummarize.log`). Fills missing `summary`. Idempotent — re-queries `summary IS NULL`.
2. **Screenshot recapture:** `node scripts/quality_backfill.mjs recapture` (log `/tmp/recapture.log`). Re-shoots retryable rejects. Idempotent — targets `screenshot_quality='reject'` with `recaptures < 2`.

## What was built (all syntax-clean, tested where noted)
- `lib/captureDomains.mjs` — social-host detection + per-domain cookie loader (parses `data/cookies.json` header strings → Puppeteer cookies). **Tested.**
- `lib/screenshotQuality.mjs` — the gate brains: `analyzePixels` (sharp on a `w_64` Cloudinary derivative), `stageAVerdict` (calibrated thresholds), `gateScrap` (Stage A + folded free vision verdict). **Tested live.**
- `scripts/generateScreenshot.mjs` — REWRITTEN: puppeteer-extra stealth, per-domain cookies, `networkidle2`+`fonts.ready`, fixed viewport (1200×1500 @2x; social 1080×1350), HTTP-status gate + in-page wall/CAPTCHA classifier, `opts.force` for recapture. Returns `{url,public_id,capture_status,category,blocked}`. **Tested live.**
- `scripts/aiSummarization.mjs` — vision prompt now emits a JSON quality verdict on line 1; `splitVisionVerdict()` parses it; `summarizeFromScreenshot(...,{returnVerdict:true})` returns `{summary,verdict}`. **Tested.**
- `scripts/index.mjs` — both capture call sites persist `capture_status`/quality; vision path skips blocked shots.
- `scripts/quality_gate.mjs` — batch gate driver (`--dry`, `--no-vision`, `--limit`, `--regate`, `--workers`).
- `scripts/quality_backfill.mjs` — corpus orchestrator: `classify` / `recapture` / `all` phases.
- `scripts/import_cookies.mjs` — normalize Cookie-Editor JSON export → `data/cookies.json`. **Smoke-tested.**
- `scripts/api-server.mjs` — added `/review/queue|decide|recapture|bulk` + serves `/review`.
- `review.html` — keyboard triage UI (a/r/c/s, undo, bulk-by-category, image preload).
- `migrations/add_screenshot_quality.sql` (root, human-readable) + `supabase/migrations/20260729000000_...sql` (CLI, APPLIED).
- `CLAUDE.md` — documented new columns + pipeline commands.

## RESUME — do this on restart
```bash
cd /Users/ejfox/code/scrapbook-core

# 1. (optional) restart the two backfills that died:
node scripts/resummarize_parallel.mjs 5 > /tmp/resummarize.log 2>&1 &   # summaries
node scripts/quality_backfill.mjs recapture > /tmp/recapture.log 2>&1 & # finish healing the 131 rejects

# 2. Classify the whole corpus (9786 ungated) to get the full damage map + populate every card:
node scripts/quality_backfill.mjs classify --dry --no-vision   # free preview of Stage-A split
node scripts/quality_backfill.mjs classify                     # real: writes columns, vision on ambiguous middle

# 3. Human triage of the 'review' lane:
node scripts/api-server.mjs   # → http://localhost:3001/review
```

## Next decisions / open threads
- **COMMIT the work** — still on `main`, nothing committed. Branch first, then commit the verified set. (User was asked, said "just get some scraps working" — commit still pending.)
- **Social cookies not yet provided** — the ~1,166 X/FB/IG login walls won't heal until you export logged-in cookies: `node scripts/import_cookies.mjs <export.json>`. Until then they recapture, re-fail, hit the 2-try cap → terminal reject (correct).
- **Full-corpus classify not yet run** — only 200 rows gated so far; 9786 still `NULL` (Unity treats NULL as provisional-accept).
- Threshold tuning: gate thresholds in `lib/screenshotQuality.mjs` `stageAVerdict` are calibrated on a 157-shot sample; the `screenshot_reviews` table is the label store to retune them later.

## Unity note
Feed query: `WHERE screenshot_quality = 'accept' OR screenshot_quality IS NULL`. `hide_shot_in_unity=true` rejects should render as text/color cards (scrap still has title/summary).
