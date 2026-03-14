# Phase 5: Strategic Intelligence — Tier 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 5 highest-impact, lowest-effort improvements from the strategic intelligence analysis — weighted engagement scoring, share ratio, bookmarks persistence, cultural calendar, enhanced Trash Gate, and audio trend tracking.

**Architecture:** Add bookmarks + share_ratio columns to DB; refactor engagement scoring to weight shares > saves > comments > likes; add a cultural calendar JSON config that dynamically adjusts pattern scores; pass engagement data to Trash Gate; track audio usage counts across pipeline runs in a new audio_trends table.

**Tech Stack:** Node.js (CommonJS), Supabase (via MCP), Jest for unit tests.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/scoring/engagement.js` | Modify | Add bookmarks param, weighted engagement, share ratio |
| `src/scoring/classifier.js` | Modify | Use weighted engagement in composite score |
| `src/config/cultural-calendar.json` | Create | Date-based cultural event definitions |
| `src/patterns/cultural.js` | Modify | Add `getActiveCulturalMoments()` using calendar |
| `src/patterns/formats.js` | Modify | Boost pattern score for calendar-aligned trends |
| `src/ai/analyzer.js` | Modify | Pass engagement scores to Trash Gate prompt |
| `src/database/supabase.js` | Modify | Write bookmarks, share_ratio; new audio_trends functions |
| `src/pipeline.js` | Modify | Calculate share_ratio, pass bookmarks, audio tracking |
| `frontend/src/types/index.ts` | Modify | Add bookmarks, share_ratio to Trend; bookmarks to EngagementSnapshot |
| `tests/scoring.test.js` | Modify | Tests for weighted engagement, share ratio |
| `tests/patterns.test.js` | Modify | Tests for cultural calendar |

---

## Chunk 1: DB Migrations + Weighted Engagement Scoring

### Task 1: Database Migrations

Add new columns and table via Supabase MCP.

**Migrations needed:**
1. Add `bookmarks` column to `trends` table (integer, default 0)
2. Add `bookmarks` column to `engagement_snapshots` table (integer, default 0)
3. Add `share_ratio` column to `trends` table (numeric, nullable)
4. Create `audio_trends` table

- [ ] **Step 1: Apply migration — bookmarks + share_ratio on trends**

```sql
ALTER TABLE trends ADD COLUMN IF NOT EXISTS bookmarks integer DEFAULT 0;
ALTER TABLE trends ADD COLUMN IF NOT EXISTS share_ratio numeric;
```

Run via Supabase MCP `execute_sql` on project `tnvnevydxobtmiackdkz`.

- [ ] **Step 2: Apply migration — bookmarks on engagement_snapshots**

```sql
ALTER TABLE engagement_snapshots ADD COLUMN IF NOT EXISTS bookmarks integer DEFAULT 0;
```

- [ ] **Step 3: Apply migration — audio_trends table**

```sql
CREATE TABLE IF NOT EXISTS audio_trends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_id text NOT NULL,
  audio_title text,
  usage_count integer NOT NULL DEFAULT 1,
  unique_authors integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audio_trends_audio_id ON audio_trends(audio_id);
CREATE INDEX IF NOT EXISTS idx_audio_trends_scraped_at ON audio_trends(scraped_at);
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add bookmarks, share_ratio, audio_trends DB migrations"
```

---

### Task 2: Weighted Engagement Scoring + Share Ratio

**Files:**
- Modify: `src/scoring/engagement.js`
- Modify: `tests/scoring.test.js`

- [ ] **Step 1: Write failing tests for weighted engagement and share ratio**

Add to `tests/scoring.test.js`:

```javascript
// At top, update import:
const {
  calculateEngagementRate,
  calculateVelocityScore,
  calculateMomentum,
  calculateWeightedEngagementRate,
  calculateShareRatio,
} = require('../src/scoring/engagement');

// --- Weighted Engagement Rate tests ---
describe('calculateWeightedEngagementRate', () => {
  it('weights shares 3x, saves 2x, comments 1.5x, likes 1x', () => {
    // 100 likes*1 + 50 comments*1.5 + 30 shares*3 + 20 saves*2 = 100+75+90+40 = 305
    // 305 / 10000 * 100 = 3.05%
    const rate = calculateWeightedEngagementRate(100, 50, 30, 20, 10000);
    expect(rate).toBeCloseTo(3.05, 1);
  });

  it('returns 0 when views is 0 and all metrics are 0', () => {
    expect(calculateWeightedEngagementRate(0, 0, 0, 0, 0)).toBe(0);
  });

  it('uses volume-based scoring when views is 0', () => {
    const rate = calculateWeightedEngagementRate(1000, 100, 50, 20, 0);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(100);
  });

  it('handles missing bookmarks gracefully', () => {
    const rate = calculateWeightedEngagementRate(100, 50, 30, undefined, 10000);
    // 100*1 + 50*1.5 + 30*3 + 0*2 = 100+75+90 = 265
    // 265 / 10000 * 100 = 2.65%
    expect(rate).toBeCloseTo(2.65, 1);
  });
});

// --- Share Ratio tests ---
describe('calculateShareRatio', () => {
  it('calculates shares / views as percentage', () => {
    expect(calculateShareRatio(500, 100000)).toBeCloseTo(0.5, 1);
  });

  it('returns 0 when views is 0', () => {
    expect(calculateShareRatio(500, 0)).toBe(0);
  });

  it('returns 0 when shares is 0', () => {
    expect(calculateShareRatio(0, 100000)).toBe(0);
  });

  it('caps at 100', () => {
    expect(calculateShareRatio(200000, 100000)).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/scoring.test.js --verbose 2>&1 | tail -20`
Expected: FAIL — `calculateWeightedEngagementRate` and `calculateShareRatio` not defined

- [ ] **Step 3: Implement weighted engagement rate and share ratio**

In `src/scoring/engagement.js`, add before the `module.exports`:

```javascript
/**
 * Calculates weighted engagement rate where different actions have different weights.
 * Shares (3x) > Saves (2x) > Comments (1.5x) > Likes (1x).
 * This better reflects TikTok's own algorithm weighting.
 *
 * @param {number} likes
 * @param {number} comments
 * @param {number} shares
 * @param {number} bookmarks - Saves/bookmarks count
 * @param {number} views
 * @returns {number} Weighted engagement rate as percentage (0-100+)
 */
function calculateWeightedEngagementRate(likes, comments, shares, bookmarks, views) {
  const safeBookmarks = bookmarks || 0;
  if (views && views > 0) {
    const weighted = likes + comments * 1.5 + shares * 3 + safeBookmarks * 2;
    return (weighted / views) * 100;
  }
  // FYP-native: volume-based score
  const volume = likes + comments * 2 + shares * 3 + safeBookmarks * 2;
  if (volume <= 0) return 0;
  return (Math.log10(volume + 1) / Math.log10(MAX_VOLUME + 1)) * 100;
}

/**
 * Calculates share ratio — shares as a percentage of views.
 * This is the single strongest externally measurable virality predictor.
 *
 * @param {number} shares
 * @param {number} views
 * @returns {number} Share ratio as percentage (0-100), capped at 100
 */
function calculateShareRatio(shares, views) {
  if (!views || views <= 0 || !shares) return 0;
  return Math.min((shares / views) * 100, 100);
}
```

Update `module.exports`:

```javascript
module.exports = {
  calculateEngagementRate,
  calculateVelocityScore,
  calculateMomentum,
  calculateWeightedEngagementRate,
  calculateShareRatio,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/scoring.test.js --verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/scoring/engagement.js tests/scoring.test.js
git commit -m "feat: add weighted engagement rate and share ratio scoring"
```

---

### Task 3: Pipeline Integration — Share Ratio + Bookmarks Persistence

**Files:**
- Modify: `src/pipeline.js`
- Modify: `src/database/supabase.js`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Update frontend types**

In `frontend/src/types/index.ts`:

Add `bookmarks: number;` after `shares: number;` in the `Trend` interface (line 19).
Add `share_ratio: number | null;` after `velocity_score: number;` in the `Trend` interface (line 24).
Add `bookmarks: number;` after `shares: number;` in the `EngagementSnapshot` interface (line 88).

- [ ] **Step 2: Update upsertTrend to write bookmarks and share_ratio**

In `src/database/supabase.js`, in the `upsertTrend` function, add to the `row` object (after line 105 `shares: trendData.shares,`):

```javascript
    bookmarks: trendData.bookmarks || 0,
```

And after line 110 `engagement_rate: trendData.engagement_rate,`:

```javascript
    share_ratio: trendData.share_ratio || null,
```

- [ ] **Step 3: Update createEngagementSnapshot to write bookmarks**

In `src/database/supabase.js`, in the `createEngagementSnapshot` function, add `bookmarks` to the row object (after `shares: metrics.shares,`):

```javascript
    bookmarks: metrics.bookmarks || 0,
```

- [ ] **Step 4: Update pipeline to calculate share_ratio and pass bookmarks**

In `src/pipeline.js`:

Add import at top (after the engagement imports):

```javascript
const {
  calculateEngagementRate,
  calculateVelocityScore,
  calculateMomentum,
  calculateShareRatio,
} = require('./scoring/engagement');
```

In the per-video scoring loop (around line 180), after the `engagementRate` calculation, add:

```javascript
        // --- Share ratio ---
        const shareRatio = calculateShareRatio(video.shares, video.views);
```

In the `enrichedTrend` object (around line 234), add after `engagement_rate`:

```javascript
          share_ratio: Math.round(shareRatio * 100) / 100,
```

Update the `createEngagementSnapshot` call to include bookmarks:

```javascript
        await createEngagementSnapshot(trend_id, {
          views: video.views,
          likes: video.likes,
          comments: video.comments,
          shares: video.shares,
          bookmarks: video.bookmarks || 0,
        });
```

- [ ] **Step 5: Run full test suite**

Run: `npx jest --verbose 2>&1 | tail -20`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/pipeline.js src/database/supabase.js frontend/src/types/index.ts
git commit -m "feat: persist bookmarks and share_ratio through pipeline to DB"
```

---

## Chunk 2: Cultural Calendar + Enhanced Trash Gate + Audio Tracking

### Task 4: Cultural Calendar

**Files:**
- Create: `src/config/cultural-calendar.json`
- Modify: `src/patterns/cultural.js`
- Modify: `src/patterns/formats.js`
- Modify: `tests/patterns.test.js`

- [ ] **Step 1: Create cultural calendar config**

Create `src/config/cultural-calendar.json`:

```json
{
  "events": [
    {
      "name": "ramadan",
      "label": "Ramadan",
      "periods": [
        { "start": "03-01", "end": "04-10", "note": "Approximate — shifts ~11 days/year per Islamic calendar" }
      ],
      "brand_relevance": { "stella": "high", "hit_kecoa": "moderate", "nyu": "moderate" },
      "score_boost": 20
    },
    {
      "name": "lebaran",
      "label": "Lebaran / Idul Fitri",
      "periods": [
        { "start": "04-05", "end": "04-20", "note": "Approximate — follows Ramadan end" }
      ],
      "brand_relevance": { "stella": "peak", "hit_kecoa": "low", "nyu": "high" },
      "score_boost": 25
    },
    {
      "name": "imlek",
      "label": "Imlek (Chinese New Year)",
      "periods": [
        { "start": "01-20", "end": "02-10" }
      ],
      "brand_relevance": { "stella": "moderate", "hit_kecoa": "low", "nyu": "moderate" },
      "score_boost": 10
    },
    {
      "name": "independence_day",
      "label": "Hari Kemerdekaan (17 Agustus)",
      "periods": [
        { "start": "08-10", "end": "08-20" }
      ],
      "brand_relevance": { "stella": "moderate", "hit_kecoa": "moderate", "nyu": "low" },
      "score_boost": 10
    },
    {
      "name": "school_season",
      "label": "Back to School",
      "periods": [
        { "start": "07-01", "end": "07-20" }
      ],
      "brand_relevance": { "stella": "low", "hit_kecoa": "low", "nyu": "high" },
      "score_boost": 10
    },
    {
      "name": "year_end",
      "label": "Year-End / Natal / New Year",
      "periods": [
        { "start": "12-15", "end": "01-05" }
      ],
      "brand_relevance": { "stella": "moderate", "hit_kecoa": "low", "nyu": "moderate" },
      "score_boost": 10
    },
    {
      "name": "harbolnas",
      "label": "Harbolnas / Mega Sales",
      "periods": [
        { "start": "09-09", "end": "09-12" },
        { "start": "10-10", "end": "10-12" },
        { "start": "11-11", "end": "11-13" },
        { "start": "12-12", "end": "12-14" }
      ],
      "brand_relevance": { "stella": "moderate", "hit_kecoa": "moderate", "nyu": "high" },
      "score_boost": 15
    },
    {
      "name": "rainy_season",
      "label": "Musim Hujan (Rainy Season)",
      "periods": [
        { "start": "10-01", "end": "03-31" }
      ],
      "brand_relevance": { "stella": "moderate", "hit_kecoa": "peak", "nyu": "low" },
      "score_boost": 10
    },
    {
      "name": "payday",
      "label": "Tanggal Gajian (Payday)",
      "periods": [
        { "start": "MM-25", "end": "MM-01", "recurring": "monthly" }
      ],
      "brand_relevance": { "stella": "moderate", "hit_kecoa": "moderate", "nyu": "moderate" },
      "score_boost": 5
    }
  ]
}
```

- [ ] **Step 2: Write failing tests for getActiveCulturalMoments**

Add to `tests/patterns.test.js`:

```javascript
const { getActiveCulturalMoments } = require('../src/patterns/cultural');

describe('getActiveCulturalMoments', () => {
  it('returns ramadan for March 15', () => {
    const moments = getActiveCulturalMoments(new Date('2026-03-15'));
    expect(moments.some(m => m.name === 'ramadan')).toBe(true);
  });

  it('returns independence_day for August 17', () => {
    const moments = getActiveCulturalMoments(new Date('2026-08-17'));
    expect(moments.some(m => m.name === 'independence_day')).toBe(true);
  });

  it('returns payday for the 25th of any month', () => {
    const moments = getActiveCulturalMoments(new Date('2026-06-25'));
    expect(moments.some(m => m.name === 'payday')).toBe(true);
  });

  it('returns payday for the 1st of any month', () => {
    const moments = getActiveCulturalMoments(new Date('2026-06-01'));
    expect(moments.some(m => m.name === 'payday')).toBe(true);
  });

  it('returns empty for a non-event date', () => {
    const moments = getActiveCulturalMoments(new Date('2026-05-15'));
    // May 15 is not in any event period (except possibly rainy season... actually no, rainy season is Oct-Mar)
    // So should be empty
    expect(moments.length).toBe(0);
  });

  it('returns harbolnas for 11.11', () => {
    const moments = getActiveCulturalMoments(new Date('2026-11-11'));
    expect(moments.some(m => m.name === 'harbolnas')).toBe(true);
  });

  it('handles year-end wrapping (Dec 20 -> Jan 5)', () => {
    const moments = getActiveCulturalMoments(new Date('2026-12-25'));
    expect(moments.some(m => m.name === 'year_end')).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest tests/patterns.test.js --verbose 2>&1 | tail -20`
Expected: FAIL — `getActiveCulturalMoments` not defined

- [ ] **Step 4: Implement getActiveCulturalMoments**

In `src/patterns/cultural.js`, add at the top after the existing constants:

```javascript
const calendarData = require('../config/cultural-calendar.json');

/**
 * Returns cultural moments that are currently active for a given date.
 * Checks the cultural-calendar.json config for matching date ranges.
 *
 * @param {Date} [date=new Date()] - Date to check
 * @returns {Array<{name: string, label: string, score_boost: number, brand_relevance: object}>}
 */
function getActiveCulturalMoments(date) {
  const d = date || new Date();
  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate();
  const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const active = [];

  for (const event of calendarData.events) {
    for (const period of event.periods) {
      if (period.recurring === 'monthly') {
        // Payday: 25th to 1st of next month
        if (day >= 25 || day <= 1) {
          active.push({
            name: event.name,
            label: event.label,
            score_boost: event.score_boost,
            brand_relevance: event.brand_relevance,
          });
        }
        break;
      }

      const start = period.start; // "MM-DD"
      const end = period.end;     // "MM-DD"

      if (start <= end) {
        // Normal range (e.g., "03-01" to "04-10")
        if (mmdd >= start && mmdd <= end) {
          active.push({
            name: event.name,
            label: event.label,
            score_boost: event.score_boost,
            brand_relevance: event.brand_relevance,
          });
          break;
        }
      } else {
        // Wrapping range (e.g., "12-15" to "01-05")
        if (mmdd >= start || mmdd <= end) {
          active.push({
            name: event.name,
            label: event.label,
            score_boost: event.score_boost,
            brand_relevance: event.brand_relevance,
          });
          break;
        }
      }
    }
  }

  return active;
}
```

Update `module.exports`:

```javascript
module.exports = {
  CULTURAL_KEYWORDS,
  INDONESIAN_LOCATION_TAGS,
  INDONESIAN_WORDS,
  detectCulturalSignals,
  isIndonesianContent,
  getActiveCulturalMoments,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/patterns.test.js --verbose 2>&1 | tail -20`
Expected: ALL PASS

- [ ] **Step 6: Boost pattern score for calendar-aligned trends**

In `src/patterns/formats.js`, update `calculatePatternScore` to accept an optional `calendarBoost` parameter:

```javascript
/**
 * Calculates a pattern score from detected formats, cultural signals, replication,
 * and optional calendar-based boost.
 *
 * Components:
 * - Format bonus: +10 per format, capped at 30
 * - Cultural signal bonus: +15 per signal, capped at 30
 * - Replication boost: (replicationCount / 100) * 40, capped at 40
 * - Calendar boost: from cultural calendar (0-25)
 * - Total capped at 100
 *
 * @param {string[]} formats - Output from detectFormat()
 * @param {string[]} culturalSignals - Output from detectCulturalSignals()
 * @param {number} replicationCount - Number of creators replicating the format
 * @param {number} [calendarBoost=0] - Score boost from active cultural calendar events
 * @returns {number} Pattern score 0-100
 */
function calculatePatternScore(formats, culturalSignals, replicationCount, calendarBoost) {
  const formatBonus = Math.min((formats || []).length * 10, 30);
  const culturalBonus = Math.min((culturalSignals || []).length * 15, 30);
  const replicationBoost = Math.min(((replicationCount || 0) / 100) * 40, 40);
  const calBoost = calendarBoost || 0;

  const total = formatBonus + culturalBonus + replicationBoost + calBoost;
  return Math.round(Math.min(total, 100) * 100) / 100;
}
```

- [ ] **Step 7: Integrate calendar boost into pipeline**

In `src/pipeline.js`, add import:

```javascript
const { detectCulturalSignals, getActiveCulturalMoments } = require('./patterns/cultural');
```

In the per-video scoring loop, after `culturalSignals` is calculated, add:

```javascript
        // --- Calendar boost ---
        const activeMoments = getActiveCulturalMoments();
        let calendarBoost = 0;
        if (activeMoments.length > 0 && culturalSignals.length > 0) {
          // If trend has cultural signals AND we're in a cultural moment, apply the highest boost
          const matchingMoment = activeMoments.find(m => culturalSignals.includes(m.name));
          if (matchingMoment) {
            calendarBoost = matchingMoment.score_boost;
          }
        }
```

Update the `calculatePatternScore` call to pass `calendarBoost`:

```javascript
        const patternScore = calculatePatternScore(
          formats, culturalSignals, replicationCount, calendarBoost
        );
```

- [ ] **Step 8: Run full test suite**

Run: `npx jest --verbose 2>&1 | tail -20`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add src/config/cultural-calendar.json src/patterns/cultural.js src/patterns/formats.js src/pipeline.js tests/patterns.test.js
git commit -m "feat: add cultural calendar with dynamic score boosting"
```

---

### Task 5: Enhanced Trash Gate with Engagement Data

**Files:**
- Modify: `src/ai/analyzer.js`
- Modify: `src/pipeline.js`

- [ ] **Step 1: Update Trash Gate to receive enriched data**

In `src/ai/analyzer.js`, modify the `trashGate` function's video list construction (around line 96).

Replace the current `videoList` generation:

```javascript
  const videoList = videos.map((v, i) => {
    const shareRatio = v.views > 0 ? ((v.shares / v.views) * 100).toFixed(2) : 'N/A';
    return `[${i}] @${v.author} — "${(v.title || '').slice(0, 100)}" | Views: ${(v.views || 0).toLocaleString()} Likes: ${v.likes} Comments: ${v.comments} Shares: ${v.shares} Bookmarks: ${v.bookmarks || 0} | Engagement Rate: ${v.engagement_rate || 'N/A'}% | Share Ratio: ${shareRatio}% | Hashtags: ${(v.hashtags || []).join(', ')} | Audio: ${v.audio_title || 'unknown'}`;
  }).join('\n');
```

Update the prompt to mention engagement data (replace the existing prompt string):

```javascript
  const prompt = `You are a TikTok trend filter for Epilog Creative, a digital marketing agency in Jakarta, Indonesia. Your clients are Godrej Indonesia brands (Stella air freshener, HIT Kecoa insecticide, NYU hair color).

Review these ${videos.length} TikTok FYP videos and classify each as SIGNAL or NOISE.

SIGNAL = Worth analyzing deeper. Could be a trend, culturally relevant, has replication potential, interesting for brand marketing. Be generous with emerging signals.
NOISE = Low-value content. Personal vlog with no trend angle, too niche, no brand relevance, duplicate of common format with no twist.

USE THE ENGAGEMENT DATA to inform your decision:
- High share ratio (>1%) = strong virality signal, lean toward SIGNAL
- High bookmark count relative to likes = evergreen/reference content, lean toward SIGNAL
- Very low engagement across all metrics = likely NOISE
- But don't reject low-view content from small creators if the format is interesting — small creators with novel formats are STRONG signals

Be aggressive — only 30-40% should survive as SIGNAL. We're looking for trends with marketing potential for Indonesian FMCG brands.

VIDEOS:
${videoList}

Respond with this exact JSON:
{
  "results": [
    { "index": 0, "verdict": "signal", "reason": "Brief reason" },
    { "index": 1, "verdict": "noise", "reason": "Brief reason" }
  ]
}

Include ALL ${videos.length} videos in your response.`;
```

- [ ] **Step 2: Update pipeline to pass enriched data to Trash Gate**

In `src/pipeline.js`, update Step 4 (Trash Gate) to pass enriched video data instead of raw videos:

Replace:
```javascript
    const verdicts = await trashGate(enrichedVideos.map((ev) => ev.video));
```

With:
```javascript
    const verdicts = await trashGate(enrichedVideos.map((ev) => ({
      ...ev.video,
      engagement_rate: ev.enrichedTrend.engagement_rate,
      share_ratio: ev.enrichedTrend.share_ratio,
    })));
```

- [ ] **Step 3: Run full test suite**

Run: `npx jest --verbose 2>&1 | tail -20`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/ai/analyzer.js src/pipeline.js
git commit -m "feat: enhance Trash Gate with engagement data (share ratio, bookmarks)"
```

---

### Task 6: Audio Trend Tracking

**Files:**
- Modify: `src/database/supabase.js`
- Modify: `src/pipeline.js`

- [ ] **Step 1: Add audio trend DB functions**

In `src/database/supabase.js`, add before `module.exports`:

```javascript
/**
 * Upserts audio trend data from a pipeline scrape batch.
 * Groups by audio_id, counts unique authors, and tracks first/last seen.
 *
 * @param {Array<{audio_id: string, audio_title: string, author: string}>} videos
 * @returns {Promise<number>} Number of audio trends upserted
 */
async function upsertAudioTrends(videos) {
  const audioMap = new Map();
  for (const v of videos) {
    if (!v.audio_id) continue;
    if (!audioMap.has(v.audio_id)) {
      audioMap.set(v.audio_id, { title: v.audio_title || '', authors: new Set() });
    }
    audioMap.get(v.audio_id).authors.add(v.author);
  }

  let upserted = 0;
  const now = new Date().toISOString();

  for (const [audioId, data] of audioMap) {
    try {
      const { data: existing } = await supabase
        .from('audio_trends')
        .select('id, usage_count, unique_authors')
        .eq('audio_id', audioId)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        await supabase.from('audio_trends').insert({
          audio_id: audioId,
          audio_title: data.title,
          usage_count: data.authors.size,
          unique_authors: data.authors.size,
          last_seen_at: now,
          scraped_at: now,
        });
      } else {
        await supabase.from('audio_trends').insert({
          audio_id: audioId,
          audio_title: data.title,
          usage_count: data.authors.size,
          unique_authors: data.authors.size,
          first_seen_at: now,
          last_seen_at: now,
          scraped_at: now,
        });
      }
      upserted++;
    } catch (err) {
      logger.warn(MOD, `Failed to upsert audio trend ${audioId}`, err);
    }
  }

  logger.log(MOD, `Upserted ${upserted} audio trends`);
  return upserted;
}
```

Add `upsertAudioTrends` to `module.exports`.

- [ ] **Step 2: Integrate audio tracking into pipeline**

In `src/pipeline.js`, add import:

```javascript
const { upsertAudioTrends } = require('./database/supabase');
```

Wait — `upsertAudioTrends` is in the same `supabase.js` file. Update the existing destructured import to include it:

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
  updateTrendThumbnail,
  upsertAudioTrends,
} = require('./database/supabase');
```

Add a new step after Step 3 (per-video scoring) and before Step 4 (Trash Gate). Insert after the `enrichedVideos` loop:

```javascript
    // -----------------------------------------------------------------------
    // Step 3b — Audio trend tracking
    // -----------------------------------------------------------------------
    try {
      const audioCount = await upsertAudioTrends(videos);
      logger.log(MOD, `Tracked ${audioCount} audio trends`);
    } catch (err) {
      logger.warn(MOD, 'Audio trend tracking failed (non-fatal)', err);
    }
```

- [ ] **Step 3: Run full test suite**

Run: `npx jest --verbose 2>&1 | tail -20`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/database/supabase.js src/pipeline.js
git commit -m "feat: track audio trends across pipeline runs"
```

---

### Task 7: TypeScript Type Check + Final Verification

- [ ] **Step 1: Run TypeScript type check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 2: Run full backend test suite**

Run: `npx jest --verbose`
Expected: ALL PASS, 0 failures

- [ ] **Step 3: Verify all new tests exist and pass**

Run: `npx jest --verbose 2>&1 | grep -E '(PASS|FAIL|weighted|share|calendar|cultural)'`
Expected: All new test suites PASS

- [ ] **Step 4: Commit any final fixes**

If any tests fail, fix and commit.
