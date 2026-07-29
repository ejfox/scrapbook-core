-- Screenshot quality overhaul: per-capture quality signals + review queue.
--
-- screenshot_quality is the ONE field Unity filters on:
--   feed query -> WHERE screenshot_quality = 'accept' OR screenshot_quality IS NULL
--   (NULL = un-gated legacy row, treat as provisional-accept until backfilled)

alter table scraps
  add column if not exists capture_status     int2,        -- HTTP status at capture time (was computed then discarded)
  add column if not exists screenshot_quality text,        -- accept | reject | review | recapture_pending
  add column if not exists quality_category   text,        -- content|login_wall|captcha|error_page|cookie_wall|blank|css_broken|unknown
  add column if not exists quality_score      real,        -- 0..1 confidence this is good content
  add column if not exists quality_signals    jsonb,       -- {aspect,bytesPerMP,dominantPct,entropy,visionConfidence,domain}
  add column if not exists quality_checked_at timestamptz, -- when the gate last scored this row
  add column if not exists hide_shot_in_unity boolean default false; -- reject => text/color card, keep the scrap

-- Small review/reject sets: partial index keeps the triage queue query cheap.
create index if not exists scraps_quality_review_idx
  on scraps (screenshot_quality)
  where screenshot_quality is distinct from 'accept';

-- Human triage decisions = the label store that tunes the gate's thresholds over time.
create table if not exists screenshot_reviews (
  id            bigint generated always as identity primary key,
  scrap_id      text not null,
  category      text,           -- gate's category at review time
  decision      text not null,  -- approve | reject | recapture | skip
  gate_score    real,           -- gate's quality_score at review time (for calibration)
  reviewed_at   timestamptz not null default now()
);
create index if not exists screenshot_reviews_scrap_idx on screenshot_reviews (scrap_id);
