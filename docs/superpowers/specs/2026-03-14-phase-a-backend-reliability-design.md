# Phase A: Backend Reliability — Design Spec

**Goal:** Harden the Trend Watcher backend for production reliability, smarter scoring, cost visibility, and data persistence.

**Scope:** 7 backend changes. No frontend changes (Phase B handles frontend via Lovable).

**Runtime:** Node.js CommonJS on Mac Mini, Supabase DB, OpenRouter AI, Slack notifications.

---

## 1. Pipeline Crash Recovery (DB-Backed Lock)

### Problem
`pipelineRunning` is an in-memory boolean in `src/server.js`. If the process crashes mid-pipeline, the flag is never cleared. The scheduler and `/trigger/scrape` endpoint think the pipeline is still running indefinitely until manual restart.

### Solution
Replace in-memory flag with DB-backed state from the `pipeline_runs` table.

### Behavior
- **On server startup:** Query `pipeline_runs` for any row with `status = 'running'` AND `started_at` older than 15 minutes. Auto-mark as `failed` with `error_message: 'Recovered after process crash'`. Log + write `pipeline_events` row with `severity: 'warning'`.
- **On `/trigger/scrape` call:** Before checking `isPipelineRunning()`, also call `recoverOrphanedRuns()` to catch stuck runs that didn't crash the process (e.g., unhandled promise that never resolved). This provides periodic recovery without a separate timer.
- **`isPipelineRunning()` function:** New async function in `src/database/supabase.js`. Queries `SELECT status FROM pipeline_runs WHERE status = 'running' LIMIT 1`. Returns boolean.
- **`/trigger/scrape` endpoint:** Calls `recoverOrphanedRuns()` then `isPipelineRunning()` instead of checking in-memory flag. Returns 409 if running.
- **`/status/pipeline` endpoint:** Reads from `pipeline_runs` table (latest row) instead of in-memory vars.
- **Pipeline start/end:** Already writes `status = 'running'` at start and `'success'`/`'partial'`/`'failed'` at end. No change needed here.

### Files
- Modify: `src/server.js` — remove in-memory `pipelineRunning`, `lastRun`, `lastRunDuration`, `lastRunResult` vars; replace with DB reads
- Modify: `src/database/supabase.js` — add `isPipelineRunning()`, `recoverOrphanedRuns()`
- Modify: `src/pipeline.js` — no change (already writes pipeline_runs)

### Constraints
- Recovery timeout: 15 minutes (configurable constant `PIPELINE_MAX_DURATION_MS = 15 * 60 * 1000`)
- Recovery runs on startup AND on each `/trigger/scrape` call (catches stuck runs without restart)

---

## 2. Selector Health Monitoring (Slack + Pipeline Events)

### Problem
TikTok changes DOM selectors frequently. When they do, the scraper silently returns 0 videos. The scheduler's backoff kicks in after 3 empty scrapes, but there's no proactive alert. The team doesn't know the scraper is broken until they check the app.

### Solution
Periodic selector health check that alerts via Slack and writes to `pipeline_events` for frontend visibility.

### Behavior
- **Existing `checkSelectors()` function:** Already exists in `src/scrapers/health-check.js`. Launches headless browser, navigates to TikTok, verifies selectors exist. Returns `{ ok: boolean, details: string }`. Accepts injectable `deps` for testing.
- **Enhancement:** Extend `checkSelectors()` to also send Slack alerts on failure and write `pipeline_events` rows.
- **Scheduler integration:** `src/scheduler.js` already imports from `./scrapers/health-check` and has a 6-hour health check cron. Enhance the existing call to use the new alert behavior.
- **On failure:** Sends Slack alert with failed selector details via `src/notifications/slack.js`. Writes `pipeline_events` row: `event_type: 'selector_health_failed'`, `severity: 'critical'`, `message: <details>`.
- **On success:** Writes `pipeline_events` row: `event_type: 'selector_health_ok'`, `severity: 'info'`. No Slack (avoid noise).
- **Throttle:** Only send one Slack alert per 24 hours for the same failure (avoid spam if check runs every 6h and selectors stay broken).

### Files
- Modify: `src/scrapers/health-check.js` — enhance existing `checkSelectors()` to write pipeline_events and trigger Slack alerts
- Modify: `src/scheduler.js` — pass `createPipelineEvent` and Slack alert function as deps to `checkSelectors()`
- Modify: `src/notifications/slack.js` — add `alertSelectorHealth(details)` function
- Modify: `src/database/supabase.js` — `createPipelineEvent()` already exists, no change needed

### Constraints
- Health check timeout: 30 seconds max (already configured in existing function)
- Browser instance must be closed even if check fails (already uses try/finally)
- Selectors to check: defined in `SELECTORS` constant in `src/scrapers/tiktok.js` (already exists)

---

## 3. Recency Decay in Scoring (Exponential, 12h Half-Life)

### Problem
Current composite score treats a 2-hour-old trend the same as a 72-hour-old trend. Old trends clutter the top of rankings even when newer, more actionable trends exist.

### Solution
Apply exponential decay multiplier to the composite trend score based on trend age.

### Formula
```
recencyMultiplier = Math.pow(0.5, ageHours / HALF_LIFE_HOURS)

Where:
  ageHours = (now - scraped_at) / (1000 * 60 * 60)
  HALF_LIFE_HOURS = 12 (configurable constant)

Result:
  0h  = 1.00 (full score)
  6h  = 0.71
  12h = 0.50
  24h = 0.25
  36h = 0.125
  48h = 0.0625
  72h = 0.016
```

### Behavior
- New pure function `calculateRecencyMultiplier(scrapedAt, now)` in `src/scoring/engagement.js`. Returns float 0.0-1.0.
- Applied as final step in `compositeScore()` in `src/scoring/classifier.js`: `score = rawScore * recencyMultiplier`
- `trend_score` column already exists — stores the decayed score. No new column needed.
- Score is recalculated each pipeline run when the trend is re-seen. If a trend isn't re-scraped, its stored score reflects when it was last scored.

### Files
- Modify: `src/scoring/engagement.js` — add `calculateRecencyMultiplier()`
- Modify: `src/scoring/classifier.js` — apply multiplier in `compositeScore()`
- Modify: `tests/scoring.test.js` — add tests for recency decay

### Constraints
- Pure function, no side effects, no I/O
- Must handle missing/null `scraped_at` gracefully (return 1.0 — no penalty)
- Half-life exported as named constant for testability

---

## 4. OpenRouter Cost Tracking + Slack Alerts

### Problem
No visibility into AI API costs. A bad scrape or prompt regression could burn through OpenRouter credits without anyone noticing.

### Solution
Track token usage per pipeline run. Log to `pipeline_runs`. Alert via Slack if daily spend exceeds threshold. No hard cap.

### Behavior
- **Token tracking:** `callOpenRouter()` exists as two independent implementations — one in `src/ai/analyzer.js` and one in `src/ai/brand-fit.js`. Both must be modified identically. Each already receives `usage` in the API response (`prompt_tokens`, `completion_tokens`, `total_tokens`). Extract and return these alongside the parsed result.
- **Per-run accumulation:** Pipeline accumulates `prompt_tokens` and `completion_tokens` separately across all LLM calls (trash gate + deep analysis + synthesis + brand fit). Module-level counters reset at pipeline start. `tokens_used` in DB stores the total (`prompt + completion`).
- **Cost estimation:** Gemini Flash pricing: $0.10/1M input tokens, $0.40/1M output tokens (OpenRouter rates). Calculate `estimated_cost_usd = (prompt_tokens * 0.10 + completion_tokens * 0.40) / 1_000_000`. Per-type breakdown held in memory during the run for cost calculation; only totals persisted.
- **DB persistence:** Write `tokens_used` (total) and `estimated_cost_usd` to `pipeline_runs` row via `updatePipelineRun()`.
- **Daily alert:** After each run, sum today's `estimated_cost_usd` from `pipeline_runs`. If total exceeds `DAILY_COST_ALERT_USD` (default: $5.00, from env var), send one Slack alert per day.

### DB Migration
Add to `pipeline_runs` table:
- `tokens_used INTEGER DEFAULT 0`
- `estimated_cost_usd NUMERIC(8,4) DEFAULT 0`

### Files
- Modify: `src/ai/analyzer.js` — extract and return token usage from `callOpenRouter()`
- Modify: `src/ai/brand-fit.js` — same token extraction
- Modify: `src/pipeline.js` — accumulate tokens, pass to `updatePipelineRun()`
- Modify: `src/database/supabase.js` — accept new fields in `updatePipelineRun()`
- Modify: `src/notifications/slack.js` — add `alertDailyCost(totalCost, threshold)` function

### Constraints
- Cost calculation uses OpenRouter's published Gemini Flash rates
- Alert threshold configurable via `DAILY_COST_ALERT_USD` env var (default $5)
- One alert per day max (track last alert date in memory — resets on restart, which is fine)

---

## 5. Persist Detected Formats

### Problem
Content format detection (`detectFormat(title, hashtags)`) runs on every `/api/for-you` and `/api/patterns/formats` request. Redundant computation — formats don't change after scraping.

### Solution
Compute formats once during pipeline, store in `trends` table.

### Behavior
- `src/pipeline.js` already calls `detectFormat(video.title, video.hashtags)` at line 217 during scoring. The result is used for `patternScore` but not persisted. Change: include `detected_formats` array in the data passed to `upsertTrend()`.
- `/api/for-you` already has a conditional path reading `t.detected_formats` — remove the recomputation fallback so it only reads from DB.
- `/api/patterns/formats` aggregates from stored `detected_formats` instead of recomputing.

### DB Migration
Add to `trends` table:
- `detected_formats TEXT[] DEFAULT '{}'`

### Files
- Modify: `src/pipeline.js` — call `detectFormat()` during scoring, include in upsert data
- Modify: `src/database/supabase.js` — include `detected_formats` in `upsertTrend()` field list
- Modify: `src/api/for-you.js` — read from DB field instead of recomputing
- Modify: `src/api/patterns.js` — read from DB field instead of recomputing

### Constraints
- `detected_formats` is a Postgres text array (`TEXT[]`)
- Frontend type `Trend` already has `detected_formats` defined — no frontend type change needed
- Backwards compatible: old trends without the field will have empty array default

---

## 6. Cross-Run Velocity (Snapshot Delta)

### Problem
Current `velocity_score` only compares engagement within a single scrape batch. It cannot detect that a trend's views jumped from 50K to 200K between two pipeline runs 2 hours apart.

### Solution
Before scoring each trend, fetch its previous `engagement_snapshots` row and calculate the delta.

### Behavior
- In `src/pipeline.js`, after upserting a trend (which returns `trend_id`), query `engagement_snapshots` for that trend's most recent previous snapshot using the returned `trend_id`.
- If previous snapshot exists: calculate per-hour deltas for views, likes, comments, shares.
- Pass delta data to `calculateVelocityScore()` as an additional input.
- `calculateVelocityScore()` updated to prefer cross-run delta over single-batch estimation when available.
- If no previous snapshot (first time seeing this trend): fall back to current behavior (single-batch estimation).
- FYP mode handling: The existing function handles zero-view videos using weighted volume logarithmic scaling. The cross-run path must also handle this — if both current and previous views are 0, use the weighted volume delta instead of view delta.

### Velocity Calculation Update
```
IF previousSnapshot exists AND hoursBetween > 0 AND hoursBetween < 72:
  IF currentViews > 0 AND previousViews > 0:
    // Normal mode: use view-based velocity
    viewsPerHour = (currentViews - previousViews) / hoursBetween
    velocityScore = Math.min(100, Math.log10(Math.max(viewsPerHour, 1)) / Math.log10(100000) * 100)
  ELSE:
    // FYP mode: use weighted volume delta (same as existing FYP fallback)
    currentVolume = likes + comments*2 + shares*3
    previousVolume = prevLikes + prevComments*2 + prevShares*3
    volumePerHour = (currentVolume - previousVolume) / hoursBetween
    velocityScore = Math.min(100, Math.log10(Math.max(volumePerHour, 1)) / Math.log10(MAX_VOLUME) * 100)
ELSE:
  // No previous snapshot or stale: fall back to current single-batch behavior
  // (existing calculateVelocityScore logic unchanged)
```

### Files
- Modify: `src/pipeline.js` — fetch previous snapshot after upsert (using returned trend_id), before final scoring
- Modify: `src/scoring/engagement.js` — update `calculateVelocityScore()` to accept optional `previousSnapshot` parameter; preserve existing FYP mode handling in both paths
- Modify: `src/database/supabase.js` — add `getLatestSnapshot(trendId)` query function (takes trend UUID, not hash)
- Modify: `tests/scoring.test.js` — add cross-run velocity tests covering both normal and FYP modes

### Constraints
- Query adds 1 DB read per trend per run (~12-20 extra queries). Acceptable for current scale.
- If previous snapshot is older than 72 hours, ignore it (stale data, treat as new trend).
- Pure function signature: `calculateVelocityScore(snapshots, previousSnapshot?)` — backwards compatible.
- FYP mode (zero-view videos) must work in both single-batch and cross-run paths.

---

## 7. HTTPS Security Headers (Conditional)

### Problem
`upgrade-insecure-requests` CSP directive was disabled to allow HTTP access on local network. Must be re-enabled when HTTPS is available via Cloudflare Tunnel.

### Solution
Make the directive conditional on an environment variable.

### Behavior
- In `src/server.js` helmet config: if `process.env.HTTPS_ENABLED === 'true'`, omit `upgradeInsecureRequests: null` (let helmet's default apply). Otherwise, set `upgradeInsecureRequests: null`.
- Default: not set (HTTP mode, current behavior).
- After Cloudflare Tunnel setup: add `HTTPS_ENABLED=true` to `.env`.

### Files
- Modify: `src/server.js` — conditional CSP directive

### Constraints
- No new dependencies
- Single env var toggle
- Backwards compatible (no env var = current HTTP behavior)

---

## DB Migrations Summary

Two ALTER TABLE statements needed (run via Supabase dashboard or migration):

```sql
-- 1. Cost tracking on pipeline_runs
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(8,4) DEFAULT 0;

-- 2. Detected formats on trends
ALTER TABLE trends
  ADD COLUMN IF NOT EXISTS detected_formats TEXT[] DEFAULT '{}';
```

---

## Testing Strategy

- Items 3, 6: Unit tests in `tests/scoring.test.js` for pure functions (recency decay, cross-run velocity)
- Items 1, 2, 4: Integration-level — verify via manual pipeline run + check DB/Slack (crash recovery, selector health, cost tracking involve DB queries and external services)
- Item 5: Verify via `/api/for-you` response containing `detected_formats`
- Item 7: Verify CSP header presence/absence based on env var

---

## Out of Scope

- Frontend changes (Phase B via Lovable)
- Cloudflare Tunnel setup (separate task)
- Brand configuration in DB (future)
- Circuit breaker for Supabase retries (future)
