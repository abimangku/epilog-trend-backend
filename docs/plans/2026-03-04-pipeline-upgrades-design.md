# Pipeline Upgrades Design — Frontend Field Alignment

**Date:** 2026-03-04
**Context:** Lovable upgraded the frontend with visual galleries, analytics charts, and comparison tools. The DB schema has new columns. The backend pipeline needs to populate the new fields.

## Audit Summary

The pipeline is ~95% complete. Most fields Lovable requested are already computed and written. The real gaps:

| Gap | Impact |
|-----|--------|
| `thumbnail_url` column missing from DB + not extracted | No thumbnails in gallery |
| `video_embed_url` column missing from DB + not constructed | No embedded video players |
| Classification enum mismatch | Frontend shows nothing (values don't match) |
| Scoring too harsh | All 99 trends = "noise" (max score 22.45/100) |
| `confidence` on 0-1 scale | Frontend expects 0-100 |
| `recommended_action` always empty | Empty action labels on frontend |

## Design

### 1. DB Migration — Add Missing Columns

```sql
ALTER TABLE trends ADD COLUMN thumbnail_url text DEFAULT NULL;
ALTER TABLE trends ADD COLUMN video_embed_url text DEFAULT NULL;
```

Two nullable text columns. No constraints.

### 2. Scraper — Extract Thumbnails & Embed URLs

TikTok's JS state items (`$PREFETCH_CACHE` and API interception) contain `item.video.cover`, `item.video.originCover`, `item.video.dynamicCover`.

**Changes to `src/scrapers/tiktok.js`:**

- `_normalizeApiItem()`: Add `coverUrl: item.video?.originCover || item.video?.cover || item.video?.dynamicCover || null`
- Prefetch extraction (inside `page.evaluate`): Same cover extraction from `item.video`
- Video assembly (line ~368-384): Add:
  - `thumbnail_url: jsMatch?.coverUrl || null`
  - `video_embed_url: jsMatch?.videoId ? 'https://www.tiktok.com/embed/v2/' + jsMatch.videoId : null`

Priority: `originCover` > `cover` > `dynamicCover` (originCover is highest quality static frame).

### 3. Database Layer — Write New Fields

**Changes to `src/database/supabase.js`:**

- `upsertTrend()`: Add `thumbnail_url` and `video_embed_url` to the upsert payload.

### 4. Classification Enum Update

**Current backend values → New frontend-aligned values:**

| Old | New | Mapping Logic |
|-----|-----|---------------|
| `noise` | `noise` | Unchanged |
| `emerging_trend` | `emerging_trend` | Unchanged |
| `brand_opportunity` | `rising_trend` | Score-based: 35-60 |
| `confirmed_trend` | `hot_trend` | Score-based: 60-80 |
| `viral_moment` | `viral` | Score-based: 80+ |

**New approach:** Switch from multi-dimension threshold classification to score-based classification. Use `compositeScore` as the primary input:

```
score < 15       → 'noise'
score 15-35      → 'emerging_trend'
score 35-60      → 'rising_trend'
score 60-80      → 'hot_trend'
score 80+        → 'viral'
```

This is simpler, more tunable, and directly tied to the composite score that's already computed.

**File:** `src/scoring/classifier.js` — rewrite `classifyTrend()` to accept `compositeScore` and return new enum values.

### 5. Scoring Recalibration

**Problem:** `compositeScore()` uses normalization caps calibrated for established viral content (1M views, 30% engagement, 100 replications). FYP content is much smaller scale — typical video: 10K-100K views, 3-8% engagement, 0-5 replications. Everything scores under 23.

**Recalibration strategy:**

| Dimension | Old Cap | New Cap | Rationale |
|-----------|---------|---------|-----------|
| Replication | 100 creators | 20 creators | FYP rarely has >20 replications |
| Engagement quality | 30% rate | 10% rate | TikTok FYP avg is 3-8% |
| Velocity | As-is (0-100) | As-is | Already reasonable |
| Pattern | As-is | As-is | Already reasonable |

**Keep the same weights** (replication 35%, velocity 25%, engagement 20%, pattern 15%, raw 5%). Only change normalization caps.

**File:** `src/scoring/classifier.js` — update `compositeScore()` normalization constants.

**Update tests:** `tests/scoring.test.js` — update expected values for the recalibrated formula.

### 6. Confidence Scale Fix

**Current:** Deep analysis returns `confidence: 0.0-1.0` from LLM.
**Target:** Store as 0-100 integer.

**File:** `src/ai/analyzer.js` — multiply confidence by 100 before returning:
```js
confidence: Math.round((parsed.confidence || 0) * 100),
```

Same for cross-trend synthesis confidence.

### 7. Populate `recommended_action`

**Current:** `deepAnalysis()` returns `recommended_action: ''` (always empty).
**Fix:** Add `recommended_action` to the LLM prompt for Phase 2 deep analysis. Expected values: `'Act immediately'`, `'Prepare content'`, `'Monitor closely'`, `'Watch passively'`, `'Skip'`.

**File:** `src/ai/analyzer.js` — update the Phase 2 prompt to request `recommended_action` and parse it from the response.

### 8. Backfill Existing Data

After deploying the changes, run a one-time SQL update to reclassify existing trends:

```sql
UPDATE trends SET classification = CASE
  WHEN trend_score >= 80 THEN 'viral'
  WHEN trend_score >= 60 THEN 'hot_trend'
  WHEN trend_score >= 35 THEN 'rising_trend'
  WHEN trend_score >= 15 THEN 'emerging_trend'
  ELSE 'noise'
END;
```

Note: Existing scores are pre-recalibration, so most will remain 'noise'. The recalibrated scoring will produce better distribution on future scrapes.

## Out of Scope

- **Client metadata correction:** Lovable's prompt has wrong brand descriptions (Stella=beer, NYU=university). The backend already has correct metadata (Stella=air freshener, HIT Kecoa=insecticide, NYU=personal care). No change needed.
- **Engagement snapshot frequency:** Already captured once per scrape cycle. No change needed.
- **Lifecycle stage updates:** Already computed from snapshot trajectory. No change needed.
- **Brand fit fields:** All already written. No change needed.
- **`analysis_type` and `model_version`:** Already written. No change needed.

## Files to Modify

| File | Changes |
|------|---------|
| `src/scrapers/tiktok.js` | Extract coverUrl in normalizer + prefetch; add thumbnail_url/video_embed_url to video object |
| `src/scoring/classifier.js` | Recalibrate compositeScore() caps; rewrite classifyTrend() for new enum |
| `src/database/supabase.js` | Add thumbnail_url + video_embed_url to upsertTrend() payload |
| `src/ai/analyzer.js` | Scale confidence ×100; add recommended_action to prompt + parsing |
| `tests/scoring.test.js` | Update tests for new classification enum + recalibrated scores |
| DB migration | ADD COLUMN thumbnail_url, video_embed_url |
