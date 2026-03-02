# Anti-Detection Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the TikTok FYP scraper against bot detection, rate limiting, and IP bans — zero cost.

**Architecture:** Replace playwright with playwright-extra + stealth plugin (drop-in, same API). Reduce schedule frequency ~50%, add jitter and exponential backoff. Replace mechanical scroll behavior with human-like patterns. Rotate user agents and viewport sizes per session.

**Tech Stack:** playwright-extra, puppeteer-extra-plugin-stealth, Node.js (CommonJS)

**Design doc:** `docs/plans/2026-03-02-anti-detection-hardening-design.md`

---

### Task 1: Install stealth dependencies and swap imports

**Files:**
- Modify: `package.json` (add 2 deps)
- Modify: `src/scrapers/tiktok.js:16` (replace playwright import)

**Step 1: Install playwright-extra and stealth plugin**

Run: `npm install playwright-extra puppeteer-extra-plugin-stealth`
Expected: Both packages added to `dependencies` in package.json

**Step 2: Swap the import in tiktok.js**

Replace lines 16 at the top of `src/scrapers/tiktok.js`:

```js
// BEFORE (line 16):
const { chromium } = require('playwright');

// AFTER:
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
```

No other code changes needed — playwright-extra has the same API.

**Step 3: Verify scraper still works**

Run: `node scripts/test-fyp-scraper.js`
Expected: Videos scraped successfully (same output as before). If TikTok is rate-limiting, at least confirm the browser launches and navigates without import errors.

**Step 4: Commit**

```bash
git add package.json package-lock.json src/scrapers/tiktok.js
git commit -m "feat: add playwright-extra stealth plugin for anti-detection"
```

---

### Task 2: Add UA rotation and viewport variance

**Files:**
- Modify: `src/scrapers/tiktok.js:57-65` (CONFIG section)
- Modify: `src/scrapers/tiktok.js:183-197` (browser launch + context creation)

**Step 1: Add UA pool and viewport range to CONFIG**

Add after the existing CONFIG object (around line 65) in `src/scrapers/tiktok.js`:

```js
// ---------------------------------------------------------------------------
// Anti-detection: user agent pool and viewport ranges
// ---------------------------------------------------------------------------
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
];

const VIEWPORT_RANGE = {
  widthMin: 1260, widthMax: 1400,
  heightMin: 780, heightMax: 900,
};
```

**Step 2: Use random UA and viewport in browser context creation**

Replace the hardcoded userAgent and viewport in `scrapeOnce()` (around lines 192-197):

```js
// BEFORE:
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
  locale: 'id-ID',
  timezoneId: 'Asia/Jakarta',
});

// AFTER:
const selectedUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const vpWidth = randomDelay(VIEWPORT_RANGE.widthMin, VIEWPORT_RANGE.widthMax);
const vpHeight = randomDelay(VIEWPORT_RANGE.heightMin, VIEWPORT_RANGE.heightMax);
logger.log(MOD, `Session fingerprint: UA=${selectedUA.match(/Chrome\/([\d.]+)/)[1]}, viewport=${vpWidth}x${vpHeight}`);

const context = await browser.newContext({
  userAgent: selectedUA,
  viewport: { width: vpWidth, height: vpHeight },
  locale: 'id-ID',
  timezoneId: 'Asia/Jakarta',
});
```

Note: `randomDelay()` already exists in the file — reuse it for viewport sizing.

**Step 3: Verify scraper still works**

Run: `node scripts/test-fyp-scraper.js`
Expected: Videos scraped. Log line shows randomized Chrome version and viewport.

**Step 4: Commit**

```bash
git add src/scrapers/tiktok.js
git commit -m "feat: rotate user agent and viewport per scrape session"
```

---

### Task 3: Human-like scroll behavior

**Files:**
- Modify: `src/scrapers/tiktok.js:372-375` (scroll section in the while loop)

**Step 1: Replace mechanical scroll with human-like behavior**

Replace the scroll section at the bottom of the while loop (around lines 372-375):

```js
// BEFORE:
// Scroll down to load more videos
const delay = randomDelay(CONFIG.scrollPauseMinMs, CONFIG.scrollPauseMaxMs);
await page.evaluate(() => window.scrollBy(0, window.innerHeight));
await page.waitForTimeout(delay);

// AFTER:
// --- Human-like scroll behavior ---
const scrollRoll = Math.random();
let scrollDistance;
let pauseMs;

if (scrollRoll < 0.10) {
  // ~10%: slight upward scroll (simulates "wait, go back")
  scrollDistance = -randomDelay(100, 300);
  pauseMs = randomDelay(1000, 2000);
} else if (scrollRoll < 0.20) {
  // ~10%: small re-read scroll
  scrollDistance = randomDelay(200, 400);
  pauseMs = randomDelay(500, 1500);
} else if (scrollRoll < 0.35) {
  // ~15%: "watching" a video — long pause
  scrollDistance = randomDelay(
    Math.round(vpHeight * 0.6),
    Math.round(vpHeight * 1.0)
  );
  pauseMs = randomDelay(8000, 15000);
} else {
  // ~65%: normal scroll
  scrollDistance = randomDelay(
    Math.round(vpHeight * 0.7),
    Math.round(vpHeight * 1.3)
  );
  pauseMs = randomDelay(2000, 5000);
}

await page.evaluate((dy) => window.scrollBy(0, dy), scrollDistance);
await page.waitForTimeout(pauseMs);
```

Note: `vpHeight` is the viewport height variable created in Task 2. It's already in scope within `scrapeOnce()`.

**Step 2: Add early exit on stale scrolls**

Add a stale scroll counter right after `let scrollAttempts = 0;` (around line 260):

```js
let staleScrollCount = 0; // consecutive scrolls with 0 new articles
```

Then inside the while loop, after processing all articles from `_extractVisibleArticles()` and before the scroll section, add:

```js
// Track stale scrolls — if no new articles found this iteration
const newArticlesThisScroll = articleData.filter(
  (a) => a.authorUsername && !seenArticleIds.has(a.articleId || (a.authorUsername + '|' + a.caption))
).length;

// Note: seenArticleIds was already updated above, so check BEFORE the for-loop
// Actually, we need to track this differently. Count videos added this scroll:
```

Wait — the `seenArticleIds` set is already modified during the for-loop above. A simpler approach: track `videos.length` before and after the for-loop.

Add before the `for (const article of articleData)` loop:

```js
const videosBeforeThisScroll = videos.length;
```

Add after the for-loop closes (before the scroll section):

```js
// Stale scroll detection — early exit if no new content loading
if (videos.length === videosBeforeThisScroll) {
  staleScrollCount++;
  if (staleScrollCount >= 3) {
    logger.log(MOD, `3 consecutive stale scrolls — stopping with ${videos.length} videos`);
    break;
  }
} else {
  staleScrollCount = 0;
}
```

**Step 3: Verify scraper still works**

Run: `node scripts/test-fyp-scraper.js`
Expected: Videos scraped. May see varied scroll timing in behavior. Early exit logs if content runs out.

**Step 4: Commit**

```bash
git add src/scrapers/tiktok.js
git commit -m "feat: human-like scroll behavior with stale scroll detection"
```

---

### Task 4: Schedule tuning — reduce intervals, add jitter, disable sleep window

**Files:**
- Modify: `src/scheduler.js:35-43` (SCHEDULE constants)
- Modify: `src/scheduler.js:104-115` (onTick interval check)

**Step 1: Update SCHEDULE intervals**

Replace the SCHEDULE object in `src/scheduler.js` (lines 35-43):

```js
// BEFORE:
const SCHEDULE = {
  morning:   { start: 5,  end: 8,  intervalMinutes: 30,  aiAnalysis: true },
  work:      { start: 8,  end: 11, intervalMinutes: 90,  aiAnalysis: false },
  lunch:     { start: 11, end: 14, intervalMinutes: 30,  aiAnalysis: true },
  afternoon: { start: 14, end: 18, intervalMinutes: 60,  aiAnalysis: false },
  primetime: { start: 18, end: 22, intervalMinutes: 20,  aiAnalysis: true },
  latenight: { start: 22, end: 24, intervalMinutes: 45,  aiAnalysis: true },
  sleep:     { start: 0,  end: 5,  intervalMinutes: 120, aiAnalysis: false },
};

// AFTER:
const SCHEDULE = {
  morning:   { start: 5,  end: 8,  intervalMinutes: 60,  aiAnalysis: true },
  work:      { start: 8,  end: 11, intervalMinutes: 90,  aiAnalysis: false },
  lunch:     { start: 11, end: 14, intervalMinutes: 45,  aiAnalysis: true },
  afternoon: { start: 14, end: 18, intervalMinutes: 60,  aiAnalysis: false },
  primetime: { start: 18, end: 22, intervalMinutes: 60,  aiAnalysis: true },
  latenight: { start: 22, end: 24, intervalMinutes: 90,  aiAnalysis: true },
  sleep:     { start: 0,  end: 5,  intervalMinutes: 0,   aiAnalysis: false },
};
```

Note: `intervalMinutes: 0` for sleep means "disabled" — we'll handle this in onTick.

**Step 2: Add jitter and sleep-skip to onTick**

Replace the interval check at the top of `onTick()` (lines 104-115):

```js
async function onTick() {
  const { name, config } = getCurrentWindow();

  // Skip disabled windows (intervalMinutes === 0)
  if (config.intervalMinutes === 0) return;

  // Check if enough time has elapsed since the last scrape
  // Apply jitter: ±30% variance to prevent clockwork patterns
  const now = Date.now();
  const jitterMultiplier = 0.7 + (Math.random() * 0.6); // 0.7 to 1.3
  const intervalMs = config.intervalMinutes * 60 * 1000 * jitterMultiplier;
  const elapsed = lastScrapeTime ? now - lastScrapeTime.getTime() : Infinity;

  if (elapsed < intervalMs) {
    return;
  }

  // ... rest of onTick unchanged
```

**Step 3: Verify the scheduler logic**

Run: `node -e "const s = require('./src/scheduler'); console.log('Current window:', s.getCurrentWindow()); console.log('Schedule:', s.SCHEDULE);"`
Expected: Shows updated intervals. Sleep window has intervalMinutes: 0.

**Step 4: Commit**

```bash
git add src/scheduler.js
git commit -m "feat: reduce schedule frequency, add jitter, disable sleep window"
```

---

### Task 5: Exponential backoff on empty scrapes

**Files:**
- Modify: `src/scheduler.js:49-53` (state variables)
- Modify: `src/scheduler.js` (onTick success/failure handling)
- Modify: `src/scheduler.js` (getSchedulerStatus)

**Step 1: Add empty-scrape tracking state**

Add to the scheduler state section (after line 53):

```js
let consecutiveEmptyScrapes = 0;
```

**Step 2: Add backoff logic to onTick**

In the `onTick()` function, after computing `intervalMs` (the jittered interval), add backoff:

```js
  // Apply exponential backoff when getting empty scrapes (rate-limited)
  const backoffMultiplier = consecutiveEmptyScrapes > 0
    ? Math.min(Math.pow(2, consecutiveEmptyScrapes), 4) // caps at 4x
    : 1;
  const effectiveIntervalMs = intervalMs * backoffMultiplier;
  const elapsed = lastScrapeTime ? now - lastScrapeTime.getTime() : Infinity;

  if (elapsed < effectiveIntervalMs) {
    return;
  }

  // Skip to next window after 3+ consecutive empty scrapes
  if (consecutiveEmptyScrapes >= 3) {
    logger.warn(MOD, `3+ empty scrapes — skipping "${name}" window entirely`);
    // Set lastScrapeTime to window end so we skip the rest of this window
    const windowEndMs = new Date().setHours(config.end, 0, 0, 0);
    lastScrapeTime = new Date(windowEndMs);
    consecutiveEmptyScrapes = 0; // reset for next window
    return;
  }
```

**Step 3: Track empty scrapes in the success handler**

In the try block of `onTick()`, after `const result = await runPipelineOnce();`, modify the success handling:

```js
    // Success — reset failure counter, update stats
    consecutiveFailures = 0;

    // Track empty scrapes for backoff (rate-limiting detection)
    if (result.scraped === 0) {
      consecutiveEmptyScrapes++;
      logger.warn(MOD, `Empty scrape #${consecutiveEmptyScrapes} — backing off (next interval: ${Math.round(config.intervalMinutes * Math.min(Math.pow(2, consecutiveEmptyScrapes), 4))}m)`);
    } else {
      consecutiveEmptyScrapes = 0;
    }

    totalScrapesToday++;
    // ... rest unchanged
```

**Step 4: Add to getSchedulerStatus**

Add `consecutiveEmptyScrapes` and `backoffMultiplier` to the status object in `getSchedulerStatus()`:

```js
function getSchedulerStatus() {
  const { name, config } = getCurrentWindow();
  const next = getNextScrapeTime();
  const backoff = consecutiveEmptyScrapes > 0
    ? Math.min(Math.pow(2, consecutiveEmptyScrapes), 4)
    : 1;

  return {
    currentWindow: name,
    currentInterval: config.intervalMinutes,
    effectiveInterval: Math.round(config.intervalMinutes * backoff),
    backoffMultiplier: backoff,
    consecutiveEmptyScrapes,
    lastScrapeTime: lastScrapeTime ? lastScrapeTime.toISOString() : null,
    nextScrapeTime: next ? next.toISOString() : null,
    totalScrapesToday,
  };
}
```

**Step 5: Reset empty-scrape counter in daily reset**

Add to `onDailyReset()`:

```js
consecutiveEmptyScrapes = 0;
```

**Step 6: Verify scheduler status**

Run: `node -e "const s = require('./src/scheduler'); console.log(s.getSchedulerStatus());"`
Expected: Shows `effectiveInterval`, `backoffMultiplier: 1`, `consecutiveEmptyScrapes: 0`.

**Step 7: Commit**

```bash
git add src/scheduler.js
git commit -m "feat: exponential backoff on empty scrapes with window skip"
```

---

### Task 6: Run existing tests + manual verification

**Files:**
- No new files

**Step 1: Run existing unit tests**

Run: `npm test`
Expected: All 119 tests pass. (Scraper changes don't affect scoring/pattern tests.)

**Step 2: Run a manual scrape to verify end-to-end**

Run: `node scripts/test-fyp-scraper.js`
Expected:
- Log shows randomized UA (Chrome version) and viewport dimensions
- Videos scraped with video URLs and view counts
- Human-like scroll behavior visible in timing (some fast, some slow, occasional long pauses)
- If rate-limited (0 videos), that's OK — the stealth changes need a fresh IP reputation

**Step 3: Final commit with all changes**

If any loose changes remain:
```bash
git add -A
git commit -m "chore: anti-detection hardening complete"
```

**Step 4: Push to remote**

```bash
git push origin main
```
