# Phase A: Backend Reliability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Trend Watcher backend with crash recovery, selector monitoring, smarter scoring, cost tracking, format persistence, cross-run velocity, and conditional HTTPS.

**Architecture:** 7 independent backend changes. Each task is self-contained and can be committed separately. DB migrations run first. All code is Node.js CommonJS — no ES modules.

**Tech Stack:** Node.js, Supabase (Postgres), OpenRouter API, Slack webhooks, Playwright, Jest

---

## Chunk 1: Database Migrations + Scoring (Tasks 1-3)

### Task 1: Run DB Migrations

**Files:**
- Create: `supabase/migrations/phase_a_reliability.sql`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/phase_a_reliability.sql

-- Cost tracking on pipeline_runs
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(8,4) DEFAULT 0;

-- Detected formats on trends
ALTER TABLE trends
  ADD COLUMN IF NOT EXISTS detected_formats TEXT[] DEFAULT '{}';
```

- [ ] **Step 2: Run migration via Supabase MCP**

Execute both ALTER TABLE statements against the production Supabase project (`tnvnevydxobtmiackdkz`).

- [ ] **Step 3: Verify columns exist**

Run: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pipeline_runs' AND column_name IN ('tokens_used', 'estimated_cost_usd');`
Expected: 2 rows

Run: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'trends' AND column_name = 'detected_formats';`
Expected: 1 row

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/phase_a_reliability.sql
git commit -m "feat: add DB migrations for Phase A (tokens, cost, formats)"
```

---

### Task 2: Recency Decay Scoring

**Files:**
- Modify: `src/scoring/engagement.js` (add function after line 201)
- Modify: `src/scoring/classifier.js:130-145` (modify `compositeScore()`)
- Test: `tests/scoring.test.js`

- [ ] **Step 1: Write failing tests for recency decay**

Add to end of `tests/scoring.test.js`:

```javascript
describe('calculateRecencyMultiplier', () => {
  const { calculateRecencyMultiplier, RECENCY_HALF_LIFE_HOURS } = require('../src/scoring/engagement');

  test('returns 1.0 for brand new trend (0 hours old)', () => {
    const now = new Date();
    expect(calculateRecencyMultiplier(now.toISOString(), now)).toBeCloseTo(1.0, 2);
  });

  test('returns ~0.5 at half-life (12 hours)', () => {
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    expect(calculateRecencyMultiplier(twelveHoursAgo.toISOString(), now)).toBeCloseTo(0.5, 1);
  });

  test('returns ~0.25 at 24 hours', () => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    expect(calculateRecencyMultiplier(dayAgo.toISOString(), now)).toBeCloseTo(0.25, 1);
  });

  test('returns near 0 at 72 hours', () => {
    const now = new Date();
    const threeeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const result = calculateRecencyMultiplier(threeeDaysAgo.toISOString(), now);
    expect(result).toBeLessThan(0.02);
    expect(result).toBeGreaterThan(0);
  });

  test('returns 1.0 for null scraped_at', () => {
    expect(calculateRecencyMultiplier(null, new Date())).toBe(1.0);
  });

  test('returns 1.0 for undefined scraped_at', () => {
    expect(calculateRecencyMultiplier(undefined, new Date())).toBe(1.0);
  });

  test('half-life constant is 12', () => {
    expect(RECENCY_HALF_LIFE_HOURS).toBe(12);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: New tests FAIL with "calculateRecencyMultiplier is not a function" or similar

- [ ] **Step 3: Implement calculateRecencyMultiplier**

Add to `src/scoring/engagement.js` before `module.exports`:

```javascript
/**
 * Half-life for recency decay in hours. Exported for testability.
 * At 12h, a trend retains 50% of its recency score.
 */
const RECENCY_HALF_LIFE_HOURS = 12;

/**
 * Calculates exponential decay multiplier based on trend age.
 * Used as final multiplier on composite trend score.
 *
 * @param {string|null} scrapedAt - ISO timestamp of when trend was scraped
 * @param {Date} [now=new Date()] - Current time (injectable for testing)
 * @returns {number} Multiplier 0.0-1.0 (1.0 = brand new, 0.5 = half-life age)
 */
function calculateRecencyMultiplier(scrapedAt, now) {
  if (!scrapedAt) return 1.0;
  const scrapedTime = new Date(scrapedAt).getTime();
  if (isNaN(scrapedTime)) return 1.0;
  const currentTime = (now || new Date()).getTime();
  const ageHours = Math.max(0, (currentTime - scrapedTime) / (1000 * 60 * 60));
  return Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS);
}
```

Update `module.exports` in `src/scoring/engagement.js` to include:

```javascript
module.exports = {
  calculateEngagementRate,
  calculateVelocityScore,
  calculateMomentum,
  calculateWeightedEngagementRate,
  calculateShareRatio,
  calculateRecencyMultiplier,
  RECENCY_HALF_LIFE_HOURS,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: ALL tests pass including new recency decay tests

- [ ] **Step 5: Write test for compositeScore with recency**

Add to `tests/scoring.test.js` inside the existing `compositeScore` describe block:

```javascript
test('applies recency decay when scrapedAt provided', () => {
  const { compositeScore } = require('../src/scoring/classifier');
  const now = new Date();
  const freshScore = compositeScore(50, 50, 10, 50, now.toISOString());
  const twelveHourScore = compositeScore(50, 50, 10, 50,
    new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString());
  // 12h old should be roughly half of fresh
  expect(twelveHourScore).toBeCloseTo(freshScore * 0.5, 0);
});

test('compositeScore without scrapedAt returns undecayed score', () => {
  const { compositeScore } = require('../src/scoring/classifier');
  const withoutTime = compositeScore(50, 50, 10, 50);
  const withNullTime = compositeScore(50, 50, 10, 50, null);
  expect(withoutTime).toBe(withNullTime);
});
```

- [ ] **Step 6: Run tests to verify compositeScore tests fail**

Run: `npm test`
Expected: New compositeScore tests FAIL (function doesn't accept scrapedAt yet)

- [ ] **Step 7: Modify compositeScore to apply recency decay**

In `src/scoring/classifier.js`:

Add at top of file (after existing requires):
```javascript
const { calculateRecencyMultiplier } = require('./engagement');
```

Change `compositeScore` function signature (line 130) from:
```javascript
function compositeScore(engagementRate, velocityScore, replicationCount, patternScore) {
```
to:
```javascript
function compositeScore(engagementRate, velocityScore, replicationCount, patternScore, scrapedAt) {
```

Before the `return` statement (around line 144), add:
```javascript
  const recency = calculateRecencyMultiplier(scrapedAt);
  score = score * recency;
```

- [ ] **Step 8: Run tests to verify all pass**

Run: `npm test`
Expected: ALL tests pass (existing tests don't pass scrapedAt so get multiplier=1.0, backwards compatible)

- [ ] **Step 9: Update pipeline to pass scrapedAt to compositeScore**

In `src/pipeline.js`, find where `compositeScore()` is called and add `video.scraped_at || new Date().toISOString()` as the 5th argument. The call is around line 235.

- [ ] **Step 10: Commit**

```bash
git add src/scoring/engagement.js src/scoring/classifier.js src/pipeline.js tests/scoring.test.js
git commit -m "feat: add recency decay scoring (12h half-life exponential)"
```

---

### Task 3: Cross-Run Velocity

**Files:**
- Modify: `src/scoring/engagement.js:56-111` (update `calculateVelocityScore()`)
- Modify: `src/database/supabase.js` (add `getLatestSnapshot()`)
- Modify: `src/pipeline.js` (fetch previous snapshot before scoring)
- Test: `tests/scoring.test.js`

- [ ] **Step 1: Write failing tests for cross-run velocity**

Add to `tests/scoring.test.js`:

```javascript
describe('calculateVelocityScore with previousSnapshot', () => {
  const { calculateVelocityScore } = require('../src/scoring/engagement');

  test('uses cross-run delta when previousSnapshot provided', () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const previousSnapshot = {
      views: 50000, likes: 2000, comments: 100, shares: 500,
      captured_at: twoHoursAgo.toISOString(),
    };
    const currentMetrics = {
      views: 200000, likes: 8000, comments: 400, shares: 2000,
      captured_at: now.toISOString(),
    };
    const score = calculateVelocityScore([], previousSnapshot, currentMetrics);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('falls back to single-batch when no previousSnapshot', () => {
    const snapshots = [
      { views: 1000, likes: 50, comments: 5, shares: 10, captured_at: new Date().toISOString() },
    ];
    const withoutPrev = calculateVelocityScore(snapshots);
    const withNullPrev = calculateVelocityScore(snapshots, null, null);
    expect(withoutPrev).toBe(withNullPrev);
  });

  test('ignores stale previousSnapshot (>72 hours)', () => {
    const now = new Date();
    const fourDaysAgo = new Date(now.getTime() - 96 * 60 * 60 * 1000);
    const staleSnapshot = {
      views: 50000, likes: 2000, comments: 100, shares: 500,
      captured_at: fourDaysAgo.toISOString(),
    };
    const currentMetrics = {
      views: 200000, likes: 8000, comments: 400, shares: 2000,
      captured_at: now.toISOString(),
    };
    const snapshots = [currentMetrics];
    const withStale = calculateVelocityScore(snapshots, staleSnapshot, currentMetrics);
    const withoutPrev = calculateVelocityScore(snapshots);
    expect(withStale).toBe(withoutPrev);
  });

  test('handles FYP mode (zero views) in cross-run delta', () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const previousSnapshot = {
      views: 0, likes: 100, comments: 10, shares: 50,
      captured_at: oneHourAgo.toISOString(),
    };
    const currentMetrics = {
      views: 0, likes: 500, comments: 50, shares: 200,
      captured_at: now.toISOString(),
    };
    const score = calculateVelocityScore([], previousSnapshot, currentMetrics);
    expect(score).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: New tests FAIL

- [ ] **Step 3: Update calculateVelocityScore to accept previousSnapshot**

In `src/scoring/engagement.js`, modify `calculateVelocityScore` (line 56):

Change signature from:
```javascript
function calculateVelocityScore(snapshots) {
```
to:
```javascript
function calculateVelocityScore(snapshots, previousSnapshot, currentMetrics) {
```

Add cross-run path at the top of the function body (before existing logic):

```javascript
  // Cross-run velocity: compare current metrics to previous pipeline run's snapshot
  if (previousSnapshot && currentMetrics) {
    const prevTime = new Date(previousSnapshot.captured_at).getTime();
    const currTime = new Date(currentMetrics.captured_at || Date.now()).getTime();
    const hoursBetween = (currTime - prevTime) / (1000 * 60 * 60);

    // Ignore stale snapshots (>72h) or invalid time gaps
    if (hoursBetween > 0 && hoursBetween < 72) {
      const currViews = currentMetrics.views || 0;
      const prevViews = previousSnapshot.views || 0;

      if (currViews > 0 && prevViews > 0) {
        // Normal mode: view-based velocity
        const viewsPerHour = Math.max(0, (currViews - prevViews) / hoursBetween);
        return Math.min(100, Math.round(
          (Math.log10(Math.max(viewsPerHour, 1)) / Math.log10(100000)) * 100 * 100
        ) / 100);
      } else {
        // FYP mode: weighted volume delta
        const currVolume = (currentMetrics.likes || 0) + (currentMetrics.comments || 0) * 2 + (currentMetrics.shares || 0) * 3;
        const prevVolume = (previousSnapshot.likes || 0) + (previousSnapshot.comments || 0) * 2 + (previousSnapshot.shares || 0) * 3;
        const volumePerHour = Math.max(0, (currVolume - prevVolume) / hoursBetween);
        const MAX_VOLUME = 10000000;
        return Math.min(100, Math.round(
          (Math.log10(Math.max(volumePerHour, 1)) / Math.log10(MAX_VOLUME)) * 100 * 100
        ) / 100);
      }
    }
  }

  // Fall back to existing single-batch behavior
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test`
Expected: ALL tests pass (existing tests pass null/undefined for new params, backwards compatible)

- [ ] **Step 5: Add getLatestSnapshot to supabase.js**

Add to `src/database/supabase.js` before `module.exports`:

```javascript
/**
 * Fetches the most recent engagement snapshot for a trend.
 * Used for cross-run velocity calculation.
 *
 * @param {string} trendId - Trend UUID
 * @returns {Promise<object|null>} Latest snapshot or null
 */
async function getLatestSnapshot(trendId) {
  if (!trendId) return null;
  try {
    const { data, error } = await retrySupabase(
      `get latest snapshot ${trendId.slice(0, 8)}`,
      () => supabase
        .from('engagement_snapshots')
        .select('views, likes, comments, shares, bookmarks, captured_at')
        .eq('trend_id', trendId)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );
    if (error) {
      logger.warn(MOD, `Failed to get latest snapshot for ${trendId}: ${error.message}`);
      return null;
    }
    return data;
  } catch (err) {
    logger.warn(MOD, `getLatestSnapshot error: ${err.message}`);
    return null;
  }
}
```

Add `getLatestSnapshot` to `module.exports`.

- [ ] **Step 6: Wire cross-run velocity in pipeline.js**

In `src/pipeline.js`, after the `upsertTrend()` call (around line 279) which returns `{ inserted, trend_id }`, and before the engagement snapshot is created, add:

```javascript
        // Fetch previous snapshot for cross-run velocity
        let previousSnapshot = null;
        if (trend_id) {
          previousSnapshot = await getLatestSnapshot(trend_id);
        }
```

Then update the `calculateVelocityScore()` call (around line 204) to pass the previous snapshot. NOTE: Since velocity is calculated before upsert in the current flow, we need to reorganize slightly — move the velocity recalculation AFTER upsert when we have trend_id. Add after the previousSnapshot fetch:

```javascript
        // Recalculate velocity with cross-run data if available
        if (previousSnapshot) {
          const currentMetrics = {
            views: video.views || 0,
            likes: video.likes || 0,
            comments: video.comments || 0,
            shares: video.shares || 0,
            captured_at: new Date().toISOString(),
          };
          enrichedTrend.velocity_score = calculateVelocityScore(
            recentSnapshots, previousSnapshot, currentMetrics
          );
        }
```

Add `getLatestSnapshot` to the require statement from `./database/supabase`.

- [ ] **Step 7: Run tests to verify all pass**

Run: `npm test`
Expected: ALL tests pass

- [ ] **Step 8: Commit**

```bash
git add src/scoring/engagement.js src/database/supabase.js src/pipeline.js tests/scoring.test.js
git commit -m "feat: add cross-run velocity using engagement snapshot deltas"
```

---

## Chunk 2: Pipeline Infrastructure (Tasks 4-5)

### Task 4: Pipeline Crash Recovery

**Files:**
- Modify: `src/database/supabase.js` (add `isPipelineRunning()`, `recoverOrphanedRuns()`)
- Modify: `src/server.js:39-42, 187-232` (replace in-memory state with DB reads)

- [ ] **Step 1: Add isPipelineRunning and recoverOrphanedRuns to supabase.js**

Add to `src/database/supabase.js` before `module.exports`:

```javascript
const PIPELINE_MAX_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Checks if any pipeline run is currently in 'running' status.
 * @returns {Promise<boolean>}
 */
async function isPipelineRunning() {
  try {
    const { data, error } = await supabase
      .from('pipeline_runs')
      .select('id')
      .eq('status', 'running')
      .limit(1)
      .maybeSingle();
    if (error) {
      logger.warn(MOD, `isPipelineRunning check failed: ${error.message}`);
      return false; // Fail open — allow triggering if we can't check
    }
    return !!data;
  } catch (err) {
    logger.warn(MOD, `isPipelineRunning error: ${err.message}`);
    return false;
  }
}

/**
 * Recovers pipeline runs stuck in 'running' state for longer than PIPELINE_MAX_DURATION_MS.
 * Marks them as 'failed' with a recovery note. Writes pipeline_event for visibility.
 * @returns {Promise<number>} Number of recovered runs
 */
async function recoverOrphanedRuns() {
  try {
    const cutoff = new Date(Date.now() - PIPELINE_MAX_DURATION_MS).toISOString();
    const { data: orphaned, error: fetchErr } = await supabase
      .from('pipeline_runs')
      .select('id, started_at')
      .eq('status', 'running')
      .lt('started_at', cutoff);

    if (fetchErr || !orphaned || orphaned.length === 0) return 0;

    for (const run of orphaned) {
      const { error: updateErr } = await supabase
        .from('pipeline_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', run.id);

      if (!updateErr) {
        logger.warn(MOD, `Recovered orphaned pipeline run ${run.id} (started ${run.started_at})`);
        await createPipelineEvent({
          run_id: run.id,
          event_type: 'pipeline_recovered',
          severity: 'warning',
          message: `Pipeline run recovered after crash/timeout (started ${run.started_at})`,
        });
      }
    }
    return orphaned.length;
  } catch (err) {
    logger.warn(MOD, `recoverOrphanedRuns error: ${err.message}`);
    return 0;
  }
}
```

Add `isPipelineRunning`, `recoverOrphanedRuns` to `module.exports`.

- [ ] **Step 2: Update server.js — remove in-memory state**

In `src/server.js`:

Remove lines 39-42 (the in-memory vars):
```javascript
let pipelineRunning = false;
let lastRun = null;
let lastRunDuration = 0;
let lastRunResult = null;
```

Add to the imports from `./database/supabase` (line 6):
```javascript
const { testConnection, supabase, acknowledgePipelineEvents, isPipelineRunning, recoverOrphanedRuns } = require('./database/supabase');
```

- [ ] **Step 3: Update /trigger/scrape endpoint**

Replace the `/trigger/scrape` handler (lines 187-219) with:

```javascript
app.post('/trigger/scrape', triggerLimiter, requireAuth, async (req, res) => {
  // Recover any orphaned runs before checking
  await recoverOrphanedRuns();

  const running = await isPipelineRunning();
  if (running) {
    return res.status(409).json({ error: 'Scrape already running' });
  }

  // Trigger pipeline asynchronously — respond immediately
  const triggerTime = new Date().toISOString();

  (async () => {
    try {
      await runPipelineOnce();
    } catch (err) {
      logger.error(MOD, 'Pipeline trigger failed', err);
    }
  })();

  res.status(202).json({
    message: 'Scrape triggered',
    timestamp: triggerTime,
  });
});
```

- [ ] **Step 4: Update /status/pipeline endpoint**

Replace the `/status/pipeline` handler (lines 225-232) with:

```javascript
app.get('/status/pipeline', async (req, res) => {
  try {
    const running = await isPipelineRunning();

    const { data: latest } = await supabase
      .from('pipeline_runs')
      .select('started_at, completed_at, status, videos_scraped, videos_analyzed, tokens_used, estimated_cost_usd')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({
      running,
      lastRun: latest?.completed_at || latest?.started_at || null,
      lastRunDuration: latest?.completed_at && latest?.started_at
        ? new Date(latest.completed_at).getTime() - new Date(latest.started_at).getTime()
        : 0,
      lastRunResult: latest ? {
        status: latest.status,
        videos_scraped: latest.videos_scraped,
        videos_analyzed: latest.videos_analyzed,
        tokens_used: latest.tokens_used,
        estimated_cost_usd: latest.estimated_cost_usd,
      } : null,
    });
  } catch (err) {
    logger.error(MOD, 'Status pipeline error', err);
    res.status(500).json({ error: 'Failed to get pipeline status' });
  }
});
```

- [ ] **Step 5: Add recovery on startup**

In `src/server.js` inside the `start()` function (around line 275), after the Supabase connection test, add:

```javascript
  // Recover any orphaned pipeline runs from previous crashes
  const recovered = await recoverOrphanedRuns();
  if (recovered > 0) {
    logger.warn(MOD, `Recovered ${recovered} orphaned pipeline run(s) from previous crash`);
  }
```

- [ ] **Step 6: Run tests to verify nothing broke**

Run: `npm test`
Expected: ALL tests pass

- [ ] **Step 7: Commit**

```bash
git add src/server.js src/database/supabase.js
git commit -m "feat: pipeline crash recovery with DB-backed running state"
```

---

### Task 5: Persist Detected Formats

**Files:**
- Modify: `src/pipeline.js` (include detected_formats in upsert)
- Modify: `src/database/supabase.js` (include detected_formats field)
- Modify: `src/api/for-you.js` (read from DB instead of recomputing)
- Modify: `src/api/patterns.js` (read from DB instead of recomputing)

- [ ] **Step 1: Include detected_formats in upsertTrend data**

In `src/pipeline.js`, find where `enrichedTrend` object is built (around line 250-270). The `formats` variable is already computed at line 217. Add to the enrichedTrend object:

```javascript
        detected_formats: formats,
```

- [ ] **Step 2: Include detected_formats in upsertTrend field list**

In `src/database/supabase.js`, find the `upsertTrend()` function. In the object being upserted, add `detected_formats` to the field list. It should be passed through from `trendData.detected_formats`.

- [ ] **Step 3: Update /api/for-you to read from DB**

In `src/api/for-you.js`, find where `detectFormat()` is called per trend. Replace with reading `t.detected_formats` directly from the trend row. Remove the recomputation fallback if it exists. Keep the `detectFormat` import only if still needed elsewhere in the file.

- [ ] **Step 4: Update /api/patterns to read from DB**

In `src/api/patterns.js`, find where format distribution is computed. Replace the per-trend `detectFormat()` call with reading from `trend.detected_formats`. Aggregate the stored arrays instead of recomputing.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: ALL tests pass

- [ ] **Step 6: Commit**

```bash
git add src/pipeline.js src/database/supabase.js src/api/for-you.js src/api/patterns.js
git commit -m "feat: persist detected_formats to trends table"
```

---

## Chunk 3: Monitoring + Alerts (Tasks 6-8)

### Task 6: Selector Health Monitoring

**Files:**
- Modify: `src/scrapers/health-check.js` (enhance with Slack + events)
- Modify: `src/notifications/slack.js` (add `alertSelectorHealth()`)
- Modify: `src/scheduler.js` (pass Slack dep)

- [ ] **Step 1: Add alertSelectorHealth to slack.js**

Add to `src/notifications/slack.js` before `module.exports`:

```javascript
/** Last selector health alert timestamp (throttle: 1 per 24h) */
let lastSelectorAlertAt = 0;

/**
 * Sends Slack alert when TikTok selectors fail health check.
 * Throttled to max 1 alert per 24 hours.
 *
 * @param {string} details - Description of which selectors failed
 * @returns {Promise<boolean>} Whether alert was sent
 */
async function alertSelectorHealth(details) {
  const now = Date.now();
  if (now - lastSelectorAlertAt < 24 * 60 * 60 * 1000) {
    logger.log(MOD, 'Selector health alert throttled (already sent in last 24h)');
    return false;
  }

  const sent = await sendRaw(
    ':rotating_light: *TikTok Selector Health Check FAILED*\n' +
    '```\n' + details + '\n```\n' +
    'The scraper may not be collecting data. Check `src/scrapers/tiktok.js` SELECTORS.'
  );

  if (sent) lastSelectorAlertAt = now;
  return sent;
}
```

Add `alertSelectorHealth` to `module.exports`.

- [ ] **Step 2: Enhance checkSelectors with Slack + events**

In `src/scrapers/health-check.js`, update the function to accept and use Slack alert and pipeline event deps:

After the existing `ok`/`details` result is computed (before the return), add:

```javascript
    // Write pipeline event for frontend visibility
    if (deps.createPipelineEvent) {
      try {
        await deps.createPipelineEvent({
          event_type: result.ok ? 'selector_health_ok' : 'selector_health_failed',
          severity: result.ok ? 'info' : 'critical',
          message: result.details,
        });
      } catch (eventErr) {
        logger.warn(MOD, `Failed to write selector health event: ${eventErr.message}`);
      }
    }

    // Send Slack alert on failure
    if (!result.ok && deps.alertSelectorHealth) {
      try {
        await deps.alertSelectorHealth(result.details);
      } catch (slackErr) {
        logger.warn(MOD, `Failed to send selector health Slack alert: ${slackErr.message}`);
      }
    }
```

- [ ] **Step 3: Pass Slack dep from scheduler**

In `src/scheduler.js`, add import:
```javascript
const { alertSelectorHealth } = require('./notifications/slack');
```

Update the health check cron call (around line 238-242):
```javascript
healthCron = cron.schedule('0 */6 * * *', () => {
  checkSelectors({ createPipelineEvent, alertSelectorHealth }).catch((err) => {
    logger.error(MOD, 'Health check cron failed', err);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: ALL tests pass

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/health-check.js src/notifications/slack.js src/scheduler.js
git commit -m "feat: selector health monitoring with Slack alerts + pipeline events"
```

---

### Task 7: OpenRouter Cost Tracking

**Files:**
- Modify: `src/ai/analyzer.js:40-55` (extract token usage)
- Modify: `src/ai/brand-fit.js:24-39` (extract token usage)
- Modify: `src/pipeline.js` (accumulate + persist tokens)
- Modify: `src/database/supabase.js` (accept new fields)
- Modify: `src/notifications/slack.js` (add `alertDailyCost()`)

- [ ] **Step 1: Modify callOpenRouter in analyzer.js to return usage**

In `src/ai/analyzer.js`, change `callOpenRouter()` (line 40-55) to also return usage data. Change the return statement from:
```javascript
return response.data;
```
to:
```javascript
const result = response.data;
result._usage = result.usage || {};
return result;
```

- [ ] **Step 2: Modify callOpenRouter in brand-fit.js identically**

In `src/ai/brand-fit.js`, apply the same change to its `callOpenRouter()` (line 24-39):
```javascript
const result = response.data;
result._usage = result.usage || {};
return result;
```

- [ ] **Step 3: Add token accumulator to pipeline.js**

In `src/pipeline.js`, add at the top of `runPipelineOnce()`:

```javascript
  // Token usage accumulator for cost tracking
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  function trackTokens(apiResponse) {
    if (apiResponse && apiResponse._usage) {
      totalPromptTokens += apiResponse._usage.prompt_tokens || 0;
      totalCompletionTokens += apiResponse._usage.completion_tokens || 0;
    }
  }
```

Then after each LLM call (trashGate, deepAnalysis, crossTrendSynthesis, scoreBrandFit), call `trackTokens()` on the raw API response. This requires modifying the AI functions to expose the raw response — OR simpler: track at the pipeline level by adding a callback.

**Simpler approach:** Since the AI functions already return parsed data (not the raw response), we need to modify them to also return usage. Update `trashGate()` return to include `_usage`, `deepAnalysis()` to include `_usage`, etc.

**Actually simplest:** Add a module-level token counter in `src/ai/analyzer.js` and `src/ai/brand-fit.js`:

In `src/ai/analyzer.js`, add at module level:
```javascript
let _runTokens = { prompt: 0, completion: 0 };

function resetTokenCounter() {
  _runTokens = { prompt: 0, completion: 0 };
}

function getTokenUsage() {
  return { ..._runTokens };
}
```

In `callOpenRouter()`, after getting `response.data`, add:
```javascript
if (response.data.usage) {
  _runTokens.prompt += response.data.usage.prompt_tokens || 0;
  _runTokens.completion += response.data.usage.completion_tokens || 0;
}
```

Export `resetTokenCounter` and `getTokenUsage`.

Apply the same pattern to `src/ai/brand-fit.js`.

- [ ] **Step 4: In pipeline.js, use token counters**

At the start of `runPipelineOnce()`:
```javascript
  // Reset AI token counters
  const { resetTokenCounter: resetAnalyzerTokens, getTokenUsage: getAnalyzerTokens } = require('./ai/analyzer');
  const { resetTokenCounter: resetBrandFitTokens, getTokenUsage: getBrandFitTokens } = require('./ai/brand-fit');
  resetAnalyzerTokens();
  resetBrandFitTokens();
```

At the end, before `updatePipelineRun()`:
```javascript
  const analyzerTokens = getAnalyzerTokens();
  const brandFitTokens = getBrandFitTokens();
  const totalPromptTokens = analyzerTokens.prompt + brandFitTokens.prompt;
  const totalCompletionTokens = analyzerTokens.completion + brandFitTokens.completion;
  const tokensUsed = totalPromptTokens + totalCompletionTokens;
  const estimatedCostUsd = (totalPromptTokens * 0.10 + totalCompletionTokens * 0.40) / 1000000;
```

Pass `tokens_used: tokensUsed, estimated_cost_usd: estimatedCostUsd` to `updatePipelineRun()`.

- [ ] **Step 5: Update updatePipelineRun to accept new fields**

In `src/database/supabase.js`, the `updatePipelineRun()` function already spreads `...update` into the update call, so `tokens_used` and `estimated_cost_usd` will be passed through automatically. Verify this is the case.

- [ ] **Step 6: Add daily cost alert**

In `src/notifications/slack.js`, add:

```javascript
let lastCostAlertDate = null;

/**
 * Sends Slack alert if daily AI spend exceeds threshold.
 * Max one alert per calendar day.
 *
 * @param {number} totalCost - Total cost today in USD
 * @param {number} threshold - Alert threshold in USD
 * @returns {Promise<boolean>}
 */
async function alertDailyCost(totalCost, threshold) {
  const today = new Date().toISOString().slice(0, 10);
  if (lastCostAlertDate === today) return false;

  const sent = await sendRaw(
    ':money_with_wings: *Daily AI Cost Alert*\n' +
    `Today's spend: *$${totalCost.toFixed(4)}* (threshold: $${threshold.toFixed(2)})\n` +
    'Check OpenRouter dashboard for details.'
  );

  if (sent) lastCostAlertDate = today;
  return sent;
}
```

Add `alertDailyCost` to `module.exports`.

- [ ] **Step 7: Add cost check in pipeline.js after run**

After computing `estimatedCostUsd`, add:

```javascript
  // Check daily cost threshold
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: todayRuns } = await supabase
      .from('pipeline_runs')
      .select('estimated_cost_usd')
      .gte('started_at', today + 'T00:00:00.000Z');
    const dailyTotal = (todayRuns || []).reduce((sum, r) => sum + (parseFloat(r.estimated_cost_usd) || 0), 0);
    const threshold = parseFloat(process.env.DAILY_COST_ALERT_USD) || 5.0;
    if (dailyTotal > threshold) {
      const { alertDailyCost } = require('./notifications/slack');
      await alertDailyCost(dailyTotal, threshold);
    }
  } catch (costErr) {
    logger.warn(MOD, `Cost alert check failed: ${costErr.message}`);
  }
```

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: ALL tests pass

- [ ] **Step 9: Commit**

```bash
git add src/ai/analyzer.js src/ai/brand-fit.js src/pipeline.js src/database/supabase.js src/notifications/slack.js
git commit -m "feat: OpenRouter cost tracking with daily Slack alerts"
```

---

### Task 8: Conditional HTTPS Headers

**Files:**
- Modify: `src/server.js:73-85` (conditional CSP)

- [ ] **Step 1: Make upgradeInsecureRequests conditional**

In `src/server.js`, replace the helmet config (lines 73-85):

```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.tiktok.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", process.env.SUPABASE_URL || '', "https://*.supabase.co"],
      frameSrc: ["'self'", "https://www.tiktok.com"],
      ...(process.env.HTTPS_ENABLED !== 'true' ? { upgradeInsecureRequests: null } : {}),
    },
  },
}));
```

- [ ] **Step 2: Verify CSP without HTTPS_ENABLED**

Run: `curl -s -I http://localhost:3001/ | grep -i content-security-policy`
Expected: Should NOT contain `upgrade-insecure-requests`

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: ALL tests pass

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat: conditional HTTPS security headers via HTTPS_ENABLED env var"
```

---

## Final Verification

- [ ] **Run full test suite**

Run: `npm test`
Expected: ALL tests pass (existing + new recency + cross-run velocity tests)

- [ ] **Trigger a pipeline run to verify end-to-end**

```bash
curl -s -X POST http://localhost:3001/trigger/scrape -H "x-auth-secret: <AUTH_SECRET>"
```

Wait for completion, then verify:
- `/status/pipeline` returns DB-backed status with `tokens_used` and `estimated_cost_usd`
- Trends have `detected_formats` populated
- Trend scores reflect recency decay
