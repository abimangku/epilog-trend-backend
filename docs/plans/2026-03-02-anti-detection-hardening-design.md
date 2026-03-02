# Anti-Detection Hardening Design

**Date:** 2026-03-02
**Goal:** Prevent TikTok bot identification, rate limiting, and IP bans
**Approach:** Option A — playwright-extra stealth plugin + schedule tuning + human behavior simulation
**Cost:** Zero ongoing cost

## Problem

The TikTok FYP scraper has several detection vulnerabilities:

- `navigator.webdriver` is `true` (Playwright default)
- ~15 other automation fingerprint signals exposed
- Static user agent, viewport, and scroll behavior
- Aggressive schedule: ~30 scrapes/day from single IP
- No backoff on rate limiting (already experienced during testing)
- Mechanical scroll pattern (`window.scrollBy(0, innerHeight)` every 3-5s)

## Design

### 1. Stealth Plugin Integration

Replace `playwright` import with `playwright-extra` + stealth plugin. Drop-in replacement with identical API.

New dependencies:
- `playwright-extra@^4.3.6`
- `puppeteer-extra-plugin-stealth@^2.11.2`

Change in `src/scrapers/tiktok.js`:
```js
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
```

Auto-patches: navigator.webdriver, chrome.runtime, permissions API, plugin/mimeType arrays, WebGL vendor/renderer, window.chrome, iframe contentWindow, UA consistency.

### 2. Schedule Tuning

Updated intervals in `src/scheduler.js`:

| Window | Old | New |
|--------|-----|-----|
| morning (05-08) | 30 min | 60 min |
| work (08-11) | 90 min | 90 min |
| lunch (11-14) | 30 min | 45 min |
| afternoon (14-18) | 60 min | 60 min |
| primetime (18-22) | 20 min | 60 min |
| latenight (22-00) | 45 min | 90 min |
| sleep (00-05) | 120 min | disabled |

Daily scrapes: ~30 -> ~14. Same trend intelligence, half the fingerprint.

**Jitter:** +/-30% random variance on each interval. Prevents clockwork patterns.

### 3. Human-Like Behavior

In `src/scrapers/tiktok.js` scroll loop:

**Variable scroll distance:**
- Normal: 60-130% of viewport height
- Small re-read scroll: 20-40% height (occasional)
- Slight upward scroll: ~10% chance

**Variable pause timing:**
- Normal: 2-5s
- "Watching" pause: 8-15s (~15% chance)
- Fast-scroll: 0.5-1.5s (~10% chance)

**User agent rotation:** Pool of 5 current Chrome UA strings (Chrome 132-136, macOS + Windows mix). Random pick per session.

**Viewport variation:** Random per session within 1260-1400px width, 780-900px height.

### 4. Error Handling & Rate Limit Recovery

**Scraper (`src/scrapers/tiktok.js`):**
- Early exit if 3 consecutive scroll attempts yield 0 new articles

**Scheduler (`src/scheduler.js`):**
- Track `consecutiveEmptyScrapes` separately from crash failures
- Backoff: `interval x min(2^consecutiveEmptyScrapes, 4)` — caps at 4x
- 3+ empty scrapes: skip to next time window
- Reset on first successful scrape
- Clear logging when backing off

## Files Changed

| File | Changes |
|------|---------|
| `package.json` | Add playwright-extra, stealth plugin deps |
| `src/scrapers/tiktok.js` | Stealth import, UA pool, viewport variance, human scroll behavior, early exit on stale scrolls |
| `src/scheduler.js` | Reduced intervals, jitter, sleep window disabled, empty-scrape backoff |

## What We Skip (for now)

- Residential proxy rotation (add later if IP gets blocked)
- Multiple browser profiles (overkill for ~14 scrapes/day)
- CAPTCHA solving service (stealth plugin should prevent triggers)
- Logged-in account rotation (we scrape as guest)
