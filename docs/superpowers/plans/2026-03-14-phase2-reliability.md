# Phase 2: Reliability & Persistence — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pipeline self-healing: scraping failures recover gracefully, media assets persist beyond TikTok CDN expiry, AI calls retry on transient errors, and per-trend failures don't crash the entire run.

**Architecture:** Add failure isolation at every pipeline stage, persistent media storage via Supabase Storage, retry wrappers on LLM calls (reusing Phase 1 `withRetry`), and run-level tracking via new `pipeline_runs` and `pipeline_events` tables.

**Tech Stack:** Node.js (CommonJS), Supabase Storage, OpenRouter API, React 18

**Spec:** `docs/superpowers/specs/2026-03-14-enterprise-hardening-design.md` — Phase 2 sections 2.1–2.6

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/database/supabase.js` | Modify | Add `createPipelineRun`, `updatePipelineRun`, `createPipelineEvent`, `checkConnection` |
| `src/pipeline.js` | Modify | Per-trend try/catch, run tracking, event emission, remove Slack refs, thumbnail proxy call |
| `src/ai/analyzer.js` | Modify | Add retry with backoff for 429/5xx, JSON parse safety, timeout |
| `src/ai/brand-fit.js` | Modify | Same retry/timeout/JSON safety as analyzer |
| `src/scrapers/tiktok.js` | Modify | Partial save on timeout, cooldown enforcement, zero-result detection |
| `src/scrapers/health-check.js` | Create | Selector health check — verify FYP DOM structure |
| `src/media/thumbnail-proxy.js` | Create | Download TikTok thumbnail, upload to Supabase Storage |
| `src/scheduler.js` | Modify | Add health check cron, nightly cleanup cron, remove Slack refs |
| `frontend/src/components/shared/TikTokEmbed.tsx` | Modify | Add timeout fallback, loading state, embed failure detection |
| `frontend/src/components/shared/TrendThumbnail.tsx` | Create or Modify | Fallback chain: storage URL → original URL → placeholder |

---

## Chunk 1: DB Migrations + Pipeline Tracking Functions

### Task 1: Apply DB Migrations

**Files:**
- Supabase SQL migrations (via MCP)

- [ ] **Step 1: Create `pipeline_runs` table**

```sql
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'failed')),
  videos_scraped int DEFAULT 0,
  videos_passed_gate int DEFAULT 0,
  videos_analyzed int DEFAULT 0,
  videos_failed int DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Create `pipeline_events` table**

```sql
CREATE TABLE IF NOT EXISTS pipeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES pipeline_runs(id),
  stage text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  message text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  acknowledged boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_events_severity ON pipeline_events(severity) WHERE NOT acknowledged;
CREATE INDEX idx_pipeline_events_run_id ON pipeline_events(run_id);
```

- [ ] **Step 3: Add `thumbnail_storage_url` column to trends**

```sql
ALTER TABLE trends ADD COLUMN IF NOT EXISTS thumbnail_storage_url text;
```

- [ ] **Step 4: Create Supabase Storage bucket**

Create a `trend-thumbnails` bucket in Supabase Storage (public read, authenticated write).

---

### Task 2: Pipeline Tracking DB Functions

**Files:**
- Modify: `src/database/supabase.js`

- [ ] **Step 1: Add `createPipelineRun` function**

After the existing `upsertBrandFits` function, add:

```javascript
/**
 * Creates a new pipeline run record. Called at pipeline start.
 * @returns {Promise<string>} The run ID (UUID)
 */
async function createPipelineRun() {
  const { data, error } = await retrySupabase(
    'create pipeline run',
    () => supabase.from('pipeline_runs').insert({
      started_at: new Date().toISOString(),
      status: 'running',
    }).select('id').single()
  );

  if (error) {
    logger.error(MOD, 'Failed to create pipeline run', error);
    return null;
  }

  return data.id;
}

/**
 * Updates an existing pipeline run with results. Called at pipeline end.
 * @param {string} runId - Pipeline run UUID
 * @param {object} update - Fields to update
 */
async function updatePipelineRun(runId, update) {
  if (!runId) return;

  const { error } = await retrySupabase(
    `update pipeline run ${runId.slice(0, 8)}`,
    () => supabase.from('pipeline_runs').update({
      ...update,
      completed_at: new Date().toISOString(),
    }).eq('id', runId)
  );

  if (error) {
    logger.error(MOD, `Failed to update pipeline run ${runId}`, error);
  }
}

/**
 * Creates a pipeline event for observability.
 * @param {string|null} runId - Pipeline run UUID (null for non-run events like health checks)
 * @param {string} stage - Pipeline stage name
 * @param {string} severity - 'info' | 'warning' | 'critical'
 * @param {string} message - Human-readable message
 * @param {object} [data] - Additional structured data
 */
async function createPipelineEvent(runId, stage, severity, message, data = {}) {
  const { error } = await retrySupabase(
    `event: ${stage}/${severity}`,
    () => supabase.from('pipeline_events').insert({
      run_id: runId,
      stage,
      severity,
      message,
      data,
    })
  );

  if (error) {
    logger.error(MOD, `Failed to create pipeline event: ${message}`, error);
  }
}

/**
 * Checks database connectivity with retry. Returns true if reachable.
 * Retries 3 times with 10-second delays before giving up.
 * @returns {Promise<boolean>}
 */
async function checkConnection() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ok = await testConnection();
    if (ok) return true;

    if (attempt < 2) {
      logger.warn(MOD, `Connection check failed (attempt ${attempt + 1}/3) — retrying in 10s`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  logger.error(MOD, 'Connection check failed after 3 attempts');
  return false;
}
```

- [ ] **Step 2: Export the new functions**

Add to the `module.exports`:

```javascript
  createPipelineRun,
  updatePipelineRun,
  createPipelineEvent,
  checkConnection,
```

- [ ] **Step 3: Commit**

```bash
git add src/database/supabase.js
git commit -m "feat: add pipeline run tracking and event DB functions"
```

---

## Chunk 2: OpenRouter API Resilience

### Task 3: Add Retry + JSON Safety to AI Analyzer

**Files:**
- Modify: `src/ai/analyzer.js`

- [ ] **Step 1: Add retry import and helper**

After line 3 (`const logger = require('../logger');`), add:

```javascript
const { withRetry } = require('../utils/retry');
```

Add a helper function after `_headers()`:

```javascript
/**
 * Calls OpenRouter API with retry on 429 and 5xx errors.
 * @param {object} payload - The request body
 * @param {number} [timeout=30000] - Request timeout in ms
 * @returns {Promise<object>} Parsed response data
 */
async function callOpenRouter(payload, timeout = 30000) {
  return withRetry(async () => {
    const response = await axios.post(OPENROUTER_URL, payload, {
      headers: _headers(),
      timeout,
    });
    return response.data;
  }, {
    retries: 3,
    baseDelay: 2000,
    onRetry: (err, attempt) => {
      const status = err.response?.status || 'unknown';
      logger.warn(MOD, `OpenRouter retry ${attempt}/3 (HTTP ${status}): ${err.message}`);
    },
  });
}

/**
 * Safely parses JSON from LLM response content.
 * Returns null if parsing fails instead of throwing.
 * @param {string} content - Raw LLM response string
 * @param {string} context - Description for logging
 * @returns {object|null}
 */
function safeParseJSON(content, context) {
  try {
    return JSON.parse(content);
  } catch (err) {
    logger.error(MOD, `JSON parse failed for ${context}: ${content.slice(0, 200)}`, err);
    return null;
  }
}
```

- [ ] **Step 2: Refactor trashGate to use callOpenRouter + safeParseJSON**

Replace the `try { const response = await axios.post(...)` block (lines 80-125) with:

```javascript
  try {
    const data = await callOpenRouter({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a trend filtering AI. Respond only in valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    }, 30000);

    const content = data.choices[0].message.content;
    const parsed = safeParseJSON(content, 'trashGate');

    if (!parsed || !parsed.results || !Array.isArray(parsed.results)) {
      logger.warn(MOD, 'Trash Gate: unexpected response — treating all as signals');
      return videos.map((v) => ({ url: v.url, verdict: 'signal', reason: 'Parse error' }));
    }

    // Map results back to videos by index
    const verdicts = videos.map((v, i) => {
      const match = parsed.results.find((r) => r.index === i);
      return {
        url: v.url,
        verdict: match ? match.verdict.toLowerCase() : 'signal',
        reason: match ? match.reason : 'No verdict returned',
      };
    });

    const signals = verdicts.filter((v) => v.verdict === 'signal').length;
    const noise = verdicts.filter((v) => v.verdict === 'noise').length;
    logger.log(MOD, `Trash Gate: ${signals} signals, ${noise} noise (${videos.length} total)`);

    return verdicts;
  } catch (err) {
    const status = err.response?.status || 'unknown';
    logger.error(MOD, `Trash Gate failed after retries (HTTP ${status}) — treating all as signals`, err);
    return videos.map((v) => ({ url: v.url, verdict: 'signal', reason: 'API error — fail open' }));
  }
```

- [ ] **Step 3: Refactor deepAnalysis to use callOpenRouter + safeParseJSON**

Replace the `try { const response = await axios.post(...)` block (lines 205-254) with equivalent using `callOpenRouter` and `safeParseJSON`. Timeout: 45000. On parse failure, return null (not crash).

- [ ] **Step 4: Refactor crossTrendSynthesis to use callOpenRouter + safeParseJSON**

Replace the `try { const response = await axios.post(...)` block (lines 310-354) with equivalent using `callOpenRouter` and `safeParseJSON`. Timeout: 45000. On parse failure, return null.

- [ ] **Step 5: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/ai/analyzer.js
git commit -m "feat: add retry with backoff and JSON safety to AI analyzer"
```

---

### Task 4: Add Retry + JSON Safety to Brand Fit Scorer

**Files:**
- Modify: `src/ai/brand-fit.js`

- [ ] **Step 1: Add retry import and helper**

Same pattern as Task 3: add `withRetry` import, `callOpenRouter` helper, `safeParseJSON` helper.

- [ ] **Step 2: Refactor scoreBrandFit to use callOpenRouter + safeParseJSON**

Replace the `axios.post(...)` call with `callOpenRouter(...)`. Replace `JSON.parse(content)` with `safeParseJSON(content, 'brandFit')`. On parse failure, skip that brand (continue loop, don't crash).

- [ ] **Step 3: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/ai/brand-fit.js
git commit -m "feat: add retry with backoff and JSON safety to brand fit scorer"
```

---

## Chunk 3: Pipeline Failure Isolation + Run Tracking

### Task 5: Refactor Pipeline with Run Tracking + Per-Trend Isolation

**Files:**
- Modify: `src/pipeline.js`

- [ ] **Step 1: Update imports**

Add new DB function imports:

```javascript
const {
  supabase,
  generateTrendHash,
  upsertTrend,
  createEngagementSnapshot,
  getRecentSnapshots,
  testConnection,
  upsertTrendAnalysis,
  insertCrossTrendSynthesis,
  upsertBrandFits,
  createPipelineRun,
  updatePipelineRun,
  createPipelineEvent,
  checkConnection,
} = require('./database/supabase');
```

- [ ] **Step 2: Remove Slack references**

Remove the entire Slack import block (lines 54-63):
```javascript
// Slack module may not be implemented yet — import defensively
let notifyActNow = null;
try {
  const slack = require('./notifications/slack');
  ...
} catch {
  ...
}
```

Remove Step 8 (Slack notifications) entirely — the `actNowTrends` tracking in Step 3 and the notification loop in Step 8.

- [ ] **Step 3: Add run tracking to `runPipeline()`**

At the start of `runPipeline()`, create a pipeline run:

```javascript
  const runId = await createPipelineRun();
  const runErrors = [];
```

Replace Step 0 (Supabase check) with `checkConnection()`:

```javascript
    const connected = await checkConnection();
    if (!connected) {
      logger.error(MOD, 'CRITICAL: Supabase unreachable after 3 attempts — aborting pipeline');
      await createPipelineEvent(runId, 'startup', 'critical', 'Supabase unreachable — pipeline aborted');
      await updatePipelineRun(runId, { status: 'failed', errors: [{ stage: 'startup', message: 'Supabase unreachable' }] });
      return stats;
    }
```

- [ ] **Step 4: Add zero-result event**

After `if (videos.length === 0)` check, add:

```javascript
      await createPipelineEvent(runId, 'scrape', 'warning', 'Zero videos scraped — possible rate limit or DOM change');
```

- [ ] **Step 5: Add per-trend error tracking to Deep Analysis**

In the Deep Analysis loop (Step 5), the existing try/catch is fine. Add error tracking:

```javascript
      } catch (err) {
        runErrors.push({ stage: 'deep_analysis', trendId: survivor.trend_id, error: err.message });
        logger.warn(MOD, `Deep analysis failed: ${survivor.enrichedTrend.title}`, err);
      }
```

Same pattern for Brand Fit loop.

- [ ] **Step 6: Finalize run at pipeline end**

Before `return stats;` at the end of the try block, add:

```javascript
    const runStatus = stats.errors > 0 ? 'partial' : 'success';
    await updatePipelineRun(runId, {
      status: runStatus,
      videos_scraped: stats.scraped,
      videos_passed_gate: stats.signals,
      videos_analyzed: stats.analyzed,
      videos_failed: stats.errors,
      errors: runErrors,
    });

    await createPipelineEvent(runId, 'complete', 'info',
      `Pipeline ${runStatus}: ${stats.scraped} scraped, ${stats.analyzed} analyzed, ${stats.errors} errors`);
```

In the outer catch block, also update the run:

```javascript
  } catch (err) {
    logger.error(MOD, 'Pipeline failed', err);
    runErrors.push({ stage: 'pipeline', error: err.message });
    await updatePipelineRun(runId, { status: 'failed', errors: runErrors });
    await createPipelineEvent(runId, 'pipeline', 'critical', `Pipeline crashed: ${err.message}`);
  }
```

- [ ] **Step 7: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/pipeline.js
git commit -m "feat: add pipeline run tracking, per-trend failure isolation, remove Slack"
```

---

## Chunk 4: Scraping Resilience

### Task 6: Remove Slack References from Scheduler

**Files:**
- Modify: `src/scheduler.js`

- [ ] **Step 1: Remove Slack imports**

Remove lines 14-27 (the Slack import block).

- [ ] **Step 2: Replace Slack notification in failure handler**

In the `onTick` failure handler (lines 166-179), remove the Slack notification call. The pipeline event system from Task 5 replaces this.

- [ ] **Step 3: Remove Slack from daily brief**

In `onDailyBrief()` (lines 215-235), remove the `notifyDailySummary` call. Keep the function's logging — the pipeline_events table now serves this purpose.

- [ ] **Step 4: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.js
git commit -m "chore: remove Slack references from scheduler — replaced by pipeline events"
```

---

### Task 7: Scraping Resilience — Partial Save + Cooldown

**Files:**
- Modify: `src/scrapers/tiktok.js`

This task requires reading `src/scrapers/tiktok.js` first to understand the current scraper structure before making changes. The implementer should:

- [ ] **Step 1: Read the current scraper**

Read `src/scrapers/tiktok.js` in full.

- [ ] **Step 2: Add minimum cooldown enforcement**

Add a module-level variable tracking last scrape time:

```javascript
let lastScrapeEndTime = 0;
const MIN_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
```

At the top of `scrapeOnce()`, check cooldown:

```javascript
  const timeSinceLastScrape = Date.now() - lastScrapeEndTime;
  if (timeSinceLastScrape < MIN_COOLDOWN_MS) {
    const waitMs = MIN_COOLDOWN_MS - timeSinceLastScrape;
    logger.warn(MOD, `Cooldown: waiting ${Math.round(waitMs / 1000)}s before next scrape`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
```

Update `lastScrapeEndTime = Date.now()` in the finally block.

- [ ] **Step 3: Add partial save on timeout**

In the scraper's scroll loop, if the timeout is hit, return whatever videos have been collected so far instead of throwing:

```javascript
// On timeout: return partial results instead of empty
if (collectedVideos.length > 0) {
  logger.warn(MOD, `Timeout reached — returning ${collectedVideos.length} partial results`);
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/tiktok.js
git commit -m "feat: add scraper cooldown enforcement and partial save on timeout"
```

---

### Task 8: Selector Health Check

**Files:**
- Create: `src/scrapers/health-check.js`
- Modify: `src/scheduler.js`

- [ ] **Step 1: Create health check module**

Create `src/scrapers/health-check.js`:

```javascript
const logger = require('../logger');

const MOD = 'HEALTH_CHECK';

/**
 * Checks if key TikTok FYP selectors are present in the DOM.
 * Launches a headless browser, navigates to TikTok, verifies selectors exist.
 *
 * @param {object} [deps] - Injectable dependencies for testing
 * @param {Function} [deps.createPipelineEvent] - Event logger
 * @returns {Promise<{ ok: boolean, details: string }>}
 */
async function checkSelectors(deps = {}) {
  let browser = null;

  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    });
    const page = await context.newPage();

    await page.goto('https://www.tiktok.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for video articles to appear
    const articles = await page.$$('article, [data-e2e="recommend-list-item-container"]');

    if (articles.length === 0) {
      const msg = 'No video articles found in FYP DOM — selectors may be broken';
      logger.error(MOD, msg);
      if (deps.createPipelineEvent) {
        await deps.createPipelineEvent(null, 'health_check', 'critical', msg);
      }
      return { ok: false, details: msg };
    }

    logger.log(MOD, `Health check passed: ${articles.length} articles found`);
    return { ok: true, details: `${articles.length} articles found` };
  } catch (err) {
    const msg = `Health check failed: ${err.message}`;
    logger.error(MOD, msg, err);
    if (deps.createPipelineEvent) {
      await deps.createPipelineEvent(null, 'health_check', 'critical', msg);
    }
    return { ok: false, details: msg };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

module.exports = { checkSelectors };
```

- [ ] **Step 2: Add health check cron to scheduler**

In `src/scheduler.js`, add import:
```javascript
const { checkSelectors } = require('./scrapers/health-check');
const { createPipelineEvent } = require('./database/supabase');
```

Add a new cron in `start()`:
```javascript
  // Health check: every 6 hours
  healthCron = cron.schedule('0 */6 * * *', () => {
    checkSelectors({ createPipelineEvent }).catch((err) => {
      logger.error(MOD, 'Health check cron failed', err);
    });
  });
```

Add `let healthCron = null;` to state variables and clean up in `stop()`.

- [ ] **Step 3: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/scrapers/health-check.js src/scheduler.js
git commit -m "feat: add selector health check with 6-hourly cron"
```

---

## Chunk 5: Thumbnail Persistence

### Task 9: Thumbnail Proxy

**Files:**
- Create: `src/media/thumbnail-proxy.js`
- Modify: `src/pipeline.js`
- Modify: `src/database/supabase.js`

- [ ] **Step 1: Create thumbnail proxy module**

Create `src/media/thumbnail-proxy.js`:

```javascript
const axios = require('axios');
const path = require('path');
const logger = require('../logger');
const { supabase } = require('../database/supabase');

const MOD = 'THUMBNAIL_PROXY';
const BUCKET = 'trend-thumbnails';

/**
 * Downloads a thumbnail from TikTok CDN and uploads it to Supabase Storage.
 * Returns the Supabase Storage public URL, or null on failure.
 *
 * @param {string} originalUrl - TikTok CDN thumbnail URL
 * @param {string} trendId - UUID of the trend (used as filename)
 * @returns {Promise<string|null>} Supabase Storage public URL or null
 */
async function proxyThumbnail(originalUrl, trendId) {
  if (!originalUrl) return null;

  try {
    // Download from TikTok CDN
    const response = await axios.get(originalUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const storagePath = `${trendId}.${ext}`;

    // Upload to Supabase Storage (upsert)
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, response.data, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      logger.warn(MOD, `Upload failed for ${trendId}: ${uploadError.message}`);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    logger.log(MOD, `Proxied thumbnail for ${trendId.slice(0, 8)}`);
    return urlData.publicUrl;
  } catch (err) {
    logger.warn(MOD, `Thumbnail proxy failed for ${trendId.slice(0, 8)}: ${err.message}`);
    return null;
  }
}

/**
 * Deletes thumbnails older than the specified number of days from Storage.
 * @param {number} [daysOld=30] - Delete files older than this
 */
async function cleanupOldThumbnails(daysOld = 30) {
  try {
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list('', { limit: 1000 });

    if (error || !files) {
      logger.warn(MOD, 'Could not list thumbnails for cleanup', error);
      return;
    }

    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const old = files.filter((f) => new Date(f.created_at) < cutoff);

    if (old.length === 0) return;

    const paths = old.map((f) => f.name);
    const { error: deleteError } = await supabase.storage
      .from(BUCKET)
      .remove(paths);

    if (deleteError) {
      logger.warn(MOD, `Cleanup delete failed: ${deleteError.message}`);
    } else {
      logger.log(MOD, `Cleaned up ${old.length} old thumbnails`);
    }
  } catch (err) {
    logger.warn(MOD, 'Thumbnail cleanup failed', err);
  }
}

module.exports = { proxyThumbnail, cleanupOldThumbnails };
```

- [ ] **Step 2: Add `updateTrendThumbnail` to supabase.js**

Add a helper to update just the thumbnail storage URL:

```javascript
/**
 * Updates the thumbnail_storage_url for a trend.
 * @param {string} trendId - Trend UUID
 * @param {string} storageUrl - Supabase Storage URL
 */
async function updateTrendThumbnail(trendId, storageUrl) {
  const { error } = await retrySupabase(
    `thumbnail ${trendId.slice(0, 8)}`,
    () => supabase.from('trends').update({ thumbnail_storage_url: storageUrl }).eq('id', trendId)
  );

  if (error) {
    logger.warn(MOD, `Failed to update thumbnail URL for ${trendId}`, error);
  }
}
```

Export it.

- [ ] **Step 3: Call thumbnail proxy in pipeline.js**

After Step 3 (per-video scoring and persistence), add a thumbnail proxy step for each trend:

```javascript
        // --- Proxy thumbnail to Supabase Storage ---
        if (enrichedTrend.thumbnail_url) {
          try {
            const { proxyThumbnail } = require('./media/thumbnail-proxy');
            const storageUrl = await proxyThumbnail(enrichedTrend.thumbnail_url, trend_id);
            if (storageUrl) {
              await updateTrendThumbnail(trend_id, storageUrl);
            }
          } catch (thumbErr) {
            logger.warn(MOD, `Thumbnail proxy failed: ${enrichedTrend.title}`, thumbErr);
          }
        }
```

- [ ] **Step 4: Add nightly cleanup cron to scheduler**

In `src/scheduler.js`, add:

```javascript
const { cleanupOldThumbnails } = require('./media/thumbnail-proxy');

// In start():
  // Nightly thumbnail cleanup: 03:00 WIB
  cleanupCron = cron.schedule('0 3 * * *', () => {
    cleanupOldThumbnails(30).catch((err) => {
      logger.error(MOD, 'Thumbnail cleanup cron failed', err);
    });
  });
```

Add `let cleanupCron = null;` and clean up in `stop()`.

- [ ] **Step 5: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/media/thumbnail-proxy.js src/database/supabase.js src/pipeline.js src/scheduler.js
git commit -m "feat: add thumbnail proxy to Supabase Storage with nightly cleanup"
```

---

## Chunk 6: Frontend Resilience

### Task 10: Frontend — Thumbnail Fallback Chain

**Files:**
- Identify and modify the component that renders trend thumbnails

- [ ] **Step 1: Find thumbnail component**

Search frontend for components that use `thumbnail_url`. Read the component(s) to understand the current rendering.

- [ ] **Step 2: Add fallback chain**

Update the image rendering to use: `thumbnail_storage_url` → `thumbnail_url` → placeholder gradient.

```tsx
const src = trend.thumbnail_storage_url || trend.thumbnail_url;

// In the img tag:
<img
  src={src || undefined}
  onError={(e) => { e.currentTarget.style.display = 'none'; }}
  ...
/>
{!src && <div className="...placeholder..." />}
```

- [ ] **Step 3: Add `thumbnail_storage_url` to frontend types**

Update `frontend/src/types/index.ts` (or equivalent) to include `thumbnail_storage_url?: string`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat: add thumbnail fallback chain (storage → CDN → placeholder)"
```

---

### Task 11: Frontend — TikTok Embed Fallback

**Files:**
- Identify and modify the TikTok embed component

- [ ] **Step 1: Find embed component**

Search frontend for TikTok embed usage (embed.js, video ID extraction). Read the component.

- [ ] **Step 2: Add loading state and timeout**

Add a loading skeleton while embed loads, and a 5-second timeout:

```tsx
const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

useEffect(() => {
  const timer = setTimeout(() => {
    if (status === 'loading') setStatus('failed');
  }, 5000);
  return () => clearTimeout(timer);
}, []);
```

- [ ] **Step 3: Add fallback card on failure**

When status is 'failed', show a card with the thumbnail and an "Open on TikTok" link instead of the broken embed.

- [ ] **Step 4: Verify frontend builds**

Run: `cd frontend && npm run build`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: add TikTok embed timeout fallback with loading state"
```

---

## Chunk 7: Final Verification

### Task 12: Run All Tests + Build

- [ ] **Step 1: Run all backend tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Verify pipeline_runs and pipeline_events tables exist**

Query Supabase to confirm tables were created.

- [ ] **Step 4: Final commit if any cleanup needed**

Review all changes with `git diff --stat` and ensure everything is committed.
