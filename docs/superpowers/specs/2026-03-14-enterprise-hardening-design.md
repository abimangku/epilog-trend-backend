# Enterprise Hardening — Design Spec

> **Scope:** 4-phase hardening roadmap taking the Trend Watcher tool from functional prototype to enterprise-grade reliability. Each phase is an independent sub-project with its own plan and implementation cycle.

**System:** Trend Watcher — Node.js backend (Mac Mini, Jakarta) + React frontend (Lovable/Vite) + Supabase
**Clients:** Godrej Indonesia — Stella, HIT Kecoa, NYU

---

## Phase 1: Critical Fixes — Security & Crash Prevention

**Goal:** Eliminate all vectors that can crash the system, expose secrets, or compromise auth. After this phase, the tool can't be knocked offline by a single bad input or exploited by an outsider.

### 1.1 Process Management & Crash Recovery

**Problem:** Backend runs via `node src/server.js` (or nodemon in dev). An unhandled promise rejection or uncaught exception kills the process with no restart.

**Solution:**
- Add `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers in `server.js` that log the error and attempt graceful shutdown
- Add PM2 configuration (`ecosystem.config.js`) for production: auto-restart, max memory restart (512MB), crash restart delay (1s), max 10 restarts per 15 minutes
- Add startup script that uses PM2 in production, nodemon in dev

**Files:**
- Modify: `src/server.js` — add process event handlers
- Create: `ecosystem.config.js` — PM2 config
- Modify: `package.json` — add `start:prod` script

### 1.2 Auth Hardening

**Problem:** PIN auth has no brute-force protection. No rate limiting on `/scrape` endpoint. JWT secret could be weak.

**Solution:**
- Replace existing hand-rolled `rateLimitTrigger` in `server.js` with `express-rate-limit` middleware: 5 attempts per 15 min on `/api/auth/verify-pin`, 10 req/min on `/trigger/scrape`
- Add account lockout after 10 failed PIN attempts (15-minute cooldown, stored in memory with Map + TTL)
- Validate JWT secret length at startup (minimum 32 chars, warn if shorter)
- Add `helmet` middleware for security headers

**Files:**
- Create: `src/middleware/rate-limiter.js` — rate limiting middleware
- Modify: `src/server.js` — mount helmet and rate limiter
- Modify: `package.json` — add `express-rate-limit`, `helmet`

### 1.3 Input Validation & Injection Prevention

**Problem:** API endpoints accept user input (search queries, filter params, collection names) with no validation. XSS via stored collection names is possible.

**Solution:**
- Add validation middleware for all API endpoints
- Sanitize collection names, search queries (strip HTML, limit length to 200 chars)
- Validate numeric params (days: 1-90, limit: 1-500) are within bounds
- Add Content-Security-Policy header via helmet

**Files:**
- Create: `src/middleware/validate.js` — validation helpers
- Modify: API route files — add validation to each endpoint

### 1.4 Environment Variable Validation

**Problem:** Missing env vars cause cryptic runtime errors deep in the pipeline (e.g., `undefined` Supabase URL -> connection timeout).

**Solution:**
- Add startup validation in `server.js` that checks all required env vars exist and are non-empty before starting the server
- Fail fast with clear error message listing which vars are missing
- Validate URL format for `SUPABASE_URL`, non-empty for API keys

**Files:**
- Create: `src/config/validate-env.js` — env validation
- Modify: `src/server.js` — call validation at startup

### 1.5 Graceful Error Boundaries (Frontend)

**Problem:** A React rendering error in any component crashes the entire app (white screen). No error boundaries exist.

**Solution:**
- Add root-level `ErrorBoundary` component wrapping the router outlet
- Add page-level error boundaries for each route
- Error UI shows "Something went wrong" with retry button
- Log errors to console in dev

**Files:**
- Create: `frontend/src/components/shared/ErrorBoundary.tsx` — React error boundary
- Modify: `frontend/src/App.tsx` — wrap routes with ErrorBoundary

### 1.6 Supabase Write Retry Logic

**Problem:** Some Supabase write paths check for errors but don't retry. A transient network blip during a pipeline run loses that entire batch of data.

**Solution:**
- Add retry wrapper with exponential backoff (3 attempts, 1s/2s/4s delays) for all Supabase writes
- Log each retry attempt with the logger
- After final failure, log the failed payload for manual recovery
- Apply to: `upsertTrend`, `createEngagementSnapshot`, `upsertTrendAnalysis`, `upsertBrandFits`

**Files:**
- Create: `src/utils/retry.js` — generic retry-with-backoff wrapper
- Modify: `src/database/supabase.js` — wrap all write functions with retry

---

## Phase 2: Reliability & Persistence

**Goal:** After this phase, scraping failures self-recover, media assets don't disappear from the dashboard, and the pipeline handles real-world flakiness gracefully.

### 2.1 Scraping Resilience & Self-Healing

**Problem:** TikTok DOM changes break selectors silently — scraper returns 0 videos with no error. Rate limiting (consecutive scrapes <2 min apart) returns empty pages. Network timeouts kill the entire scrape with no partial save.

**Solution:**
- Add "zero results" detection: if scrape returns 0 videos, log a warning and write a `critical` event to `pipeline_events` table
- Add minimum cooldown enforcement between scrapes (3 minutes, tracked in memory)
- Save partial results: if scrape captures 15/40 videos before timeout, save those 15 instead of discarding all
- Add selector health check: on startup and every 6 hours, load FYP and verify key selectors exist in DOM. Write `critical` event on failure
- Add retry with backoff: if scrape fails, retry once after 60 seconds before giving up

**Files:**
- Modify: `src/scrapers/tiktok.js` — partial save, cooldown, zero-result detection
- Create: `src/scrapers/health-check.js` — selector health check
- Modify: `src/scheduler.js` — add health check cron

### 2.2 Media Persistence — Thumbnail Proxy

**Problem:** TikTok CDN URLs are signed and expire within hours. Thumbnails stored in `thumbnail_url` column go dead, showing broken images in the dashboard the next day.

**Solution:**
- Add Supabase Storage bucket `trend-thumbnails` for proxied images
- During pipeline: download each thumbnail, upload to Storage, store the Supabase Storage URL in a new `thumbnail_storage_url` column
- Frontend falls back: try `thumbnail_storage_url` first -> original `thumbnail_url` second -> placeholder
- Add a nightly cleanup job: delete thumbnails older than 30 days from Storage
- Keep original `thumbnail_url` as-is for debugging

**DB Migration:**
- Add `thumbnail_storage_url` column to `trends` table (nullable text)

**Files:**
- Create: `src/media/thumbnail-proxy.js` — download + upload to Storage
- Modify: `src/pipeline.js` — call thumbnail proxy after scrape
- Modify: `src/scheduler.js` — add nightly cleanup cron
- Modify: frontend image components — fallback chain

### 2.3 Media Persistence — Video Embed Reliability

**Problem:** TikTok embed.js is a third-party dependency. If TikTok blocks the embed or the URL format changes, video previews break silently.

**Solution:**
- Add embed load detection: if TikTok embed fails to render within 5 seconds, show a fallback card with thumbnail + "Open on TikTok" link
- Cache embed availability status per video (localStorage, 1-hour TTL) to avoid re-attempting known-broken embeds
- Add a visual loading state while embed loads (skeleton with shimmer)

**Files:**
- Modify: frontend TikTok embed component — add timeout, fallback, loading state

### 2.4 Pipeline Failure Isolation

**Problem:** If Deep Analysis fails for one trend, the entire pipeline run crashes — no synthesis, no brand fits, nothing saved.

**Solution:**
- Wrap each pipeline stage per-trend in try/catch
- If Deep Analysis fails for trend X, log the error, skip that trend, continue with the rest
- Track per-trend status: `{ trendId, trashGate: 'pass', deepAnalysis: 'failed', error: '...' }`
- Save pipeline run summary to a new `pipeline_runs` table: `{ id, run_id, started_at, completed_at, status, videos_scraped, videos_analyzed, videos_failed, errors[] }`
- Write summary event to `pipeline_events` after each run

**DB Migration:**
- Create `pipeline_runs` table: `id (uuid pk), started_at (timestamptz), completed_at (timestamptz), status (text: success|partial|failed), videos_scraped (int), videos_passed_gate (int), videos_analyzed (int), videos_failed (int), errors (jsonb), created_at (timestamptz)`
- Create `pipeline_events` table: `id (uuid pk), run_id (uuid fk nullable), stage (text), severity (text: info|warning|critical), message (text), data (jsonb), acknowledged (bool default false), created_at (timestamptz)`

**Files:**
- Modify: `src/pipeline.js` — per-trend try/catch, run tracking, event emission
- Modify: `src/database/supabase.js` — add `createPipelineRun`, `updatePipelineRun`, `createPipelineEvent`

### 2.5 OpenRouter API Resilience

**Problem:** OpenRouter API can timeout, return 429 (rate limit), or return malformed JSON. Current code has basic try/catch but no retry logic.

**Solution:**
- Add retry with exponential backoff for 429 and 5xx responses (3 attempts, 2s/4s/8s)
- Add request timeout of 30 seconds per LLM call
- Add JSON parse safety: if LLM returns malformed JSON, log the raw response and skip that trend (don't crash)
- Add token budget tracking: log tokens used per pipeline run, warn if approaching limits

**Files:**
- Modify: `src/ai/analyzer.js` — add retry, timeout, JSON safety
- Modify: `src/ai/brand-fit.js` — same
- Reuse: `src/utils/retry.js` from Phase 1

### 2.6 Database Connection Resilience

**Problem:** Supabase client is initialized once at startup. If the connection drops mid-pipeline, all subsequent writes fail until restart.

**Solution:**
- The retry wrapper from Phase 1.6 handles transient failures
- Add connection health check before pipeline starts: simple `SELECT 1` query via `supabase.rpc()`
- If health check fails, wait 10 seconds and retry (3 attempts) before aborting the pipeline run
- Log connection state transitions

**Files:**
- Modify: `src/database/supabase.js` — add `checkConnection()` function
- Modify: `src/pipeline.js` — call health check before pipeline starts

---

## Phase 3: Observability & Control

**Goal:** After this phase, your team can see what the backend is doing in real-time from the frontend, control scheduling, and diagnose problems without SSH-ing into the Mac Mini.

### 3.1 Pipeline Status Dashboard

**Problem:** The frontend has zero visibility into whether the backend is running, when the last scrape happened, or if something is broken.

**Solution:**
- `pipeline_runs` table (from Phase 2.4) becomes the data source
- New frontend page: **System Status** (accessible from sidebar)
- Shows: last run timestamp, status (success/partial/failed), videos scraped, videos analyzed, next scheduled run
- Color-coded status indicator in sidebar: green (last run <2h ago, success), yellow (last run >2h ago or partial), red (last run failed or >6h ago)
- Auto-refreshes via Supabase Realtime subscription on `pipeline_runs`

**Files:**
- Create: `frontend/src/pages/SystemStatus.tsx` — status dashboard page
- Create: `frontend/src/hooks/use-pipeline-status.ts` — query + realtime for pipeline_runs
- Modify: `frontend/src/components/layout/Sidebar.tsx` — add status indicator + nav item
- Modify: `frontend/src/App.tsx` — add route

### 3.2 Pipeline Activity Feed

**Problem:** When a scrape is running, there's no indication of progress. The team doesn't know if it's stuck or working.

**Solution:**
- `pipeline_events` table (from Phase 2.4) provides the data
- Backend emits events at each stage: "Scraping started", "Found 35 videos", "Trash gate: 12 passed", "Deep analysis: 8/12 complete", "Brand fit scoring complete", "Pipeline finished"
- System Status page shows live event feed for the current/last run
- Events auto-scroll as they arrive via Realtime
- Critical events show a red dot badge on System Status nav item
- Badge clears when user views the page

**Files:**
- Create: `frontend/src/hooks/use-pipeline-events.ts` — query + realtime for pipeline_events
- Modify: `frontend/src/pages/SystemStatus.tsx` — add event feed section
- Modify: `src/pipeline.js` — emit events at each stage

### 3.3 Manual Trigger & Scheduling UI

**Problem:** Scheduling is hardcoded in `scheduler.js` (07:00, 12:00, 18:00, 21:00 WIB). To change times or trigger a manual scrape, someone needs terminal access.

**Solution:**
- Frontend "Run Now" button on System Status page — calls existing `POST /trigger/scrape` endpoint
- Button shows spinner while pipeline runs, disabled until complete
- New `schedule_config` table that preserves the existing window-based scheduler's capabilities: `{ id, label, cron_expression, enabled, ai_analysis_enabled, interval_minutes, created_at }`
- `ai_analysis_enabled` maps to the existing `aiAnalysis` flag per time window (controls whether deep analysis + synthesis + brand fit run, or just scrape + trash gate)
- `interval_minutes` preserves the per-window interval variance (e.g., morning=25min, primetime=20min)
- Seed with current schedule windows from `SCHEDULE` constant in `scheduler.js` (morning, work, lunch, afternoon, primetime, latenight — excluding sleep)
- Scheduler reads from DB on startup and every 30 minutes (picks up changes without restart)
- Existing backoff and jitter logic (empty scrape detection, consecutive-empty cooldown) is preserved in `scheduler.js` — only the schedule source changes from hardcoded constant to DB table
- System Status page shows schedule list with enable/disable toggles and time display
- Add/edit schedule with time picker + AI analysis toggle

**DB Migration:**
- Create `schedule_config` table: `id (uuid pk), label (text), cron_expression (text), enabled (bool default true), ai_analysis_enabled (bool default true), interval_minutes (int default 25), created_at (timestamptz)`
- Seed: rows matching current `SCHEDULE` windows

**Files:**
- Modify: `src/scheduler.js` — read schedules from DB, reload periodically
- Create: `src/api/schedules.js` — CRUD endpoints for schedule_config
- Modify: `src/server.js` — mount schedule routes
- Modify: `frontend/src/pages/SystemStatus.tsx` — add schedule management UI
- Create: `frontend/src/hooks/use-schedules.ts` — query schedules

### 3.4 Health Monitoring Endpoint

**Problem:** `/health` returns `{ status: 'ok' }` with no useful information.

**Solution:**
- Enhance `/health` to return:
  - `status`: healthy / degraded / unhealthy
  - `uptime_seconds`
  - `last_pipeline_run` and `last_pipeline_status`
  - `supabase`: connected / disconnected
  - `openrouter`: reachable / unreachable
  - `memory_mb`
  - `next_scheduled_run`
- Add periodic health self-check (every 5 min): if Supabase unreachable for 3 consecutive checks, write `critical` event to `pipeline_events`
- Frontend System Status page polls `/health` every 30 seconds for live server metrics

**Files:**
- Modify: `src/server.js` — enhance /health endpoint
- Create: `src/health/monitor.js` — periodic self-check logic

### 3.5 Structured Logging

**Problem:** Current logger writes unstructured text. Hard to search, filter, or analyze.

**Solution:**
- Upgrade `logger.js` to output structured JSON logs: `{ timestamp, level, module, message, data }`
- Add log levels: `debug`, `info`, `warn`, `error`
- Retain backward-compatible API: keep existing `logger.log(MOD, msg, data)` / `logger.error(MOD, msg, data)` call signature so all existing call sites continue to work without changes. Internally, the module name (first arg) becomes the `module` field in structured output
- Add optional `logger.child('module')` factory that returns a scoped logger — new code can use it, existing code doesn't need to change
- Add pipeline run ID as correlation ID: `logger.setRunId(runId)` called once at pipeline start, automatically attached to all subsequent log entries until cleared
- Write logs to rotating files (`logs/app-YYYY-MM-DD.log`, keep 7 days)
- Keep human-readable console output in dev mode

**Files:**
- Modify: `src/logger.js` — rewrite with structured output, backward-compatible API, optional child loggers, file rotation

### 3.6 Dashboard Alert System

**Problem:** Errors, failures, and degraded states are invisible unless someone checks the System Status page.

**Solution:**
- Critical events in `pipeline_events` (severity: `critical`) trigger a red badge on the System Status sidebar nav item
- Badge shows count of unacknowledged critical events
- Badge clears when user views System Status page (marks events as acknowledged)
- Critical event types: pipeline failure, scraper 0 results, selector health check failure, 3+ consecutive API errors, Supabase connection loss
- Notification throttling: same error type -> max 1 event per hour (prevent spam during outages)
- Each critical event includes actionable context message

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx` — badge on System Status nav
- Modify: `frontend/src/hooks/use-pipeline-events.ts` — track unacknowledged critical count
- Modify: `src/database/supabase.js` — add `acknowledgePipelineEvents()`

---

## Phase 4: AI Quality & UX Polish

**Goal:** After this phase, the AI output feels genuinely insightful (not generic), confidence scores are trustworthy, brand fit recommendations are actionable, and the frontend feels polished and professional.

### 4.1 Prompt Engineering — Deep Analysis

**Problem:** Deep Analysis prompts produce generic summaries. Cultural context is shallow. Creative angles are vague.

**Solution:**
- Rewrite Deep Analysis system prompt with:
  - Indonesian cultural specificity: reference Ramadan cycles, lebaran, regional humor styles, local slang patterns
  - Force concrete creative angles: "Describe a specific 15-second video concept a brand could film tomorrow, including script outline, audio choice, and visual style"
  - Require comparisons: "Compare this trend to similar trends from the past 30 days"
- Add few-shot examples in the prompt: 2-3 gold-standard analyses showing the depth expected
- Add `analysis_version` field to `trend_analysis` for tracking prompt iteration quality

**DB Migration:**
- Add `analysis_version` column to `trend_analysis` (nullable text, default null)

**Files:**
- Modify: `src/ai/analyzer.js` — rewrite `deepAnalysis()` prompt
- Modify: `src/database/supabase.js` — pass analysis_version on write

### 4.2 Prompt Engineering — Cross-Trend Synthesis

**Problem:** Synthesis output reads like a summary of individual trends, not genuine pattern recognition.

**Solution:**
- Rewrite synthesis prompt to:
  - Identify format convergence: "Are multiple unrelated topics using the same video format?"
  - Detect audio clustering: "Are different creators using the same audio in different contexts?"
  - Surface timing patterns: "Are certain content types appearing at specific times?"
  - Force contrarian takes: "What trend does everyone think is big but the data says is declining?"
- Add `synthesis_version` field for A/B tracking

**Files:**
- Modify: `src/ai/analyzer.js` — rewrite `crossTrendSynthesis()` prompt

### 4.3 Confidence Score Calibration

**Problem:** Confidence scores (0-100) from the LLM are uncalibrated — the model clusters around 60-80 regardless of actual signal strength.

**Solution:**
- Add post-processing calibration layer in `analyzer.js`:
  - Cross-reference LLM confidence with engagement metrics (high confidence + low engagement = downgrade)
  - Cross-reference with data freshness (trend seen only once = cap confidence at 50)
  - Cross-reference with replication signal (high replication = boost confidence)
- Add `raw_confidence` and `calibrated_confidence` fields
- Frontend displays calibrated confidence with visual indicator: solid bar for high, dashed/faded for low
- Add tooltip explaining what drives the confidence score

**DB Migration:**
- Add `raw_confidence` (int nullable) and `calibrated_confidence` (int nullable) columns to `trend_analysis`

**Files:**
- Create: `src/scoring/confidence.js` — calibration logic (pure function)
- Modify: `src/ai/analyzer.js` — pass raw confidence to calibration
- Modify: `src/database/supabase.js` — write both confidence fields
- Modify: frontend detail panel — show calibrated confidence with indicator
- Create: `tests/confidence.test.js` — unit tests

### 4.4 Brand Fit Depth & Actionability

**Problem:** Brand fit scores feel arbitrary. Creative briefs are too short to act on.

**Solution:**
- Expand brand fit prompt to require:
  - 3 specific reasons for the score
  - Risk assessment: "What could go wrong if this brand jumps on this trend?"
  - Timing recommendation: "Act within 24h / This week / Watch for now"
  - Competitor scan: "Has any competitor brand already used this trend?"
- Add `fit_reasoning` (jsonb array), `risk_notes` (text), `timing` (text) fields to `client_brand_fit`
- Frontend OpportunityCard shows reasoning bullets and timing badge

**DB Migration:**
- Add `fit_reasoning` (jsonb nullable), `risk_notes` (text nullable), `timing` (text nullable) to `client_brand_fit`

**Files:**
- Modify: `src/ai/brand-fit.js` — expand prompt, parse new fields
- Modify: `src/database/supabase.js` — write new fields
- Modify: frontend OpportunityCard — display reasoning, timing badge

### 4.5 Frontend Polish — Loading & Transition States

**Problem:** Page transitions are jarring. Data appears abruptly. Some pages flash empty states before data loads.

**Solution:**
- Add skeleton screens matched to actual content layout for every data-dependent section
- Add subtle fade-in animation for cards when data loads (CSS `@keyframes`, 150ms)
- Verify all pages: only show empty state after loading completes AND data is truly empty
- Add optimistic UI for bookmark toggle: update immediately, revert on error

**Files:**
- Modify: `frontend/src/components/shared/Skeleton.tsx` — add content-specific skeleton variants
- Modify: `frontend/src/index.css` — add fade-in keyframes
- Modify: page components — verify loading/empty state logic
- Modify: bookmark hook — add optimistic update

### 4.6 Frontend Polish — Detail Panel Improvements

**Problem:** Detail panel shows raw data with no visual hierarchy. Analysis text is a wall of text.

**Solution:**
- Restructure detail panel into collapsible sections: Overview, Analysis, Brand Fit, Engagement History
- Add visual hierarchy: key metrics (score, lifecycle, confidence) as large numbers at top
- Format analysis text with section headers (Why Trending, Cultural Context, Creative Angles) parsed from JSON
- Add "Copy Brief" button that copies a formatted brand brief to clipboard
- Show engagement sparkline (last 7 snapshots) using existing recharts

**Files:**
- Modify: frontend detail panel component — restructure layout, add sections
- Create: `frontend/src/components/detail/CopyBrief.tsx` — copy-to-clipboard
- Create: `frontend/src/hooks/use-engagement-history.ts` — query engagement_snapshots

### 4.7 Empty State & Onboarding

**Problem:** New users see empty pages with no guidance.

**Solution:**
- First-launch detection: if `pipeline_runs` table is empty, show onboarding state
- Onboarding explains: "This tool automatically scans TikTok's For You Page and analyzes trends for your brands. Scans run automatically throughout the day based on your schedule configuration."
- Add "Run First Scan" button (calls `/scrape`) with progress indication
- After first scan completes, onboarding dismisses and content appears

**Files:**
- Create: `frontend/src/components/shared/Onboarding.tsx` — first-launch UI
- Modify: `frontend/src/pages/Pulse.tsx` — show onboarding when no pipeline_runs exist

---

## Removed Components

### Remove Slack Integration

All notification functionality moves to the dashboard via `pipeline_events` table. No Slack dependency remains.

**Deletions:**
- Delete `src/notifications/slack.js` entirely

**Modifications:**
- Modify `src/pipeline.js`:
  - Remove Step 8 (Slack notifications block, lines ~384-399)
  - Remove `notifyActNow` import (line ~54-63)
  - Update module-level JSDoc to remove "Slack notifications" from pipeline steps
  - Replace act-now notification with `createPipelineEvent({ severity: 'critical', stage: 'brand_fit', message: 'Act-now trend detected: <trend_title>' })`
- Modify `src/scheduler.js`:
  - Remove defensive `notifyScraperDown` and `notifyDailySummary` imports (lines ~14-27)
  - Remove `notifyScraperDown` call block (lines ~165-179)
  - Remove `onDailyBrief()` function and `briefCron` (08:00 cron job) entirely — daily summary is replaced by `pipeline_runs` table data visible in System Status page
- Remove `SLACK_WEBHOOK_URL` from env var requirements and startup validation

---

## DB Migration Summary

| Phase | Table | Change |
|-------|-------|--------|
| 2.2 | `trends` | Add `thumbnail_storage_url` (text nullable) |
| 2.4 | `pipeline_runs` | Create table |
| 2.4 | `pipeline_events` | Create table |
| 3.3 | `schedule_config` | Create table + seed 6 rows |
| 4.1 | `trend_analysis` | Add `analysis_version` (text nullable) |
| 4.3 | `trend_analysis` | Add `raw_confidence`, `calibrated_confidence` (int nullable) |
| 4.4 | `client_brand_fit` | Add `fit_reasoning` (jsonb), `risk_notes` (text), `timing` (text) |

---

## Dependency Summary

| Package | Phase | Purpose |
|---------|-------|---------|
| `pm2` | 1.1 | Process management (global install) |
| `express-rate-limit` | 1.2 | Rate limiting middleware |
| `helmet` | 1.2 | Security headers |

---

## Phase Execution Order

Each phase is an independent sub-project: own plan -> own implementation -> own review.

1. **Phase 1: Critical Fixes** — do first, highest blast radius
2. **Phase 2: Reliability** — depends on Phase 1 retry logic
3. **Phase 3: Observability** — depends on Phase 2 tables (`pipeline_runs`, `pipeline_events`)
4. **Phase 4: AI & Polish** — independent of Phase 3, but logically last
