# Phase B: Volume Intelligence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 new intelligence dimensions (acceleration, creator tier, saturation, emotion, feasibility, niche trajectory) and increase scrape volume from 40 to 60 videos per run while keeping LLM costs nearly flat.

**Architecture:** Two-tier analysis — Tier 1 is free math (runs on all videos before Trash Gate), Tier 2 piggybacks on existing LLM prompts (runs only on survivors). Saturation index requires a batch pass after the per-video loop. All new DB columns are additive.

**Tech Stack:** Node.js (CommonJS), Supabase (PostgreSQL), OpenRouter (Gemini Flash), Playwright, Jest

**Spec:** `docs/superpowers/specs/2026-03-14-phase-b-volume-intelligence-design.md`

---

## Chunk 1: Tier 1 Pure Scoring Functions + Tests

### Task 1: Acceleration Metric

**Files:**
- Modify: `src/scoring/engagement.js` (add function + export)
- Modify: `tests/scoring.test.js` (add tests)

- [ ] **Step 1: Write failing tests for `calculateAcceleration`**

Add to `tests/scoring.test.js` after the existing recency decay tests. Import `calculateAcceleration` at the top.

```js
// In the imports at top of file, add calculateAcceleration:
const {
  calculateEngagementRate,
  calculateVelocityScore,
  calculateMomentum,
  calculateWeightedEngagementRate,
  calculateShareRatio,
  calculateAcceleration,
} = require('../src/scoring/engagement');

// Add this describe block:
describe('calculateAcceleration', () => {
  test('positive acceleration when velocity increases', () => {
    expect(calculateAcceleration(60, 40)).toBe(20);
  });

  test('negative acceleration when velocity decreases', () => {
    expect(calculateAcceleration(30, 50)).toBe(-20);
  });

  test('zero acceleration when velocity unchanged', () => {
    expect(calculateAcceleration(45, 45)).toBe(0);
  });

  test('clamped to +100 maximum', () => {
    expect(calculateAcceleration(100, 0)).toBe(100);
  });

  test('clamped to -100 minimum', () => {
    expect(calculateAcceleration(0, 100)).toBe(-100);
  });

  test('handles null/undefined previousVelocity as 0', () => {
    expect(calculateAcceleration(50, null)).toBe(50);
    expect(calculateAcceleration(50, undefined)).toBe(50);
  });

  test('handles null/undefined currentVelocity as 0', () => {
    expect(calculateAcceleration(null, 30)).toBe(-30);
    expect(calculateAcceleration(undefined, 30)).toBe(-30);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=scoring`
Expected: FAIL — `calculateAcceleration is not a function`

- [ ] **Step 3: Implement `calculateAcceleration`**

Add to `src/scoring/engagement.js` before `module.exports`:

```js
/**
 * Calculates acceleration — the rate of change of velocity.
 * Positive = velocity increasing (inflection point), negative = cooling.
 *
 * @param {number|null} currentVelocity - Current run's velocity score (0-100)
 * @param {number|null} previousVelocity - Previous run's velocity score (0-100)
 * @returns {number} Acceleration clamped to -100..+100
 */
function calculateAcceleration(currentVelocity, previousVelocity) {
  const curr = currentVelocity || 0;
  const prev = previousVelocity || 0;
  const delta = curr - prev;
  return Math.max(-100, Math.min(100, delta));
}
```

Add `calculateAcceleration` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=scoring`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/scoring/engagement.js tests/scoring.test.js
git commit -m "feat: add calculateAcceleration scoring function with tests"
```

---

### Task 2: Creator Tier Classification

**Files:**
- Modify: `src/scoring/engagement.js` (add function + export)
- Modify: `tests/scoring.test.js` (add tests)

- [ ] **Step 1: Write failing tests for `classifyCreatorTier`**

Add import `classifyCreatorTier` to the engagement import block in `tests/scoring.test.js`. Add describe block:

```js
describe('classifyCreatorTier', () => {
  test('returns unknown for 0', () => {
    expect(classifyCreatorTier(0)).toBe('unknown');
  });

  test('returns unknown for null/undefined', () => {
    expect(classifyCreatorTier(null)).toBe('unknown');
    expect(classifyCreatorTier(undefined)).toBe('unknown');
  });

  test('returns nano for 1-9999', () => {
    expect(classifyCreatorTier(1)).toBe('nano');
    expect(classifyCreatorTier(5000)).toBe('nano');
    expect(classifyCreatorTier(9999)).toBe('nano');
  });

  test('returns micro for 10000-99999', () => {
    expect(classifyCreatorTier(10000)).toBe('micro');
    expect(classifyCreatorTier(50000)).toBe('micro');
    expect(classifyCreatorTier(99999)).toBe('micro');
  });

  test('returns mid for 100000-499999', () => {
    expect(classifyCreatorTier(100000)).toBe('mid');
    expect(classifyCreatorTier(499999)).toBe('mid');
  });

  test('returns macro for 500000-999999', () => {
    expect(classifyCreatorTier(500000)).toBe('macro');
    expect(classifyCreatorTier(999999)).toBe('macro');
  });

  test('returns mega for 1000000+', () => {
    expect(classifyCreatorTier(1000000)).toBe('mega');
    expect(classifyCreatorTier(50000000)).toBe('mega');
  });

  test('handles negative numbers as unknown', () => {
    expect(classifyCreatorTier(-100)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=scoring`
Expected: FAIL — `classifyCreatorTier is not a function`

- [ ] **Step 3: Implement `classifyCreatorTier`**

Add to `src/scoring/engagement.js` before `module.exports`:

```js
/**
 * Classifies a creator into a tier based on follower count.
 *
 * @param {number|null|undefined} followerCount
 * @returns {'unknown' | 'nano' | 'micro' | 'mid' | 'macro' | 'mega'}
 */
function classifyCreatorTier(followerCount) {
  if (!followerCount || followerCount <= 0) return 'unknown';
  if (followerCount < 10000) return 'nano';
  if (followerCount < 100000) return 'micro';
  if (followerCount < 500000) return 'mid';
  if (followerCount < 1000000) return 'macro';
  return 'mega';
}
```

Add `classifyCreatorTier` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=scoring`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/scoring/engagement.js tests/scoring.test.js
git commit -m "feat: add classifyCreatorTier scoring function with tests"
```

---

### Task 3: Saturation Index

**Files:**
- Modify: `src/scoring/replication.js` (add function + export)
- Modify: `tests/scoring.test.js` (add tests)

- [ ] **Step 1: Write failing tests for `calculateSaturationIndex`**

Add import `calculateSaturationIndex` to the replication import block in `tests/scoring.test.js`. Add describe block:

```js
describe('calculateSaturationIndex', () => {
  test('returns 0 when no replicators found', () => {
    const allVideos = [
      { audio_id: 'a1', author: 'u1', author_tier: 'micro', hashtags: ['#test'] },
    ];
    expect(calculateSaturationIndex('a99', ['#other'], allVideos)).toBe(0);
  });

  test('returns 0 when all replicators are unknown tier', () => {
    const allVideos = [
      { audio_id: 'a1', author: 'u1', author_tier: 'unknown', hashtags: ['#fyp'] },
      { audio_id: 'a1', author: 'u2', author_tier: 'unknown', hashtags: ['#fyp'] },
    ];
    expect(calculateSaturationIndex('a1', ['#fyp'], allVideos)).toBe(0);
  });

  test('low saturation when small creators dominate', () => {
    const allVideos = [
      { audio_id: 'a1', author: 'u1', author_tier: 'nano', hashtags: ['#dance'] },
      { audio_id: 'a1', author: 'u2', author_tier: 'micro', hashtags: ['#dance'] },
      { audio_id: 'a1', author: 'u3', author_tier: 'nano', hashtags: ['#dance'] },
      { audio_id: 'a1', author: 'u4', author_tier: 'mid', hashtags: ['#dance'] },
    ];
    // 0 big / 4 total = 0
    expect(calculateSaturationIndex('a1', ['#dance'], allVideos)).toBe(0);
  });

  test('high saturation when big creators dominate', () => {
    const allVideos = [
      { audio_id: 'a1', author: 'u1', author_tier: 'macro', hashtags: ['#trend'] },
      { audio_id: 'a1', author: 'u2', author_tier: 'mega', hashtags: ['#trend'] },
      { audio_id: 'a1', author: 'u3', author_tier: 'macro', hashtags: ['#trend'] },
      { audio_id: 'a1', author: 'u4', author_tier: 'nano', hashtags: ['#trend'] },
    ];
    // 3 big / 4 total = 0.75
    expect(calculateSaturationIndex('a1', ['#trend'], allVideos)).toBe(0.75);
  });

  test('mixed saturation with hashtag-based matching', () => {
    const allVideos = [
      { audio_id: 'a1', author: 'u1', author_tier: 'micro', hashtags: ['#cooking', '#fyp'] },
      { audio_id: 'a2', author: 'u2', author_tier: 'macro', hashtags: ['#cooking', '#viral'] },
      { audio_id: 'a3', author: 'u3', author_tier: 'nano', hashtags: ['#cooking', '#fyp'] },
    ];
    // Matching by hashtag overlap (#cooking). 1 big / 3 total = 0.333...
    const result = calculateSaturationIndex('a99', ['#cooking', '#fyp'], allVideos);
    expect(result).toBeCloseTo(0.333, 2);
  });

  test('excludes unknown-tier from denominator', () => {
    const allVideos = [
      { audio_id: 'a1', author: 'u1', author_tier: 'macro', hashtags: ['#x'] },
      { audio_id: 'a1', author: 'u2', author_tier: 'unknown', hashtags: ['#x'] },
      { audio_id: 'a1', author: 'u3', author_tier: 'nano', hashtags: ['#x'] },
    ];
    // unknown excluded: 1 big / 2 known total = 0.5
    expect(calculateSaturationIndex('a1', ['#x'], allVideos)).toBe(0.5);
  });

  test('returns 0 for single-video batch (no replicators possible)', () => {
    const allVideos = [
      { audio_id: 'a1', author: 'u1', author_tier: 'nano', hashtags: ['#solo'] },
    ];
    // Only 1 video in batch — need at least 2 to compute saturation
    expect(calculateSaturationIndex('a1', ['#solo'], allVideos)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=scoring`
Expected: FAIL — `calculateSaturationIndex is not a function`

- [ ] **Step 3: Implement `calculateSaturationIndex`**

Add to `src/scoring/replication.js` before `module.exports`:

```js
/**
 * Calculates saturation index — ratio of big creators in a trend's replicator set.
 * High saturation = big creators already jumped in (you're late).
 * Low saturation = small creators leading (early signal, high value).
 *
 * Unknown-tier creators are excluded from both numerator and denominator.
 *
 * @param {string} trendAudioId - The trend's audio_id
 * @param {string[]} trendHashtags - The trend's hashtags
 * @param {Array<{audio_id: string, author: string, author_tier: string, hashtags: string[]}>} allVideos
 *   All videos in the current batch, each with author_tier set.
 * @returns {number} Saturation index 0..1 (0 = no big creators, 1 = all big creators)
 */
function calculateSaturationIndex(trendAudioId, trendHashtags, allVideos) {
  if (!allVideos || allVideos.length <= 1) return 0;

  const normalizedTags = (trendHashtags || []).map(t => t.toLowerCase().trim());

  // Find replicators: other videos sharing the same audio OR overlapping hashtags
  const replicators = allVideos.filter(v => {
    // Audio match
    if (trendAudioId && v.audio_id === trendAudioId) return true;
    // Hashtag overlap (at least 1 shared tag)
    if (normalizedTags.length > 0 && v.hashtags && v.hashtags.length > 0) {
      const vTags = v.hashtags.map(t => t.toLowerCase().trim());
      return normalizedTags.some(tag => vTags.includes(tag));
    }
    return false;
  });

  // Need at least 2 replicators (including the trend itself) to compute meaningful saturation
  if (replicators.length <= 1) return 0;

  // Exclude unknown-tier creators from saturation math
  const knownReplicators = replicators.filter(v => v.author_tier && v.author_tier !== 'unknown');
  if (knownReplicators.length === 0) return 0;

  const BIG_TIERS = new Set(['macro', 'mega']);
  const bigCount = knownReplicators.filter(v => BIG_TIERS.has(v.author_tier)).length;

  return Math.round((bigCount / knownReplicators.length) * 10000) / 10000;
}
```

Add `calculateSaturationIndex` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=scoring`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/scoring/replication.js tests/scoring.test.js
git commit -m "feat: add calculateSaturationIndex scoring function with tests"
```

---

## Chunk 2: Database Migration + Scraper + DB Functions

### Task 4: Database Migration

**Files:**
- Create: `supabase/migrations/phase_b_volume_intelligence.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Phase B: Volume Intelligence
-- Adds acceleration, saturation index, and executional feasibility columns.

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

- [ ] **Step 2: Apply migration to Supabase**

Run via Supabase MCP tool `apply_migration` or the Supabase dashboard SQL editor. The migration uses `IF NOT EXISTS` so it's safe to re-run.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/phase_b_volume_intelligence.sql
git commit -m "feat: add Phase B database migration (acceleration, saturation, feasibility)"
```

---

### Task 5: Scraper — Extract Follower Count + Increase Volume

**Files:**
- Modify: `src/scrapers/tiktok.js`

**Context:** The scraper extracts video data from 3 JS sources:
- `_extractVideoItemsFromJsState()` (lines 494-571) — reads `$PREFETCH_CACHE` and `__UNIVERSAL_DATA_FOR_REHYDRATION__`
- `_normalizeApiItem()` (lines 580-595) — normalizes API intercept responses

All 3 sources have the same TikTok item structure where follower count is at `item.authorStats.followerCount` (primary) or `item.author.fans` (fallback).

- [ ] **Step 1: Add `followerCount` to `_extractVideoItemsFromJsState`**

In `_extractVideoItemsFromJsState()`, in the `$PREFETCH_CACHE` source block, add `followerCount` to the pushed item object (after the `coverUrl` line):

```js
followerCount: (item.authorStats && item.authorStats.followerCount) || (item.author && item.author.fans) || 0,
```

Do the same in the `__UNIVERSAL_DATA_FOR_REHYDRATION__` source block — add the same line after `coverUrl`.

- [ ] **Step 2: Add `followerCount` to `_normalizeApiItem`**

In `_normalizeApiItem()`, add to the returned object (after `coverUrl`):

```js
followerCount: (item.authorStats && item.authorStats.followerCount) || (item.author && item.author.fans) || 0,
```

- [ ] **Step 3: Use follower count in video assembly**

In the main scrape function where the `video` object is assembled (around line 382-402), add `follower_count` field using the JS state match:

```js
follower_count: jsMatch ? (jsMatch.followerCount || 0) : 0,
```

And replace the hardcoded `author_tier: 'unknown'` with:

```js
author_tier: 'unknown', // Will be classified in pipeline via classifyCreatorTier()
```

(Keep it as `'unknown'` here — the pipeline will classify it using `classifyCreatorTier(video.follower_count)`)

- [ ] **Step 4: Increase maxVideos from 40 to 60**

Find the `maxVideos` constant/config in the scraper and change from `40` to `60`.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/tiktok.js
git commit -m "feat: extract follower count from TikTok JS state + increase maxVideos to 60"
```

---

### Task 6: Database Functions — Saturation Update + Feasibility Fields

**Files:**
- Modify: `src/database/supabase.js`

- [ ] **Step 1: Add `acceleration` and `saturation_index` to `upsertTrend` row**

In the `upsertTrend()` function, find the row object passed to `.upsert()`. Add these fields:

```js
acceleration: trendData.acceleration || 0,
saturation_index: trendData.saturation_index || 0,
```

- [ ] **Step 2: Add `updateTrendSaturation` function**

Add a new exported function for the Step 3c batch update:

```js
/**
 * Updates the saturation_index for a trend after the batch saturation pass.
 * Called in Step 3c after all videos are scored.
 *
 * @param {string} trendId - UUID of the trend
 * @param {number} saturationIndex - Saturation value 0..1
 * @returns {Promise<void>}
 */
async function updateTrendSaturation(trendId, saturationIndex) {
  const { error } = await supabase
    .from('trends')
    .update({ saturation_index: saturationIndex })
    .eq('id', trendId);

  if (error) {
    logger.error(MOD, `Failed to update saturation_index for trend ${trendId}`, error);
  }
}
```

Add `updateTrendSaturation` to `module.exports`.

- [ ] **Step 3: Add feasibility fields to brand fit upsert**

In `upsertBrandFits()`, find the row mapping. Add these fields to each row:

```js
production_difficulty: fit.production_difficulty || 'medium',
production_requirements: fit.production_requirements || null,
estimated_production_hours: fit.estimated_production_hours || null,
requires_original_audio: fit.requires_original_audio || false,
```

- [ ] **Step 4: Commit**

Note: `acceleration` and `saturation_index` fields in `upsertTrend` are forward-compatible — they will write `0` until Task 10 wires the computed values into `enrichedTrend`.

```bash
git add src/database/supabase.js
git commit -m "feat: add saturation update function + feasibility fields to brand fit upsert"
```

---

## Chunk 3: AI Prompt Enhancements (Tier 2)

### Task 7: Deep Analysis — Add Emotion + Niche Trajectory Fields

**Files:**
- Modify: `src/ai/analyzer.js` (deepAnalysis prompt + response mapping)

- [ ] **Step 1: Add emotion + niche fields to Deep Analysis prompt**

In `deepAnalysis()`, find the JSON schema block at the end of the prompt (around line 272-288). Add these fields to the schema:

```
  "dominant_emotion": "One of: humor, relatability, aspiration, nostalgia, outrage, wholesomeness, fear, curiosity, pride — the primary emotion driving engagement",
  "emotion_intensity": 0 to 100,
  "emotion_notes": "1 sentence explaining why this emotion drives engagement for this content",
  "niche_origin": "The community/subculture where this trend started (e.g., skintok, anak kos humor, ibu-ibu receh, gym tok, beauty tok)",
  "mainstream_progress": "One of: niche_only, crossing_over, early_mainstream, fully_mainstream",
  "mainstream_notes": "1 sentence on where it sits on the niche-to-mainstream spectrum and how fast it's moving"
```

- [ ] **Step 2: Map new fields in the response object**

In the `deepAnalysis()` return object (around line 337-357), add after the existing fields:

```js
dominant_emotion: (parsed.dominant_emotion || '').toLowerCase(),
emotion_intensity: parsed.emotion_intensity || 0,
emotion_notes: parsed.emotion_notes || '',
niche_origin: parsed.niche_origin || '',
mainstream_progress: (parsed.mainstream_progress || '').toLowerCase(),
mainstream_notes: parsed.mainstream_notes || '',
```

- [ ] **Step 3: Commit**

```bash
git add src/ai/analyzer.js
git commit -m "feat: add emotion tagging + niche trajectory to Deep Analysis prompt"
```

---

### Task 8: Enhanced Trash Gate — Add Tier 1 Scores to Prompt

**Files:**
- Modify: `src/ai/analyzer.js` (trashGate prompt)

- [ ] **Step 1: Update `trashGate()` to accept and display Tier 1 scores**

The `trashGate()` function receives an array of video objects. The pipeline will now pass objects with additional fields: `acceleration`, `author_tier`, `saturation_index`.

In the `videoList` mapping (around line 119-122), extend the template string for each video. After the existing `| Audio: ${v.audio_title || 'unknown'}` part, add:

```js
 | Acceleration: ${v.acceleration != null ? (v.acceleration > 0 ? '+' : '') + v.acceleration : 'N/A'} | Creator Tier: ${v.author_tier || 'unknown'} | Saturation: ${v.saturation_index != null ? v.saturation_index.toFixed(2) : 'N/A'}
```

- [ ] **Step 2: Add Tier 1 guidance to the prompt**

After the last bullet of the `USE THE ENGAGEMENT DATA` block (the `- But don't reject low-view content...` line, around line 136), before the `Be aggressive —` line, add this guidance block:

```
USE THE TIER 1 INTELLIGENCE SCORES:
- Acceleration > 0 = velocity is INCREASING — this trend is at an inflection point. Strong lean toward SIGNAL even if absolute numbers are low.
- Acceleration < 0 = velocity is SLOWING — the engine is cooling. Lean NOISE unless engagement is still very high.
- Creator Tier "nano"/"micro" with high engagement = potential breakout creator. Lean SIGNAL — small creators with novel formats are the strongest early signals.
- Saturation < 0.3 = big creators haven't jumped in yet. If replication is happening among small creators, this is an EARLY signal — lean SIGNAL.
- Saturation > 0.6 = trend is already mainstream. Big creators dominate. Only mark as SIGNAL if there's a unique brand angle remaining.
```

- [ ] **Step 3: Commit**

```bash
git add src/ai/analyzer.js
git commit -m "feat: enhance Trash Gate prompt with Tier 1 intelligence scores"
```

---

### Task 9: Brand Fit — Add Executional Feasibility

**Files:**
- Modify: `src/ai/brand-fit.js` (prompt + response mapping)

- [ ] **Step 1: Add feasibility fields to `buildBrandFitPrompt`**

In `buildBrandFitPrompt()`, find the per-brand JSON schema (around line 253-280). Add these fields to each brand's schema:

```
      "production_difficulty": "easy" or "medium" or "hard",
      "production_requirements": "What the content team needs to execute this — specific talent, equipment, location, time estimate. Be practical.",
      "estimated_production_hours": number of hours from concept to final edit,
      "requires_original_audio": true or false — does this need custom audio or can it use trending sound?
```

- [ ] **Step 2: Map new fields in `scoreBrandFit` response**

In `scoreBrandFit()`, find the `results` mapping (around line 174-191). Add to each brand object:

```js
production_difficulty: b.production_difficulty || 'medium',
production_requirements: b.production_requirements || '',
estimated_production_hours: b.estimated_production_hours || null,
requires_original_audio: b.requires_original_audio || false,
```

- [ ] **Step 3: Add emotion/niche to `analysisContext` passthrough**

Note: These fields (`dominant_emotion`, `niche_origin`, etc.) are produced by Task 7's Deep Analysis changes. For existing DB records that predate Task 7, these will render as `N/A` — this is safe due to the `|| 'N/A'` guards below.

In `buildBrandFitPrompt()`, find the `analysisContext` string (around line 218-228). Add after the existing Key Insights line:

```js
- Dominant Emotion: ${analysis.dominant_emotion || 'N/A'} (intensity: ${analysis.emotion_intensity || 'N/A'}/100)
- Niche Origin: ${analysis.niche_origin || 'N/A'} → ${analysis.mainstream_progress || 'N/A'}
```

- [ ] **Step 4: Commit**

```bash
git add src/ai/brand-fit.js
git commit -m "feat: add executional feasibility to brand fit scoring + emotion/niche context"
```

---

## Chunk 4: Pipeline Integration + Final Verification

### Task 10: Pipeline Integration — Wire Everything Together

**Files:**
- Modify: `src/pipeline.js`

**Context:** This is the critical wiring task. Changes to the pipeline orchestrator:
1. Import new functions
2. Compute acceleration and creator tier in per-video loop (Step 3)
3. Add Step 3c batch saturation pass
4. Pass Tier 1 scores to Trash Gate

- [ ] **Step 1: Extend `findExistingTrend` select + add new imports**

In `src/pipeline.js`, find the `findExistingTrend()` function (around line 87). Change `.select('id, scraped_at')` to `.select('id, scraped_at, velocity_score')`. This is needed for acceleration calculation below.

At the top of `src/pipeline.js`, update imports:

```js
// In the engagement import, add calculateAcceleration, classifyCreatorTier:
const {
  calculateEngagementRate,
  calculateVelocityScore,
  calculateMomentum,
  calculateShareRatio,
  calculateAcceleration,
  classifyCreatorTier,
} = require('./scoring/engagement');

// In the replication import, add calculateSaturationIndex:
const {
  calculateReplicationScore,
  getReplicationCount,
  calculateSaturationIndex,
} = require('./scoring/replication');

// In the supabase import, add updateTrendSaturation:
// (add updateTrendSaturation to the existing destructured import)
```

- [ ] **Step 2: Compute acceleration + creator tier in Step 3 per-video loop**

In the per-video loop (around line 185-336), after `velocityScore` is computed, add acceleration calculation:

```js
// --- Acceleration (rate of change of velocity) ---
const previousVelocity = existing ? (existing.velocity_score || 0) : 0;
const acceleration = calculateAcceleration(velocityScore, previousVelocity);
```

After the line that sets `author_tier: video.author_tier` in the `enrichedTrend` object, replace it:

```js
author_tier: classifyCreatorTier(video.follower_count),
```

Add `acceleration` to the `enrichedTrend` object:

```js
acceleration,
```

Note: The classified `author_tier` and `acceleration` in `enrichedTrend` are the same object that flows to `upsertTrend()` — no additional wiring needed for DB persistence.

- [ ] **Step 3: Add Step 3c — batch saturation pass after the per-video loop**

After the per-video loop ends and before the Trash Gate call (between Step 3b audio tracking and Step 4), add:

```js
// -----------------------------------------------------------------------
// Step 3c — Batch saturation index (requires all videos scored first)
// -----------------------------------------------------------------------
logger.log(MOD, `--- Step 3c: Batch saturation index (${enrichedVideos.length} videos) ---`);

for (const ev of enrichedVideos) {
  const saturationIndex = calculateSaturationIndex(
    ev.enrichedTrend.audio_id,
    ev.enrichedTrend.hashtags,
    enrichedVideos.map(v => ({
      audio_id: v.enrichedTrend.audio_id,
      author: v.enrichedTrend.author,
      author_tier: v.enrichedTrend.author_tier,
      hashtags: v.enrichedTrend.hashtags,
    }))
  );
  ev.enrichedTrend.saturation_index = saturationIndex;

  // Write saturation back to DB
  if (ev.trend_id) {
    await updateTrendSaturation(ev.trend_id, saturationIndex);
  }
}
```

- [ ] **Step 4: Pass Tier 1 scores to Trash Gate**

In Step 4 where `trashGate()` is called (around line 353-357), update the mapped objects to include Tier 1 scores:

```js
const verdicts = await trashGate(enrichedVideos.map((ev) => ({
  ...ev.video,
  engagement_rate: ev.enrichedTrend.engagement_rate,
  share_ratio: ev.enrichedTrend.share_ratio,
  acceleration: ev.enrichedTrend.acceleration,
  author_tier: ev.enrichedTrend.author_tier,
  saturation_index: ev.enrichedTrend.saturation_index,
})));
```

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.js
git commit -m "feat: wire Phase B Tier 1 scoring into pipeline (acceleration, creator tier, saturation)"
```

---

### Task 11: Verification — Run Tests + Integration Check

**Files:** None created/modified — verification only.

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: ALL PASS (existing 186 + new acceleration/tier/saturation tests)

- [ ] **Step 2: Check server starts cleanly**

Run: `pm2 restart trend-watcher && sleep 3 && curl -s http://localhost:3001/health | python3 -m json.tool`
Expected: `"status": "healthy"`, no errors in `pm2 logs --lines 20`

- [ ] **Step 3: Verify new DB columns exist**

Run via Supabase MCP or SQL editor:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'trends' AND column_name IN ('acceleration', 'saturation_index');

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'client_brand_fit' AND column_name IN ('production_difficulty', 'production_requirements', 'estimated_production_hours', 'requires_original_audio');
```
Expected: All columns exist with correct types.

- [ ] **Step 4: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 5: Final commit — update CLAUDE.md**

Add to the `## Architecture` section of CLAUDE.md a note about Phase B:
- Tier 1 math layer: acceleration, creator tier, saturation index (computed on all videos)
- Tier 2 LLM dimensions: emotion, feasibility, niche trajectory (piggybacked on existing prompts)
- maxVideos: 60 (up from 40)

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Phase B architecture notes"
git push origin main
```
