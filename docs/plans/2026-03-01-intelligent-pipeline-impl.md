# Intelligent Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the Epilog Trend Watcher backend from a TikTok /explore scraper with single-pass AI into an FYP-scrolling, screenshot-capturing, 3-phase AI pipeline with cross-repo documentation contracts.

**Architecture:** FYP Scroll + Screenshot → Scoring Engine → Trash Gate (batch LLM) → Deep Analysis (per-trend multimodal LLM) → Cross-Trend Synthesis (batch LLM) → Brand Fit (per-brand per-trend LLM) → Supabase → Frontend (Realtime).

**Tech Stack:** Node.js (CommonJS), Playwright, OpenRouter (Gemini Flash), Supabase JS, axios, node-cron, Express.

**Design doc:** `docs/plans/2026-03-01-intelligent-pipeline-design.md`

---

## Task 1: Update .gitignore and CLAUDE.md

**Why first:** Every subsequent task depends on correct documentation and ignoring transient files. This also fixes the outdated "backend NEVER writes to trend_analysis/client_brand_fit" lie in CLAUDE.md.

**Files:**
- Modify: `.gitignore`
- Modify: `CLAUDE.md`
- Create: `../EPILOG-TREND-FRONTEND/CLAUDE.md`

**Step 1: Add screenshots/ and debug/ to .gitignore**

In `.gitignore`, append:

```
screenshots/
debug/
```

**Step 2: Rewrite CLAUDE.md with corrected ownership and cross-repo rules**

Replace the entire `CLAUDE.md`. Key changes:
- Fix "AI (future)" to "AI: OpenRouter via Gemini Flash" in Architecture section
- Fix folder structure to include `src/ai/` (analyzer.js, brand-fit.js)
- Fix Database Rules: backend now WRITES to `trends`, `engagement_snapshots`, `trend_analysis`, `client_brand_fit`
- Backend NEVER writes to: `team_feedback`, `taste_weights`
- Add new section: "## Cross-Repo Contract" documenting shared schema rules
- Add new section: "## AI Pipeline Architecture" documenting 3-phase pipeline
- Add new section: "## FYP Scraper Strategy" documenting FYP approach + screenshots
- Add frontend repo path: `../EPILOG-TREND-FRONTEND/`

The full CLAUDE.md content should be written in one go. Reference the design doc for the cross-repo contract text.

**Step 3: Create frontend CLAUDE.md**

Create `/Users/abimangkuagent/EPILOG-TREND-FRONTEND/CLAUDE.md` with:
- Project overview (React frontend that READS from Supabase, WRITES only to team_feedback)
- Cross-Repo Contract section (identical to backend — copy verbatim)
- Backend repo reference: `../EPILOG-TREND-ANALYZER/`
- Display rules for AI analysis data (deep_analysis, cross_trend_synthesis, brand fit briefs)

**Step 4: Commit**

```bash
git add .gitignore CLAUDE.md
git commit -m "docs: update CLAUDE.md with corrected ownership and cross-repo contract"
```

Then in the frontend repo:
```bash
cd ../EPILOG-TREND-FRONTEND && git add CLAUDE.md && git commit -m "docs: add CLAUDE.md with cross-repo contract and display rules"
```

---

## Task 2: Rewrite FYP Scraper

**Why:** The current scraper targets /explore and uses explore-specific selectors. The design requires FYP scrolling with screenshot capture and human-like behavior.

**Files:**
- Rewrite: `src/scrapers/tiktok.js`

**Step 1: Write the scraper test harness**

Before full rewrite, create a manual test script. Create `scripts/test-fyp-scraper.js`:

```javascript
/**
 * Manual test: runs the FYP scraper once and dumps results to console.
 * Usage: node scripts/test-fyp-scraper.js
 */
require('dotenv').config();
const { scrapeOnce } = require('../src/scrapers/tiktok');

(async () => {
  try {
    const results = await scrapeOnce();
    console.log(`Scraped ${results.videos.length} videos`);
    console.log(`Screenshots: ${results.screenshots.length}`);
    for (const v of results.videos.slice(0, 3)) {
      console.log(`  ${v.title?.slice(0, 60)} | views=${v.views} likes=${v.likes} comments=${v.comments} shares=${v.shares}`);
    }
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
})();
```

**Step 2: Rewrite tiktok.js for FYP**

Complete rewrite of `src/scrapers/tiktok.js`. Key design decisions:

- **Navigation:** `https://www.tiktok.com` (NOT /explore). FYP is default for locale id-ID.
- **Return value changes:** `scrapeOnce()` now returns `{ videos: [], screenshots: [] }` instead of just an array. Each video object includes a `screenshot_path` field. Each screenshot entry has `{ video_url, path }`.
- **SELECTORS:** Remove all explore-specific selectors. FYP shows one video at a time in full-screen mode. Key selectors for FYP:
  - Video container: `div[data-e2e="recommend-list-item-container"]` or similar (needs DOM inspection)
  - Author: `a[data-e2e="video-author-uniqueid"]` or `[data-e2e="browse-username"]`
  - Caption: `[data-e2e="browse-video-desc"]` or `[data-e2e="video-desc"]`
  - Music: `[data-e2e="video-music"]`
  - Likes: `strong[data-e2e="like-count"]`
  - Comments: `strong[data-e2e="comment-count"]`
  - Shares: `strong[data-e2e="share-count"]`
  - Views: `strong[data-e2e="video-views"]`
  - Hashtags: parsed from caption text `#hashtag` patterns
- **Scroll behavior:** Scroll down one viewport height every 3-5 seconds (randomized). For each visible video, wait for metrics to load, extract data, take screenshot.
- **Screenshot:** `await page.screenshot({ path: screenshotPath })` — save to `screenshots/{hash}.png` where hash is SHA256 of the video URL.
- **Cookie persistence:** Load from `cookies/tiktok.json` on start, save on finish.
- **Timeout:** 90 seconds max, or maxVideos reached (default 40).
- **Error resilience:** If a single video extraction fails, log and continue to next video. Never crash the whole scrape.

Important: The exact FYP selectors may need DOM inspection first. The scraper should use a `SELECTORS` constant at the top of the file (per CLAUDE.md convention). If DOM inspection reveals different selectors, update accordingly.

**Step 3: Run the test harness**

```bash
node scripts/test-fyp-scraper.js
```

Expected: Output showing scraped videos with non-zero engagement metrics and screenshot paths. If selectors fail, run `scripts/inspect-tiktok-dom.js` (modified to target tiktok.com instead of /explore) to discover correct selectors.

**Step 4: Commit**

```bash
git add src/scrapers/tiktok.js scripts/test-fyp-scraper.js
git commit -m "feat: rewrite scraper for FYP scrolling with screenshot capture"
```

---

## Task 3: Rewrite AI Analyzer — Trash Gate (Phase 1)

**Why:** The current analyzer.js runs one LLM call per trend. The new design needs a batch Trash Gate as the first AI phase.

**Files:**
- Rewrite: `src/ai/analyzer.js`

**Step 1: Write the Trash Gate function**

Add `trashGate(videos)` to `src/ai/analyzer.js`. This replaces the old `analyzeTrend()`.

```javascript
/**
 * Phase 1 — Trash Gate. Sends ALL scraped videos as one batch to the LLM.
 * Returns an array of verdicts: { url, verdict: 'signal'|'noise', reason }.
 *
 * @param {object[]} videos - Array of scraped video objects
 * @returns {Promise<object[]>} Array of { url, verdict, reason }
 */
async function trashGate(videos) { ... }
```

Design:
- Input: All scraped video metadata (no screenshots) — title, author, hashtags, views, likes, comments, shares, engagement_rate.
- Prompt: System prompt says "You are a TikTok trend filter for Indonesian brands. Classify each video as SIGNAL (worth analyzing) or NOISE (low-value). Be aggressive — only 30-40% should survive."
- User message: List all videos with index, title, author, metrics.
- Response format: `{ "results": [{ "index": 0, "verdict": "signal", "reason": "..." }, ...] }`
- Model: `google/gemini-2.0-flash-001` via OpenRouter.
- Match results back to videos by index.
- If API call fails, treat ALL videos as signals (fail open — don't lose data).

**Step 2: Write the Deep Analysis function (Phase 2)**

Add `deepAnalysis(video, screenshotPath)` to `src/ai/analyzer.js`.

```javascript
/**
 * Phase 2 — Deep Analysis. Sends one video's metadata + screenshot to LLM.
 * Returns structured analysis for the trend_analysis table.
 *
 * @param {object} video - Scraped video with scores
 * @param {string} screenshotPath - Absolute path to screenshot PNG
 * @returns {Promise<object|null>} Analysis object or null
 */
async function deepAnalysis(video, screenshotPath) { ... }
```

Design:
- Input: Video metadata + base64-encoded screenshot (multimodal).
- Read screenshot file with `fs.promises.readFile()`, convert to base64.
- OpenRouter message: `[{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }]`
- Prompt asks for: summary, why_trending, cultural_context, replication_signal, brand_safety, creative_angles, confidence (0-1), virality_trajectory, key_insights, trash_check.
- Output maps directly to `trend_analysis` table columns with `analysis_type: 'deep_analysis'`.

**Step 3: Write the Cross-Trend Synthesis function (Phase 3)**

Add `crossTrendSynthesis(analyzedTrends)` to `src/ai/analyzer.js`.

```javascript
/**
 * Phase 3 — Cross-Trend Synthesis. Sends ALL surviving trends + their Phase 2
 * analyses as one batch. Returns meta-trend insights.
 *
 * @param {object[]} analyzedTrends - Array of { video, analysis } pairs
 * @returns {Promise<object|null>} Synthesis object or null
 */
async function crossTrendSynthesis(analyzedTrends) { ... }
```

Design:
- Input: All surviving trends with their Phase 2 analysis JSON.
- Prompt: "Looking at all these trends together, identify: meta-trends (patterns across multiple videos), emerging cultural shifts, brand priorities (which brands should act on which trends first), content format patterns, a 'cultural pulse' summary."
- Output: `{ meta_trends: [], emerging_patterns: [], cultural_pulse: '', brand_priorities: {}, taste_check: '' }`
- Writes to `trend_analysis` with `analysis_type: 'cross_trend_synthesis'` and `trend_id: null`.

**Step 4: Remove old analyzeTrend function**

Delete the old `analyzeTrend()` and `buildAnalysisPrompt()` functions. Update `module.exports` to:

```javascript
module.exports = { trashGate, deepAnalysis, crossTrendSynthesis };
```

**Step 5: Commit**

```bash
git add src/ai/analyzer.js
git commit -m "feat: rewrite analyzer for 3-phase AI pipeline (trash gate, deep analysis, synthesis)"
```

---

## Task 4: Enhance Brand Fit with Phase 2 Context

**Why:** Brand fit scoring currently gets raw trend data. The design says it should receive Phase 2 deep analysis + screenshot for richer briefs.

**Files:**
- Modify: `src/ai/brand-fit.js`

**Step 1: Update scoreBrandFit signature**

Change `scoreBrandFit(trend, trendId)` to `scoreBrandFit(trend, trendId, deepAnalysis, screenshotPath)`.

```javascript
/**
 * Scores a trend against all three brands using an LLM.
 * Enhanced: receives Phase 2 deep analysis and screenshot for richer context.
 *
 * @param {object} trend - Enriched trend object
 * @param {string} trendId - UUID of the trend
 * @param {object|null} deepAnalysis - Phase 2 analysis (summary, why_trending, etc.)
 * @param {string|null} screenshotPath - Path to screenshot PNG
 * @returns {Promise<object[]>} Array of brand fit objects
 */
async function scoreBrandFit(trend, trendId, deepAnalysis, screenshotPath) { ... }
```

**Step 2: Update the prompt to include Phase 2 context**

Add deep analysis context to `buildBrandFitPrompt()`:
- Include `deepAnalysis.summary`, `deepAnalysis.why_trending`, `deepAnalysis.cultural_context`, `deepAnalysis.creative_angles` in the prompt.
- If `screenshotPath` is provided, include the base64 screenshot as multimodal content.
- The LLM now has much richer context to generate specific creative briefs.

**Step 3: Commit**

```bash
git add src/ai/brand-fit.js
git commit -m "feat: enhance brand fit with Phase 2 analysis context and screenshot"
```

---

## Task 5: Update Database Layer for New Analysis Types

**Why:** The `upsertTrendAnalysis` function currently conflicts on `trend_id` alone. Cross-trend synthesis has `trend_id: null`. We need to handle both analysis types.

**Files:**
- Modify: `src/database/supabase.js`

**Step 1: Add upsertCrossTrendSynthesis function**

```javascript
/**
 * Inserts a cross-trend synthesis row into trend_analysis.
 * These rows have trend_id = null and analysis_type = 'cross_trend_synthesis'.
 *
 * @param {object} synthesis - Phase 3 synthesis data
 * @returns {Promise<object>} The inserted row
 */
async function upsertCrossTrendSynthesis(synthesis) { ... }
```

Design:
- Uses `insert` not `upsert` (each pipeline run creates a new synthesis).
- Sets `trend_id: null`, `analysis_type: 'cross_trend_synthesis'`.
- Maps synthesis fields into `summary`, `key_insights`, `why_trending` etc.

**Step 2: Update upsertTrendAnalysis for deep_analysis type**

Ensure the existing function sets `analysis_type: 'deep_analysis'` when called from the new pipeline. The conflict key may need to be `trend_id, analysis_type` instead of just `trend_id` — check if the Supabase table has a unique constraint and update accordingly.

**Step 3: Export the new function**

Add `upsertCrossTrendSynthesis` to `module.exports`.

**Step 4: Commit**

```bash
git add src/database/supabase.js
git commit -m "feat: add cross-trend synthesis DB function, update analysis type handling"
```

---

## Task 6: Rewire Pipeline Orchestrator

**Why:** The pipeline currently runs: scrape → score → per-video AI → brand fit → notify. The new flow is: scrape → score → trash gate → deep analysis → synthesis → brand fit → notify.

**Files:**
- Rewrite: `src/pipeline.js`

**Step 1: Rewrite runPipeline()**

New flow:

```
1. Verify Supabase connection
2. Scrape FYP (returns { videos, screenshots })
3. Batch replication analysis (existing scoring)
4. Per-video scoring (existing — engagement, velocity, momentum, etc.)
5. Upsert all trends + engagement snapshots to Supabase (get trend_ids back)
6. Phase 1 — Trash Gate (one batch LLM call on all videos)
7. Filter: keep only videos where verdict === 'signal'
8. Phase 2 — Deep Analysis (one multimodal LLM call per surviving trend)
9. Upsert deep analysis to trend_analysis for each surviving trend
10. Phase 3 — Cross-Trend Synthesis (one batch LLM call on all survivors + their analyses)
11. Upsert synthesis to trend_analysis (trend_id: null)
12. Brand Fit — score each surviving trend against 3 brands (with Phase 2 context + screenshot)
13. Upsert brand fits
14. Slack notifications for act_now trends
15. Clean up screenshots directory
```

Key changes from current pipeline:
- Import `trashGate`, `deepAnalysis`, `crossTrendSynthesis` instead of `analyzeTrend`.
- `scrapeOnce()` now returns `{ videos, screenshots }`.
- Add Phase 1 filtering step between scoring and deep analysis.
- Add Phase 3 synthesis call after all deep analyses complete.
- Pass `deepAnalysis` result and `screenshotPath` to `scoreBrandFit()`.
- Add cleanup step: delete all files in `screenshots/` after pipeline completes.

**Step 2: Add screenshots cleanup helper**

```javascript
/**
 * Removes all files from the screenshots directory.
 * Called after pipeline completes — screenshots are transient.
 */
async function cleanupScreenshots() {
  const dir = path.join(process.cwd(), 'screenshots');
  try {
    const files = await fs.promises.readdir(dir);
    await Promise.all(files.map(f => fs.promises.unlink(path.join(dir, f))));
    logger.log(MOD, `Cleaned up ${files.length} screenshots`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn(MOD, 'Screenshot cleanup failed', err);
    }
  }
}
```

**Step 3: Update stats tracking**

Add to stats: `{ new, updated, errors, scraped, signals, filtered, analyzed, synthesized }` for richer logging.

**Step 4: Commit**

```bash
git add src/pipeline.js
git commit -m "feat: rewire pipeline for 3-phase AI (trash gate → deep analysis → synthesis)"
```

---

## Task 7: Integration Test — Full Pipeline Run

**Why:** Verify the entire pipeline works end-to-end with real TikTok data and real LLM calls.

**Files:**
- Create: `scripts/test-pipeline.js`

**Step 1: Create integration test script**

```javascript
/**
 * Integration test: runs the full pipeline once against live TikTok + OpenRouter.
 * Usage: node scripts/test-pipeline.js
 */
require('dotenv').config();
const { runPipelineOnce } = require('../src/pipeline');

(async () => {
  const stats = await runPipelineOnce();
  console.log('Pipeline stats:', JSON.stringify(stats, null, 2));
  process.exit(0);
})();
```

**Step 2: Run the integration test**

```bash
node scripts/test-pipeline.js
```

Expected output:
- Scrapes 30-50 videos from FYP
- Trash Gate filters ~60-70% as noise
- Deep Analysis runs on ~15-20 surviving trends
- Cross-Trend Synthesis produces meta-trends
- Brand Fit scores 3 brands x N trends
- Supabase has new rows in trends, engagement_snapshots, trend_analysis, client_brand_fit
- Screenshots directory is empty after cleanup

**Step 3: Verify Supabase data**

Check the Supabase dashboard or run:
```bash
node -e "require('dotenv').config(); const {supabase}=require('./src/database/supabase'); (async()=>{const{data}=await supabase.from('trend_analysis').select('analysis_type, trend_id, summary').order('analyzed_at',{ascending:false}).limit(5); console.log(data);})()"
```

Should show rows with `analysis_type: 'deep_analysis'` AND at least one row with `analysis_type: 'cross_trend_synthesis'` and `trend_id: null`.

**Step 4: Commit**

```bash
git add scripts/test-pipeline.js
git commit -m "test: add full pipeline integration test script"
```

---

## Task 8: Run Existing Unit Tests

**Why:** Ensure scoring and pattern functions still work after pipeline changes. The scoring/pattern modules should be untouched, but verify no regressions.

**Step 1: Run existing tests**

```bash
npm test
```

Expected: All tests pass. The scoring and pattern modules are pure functions — nothing in Tasks 1-7 should have changed them.

**Step 2: Fix any failures**

If tests fail, fix them. Likely causes: import paths changed, or a renamed export.

**Step 3: Commit (if fixes needed)**

```bash
git add -A && git commit -m "fix: resolve test regressions from pipeline rewrite"
```

---

## Task 9: Final Verification and Push

**Why:** Ensure everything is clean before pushing.

**Step 1: Run linting / check for issues**

```bash
git status
git diff --stat HEAD~5
```

Verify no accidental files, no .env leaks, no screenshots committed.

**Step 2: Verify .gitignore works**

```bash
mkdir -p screenshots && touch screenshots/test.png
git status
```

Should NOT show `screenshots/test.png` as untracked. Clean up: `rm -rf screenshots/test.png`

**Step 3: Push backend**

```bash
git push origin main
```

**Step 4: Push frontend (if CLAUDE.md was added)**

```bash
cd ../EPILOG-TREND-FRONTEND && git push origin main
```

---

## Dependency Graph

```
Task 1 (CLAUDE.md + .gitignore) ← foundation, no deps
Task 2 (FYP Scraper)            ← depends on Task 1 (screenshots/ in .gitignore)
Task 3 (AI Analyzer rewrite)    ← depends on Task 2 (needs scraper return shape)
Task 4 (Brand Fit enhance)      ← depends on Task 3 (needs deep analysis output shape)
Task 5 (DB layer update)        ← depends on Task 3 (needs synthesis data shape)
Task 6 (Pipeline orchestrator)  ← depends on Tasks 2, 3, 4, 5 (wires everything together)
Task 7 (Integration test)       ← depends on Task 6 (runs the full pipeline)
Task 8 (Unit tests)             ← can run anytime, but best after Task 6
Task 9 (Verify + push)          ← depends on Tasks 7, 8
```

Tasks 3, 4, 5 can be partially parallelized since they modify different files, but Task 3 must complete before 4 (brand fit needs deep analysis shape).
