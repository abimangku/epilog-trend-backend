# Pipeline Upgrades Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Populate new frontend fields (thumbnails, embeds, recalibrated scores, recommended actions) so the Lovable-built React frontend shows real data.

**Architecture:** Surgical patches to 5 existing files + 1 DB migration. No new files, no new modules. The pipeline is 95% complete — we're filling gaps and recalibrating.

**Tech Stack:** Node.js (CommonJS), Playwright, Supabase JS client, OpenRouter (Gemini Flash)

---

### Task 1: DB Migration — Add thumbnail_url and video_embed_url columns

**Files:**
- Supabase migration (via MCP tool)

**Step 1: Apply migration**

Run via Supabase MCP:
```sql
ALTER TABLE trends ADD COLUMN IF NOT EXISTS thumbnail_url text DEFAULT NULL;
ALTER TABLE trends ADD COLUMN IF NOT EXISTS video_embed_url text DEFAULT NULL;
```

**Step 2: Verify columns exist**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'trends' AND column_name IN ('thumbnail_url', 'video_embed_url');
```

Expected: 2 rows returned.

**Step 3: Commit** (no code changes — migration is in Supabase only)

---

### Task 2: Scraper — Extract thumbnail and embed URL

**Files:**
- Modify: `src/scrapers/tiktok.js:559-572` (`_normalizeApiItem`)
- Modify: `src/scrapers/tiktok.js:489-501` (prefetch extraction inside `page.evaluate`)
- Modify: `src/scrapers/tiktok.js:368-384` (video assembly object)

**Step 1: Update `_normalizeApiItem()` to extract cover URL**

At `src/scrapers/tiktok.js:559-572`, add `coverUrl` to the returned object:

```js
function _normalizeApiItem(item) {
  if (!item || !item.id || !item.author) return null;
  const video = item.video || {};
  return {
    source: 'api',
    videoId: item.id,
    author: item.author.uniqueId || '',
    desc: item.desc || '',
    views: (item.stats && item.stats.playCount) || 0,
    likes: (item.stats && item.stats.diggCount) || 0,
    comments: (item.stats && item.stats.commentCount) || 0,
    shares: (item.stats && item.stats.shareCount) || 0,
    bookmarks: parseInt((item.stats && item.stats.collectCount) || 0, 10) || 0,
    coverUrl: video.originCover || video.cover || video.dynamicCover || null,
  };
}
```

**Step 2: Update prefetch extraction in `page.evaluate` to extract cover URL**

At `src/scrapers/tiktok.js:491-501`, inside the prefetch `items.push({...})` block, add `coverUrl`:

```js
items.push({
  source: 'prefetch',
  videoId: item.id,
  author: item.author.uniqueId || '',
  desc: item.desc || '',
  views: (item.stats && item.stats.playCount) || 0,
  likes: (item.stats && item.stats.diggCount) || 0,
  comments: (item.stats && item.stats.commentCount) || 0,
  shares: (item.stats && item.stats.shareCount) || 0,
  bookmarks: (item.stats && item.stats.collectCount) || 0,
  coverUrl: (item.video && (item.video.originCover || item.video.cover || item.video.dynamicCover)) || null,
});
```

Note: This is inside `page.evaluate()` — cannot use optional chaining (`?.`) because it runs in the browser context where Chromium version may not support it. Use explicit `&&` chaining.

**Step 3: Update video assembly to include thumbnail_url and video_embed_url**

At `src/scrapers/tiktok.js:368-384`, where the `video` object is constructed, add two new fields after `screenshot_path`:

```js
thumbnail_url: jsMatch ? (jsMatch.coverUrl || null) : null,
video_embed_url: jsMatch && jsMatch.videoId
  ? `https://www.tiktok.com/embed/v2/${jsMatch.videoId}`
  : null,
```

**Step 4: Commit**

```bash
git add src/scrapers/tiktok.js
git commit -m "feat: extract thumbnail_url and video_embed_url from TikTok JS state"
```

---

### Task 3: Database layer — Write new fields to trends table

**Files:**
- Modify: `src/database/supabase.js:71-94` (`upsertTrend` row object)

**Step 1: Add thumbnail_url and video_embed_url to upsert payload**

At `src/database/supabase.js:93`, after `urgency_level`, add:

```js
    thumbnail_url: trendData.thumbnail_url || null,
    video_embed_url: trendData.video_embed_url || null,
```

**Step 2: Commit**

```bash
git add src/database/supabase.js
git commit -m "feat: write thumbnail_url and video_embed_url to trends table"
```

---

### Task 4: Recalibrate scoring and classification enum

**Files:**
- Modify: `src/scoring/classifier.js:18-36` (`classifyTrend`)
- Modify: `src/scoring/classifier.js:144-159` (`compositeScore`)
- Modify: `tests/scoring.test.js` (update all classification + compositeScore tests)

**Step 1: Rewrite `classifyTrend()` to use score-based classification with new enum**

Replace `src/scoring/classifier.js:18-36` entirely:

```js
/**
 * Classifies a trend based on its composite score.
 * Uses the same score thresholds as the frontend for consistency.
 *
 * @param {number} score - Composite trend score (0-100)
 * @returns {'noise' | 'emerging_trend' | 'rising_trend' | 'hot_trend' | 'viral'}
 */
function classifyTrend(score) {
  if (score >= 80) return 'viral';
  if (score >= 60) return 'hot_trend';
  if (score >= 35) return 'rising_trend';
  if (score >= 15) return 'emerging_trend';
  return 'noise';
}
```

Note: The function signature changes from `classifyTrend(trend, patternScore)` to `classifyTrend(score)`. All callers must be updated.

**Step 2: Recalibrate `compositeScore()` normalization caps**

Replace `src/scoring/classifier.js:144-159`:

```js
/**
 * Calculates the composite trend score (0-100) from multiple dimensions.
 * Calibrated for TikTok FYP content scale (not viral-scale).
 *
 * Weights:
 * - Replication component (35%): replicationCount normalized to 0-100, capped at 20 creators
 * - Velocity (25%): velocityScore as-is
 * - Engagement quality (20%): engagementRate / 10 * 100, capped at 100
 * - Pattern (15%): patternScore as-is
 * - Raw engagement (5%): same as engagement quality
 *
 * @param {number} engagementRate
 * @param {number} velocityScore
 * @param {number} replicationCount
 * @param {number} patternScore
 * @returns {number} Composite score 0-100, rounded to 2 decimal places.
 */
function compositeScore(engagementRate, velocityScore, replicationCount, patternScore) {
  // Normalize replication: 0-20 creators mapped to 0-100 score
  const replicationNorm = Math.min((replicationCount / 20) * 100, 100);

  // Normalize engagement quality: 10% engagement rate = 100 score
  const engagementQuality = Math.min((engagementRate / 10) * 100, 100);

  const score =
    replicationNorm * 0.35 +
    velocityScore * 0.25 +
    engagementQuality * 0.20 +
    patternScore * 0.15 +
    engagementQuality * 0.05;

  return Math.round(Math.min(score, 100) * 100) / 100;
}
```

**Step 3: Update the caller in `src/pipeline.js`**

Find the call to `classifyTrend(trendData, patternScore)` in pipeline.js (around line 226-230) and change it to `classifyTrend(trendData.trend_score)`. The trend_score is already computed by `compositeScore()` a few lines above.

**Step 4: Update all tests in `tests/scoring.test.js`**

The `classifyTrend` tests need complete rewrite (new signature, new enum values).
The `compositeScore` tests need updated expected values (lower caps = higher scores).

For `classifyTrend` tests — replace the entire `describe('classifyTrend', ...)` block:

```js
describe('classifyTrend', () => {
  test('noise: score < 15', () => {
    expect(classifyTrend(0)).toBe('noise');
    expect(classifyTrend(14.99)).toBe('noise');
  });

  test('emerging_trend: score 15-34.99', () => {
    expect(classifyTrend(15)).toBe('emerging_trend');
    expect(classifyTrend(25)).toBe('emerging_trend');
    expect(classifyTrend(34.99)).toBe('emerging_trend');
  });

  test('rising_trend: score 35-59.99', () => {
    expect(classifyTrend(35)).toBe('rising_trend');
    expect(classifyTrend(50)).toBe('rising_trend');
    expect(classifyTrend(59.99)).toBe('rising_trend');
  });

  test('hot_trend: score 60-79.99', () => {
    expect(classifyTrend(60)).toBe('hot_trend');
    expect(classifyTrend(70)).toBe('hot_trend');
    expect(classifyTrend(79.99)).toBe('hot_trend');
  });

  test('viral: score >= 80', () => {
    expect(classifyTrend(80)).toBe('viral');
    expect(classifyTrend(100)).toBe('viral');
  });
});
```

For `compositeScore` tests — update expected values to match new normalization (replication cap 20, engagement cap 10%):

```js
describe('compositeScore', () => {
  test('all zeros returns 0', () => {
    expect(compositeScore(0, 0, 0, 0)).toBe(0);
  });

  test('typical FYP video: 5% engagement, velocity 30, 3 replications, pattern 10', () => {
    // replicationNorm = (3/20)*100 = 15, engQuality = (5/10)*100 = 50
    // 15*0.35 + 30*0.25 + 50*0.20 + 10*0.15 + 50*0.05 = 5.25+7.5+10+1.5+2.5 = 26.75
    expect(compositeScore(5, 30, 3, 10)).toBeCloseTo(26.75);
  });

  test('strong FYP video: 8% engagement, velocity 60, 10 replications, pattern 40', () => {
    // replicationNorm = (10/20)*100 = 50, engQuality = (8/10)*100 = 80
    // 50*0.35 + 60*0.25 + 80*0.20 + 40*0.15 + 80*0.05 = 17.5+15+16+6+4 = 58.5
    expect(compositeScore(8, 60, 10, 40)).toBeCloseTo(58.5);
  });

  test('caps at 100', () => {
    expect(compositeScore(100, 100, 200, 100)).toBe(100);
  });

  test('over-cap inputs still cap at 100', () => {
    expect(compositeScore(100, 100, 1000, 100)).toBe(100);
  });

  test('engagement-only: 10% engagement', () => {
    // engQuality = 100, replicationNorm = 0
    // 0*0.35 + 0*0.25 + 100*0.20 + 0*0.15 + 100*0.05 = 25
    expect(compositeScore(10, 0, 0, 0)).toBeCloseTo(25);
  });

  test('replication-only: 20 replications', () => {
    // replicationNorm = 100
    // 100*0.35 = 35
    expect(compositeScore(0, 0, 20, 0)).toBeCloseTo(35);
  });

  test('velocity-only: velocity 100', () => {
    // 100*0.25 = 25
    expect(compositeScore(0, 100, 0, 0)).toBeCloseTo(25);
  });
});
```

**Step 5: Run tests**

```bash
npm test
```

Expected: All tests pass with new thresholds.

**Step 6: Commit**

```bash
git add src/scoring/classifier.js src/pipeline.js tests/scoring.test.js
git commit -m "feat: recalibrate scoring for FYP scale, align classification enum with frontend"
```

---

### Task 5: AI analyzer — Scale confidence and add recommended_action

**Files:**
- Modify: `src/ai/analyzer.js:169-185` (Phase 2 deep analysis prompt)
- Modify: `src/ai/analyzer.js:228-244` (Phase 2 return object)
- Modify: `src/ai/analyzer.js:267+` (Phase 3 synthesis — confidence scaling)

**Step 1: Add `recommended_action` to the Phase 2 LLM prompt**

At `src/ai/analyzer.js:169-185`, add `recommended_action` to the JSON schema in the prompt. Insert after the `"trash_check"` line:

```
  "recommended_action": "One of: 'Act immediately', 'Prepare content', 'Monitor closely', 'Watch passively', 'Skip'"
```

**Step 2: Update Phase 2 return object to parse recommended_action and scale confidence**

At `src/ai/analyzer.js:228-244`, change:
- Line 233: `recommended_action: '',` → `recommended_action: parsed.recommended_action || '',`
- Line 234: `confidence: parsed.confidence || 0,` → `confidence: Math.round((parsed.confidence || 0) * 100),`

**Step 3: Scale Phase 3 synthesis confidence**

Find the cross-trend synthesis return object (around line 333-345). Change the confidence line from:
- `confidence: synthesis.confidence || 0,` → `confidence: Math.round((synthesis.confidence || 0) * 100),`

**Step 4: Commit**

```bash
git add src/ai/analyzer.js
git commit -m "feat: add recommended_action to deep analysis, scale confidence to 0-100"
```

---

### Task 6: Run tests + verify end-to-end

**Files:**
- No new files

**Step 1: Run unit tests**

```bash
npm test
```

Expected: All 119+ tests pass (with updated scoring tests).

**Step 2: Verify DB columns**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'trends' AND column_name IN ('thumbnail_url', 'video_embed_url');
```

Expected: 2 rows.

**Step 3: Verify scraper loads without errors**

```bash
node -e "const t = require('./src/scrapers/tiktok.js'); console.log('Scraper loaded OK');"
```

**Step 4: Backfill existing trend classifications**

```sql
UPDATE trends SET classification = CASE
  WHEN trend_score >= 80 THEN 'viral'
  WHEN trend_score >= 60 THEN 'hot_trend'
  WHEN trend_score >= 35 THEN 'rising_trend'
  WHEN trend_score >= 15 THEN 'emerging_trend'
  ELSE 'noise'
END;
```

**Step 5: Push to remote**

```bash
git push origin main
```
