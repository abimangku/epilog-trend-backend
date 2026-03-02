# Fix Video URLs, FYP-Native Scoring, TikTok Embeds — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three critical bugs: broken video URLs, dead scoring engine (views=0), and missing video previews.

**Architecture:** Surgical fixes to existing files. Backend scraper extracts video URLs from FYP DOM instead of constructing profile URLs. Scoring engine uses volume-based formula when views=0. Frontend embeds TikTok videos on the detail page using official embed script.

**Tech Stack:** Node.js/Playwright (backend scraper), Jest (tests), React/TypeScript (frontend component)

---

### Task 1: Write failing tests for FYP-native engagement scoring

**Files:**
- Modify: `tests/scoring.test.js` (append new describe blocks after line 456)

**Step 1: Add test block for volume-based engagement rate**

Append after the existing `describe('compositeScore', ...)` block:

```javascript
// ===========================================================================
// engagement.js — FYP-native scoring (views=0)
// ===========================================================================

describe('calculateEngagementRate — FYP volume scoring (views=0)', () => {
  test('views=0 with typical FYP engagement returns meaningful score', () => {
    // 701K likes, 2557 comments, 18900 shares (real data from DB)
    const result = calculateEngagementRate(701200, 2557, 18900, 0);
    expect(result).toBeGreaterThan(30);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('views=0 with mega-viral engagement returns high score', () => {
    // 2.9M likes, 27900 comments, 644100 shares (real data from DB)
    const result = calculateEngagementRate(2900000, 27900, 644100, 0);
    expect(result).toBeGreaterThan(70);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('views=0 with small engagement returns low score', () => {
    // ~1K total engagement
    const result = calculateEngagementRate(500, 100, 50, 0);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(30);
  });

  test('views=0 with zero engagement returns 0', () => {
    expect(calculateEngagementRate(0, 0, 0, 0)).toBe(0);
  });

  test('views=0 shares weighted highest (3x)', () => {
    // Same total raw numbers, but shares-heavy should score higher
    const sharesHeavy = calculateEngagementRate(100, 100, 10000, 0);
    const likesHeavy = calculateEngagementRate(10000, 100, 100, 0);
    expect(sharesHeavy).toBeGreaterThan(likesHeavy);
  });

  test('views>0 still uses original rate formula', () => {
    // Backward compatibility: (100 + 50 + 25) / 10000 * 100 = 1.75%
    expect(calculateEngagementRate(100, 50, 25, 10000)).toBeCloseTo(1.75);
  });
});

describe('calculateVelocityScore — FYP volume velocity (views=0)', () => {
  test('single snapshot with views=0 returns volume-based score', () => {
    // 701K likes, 2557 comments, 18900 shares
    const result = calculateVelocityScore([snap(1, 0, 701200, 2557, 18900)]);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('growing engagement between views=0 snapshots produces positive velocity', () => {
    const snapshots = [
      snap(2, 0, 100000, 500, 5000),    // smaller
      snap(1, 0, 500000, 2500, 25000),   // 5x growth
    ];
    const result = calculateVelocityScore(snapshots);
    expect(result).toBeGreaterThan(50);
  });

  test('flat engagement between views=0 snapshots produces low velocity', () => {
    const snapshots = [
      snap(2, 0, 100000, 500, 5000),
      snap(1, 0, 105000, 520, 5100),  // ~5% growth
    ];
    const result = calculateVelocityScore(snapshots);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(50);
  });

  test('views>0 snapshots still use original rate-based velocity', () => {
    const snapshots = [
      snap(2, 10000, 100, 50, 25),   // rate = 1.75%
      snap(1, 20000, 400, 150, 100), // rate = 3.25%
    ];
    const result = calculateVelocityScore(snapshots);
    expect(result).toBeGreaterThan(0);
  });
});

describe('calculateMomentum — FYP volume momentum (views=0)', () => {
  test('accelerating with views=0 snapshots', () => {
    const snapshots = [
      snap(3, 0, 10000, 100, 500),     // small
      snap(2, 0, 50000, 500, 2500),    // 5x jump
      snap(1, 0, 300000, 3000, 15000), // 6x jump (accelerating)
    ];
    expect(calculateMomentum(snapshots)).toBe('accelerating');
  });

  test('decelerating with views=0 snapshots', () => {
    const snapshots = [
      snap(3, 0, 10000, 100, 500),     // small
      snap(2, 0, 100000, 1000, 5000),  // 10x jump
      snap(1, 0, 110000, 1100, 5500),  // only 10% jump (decelerating)
    ];
    expect(calculateMomentum(snapshots)).toBe('decelerating');
  });

  test('stable with views=0 snapshots', () => {
    const snapshots = [
      snap(3, 0, 100000, 1000, 5000),
      snap(2, 0, 200000, 2000, 10000),  // 2x
      snap(1, 0, 400000, 4000, 20000),  // 2x (same rate = stable)
    ];
    expect(calculateMomentum(snapshots)).toBe('stable');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --verbose 2>&1 | tail -40`
Expected: New FYP-native tests FAIL (calculateEngagementRate still returns 0 for views=0)

**Step 3: Commit failing tests**

```bash
git add tests/scoring.test.js
git commit -m "test: add FYP-native scoring tests for views=0 scenarios"
```

---

### Task 2: Implement FYP-native engagement scoring

**Files:**
- Modify: `src/scoring/engagement.js:14-18` (calculateEngagementRate)
- Modify: `src/scoring/engagement.js:30-77` (calculateVelocityScore)
- Modify: `src/scoring/engagement.js:88-124` (calculateMomentum)

**Step 1: Add volume scoring constant and helper**

At the top of `src/scoring/engagement.js` (after line 4), add:

```javascript
// Maximum expected weighted engagement volume for normalization.
// Based on real FYP data: mega-viral = ~5M likes + 50K comments + 600K shares
// Weighted: 5M + 50K*2 + 600K*3 = 6.9M. log10(6.9M) ≈ 6.84
// We use 10M as a round ceiling so scores don't cluster near 100.
const MAX_VOLUME = 10_000_000;

/**
 * Calculates weighted engagement volume for FYP scoring (views=0 context).
 * Comments weighted 2x (deeper engagement), shares weighted 3x (distribution).
 *
 * @param {number} likes
 * @param {number} comments
 * @param {number} shares
 * @returns {number} Weighted volume
 */
function weightedVolume(likes, comments, shares) {
  return likes + comments * 2 + shares * 3;
}
```

**Step 2: Modify `calculateEngagementRate`**

Replace the function body (lines 15-18) with:

```javascript
function calculateEngagementRate(likes, comments, shares, views) {
  if (views && views > 0) {
    return ((likes + comments + shares) / views) * 100;
  }
  // FYP-native: volume-based score using logarithmic scaling
  const volume = weightedVolume(likes, comments, shares);
  if (volume <= 0) return 0;
  return (Math.log10(volume + 1) / Math.log10(MAX_VOLUME + 1)) * 100;
}
```

**Step 3: Modify `calculateVelocityScore`**

The function needs to detect whether snapshots have views=0 and switch to volume-based comparison. Replace lines 30-77 with:

```javascript
function calculateVelocityScore(snapshots) {
  if (!snapshots || snapshots.length === 0) return 0;

  const isFYP = snapshots.every((s) => !s.views || s.views === 0);

  // Single snapshot: return engagement score, capped at 100
  if (snapshots.length === 1) {
    const s = snapshots[0];
    if (isFYP) {
      const vol = weightedVolume(s.likes, s.comments, s.shares);
      if (vol <= 0) return 0;
      return Math.min((Math.log10(vol + 1) / Math.log10(MAX_VOLUME + 1)) * 100, 100);
    }
    const rate = calculateEngagementRate(s.likes, s.comments, s.shares, s.views);
    return Math.min(rate, 100);
  }

  // Calculate per-snapshot metric (volume for FYP, rate for views>0)
  const metrics = snapshots.map((s) => {
    if (isFYP) {
      return weightedVolume(s.likes, s.comments, s.shares);
    }
    return calculateEngagementRate(s.likes, s.comments, s.shares, s.views);
  });

  // Calculate rate of change between consecutive snapshots
  const changes = [];
  for (let i = 1; i < metrics.length; i++) {
    const prev = metrics[i - 1];
    if (prev === 0) {
      changes.push(metrics[i] > 0 ? 100 : 0);
    } else {
      changes.push(((metrics[i] - prev) / prev) * 100);
    }
  }

  // Weight recent changes higher: most recent = 1.0, previous = 0.7, before that = 0.4
  const weights = [0.4, 0.7, 1.0];
  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < changes.length; i++) {
    const weightIdx = weights.length - 1 - (changes.length - 1 - i);
    const w = weightIdx >= 0 ? weights[weightIdx] : 0.4;
    weightedSum += changes[i] * w;
    weightTotal += w;
  }

  if (weightTotal === 0) return 0;

  const raw = weightedSum / weightTotal;

  // Normalize to 0-100. Treat 50% weighted change as velocity 100.
  const normalized = Math.max(0, Math.min(100, (raw / 50) * 100));
  return Math.round(normalized * 100) / 100;
}
```

**Step 4: Modify `calculateMomentum`**

Replace lines 88-124 with:

```javascript
function calculateMomentum(snapshots) {
  if (!snapshots || snapshots.length < 3) return 'stable';

  const isFYP = snapshots.every((s) => !s.views || s.views === 0);

  // Calculate per-snapshot metric
  const metrics = snapshots.map((s) => {
    if (isFYP) {
      return weightedVolume(s.likes, s.comments, s.shares);
    }
    return calculateEngagementRate(s.likes, s.comments, s.shares, s.views);
  });

  // Calculate the last two changes
  const prevChange = metrics[metrics.length - 2] - metrics[metrics.length - 3];
  const currentChange = metrics[metrics.length - 1] - metrics[metrics.length - 2];

  if (prevChange === 0 && currentChange === 0) return 'stable';
  if (prevChange === 0) return currentChange > 0 ? 'accelerating' : 'decelerating';

  const absPrev = Math.abs(prevChange);
  const absCurr = Math.abs(currentChange);
  const sameDirection = (prevChange > 0 && currentChange > 0) || (prevChange < 0 && currentChange < 0);

  if (!sameDirection) {
    return currentChange > 0 ? 'accelerating' : 'decelerating';
  }

  if (prevChange > 0) {
    if (absCurr > absPrev * 1.2) return 'accelerating';
    if (absCurr < absPrev * 0.8) return 'decelerating';
  } else {
    if (absCurr > absPrev * 1.2) return 'decelerating';
    if (absCurr < absPrev * 0.8) return 'accelerating';
  }
  return 'stable';
}
```

**Step 5: Update module.exports to include weightedVolume (for testing)**

No change needed — `weightedVolume` is internal. But if tests need it later, it can be exported.

**Step 6: Run tests**

Run: `npm test -- --verbose 2>&1 | tail -60`
Expected: ALL tests pass (old + new)

**Step 7: Commit**

```bash
git add src/scoring/engagement.js
git commit -m "feat: FYP-native volume scoring when views=0

Switches to logarithmic volume-based scoring when views are unavailable
(FYP context). Comments weighted 2x, shares 3x. Backward compatible
with views>0 rate formula."
```

---

### Task 3: Fix video URL extraction in scraper

**Files:**
- Modify: `src/scrapers/tiktok.js:23-44` (SELECTORS)
- Modify: `src/scrapers/tiktok.js:320-391` (_extractVisibleArticles)
- Modify: `src/scrapers/tiktok.js:222-283` (scrapeOnce URL construction + dedup)

**Step 1: Add video link selector**

In the SELECTORS object (after line 33, the authorAvatar line), add:

```javascript
  // Direct link to the video page — href is /@username/video/{id}
  videoLink: 'a[href*="/video/"]',
```

**Step 2: Extract video URL in `_extractVisibleArticles`**

Inside the `page.evaluate()` callback, after the authorUsername extraction (around line 344), add video link extraction:

```javascript
        // Video URL — direct link to /@username/video/{id}
        const videoLinkEl = article.querySelector(sel.videoLink);
        let videoPath = '';
        if (videoLinkEl) {
          videoPath = videoLinkEl.getAttribute('href') || '';
        }
```

And add `videoPath` to the results.push object (line 365-374):

```javascript
        results.push({
          articleId: article.id || '',
          authorUsername,
          videoPath,
          caption,
          likesText,
          commentsText,
          sharesText,
          bookmarksText,
          musicHref,
        });
```

**Step 3: Fix URL construction in `scrapeOnce`**

Replace lines 227-232 with:

```javascript
        // Build video URL — prefer direct video link, fall back to profile
        let videoUrl = null;
        if (article.videoPath && article.videoPath.includes('/video/')) {
          videoUrl = `https://www.tiktok.com${article.videoPath}`;
        } else if (article.authorUsername) {
          videoUrl = `https://www.tiktok.com/@${article.authorUsername}`;
        }

        if (!videoUrl || seenUrls.has(videoUrl)) continue;
        seenUrls.add(videoUrl);
```

Note: Dedup key is now just `videoUrl` (not `videoUrl + caption`), since video URLs are unique.

**Step 4: Update hash computation to use new URL**

Line 238 — the hash now uses the video URL instead of profile URL + caption:

```javascript
          const hash = videoHash(videoUrl);
```

**Step 5: Run manual test to verify**

Run: `node scripts/test-fyp-scraper.js 2>&1 | head -30`
Expected: Video URLs contain `/video/` paths. Example: `https://www.tiktok.com/@username/video/7350629184628`

Note: Some articles may not have video links (edge case) — those fall back to profile URL. Log a count of each.

**Step 6: Commit**

```bash
git add src/scrapers/tiktok.js
git commit -m "feat: extract actual video URLs from FYP DOM

Queries for a[href*='/video/'] within each article to get direct video
URLs instead of constructing profile URLs. Falls back to profile URL
if video link not found in DOM."
```

---

### Task 4: Create TikTokEmbed frontend component

**Files:**
- Create: `EPILOG-TREND-FRONTEND/src/components/TikTokEmbed.tsx`

**Step 1: Create the component**

```typescript
import { useEffect, useRef } from 'react';

interface TikTokEmbedProps {
  videoUrl: string;
}

/**
 * Extracts the video ID from a TikTok video URL.
 * Expected format: https://www.tiktok.com/@user/video/7123456789
 * Returns null if URL doesn't contain a video path.
 */
function extractVideoId(url: string): string | null {
  const match = url.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Embeds a TikTok video using TikTok's official embed script.
 * Returns null if the URL is not a valid video URL (e.g., profile-only URLs).
 */
export default function TikTokEmbed({ videoUrl }: TikTokEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const videoId = extractVideoId(videoUrl);

  useEffect(() => {
    if (!videoId) return;

    // Load TikTok embed script if not already present
    const existingScript = document.querySelector('script[src*="tiktok.com/embed.js"]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.tiktok.com/embed.js';
      script.async = true;
      document.head.appendChild(script);
    }

    // Re-render embeds after script loads or on re-mount
    const timer = setTimeout(() => {
      if ((window as any).tiktokEmbed?.lib?.render) {
        (window as any).tiktokEmbed.lib.render();
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [videoId]);

  if (!videoId) return null;

  return (
    <div ref={containerRef} className="flex justify-center">
      <blockquote
        className="tiktok-embed"
        cite={videoUrl}
        data-video-id={videoId}
        style={{ maxWidth: '605px', minWidth: '325px' }}
      >
        <section>
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent hover:text-foreground"
          >
            Loading TikTok video...
          </a>
        </section>
      </blockquote>
    </div>
  );
}
```

**Step 2: Commit**

```bash
cd /Users/abimangkuagent/EPILOG-TREND-FRONTEND
git add src/components/TikTokEmbed.tsx
git commit -m "feat: add TikTokEmbed component for video previews

Uses TikTok's official embed script. Extracts video ID from URL,
renders blockquote embed markup. Returns null for profile-only URLs."
```

---

### Task 5: Integrate TikTokEmbed into TrendDeepDive page

**Files:**
- Modify: `EPILOG-TREND-FRONTEND/src/pages/TrendDeepDive.tsx:1-9` (imports)
- Modify: `EPILOG-TREND-FRONTEND/src/pages/TrendDeepDive.tsx:328-330` (between header and analysis sections)

**Step 1: Add import**

Add to the import block at the top of TrendDeepDive.tsx (after line 6):

```typescript
import TikTokEmbed from '@/components/TikTokEmbed';
```

**Step 2: Add embed between header and analysis sections**

After the closing `</section>` of the header (line 328, after the Share button section), before `{/* Section 2 — Why Trending */}`, insert:

```tsx
        {/* Section 1.5 — TikTok Video Embed */}
        {trend.url && trend.url.includes('/video/') && (
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground mb-3">Video Preview</h2>
            <TikTokEmbed videoUrl={trend.url} />
          </section>
        )}
```

**Step 3: Verify build**

Run: `cd /Users/abimangkuagent/EPILOG-TREND-FRONTEND && npx vite build 2>&1 | tail -15`
Expected: Build succeeds, no TypeScript errors.

**Step 4: Commit**

```bash
cd /Users/abimangkuagent/EPILOG-TREND-FRONTEND
git add src/pages/TrendDeepDive.tsx
git commit -m "feat: embed TikTok video on trend detail page

Shows video preview above the AI analysis section for trends with
valid video URLs. Profile-only URLs (old data) show link only."
```

---

### Task 6: Run full test suite and push both repos

**Step 1: Run backend tests**

Run: `cd /Users/abimangkuagent/EPILOG-TREND-ANALYZER && npm test -- --verbose 2>&1 | tail -30`
Expected: ALL tests pass (old + new FYP-native tests)

**Step 2: Build frontend**

Run: `cd /Users/abimangkuagent/EPILOG-TREND-FRONTEND && npx vite build 2>&1 | tail -15`
Expected: Build succeeds

**Step 3: Clean frontend build artifacts**

Run: `cd /Users/abimangkuagent/EPILOG-TREND-FRONTEND && rm -rf dist`

**Step 4: Push backend**

Run: `cd /Users/abimangkuagent/EPILOG-TREND-ANALYZER && git push origin main`

**Step 5: Push frontend**

Run: `cd /Users/abimangkuagent/EPILOG-TREND-FRONTEND && git push origin main`

**Step 6: Verify both repos are clean**

Run: `cd /Users/abimangkuagent/EPILOG-TREND-ANALYZER && git status`
Run: `cd /Users/abimangkuagent/EPILOG-TREND-FRONTEND && git status`
Expected: Both show "nothing to commit, working tree clean"
