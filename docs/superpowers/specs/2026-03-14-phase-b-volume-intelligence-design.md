# Phase B: Volume Intelligence — Design Spec

**Date:** 2026-03-14
**Status:** Approved
**Approach:** Two-Tier Analysis (Approach B)

## Summary

Push 50% more scraping volume and add 6 new intelligence dimensions while keeping LLM costs nearly flat. Achieved by separating free math computations (Tier 1, runs on ALL trends) from LLM-piggybacked dimensions (Tier 2, runs only on Trash Gate survivors).

## Goals

1. Scrape 60 videos per run (up from 40) — 50% more raw signal input
2. Add acceleration metric — catch inflection points earlier
3. Add real creator tier classification — replace hardcoded `'unknown'`
4. Add saturation index — detect when big creators have already jumped in
5. Add emotion tagging — match trend emotions to brand personalities
6. Add executional feasibility scoring — tell clients how hard it is to produce
7. Add niche-to-mainstream trajectory — identify sweet-spot timing for brand entry
8. Keep daily LLM cost increase under $0.03

## Architecture: Two-Tier Analysis

### Tier 1: Free Math Layer (all scraped videos)

Computed before Trash Gate. Zero LLM cost. Feeds INTO the gate for smarter filtering.

#### 1A. Acceleration Metric

- **File:** `src/scoring/engagement.js`
- **New function:** `calculateAcceleration(currentVelocity, previousVelocity)`
- **Logic:** `acceleration = currentVelocity - previousVelocity`, normalized to -100..+100
- **Data source:** Previous trend's `velocity_score` from DB. Requires extending `findExistingTrend()` select from `'id, scraped_at'` to `'id, scraped_at, velocity_score'`
- **Pipeline integration:** Computed in Step 3 after velocity calculation. Uses `existing.velocity_score || 0` as `previousVelocity`
- **DB column:** `trends.acceleration NUMERIC DEFAULT 0`

#### 1B. Creator Tier Classification

- **File:** `src/scoring/engagement.js`
- **New function:** `classifyCreatorTier(followerCount)`
- **Tiers:**
  - `unknown`: followerCount is 0/null/undefined (data unavailable — excluded from saturation math)
  - `nano`: 1 - 9,999 followers
  - `micro`: 10,000 - 99,999
  - `mid`: 100,000 - 499,999
  - `macro`: 500,000 - 999,999
  - `mega`: >= 1,000,000
- **Data source:** Follower count from TikTok JS state (3 sources with different field paths):
  - `$PREFETCH_CACHE`: `item.authorStats.followerCount` (primary) or `item.author.fans` (fallback)
  - `__UNIVERSAL_DATA_FOR_REHYDRATION__`: same paths as prefetch
  - API intercept responses: `item.authorStats.followerCount` (primary) or `item.author.fans` (fallback)
  - All three sources use the same TikTok item structure, so one extraction path works
- **Scraper change:** Add `followerCount` field to normalized items in `_extractVideoItemsFromJsState()` and `_normalizeApiItem()`. Fallback: `followerCount: 0` when unavailable (classified as `unknown` tier, not `nano`)
- **Replaces:** Hardcoded `author_tier: 'unknown'` in `src/scrapers/tiktok.js`
- **DB column:** `trends.author_tier` (already exists, currently always `'unknown'`)

#### 1C. Saturation Index

- **File:** `src/scoring/replication.js`
- **New function:** `calculateSaturationIndex(trendAudioId, trendHashtags, allVideos)`
- **Logic:**
  - Find all videos in batch sharing the same audio or overlapping hashtags
  - Count creators by tier: big = macro + mega, small = nano + micro + mid
  - `totalReplicators` excludes `unknown`-tier creators (no follower data = excluded from both numerator and denominator)
  - `saturation = bigCreatorCount / totalReplicators` (0..1 float)
  - Returns 0 if no known-tier replicators found
- **Interpretation:**
  - < 0.3 = early signal (small creators leading) — high value
  - 0.3 - 0.6 = crossing over
  - > 0.6 = mainstream (big creators dominate) — you're late
- **Requires:** Creator tier from 1B
- **DB column:** `trends.saturation_index NUMERIC DEFAULT 0`

### Enhanced Trash Gate

- **File:** `src/ai/analyzer.js` → `trashGate()`
- **Change:** Add Tier 1 scores to each video line in the prompt
- **Format:** `| Acceleration: +23.5 | Creator Tier: micro | Saturation: 0.12`
- **Prompt addition:** Guidance block explaining how to use Tier 1 scores for filtering:
  - Acceleration > 0 with small creator = lean SIGNAL
  - Saturation > 0.6 = lean NOISE unless unique brand angle
  - Nano/micro creators with high engagement = potential breakout, lean SIGNAL
- **No structural changes** to response schema — same `{ results: [{ index, verdict, reason }] }`
- **Volume change:** `maxVideos` 40 → 60. Smarter gate should maintain ~15-18 survivors.

### Tier 2: LLM-Piggybacked Dimensions (survivors only)

Added to existing LLM prompts. Zero new API calls.

#### 2A. Emotion Tagging

- **File:** `src/ai/analyzer.js` → `deepAnalysis()` prompt
- **New output fields:**
  ```json
  "dominant_emotion": "humor | relatability | aspiration | nostalgia | outrage | wholesomeness | fear | curiosity | pride",
  "emotion_intensity": 0-100,
  "emotion_notes": "1 sentence on why this emotion drives engagement"
  ```
- **Storage:** Lives inside `trend_analysis` JSONB — no schema migration needed
- **Downstream:** Automatically included in Brand Fit context via existing `analysisContext` passthrough
- **Cost:** ~80 extra output tokens per call, ~$0.00048/run

#### 2B. Executional Feasibility

- **File:** `src/ai/brand-fit.js` → `buildBrandFitPrompt()` per-brand schema
- **New output fields:**
  ```json
  "production_difficulty": "easy | medium | hard",
  "production_requirements": "What's needed — talent, equipment, location, time",
  "estimated_production_hours": number,
  "requires_original_audio": true/false
  ```
- **Why per-brand:** Same trend has different production difficulty for different brands. A dance trend is "easy" for NYU (model + hair color) but "hard" for HIT Kecoa (pest scenario setup).
- **DB columns on `client_brand_fit`:**
  - `production_difficulty TEXT DEFAULT 'medium'`
  - `production_requirements TEXT`
  - `estimated_production_hours NUMERIC`
  - `requires_original_audio BOOLEAN DEFAULT false`
- **Pipeline change:** Map new fields in `scoreBrandFit()` return object
- **Cost:** ~60 extra output tokens per call, ~$0.00108/run

#### 2C. Niche-to-Mainstream Trajectory

- **File:** `src/ai/analyzer.js` → `deepAnalysis()` prompt
- **New output fields:**
  ```json
  "niche_origin": "skintok | anak kos humor | ibu-ibu receh | gym tok | etc.",
  "mainstream_progress": "niche_only | crossing_over | early_mainstream | fully_mainstream",
  "mainstream_notes": "1 sentence on trajectory"
  ```
- **Storage:** Lives inside `trend_analysis` JSONB — no schema migration needed
- **Downstream:** Automatically included in Brand Fit context
- **Cost:** ~60 extra output tokens per call, ~$0.00036/run

## Database Migration

File: `supabase/migrations/phase_b_volume_intelligence.sql`

```sql
-- Tier 1: Acceleration on trends
ALTER TABLE trends ADD COLUMN IF NOT EXISTS acceleration NUMERIC DEFAULT 0;

-- Tier 1: Saturation index on trends
ALTER TABLE trends ADD COLUMN IF NOT EXISTS saturation_index NUMERIC DEFAULT 0;

-- Tier 2: Executional feasibility on brand fit
ALTER TABLE client_brand_fit ADD COLUMN IF NOT EXISTS production_difficulty TEXT DEFAULT 'medium';
ALTER TABLE client_brand_fit ADD COLUMN IF NOT EXISTS production_requirements TEXT;
ALTER TABLE client_brand_fit ADD COLUMN IF NOT EXISTS estimated_production_hours NUMERIC;
ALTER TABLE client_brand_fit ADD COLUMN IF NOT EXISTS requires_original_audio BOOLEAN DEFAULT false;
```

Note: `trends.author_tier` already exists. Emotion and niche trajectory fields live in `trend_analysis` JSONB (no migration needed).

## Pipeline Flow (Updated)

```
FYP Scrape (60 videos, with follower counts)
  -> Step 2: Batch replication analysis (existing)
  -> Step 3: Per-video loop (ALL 60 videos):
      - Engagement rate, share ratio (existing)
      - Velocity + Acceleration (NEW — needs previous velocity_score from DB)
      - Creator tier classification (NEW — from follower_count)
      - Pattern detection (existing)
      - Composite score, lifecycle, urgency (existing)
      - Upsert trend + engagement snapshot (existing)
  -> Step 3c: Batch saturation pass (NEW — requires all videos from Step 3):
      - calculateSaturationIndex per video using full batch creator tiers
      - Update enrichedVideos with saturation_index
      - Batch DB update: UPDATE trends SET saturation_index = ? WHERE id = ? for each video
  -> Phase 1: Enhanced Trash Gate (60 videos + Tier 1 scores as context)
      -> ~15-18 survivors
  -> Phase 2: Enhanced Deep Analysis (survivors only)
      - Existing fields + emotion + niche trajectory (NEW)
  -> Phase 3: Cross-Trend Synthesis (unchanged)
  -> Brand Fit Scoring (survivors x 3 brands)
      - Existing fields + feasibility (NEW)
  -> Cleanup
```

## Files Modified

| File | Change |
|------|--------|
| `src/scoring/engagement.js` | Add `calculateAcceleration()`, `classifyCreatorTier()` |
| `src/scoring/replication.js` | Add `calculateSaturationIndex()` |
| `src/scrapers/tiktok.js` | Extract `follower_count` from JS state + API intercept; increase `maxVideos` to 60 |
| `src/ai/analyzer.js` | Add Tier 1 scores to Trash Gate prompt; add emotion + niche fields to Deep Analysis prompt |
| `src/ai/brand-fit.js` | Add feasibility fields to prompt + response mapping |
| `src/pipeline.js` | Extend `findExistingTrend` select to include `velocity_score`; compute acceleration, creator tier in per-video loop (Step 3); add Step 3c batch pass for saturation index (requires all videos scored first); pass Tier 1 scores to Trash Gate; map new brand fit fields |
| `src/database/supabase.js` | Add `acceleration` to upsertTrend row; add `updateTrendSaturation(trendId, saturationIndex)` for Step 3c batch update; add feasibility fields (`production_difficulty`, `production_requirements`, `estimated_production_hours`, `requires_original_audio`) to brand fit upsert |
| `tests/scoring.test.js` | Tests for acceleration, creator tier, saturation index |
| `supabase/migrations/phase_b_volume_intelligence.sql` | Migration file |

## Files NOT Modified

| File | Reason |
|------|--------|
| `src/scheduler.js` | No frequency changes this phase |
| `src/ai/analyzer.js` `crossTrendSynthesis()` | Already receives full analysis objects — new fields flow through automatically |
| `src/server.js` | No endpoint changes |
| `src/patterns/formats.js` | No changes |
| `src/patterns/cultural.js` | No changes |

## Cost Projection

| Metric | Phase A (current) | Phase B (after) | Delta |
|--------|-------------------|-----------------|-------|
| Videos scraped/run | 40 | 60 | +50% |
| Trash Gate survivors | ~15 | ~15-18 | Flat |
| LLM calls/run | ~62 | ~62-70 | +10% max |
| Cost/run | ~$0.03-0.05 | ~$0.035-0.055 | +$0.005 |
| Cost/day (4 runs) | ~$0.15 | ~$0.17 | +$0.02 |
| New intelligence dimensions | 0 | 6 | +6 |

## Testing Strategy

- **Pure function tests:** `calculateAcceleration`, `classifyCreatorTier`, `calculateSaturationIndex` — all pure, all testable with fixtures
- **Integration:** Run one full pipeline with new code, verify new fields appear in DB
- **No mocking LLM:** Trust existing retry/parse infrastructure; test that new fields are correctly mapped from LLM response to DB objects

## Frontend Impact (Lovable Update Needed Later)

New data available for the frontend to consume:
- `trends.acceleration` — show acceleration arrows/badges
- `trends.author_tier` — filter/group by creator size
- `trends.saturation_index` — early/late indicator badge
- `trend_analysis` JSONB: `dominant_emotion`, `emotion_intensity`, `niche_origin`, `mainstream_progress`
- `client_brand_fit`: `production_difficulty`, `production_requirements`, `estimated_production_hours`

All additive — nothing breaks existing frontend queries.
