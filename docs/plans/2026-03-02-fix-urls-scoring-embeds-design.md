# Design: Fix Video URLs, FYP-Native Scoring, TikTok Embeds

**Date**: 2026-03-02
**Approach**: Option A — Surgical Fix (no schema changes)
**Files changed**: 6 (4 backend, 2 frontend)

## Problem Statement

Three critical issues make the tool unreliable:

1. **Broken URLs**: Scraper constructs profile URLs (`/@username`) instead of video URLs (`/@username/video/ID`). Users click "Open on TikTok" and see a profile, not the trending video.

2. **Dead scoring engine**: FYP never shows view counts (views=0). Since `engagement_rate = (likes+comments+shares)/views`, the rate is always 0. `velocity_score` and `momentum` derive from engagement_rate, so they're also 0. 50% of the composite score formula produces zero.

3. **No video preview**: Users must leave the app to see the actual TikTok content. Text descriptions alone can't convey visual trends.

## Fix 1: Video URL Extraction

**File**: `src/scrapers/tiktok.js`

### Current behavior (broken)
```javascript
const videoUrl = article.authorUsername
  ? `https://www.tiktok.com/@${article.authorUsername}`
  : null;
```

### New behavior
In `_extractVisibleArticles()`, query for `a[href*="/video/"]` within each article element. Extract the full path (e.g., `/@username/video/7350629184628`). Also extract the numeric video ID separately.

In `scrapeOnce()`, use the video URL from DOM. Dedup key becomes the video URL itself (instead of the `videoUrl + caption` hack).

### Fallback
If no video link found in the article DOM, fall back to profile URL. The frontend checks for `/video/` in the URL to decide whether to show the embed.

### Hash impact
The hash formula uses `platform|url|title`. Old trends keep their profile-URL hashes. New scrapes produce new hashes with video URLs. Old broken data is effectively superseded — this is desired behavior.

## Fix 2: FYP-Native Scoring

**File**: `src/scoring/engagement.js`

### calculateEngagementRate
When `views === 0`, calculate a **volume score** instead of a rate:

```
volume = likes + comments*2 + shares*3
score = log10(volume + 1) / log10(MAX_EXPECTED + 1) * 100
```

Comments weighted 2x (deeper engagement), shares weighted 3x (distribution signal). Logarithmic scaling handles TikTok's 3-order-of-magnitude range (1K to 10M).

When `views > 0`, use the original rate formula (backward compatible).

### calculateVelocityScore
When views=0 in snapshots, compare absolute engagement totals between snapshots:

```
total = likes + comments*2 + shares*3
growth = (current_total - previous_total) / previous_total * 100
```

Same recency weighting (most recent change weighted 1.0, older changes 0.7, 0.4).

### calculateMomentum
Same fix — use absolute engagement totals instead of rates when views=0.

### Test updates
**File**: `tests/scoring.test.js`
- New test block for views=0 scenarios
- Verify volume scoring produces meaningful values for real FYP data
- Existing views>0 tests must continue passing

## Fix 3: TikTok Video Embed

**Files**: `EPILOG-TREND-FRONTEND/src/components/TikTokEmbed.tsx` (new), `src/pages/TrendDeepDive.tsx` (modified)

### TikTokEmbed component
- Props: `videoUrl: string`
- Parses video ID from URL path (`/video/{id}`)
- Renders TikTok blockquote embed markup
- Loads `tiktok.com/embed.js` script via useEffect
- Calls `window.tiktokEmbed.lib.render()` on mount to trigger rendering
- Returns null if URL doesn't contain `/video/` (old profile URLs)

### TrendDeepDive integration
- Place TikTokEmbed above the AI analysis section
- Keep "Open on TikTok" link as fallback below the embed
- No changes to other pages (Command Center, History, Briefs)

### No API key needed
TikTok's embed script is free and requires no authentication.

## What Does NOT Change

- Database schema (no new columns, no migrations)
- Frontend TypeScript types (url is already a string)
- AI pipeline (analyzer.js, brand-fit.js)
- Notification system (slack.js)
- Scheduler (scheduler.js)
- Server endpoints (server.js)

## Data Flow After Fix

```
FYP Scroll
  -> Extract video URL + video ID + metadata (FIX 1)
  -> Score with volume-based formula (FIX 2)
  -> Trash Gate -> Deep Analysis -> Synthesis -> Brand Fit
  -> Supabase (trends.url = video URL)
  -> Frontend: embed TikTok player + "Open on TikTok" link (FIX 3)
```
