# Trend Watcher Backend

## Project Overview

Trend Watcher backend — a Node.js server running on a Mac Mini at Epilog Creative's office in Jakarta, Indonesia. It scrolls TikTok's For You Page (FYP), captures screenshots, runs a 3-phase AI pipeline (Trash Gate, Deep Analysis, Cross-Trend Synthesis), scores brand fit for three Godrej Indonesia brands, and pushes everything to Supabase. The Lovable-built React frontend reads from the same Supabase project via Realtime subscriptions. This backend never serves the frontend — it only writes data.

Clients: Godrej Indonesia brands — Stella (air freshener), HIT Kecoa (insecticide), NYU (personal care). All trend scoring targets the Indonesian market and Indonesian cultural context.

## Architecture

- **Runtime:** Node.js (CommonJS modules, not ES modules)
- **Scraper:** Playwright with headless Chromium, FYP scrolling + screenshot capture
- **AI:** OpenRouter (Gemini Flash) for 3-phase trend analysis and brand fit scoring
- **Database:** Supabase via @supabase/supabase-js
- **Scheduler:** node-cron aligned to WIB (UTC+7) peak hours
- **Server:** Express (health check + webhook trigger endpoint only)
- **Notifications:** (Slack integration removed)

## Folder Structure

```
src/
  scrapers/
    tiktok.js           — Playwright FYP scraper. Scrolls For You Page, extracts
                          video metadata (title, author, views, likes, comments,
                          shares, hashtags, audio), captures screenshots.
                          Exports scrapeOnce() -> { videos, screenshots }.

  ai/
    analyzer.js         — 3-phase AI pipeline via OpenRouter (Gemini Flash).
                          Exports trashGate(), deepAnalysis(), crossTrendSynthesis().
    brand-fit.js        — Per-brand fit scoring via OpenRouter. Enhanced with
                          Phase 2 deep analysis context and screenshot.
                          Exports scoreBrandFit().

  scoring/
    engagement.js       — Pure functions: engagement_rate, velocity_score, momentum.
    replication.js      — Pure functions: replication_count, Replication Signal score.
    classifier.js       — Pure functions: lifecycle_stage, classification, urgency_level,
                          composite score.

  patterns/
    formats.js          — Detects replicable content formats (duets, stitches, transitions,
                          POV skits) from video metadata and hashtag clusters.
    cultural.js         — Identifies Indonesian cultural signals (Ramadan, lebaran, local slang,
                          regional references) for brand relevance scoring.

  database/
    supabase.js         — Initializes Supabase client. Exports upsertTrend(),
                          createEngagementSnapshot(), upsertTrendAnalysis(),
                          upsertCrossTrendSynthesis(), upsertBrandFits().

  notifications/
    slack.js            — Sends Slack webhook messages for act-now trends.

  pipeline.js           — Orchestrates the full pipeline: scrape -> score ->
                          trash gate -> deep analysis -> synthesis -> brand fit ->
                          DB write -> notify.

  server.js             — Express entrypoint. Loads dotenv. Mounts GET /health and
                          POST /scrape (behind AUTH_SECRET bearer token). Starts scheduler.

  scheduler.js          — node-cron jobs at Indonesian peak hours
                          (07:00, 12:00, 18:00, 21:00 WIB = UTC+7).

  logger.js             — Centralized logger wrapper. All modules use this instead
                          of console.log.

tests/
  scoring.test.js       — Jest unit tests for engagement, replication, classifier.
  patterns.test.js      — Jest unit tests for format detection and cultural signals.

scripts/
  test-fyp-scraper.js   — Manual test: runs FYP scraper once, dumps results.
  test-pipeline.js      — Integration test: runs full pipeline once.
  inspect-tiktok-dom.js — Diagnostic: inspects TikTok DOM structure for selector updates.
```

## FYP Scraper Strategy

- Navigate to `tiktok.com` (FYP is default for logged-out users with id-ID locale)
- Scroll slowly, pausing 3-5 seconds per video (human-like behavior)
- For each visible video: extract URL, author, title, hashtags, audio, views, likes, comments, shares
- Take screenshot of each video (saved to `screenshots/` directory, named by video URL hash)
- Screenshots are transient — used only during AI analysis within a pipeline run, then deleted
- Continue until maxVideos reached (default 40) or timeout (90 seconds)
- Session management: cookie persistence in `cookies/tiktok.json`, locale id-ID, timezone Asia/Jakarta

### Why FYP, Not Explore

FYP shows full engagement metrics inline (views, likes, comments, shares) for every video. Explore cards only show likes. FYP eliminates the need for individual page visits, making scraping faster and more reliable.

## AI Pipeline Architecture

```
FYP Scroll + Screenshot → Scoring Engine → Trash Gate (batch LLM)
    → Deep Analysis (per-trend, multimodal LLM)
    → Cross-Trend Synthesis (batch LLM)
    → Brand Fit (per-brand, per-trend LLM)
    → Supabase → Frontend (Realtime)
```

### Phase 1: Trash Gate
- One batch LLM call on ALL scraped videos (metadata only, no screenshots)
- Classifies each as SIGNAL or NOISE
- Goal: filter out 60-70% of content immediately
- Saves tokens on low-value content

### Phase 2: Deep Analysis
- One multimodal LLM call per surviving trend (metadata + screenshot)
- Returns: summary, why_trending, cultural_context, replication_signal, brand_safety, creative_angles, confidence, virality_trajectory, key_insights
- Writes to `trend_analysis` with `analysis_type: 'deep_analysis'`

### Phase 3: Cross-Trend Synthesis
- One batch LLM call on ALL surviving trends + their Phase 2 analyses
- Returns: meta-trends, emerging patterns, cultural pulse, brand priorities
- Writes to `trend_analysis` with `analysis_type: 'cross_trend_synthesis'`, `trend_id: null`

### Brand Fit Scoring
- One LLM call per brand per trend (3 brands x N trends)
- Enhanced with Phase 2 analysis + screenshot as input
- Generates creative briefs per brand-trend combination
- Writes to `client_brand_fit`

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public API key |
| `PORT` | Express server port (default: `3001`) |
| `AUTH_SECRET` | Bearer token for POST /scrape endpoint |
| `OPENROUTER_API_KEY` | OpenRouter API key for AI pipeline |
| `NODE_ENV` | `development` or `production` |
| `JWT_SECRET` | Secret key for signing JWT tokens (min 32 chars recommended) |
| `TEAM_PIN_HASH` | bcrypt hash of the team PIN for frontend auth |

Dotenv is loaded once at the top of `src/server.js`. No other file should call `require('dotenv').config()`.

## Coding Conventions

- **CommonJS only** — use `require()` and `module.exports`. Never use `import`/`export`.
- **All async functions must use try/catch** with explicit error logging. Never let a promise reject silently.
- **Never use `console.log`** — use the logger wrapper from `src/logger.js`.
- **All Supabase writes must check for `error`** in the response and log it.
- **No hardcoded credentials** — always read from `process.env`.
- **All exported functions must have a JSDoc comment** explaining inputs, outputs, and side effects.
- **Scoring functions must be pure functions** — no side effects, no database calls, no I/O.
- **Never block the event loop** — all I/O must be async. No sync file operations.
- **UUIDs are generated by Supabase** — never generate `id` values in backend code.
- **ISO 8601 timestamps** — use `new Date().toISOString()` for `scraped_at` and `captured_at`.

## Database Rules

### Tables this backend WRITES to:
- **`trends`** — upsert raw scraped trend data (conflict key: `hash` column)
- **`engagement_snapshots`** — insert a new row every scrape (time-series)
- **`trend_analysis`** — upsert AI analysis (Phase 2: `analysis_type='deep_analysis'`, Phase 3: `analysis_type='cross_trend_synthesis'` with `trend_id=null`)
- **`client_brand_fit`** — upsert brand fit scores (conflict key: `trend_id,brand_name`)

### Tables this backend NEVER writes to:
- `team_feedback` — owned by the frontend
- `taste_weights` — future feedback loop

### Column reference:
All column names must match the TypeScript interfaces in:
`../EPILOG-TREND-FRONTEND/src/types/index.ts`

## Cross-Repo Contract

**Frontend repo:** `../EPILOG-TREND-FRONTEND/` (github.com/abimangku/epilog-trend-analyzer)

```
Backend WRITES to: trends, engagement_snapshots, trend_analysis, client_brand_fit
Frontend READS from: all 6 tables
Frontend WRITES to: team_feedback only

When the backend adds/changes a column:
1. Update backend CLAUDE.md
2. Update frontend src/types/index.ts
3. Update frontend src/integrations/supabase/types.ts
4. Push both repos
```

## Banned Patterns

- **No sync file operations** — no `fs.readFileSync`, `fs.writeFileSync`, etc.
- **No `process.exit()`** — let errors propagate. The process manager handles restarts.
- **No hardcoded TikTok selectors** outside of the `SELECTORS` constant in `src/scrapers/tiktok.js`.
- **No direct SQL** — always use the Supabase JS client (`supabase.from(...)`).
- **No try/catch that silently swallows errors** — every catch block must log the error.
- **No `console.log` / `console.error`** — use the project logger.
- **No ES module syntax** — no `import`, no `export default`, no `export const`.

## Testing

- **Run tests:** `npm test`
- Scoring functions must have unit tests in `tests/scoring.test.js`.
- Pattern detection must have unit tests in `tests/patterns.test.js`.
- **Do not mock Supabase in tests** — test pure functions only.
- Test fixtures should use realistic Indonesian TikTok data.

## When Adding New Features

1. Read this CLAUDE.md first.
2. Check `../EPILOG-TREND-FRONTEND/src/types/index.ts` to verify column names.
3. If the column does not exist in the TypeScript types, do not write to it.
4. If adding a new scraper or data source, follow the pattern in `src/scrapers/tiktok.js`.
5. If adding a new scoring dimension, add it as a pure function in `src/scoring/` with tests.
6. Never add middleware or routes that serve HTML — this backend is API-only.
7. Update the Cross-Repo Contract section if you add new tables or change ownership.
