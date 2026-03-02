/**
 * TikTok FYP Scraper — scrolls the For You Page, extracts video metadata,
 * captures screenshots, and returns structured data for the AI pipeline.
 *
 * Video data is extracted from TikTok's JS state ($PREFETCH_CACHE and
 * __UNIVERSAL_DATA_FOR_REHYDRATION__) plus API response interception during
 * scroll. This gives us video IDs for direct URLs AND view counts (playCount)
 * — neither of which are available in the DOM.
 *
 * DOM scraping is used only for taking screenshots and as a fallback for
 * engagement metrics when JS state data is unavailable.
 *
 * @module scrapers/tiktok
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const MOD = 'SCRAPER';

// ---------------------------------------------------------------------------
// All TikTok FYP DOM selectors in one place.
// Last verified: 2026-03-02 against live TikTok FYP (tiktok.com, locale id-ID).
//
// NOTE: The FYP DOM does NOT contain direct video links (a[href*="/video/"]).
// Video IDs and view counts come from JS state + API interception instead.
// ---------------------------------------------------------------------------
const SELECTORS = {
  // Each video on the FYP is an <article> with this data-e2e attribute
  videoArticle: '[data-e2e="recommend-list-item-container"]',

  // Caption/description container within the article
  videoDesc: '[data-e2e="video-desc"]',

  // Hashtag links within the description
  hashtagLink: 'a[data-e2e="search-common-link"]',

  // Author avatar link — href is /@username
  authorAvatar: 'a[data-e2e="video-author-avatar"]',

  // Engagement metrics (within each article)
  likes: 'strong[data-e2e="like-count"]',
  comments: 'strong[data-e2e="comment-count"]',
  shares: 'strong[data-e2e="share-count"]',
  bookmarks: 'strong[data-e2e="undefined-count"]',

  // Music link — href contains /music/{title}-{id}
  musicLink: 'a[data-e2e="video-music"]',
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CONFIG = {
  maxVideos: 40,
  timeoutMs: 90000,
  scrollPauseMinMs: 3000,
  scrollPauseMaxMs: 5000,
  pageLoadWaitMs: 8000,
  screenshotDir: path.join(process.cwd(), 'screenshots'),
  cookiePath: path.join(process.cwd(), 'cookies', 'tiktok.json'),
};

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses TikTok's abbreviated number strings into integers.
 * Handles: '1.2M' -> 1200000, '500K' -> 500000, '1,234' -> 1234, '5432' -> 5432
 *
 * @param {string} str - Raw number string from TikTok DOM
 * @returns {number} Parsed integer, 0 if parsing fails
 */
function parseNumber(str) {
  if (!str) return 0;

  const cleaned = str.trim().replace(/,/g, '');
  if (!cleaned) return 0;

  const upper = cleaned.toUpperCase();

  const bMatch = upper.match(/^([\d.]+)\s*B$/);
  if (bMatch) return Math.round(parseFloat(bMatch[1]) * 1_000_000_000) || 0;

  const mMatch = upper.match(/^([\d.]+)\s*M$/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000) || 0;

  const kMatch = upper.match(/^([\d.]+)\s*K$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000) || 0;

  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Generates a SHA256 hash of a video URL for unique identification.
 * @param {string} url - Video URL
 * @returns {string} 16-char hex hash
 */
function videoHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * Extracts hashtags from caption text.
 * @param {string} text - Caption text
 * @returns {string[]} Array of hashtags (with # prefix)
 */
function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  return matches || [];
}

/**
 * Parses music info from a TikTok music URL path.
 * E.g. "/music/suara-asli-DirgaYETE-7569941368613686034" -> { title: "suara asli DirgaYETE", id: "7569941368613686034" }
 *
 * @param {string} href - Music link href
 * @returns {{ title: string, id: string }}
 */
function parseMusicHref(href) {
  if (!href) return { title: '', id: '' };
  const match = href.match(/\/music\/(.+)-(\d+)$/);
  if (!match) return { title: '', id: '' };
  const title = match[1].replace(/-/g, ' ');
  const id = match[2];
  return { title, id };
}

/**
 * Returns a random integer between min and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

/**
 * Scrapes TikTok's For You Page (FYP). Extracts video metadata from TikTok's
 * JS state and API responses, scrolls through the feed, and captures screenshots.
 *
 * Data extraction strategy:
 * 1. JS state ($PREFETCH_CACHE + rehydration) provides initial video items
 *    with IDs, authors, captions, AND view counts.
 * 2. API response interception captures new video items loaded during scroll.
 * 3. DOM scraping provides screenshots and fallback engagement metrics.
 *
 * @param {object} [options={}]
 * @param {number} [options.maxVideos=40] - Max videos to scrape
 * @param {number} [options.timeoutMs=90000] - Total timeout in ms
 * @returns {Promise<{ videos: object[], screenshots: object[] }>}
 */
async function scrapeOnce(options = {}) {
  const maxVideos = options.maxVideos || CONFIG.maxVideos;
  const timeoutMs = options.timeoutMs || CONFIG.timeoutMs;
  const startTime = Date.now();

  const videos = [];
  const screenshots = [];
  const seenVideoIds = new Set();

  // JS video items collected from state + API interception
  const jsVideoItems = [];

  // Ensure screenshots directory exists
  await fs.promises.mkdir(CONFIG.screenshotDir, { recursive: true });

  logger.log(MOD, `Starting FYP scrape (max=${maxVideos}, timeout=${timeoutMs}ms)`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    const selectedUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const vpWidth = randomDelay(VIEWPORT_RANGE.widthMin, VIEWPORT_RANGE.widthMax);
    const vpHeight = randomDelay(VIEWPORT_RANGE.heightMin, VIEWPORT_RANGE.heightMax);
    const chromeVer = (selectedUA.match(/Chrome\/([\d.]+)/) || [])[1] || 'unknown';
    logger.log(MOD, `Session fingerprint: Chrome/${chromeVer}, viewport=${vpWidth}x${vpHeight}`);

    const context = await browser.newContext({
      userAgent: selectedUA,
      viewport: { width: vpWidth, height: vpHeight },
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    });

    // Load cookies for session persistence
    await _loadCookies(context);

    const page = await context.newPage();

    // --- API Response Interception ---
    // Capture video items from TikTok's feed API responses during scroll.
    // The API returns JSON with an itemList array of video items.
    page.on('response', async (response) => {
      try {
        const url = response.url();
        // Match TikTok's recommend/feed API endpoints
        if (url.includes('/api/recommend/item_list') ||
            url.includes('/api/post/item_list') ||
            (url.includes('recommend') && url.includes('item_list'))) {
          const contentType = response.headers()['content-type'] || '';
          if (!contentType.includes('json')) return;

          const body = await response.json();
          if (body && Array.isArray(body.itemList)) {
            for (const item of body.itemList) {
              const normalized = _normalizeApiItem(item);
              if (normalized) {
                jsVideoItems.push(normalized);
              }
            }
            logger.log(MOD, `Intercepted ${body.itemList.length} items from API (total: ${jsVideoItems.length})`);
          }
        }
      } catch {
        // Ignore non-JSON responses or parse errors
      }
    });

    // Navigate to FYP
    logger.log(MOD, 'Navigating to tiktok.com (FYP)...');
    await page.goto('https://www.tiktok.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for content to load
    await page.waitForTimeout(CONFIG.pageLoadWaitMs);

    // Wait for at least one video article to appear
    try {
      await page.waitForSelector(SELECTORS.videoArticle, { timeout: 15000 });
    } catch {
      logger.warn(MOD, 'No video articles found after waiting — page may have changed');
      await _saveCookies(context);
      return { videos, screenshots };
    }

    // --- Extract initial video data from JS state ---
    const initialItems = await _extractVideoItemsFromJsState(page);
    jsVideoItems.push(...initialItems);
    logger.log(MOD, `Extracted ${initialItems.length} items from JS state (total: ${jsVideoItems.length})`);

    logger.log(MOD, 'FYP loaded, beginning scroll extraction...');

    // --- Scroll, screenshot, and match loop ---
    let scrollAttempts = 0;
    const maxScrollAttempts = maxVideos * 3; // safety limit
    // Track which JS items we've already consumed, by index
    const jsItemConsumedSet = new Set();
    // Track which DOM articles we've already processed (by articleId)
    const seenArticleIds = new Set();

    while (videos.length < maxVideos && scrollAttempts < maxScrollAttempts) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        logger.log(MOD, `Timeout reached (${timeoutMs}ms) — stopping with ${videos.length} videos`);
        break;
      }

      scrollAttempts++;

      // Extract visible DOM articles (for screenshots + fallback metrics)
      const articleData = await _extractVisibleArticles(page);

      for (const article of articleData) {
        if (videos.length >= maxVideos) break;
        if (!article.authorUsername) continue;

        // Skip DOM articles we've already processed (visible across multiple scrolls)
        const articleKey = article.articleId || (article.authorUsername + '|' + article.caption);
        if (seenArticleIds.has(articleKey)) continue;
        seenArticleIds.add(articleKey);

        // --- Match DOM article to JS video item ---
        const jsMatch = _findBestJsMatch(
          jsVideoItems, jsItemConsumedSet,
          article.authorUsername, article.caption
        );

        let videoUrl;
        let videoViews = 0;
        let videoLikes = article.likes;
        let videoComments = article.comments;
        let videoShares = article.shares;
        let videoBookmarks = article.bookmarks;

        if (jsMatch) {
          // Use JS-extracted data: video URL with ID + real view count
          videoUrl = `https://www.tiktok.com/@${jsMatch.author}/video/${jsMatch.videoId}`;
          videoViews = jsMatch.views || 0;
          // Prefer JS stats when available (they're exact, not abbreviated)
          if (jsMatch.likes > 0) videoLikes = jsMatch.likes;
          if (jsMatch.comments > 0) videoComments = jsMatch.comments;
          if (jsMatch.shares > 0) videoShares = jsMatch.shares;
          if (jsMatch.bookmarks > 0) videoBookmarks = jsMatch.bookmarks;
        } else {
          // Fallback: profile URL (no video ID available)
          videoUrl = `https://www.tiktok.com/@${article.authorUsername}`;
          logger.warn(MOD, `No JS match for ${article.authorUsername} — using profile URL`);
        }

        // Dedup by video URL
        const dedupKey = videoUrl.includes('/video/')
          ? videoUrl
          : videoUrl + '|' + (article.caption || '');
        if (seenVideoIds.has(dedupKey)) continue;
        seenVideoIds.add(dedupKey);

        // Take screenshot of the article
        let screenshotPath = null;
        try {
          const hash = videoHash(videoUrl);
          screenshotPath = path.join(CONFIG.screenshotDir, `${hash}.png`);
          const articleEl = article.articleId
            ? await page.$(`#${article.articleId}`)
            : null;
          if (articleEl) {
            await articleEl.screenshot({ path: screenshotPath });
          } else {
            await page.screenshot({ path: screenshotPath, fullPage: false });
          }
        } catch (ssErr) {
          logger.warn(MOD, `Screenshot failed for ${article.authorUsername}`, ssErr);
          screenshotPath = null;
        }

        const hashtags = extractHashtags(article.caption);
        const music = parseMusicHref(article.musicHref);

        const video = {
          platform: 'tiktok',
          url: videoUrl,
          title: article.caption || `Video by ${article.authorUsername}`,
          author: article.authorUsername || 'unknown',
          author_tier: 'unknown',
          views: videoViews,
          likes: videoLikes,
          comments: videoComments,
          shares: videoShares,
          bookmarks: videoBookmarks,
          hashtags,
          audio_id: music.id,
          audio_title: music.title,
          scraped_at: new Date().toISOString(),
          screenshot_path: screenshotPath,
        };

        videos.push(video);

        if (screenshotPath) {
          screenshots.push({
            video_url: videoUrl,
            path: screenshotPath,
          });
        }
      }

      // Scroll down to load more videos
      const delay = randomDelay(CONFIG.scrollPauseMinMs, CONFIG.scrollPauseMaxMs);
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(delay);
    }

    // Save cookies for next session
    await _saveCookies(context);

    const videoUrlCount = videos.filter((v) => v.url.includes('/video/')).length;
    const viewsCount = videos.filter((v) => v.views > 0).length;
    logger.log(MOD, `FYP scrape complete: ${videos.length} videos, ${videoUrlCount} with video URLs, ${viewsCount} with views, ${screenshots.length} screenshots`);

  } catch (err) {
    logger.error(MOD, 'FYP scrape failed', err);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore close errors
      }
    }
  }

  return { videos, screenshots };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts video items from TikTok's JS state on the page.
 * Reads from two sources:
 * 1. $PREFETCH_CACHE.recommendItemList — prefetched feed items
 * 2. __UNIVERSAL_DATA_FOR_REHYDRATION__['webapp.updated-items'] — SSR items
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<object[]>} Normalized video items
 */
async function _extractVideoItemsFromJsState(page) {
  const rawItems = await page.evaluate(async () => {
    const items = [];

    // Source 1: $PREFETCH_CACHE.recommendItemList
    try {
      const cache = window.$PREFETCH_CACHE;
      if (cache && cache.recommendItemList) {
        let data = cache.recommendItemList.result;
        // Might be a Promise
        if (data && typeof data.then === 'function') {
          data = await data;
        }
        if (data && Array.isArray(data.itemList)) {
          for (const item of data.itemList) {
            if (item && item.id && item.author) {
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
              });
            }
          }
        }
      }
    } catch {
      // Prefetch cache unavailable
    }

    // Source 2: __UNIVERSAL_DATA_FOR_REHYDRATION__
    try {
      const el = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (el) {
        const data = JSON.parse(el.textContent || '{}');
        const scope = data['__DEFAULT_SCOPE__'];
        if (scope) {
          const updatedItems = scope['webapp.updated-items'];
          if (updatedItems && typeof updatedItems === 'object') {
            for (const key of Object.keys(updatedItems)) {
              const item = updatedItems[key];
              if (item && item.id && item.author) {
                items.push({
                  source: 'rehydration',
                  videoId: item.id,
                  author: item.author.uniqueId || '',
                  desc: item.desc || '',
                  views: (item.stats && item.stats.playCount) || 0,
                  likes: (item.stats && item.stats.diggCount) || 0,
                  comments: (item.stats && item.stats.commentCount) || 0,
                  shares: (item.stats && item.stats.shareCount) || 0,
                  bookmarks: parseInt(item.stats && item.stats.collectCount, 10) || 0,
                });
              }
            }
          }
        }
      }
    } catch {
      // Rehydration data unavailable
    }

    return items;
  });

  // Normalize bookmarks (rehydration sometimes returns strings)
  return rawItems.map((item) => ({
    ...item,
    bookmarks: typeof item.bookmarks === 'string' ? parseInt(item.bookmarks, 10) || 0 : item.bookmarks,
  }));
}

/**
 * Normalizes a video item from TikTok's API response.
 * API items have the same structure as $PREFETCH_CACHE items.
 *
 * @param {object} item - Raw API item
 * @returns {object|null} Normalized video item, or null if invalid
 */
function _normalizeApiItem(item) {
  if (!item || !item.id || !item.author) return null;
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
  };
}

/**
 * Finds the best matching JS video item for a DOM article.
 * Matches primarily by author username, then by caption similarity.
 * Marks consumed items to prevent double-matching.
 *
 * @param {object[]} jsItems - All collected JS video items
 * @param {Set} consumedSet - Set of already-consumed item indices
 * @param {string} authorUsername - Author from DOM article
 * @param {string} caption - Caption text from DOM article
 * @returns {object|null} Matched JS item, or null if no match
 */
function _findBestJsMatch(jsItems, consumedSet, authorUsername, caption) {
  if (!authorUsername) return null;

  // Clean author for matching (DOM may have leading @ or extra whitespace)
  const cleanAuthor = authorUsername.replace(/^@/, '').trim().toLowerCase();
  const cleanCaption = (caption || '').trim().toLowerCase();

  // Find all unconsumed items by same author
  const candidates = [];
  for (let i = 0; i < jsItems.length; i++) {
    if (consumedSet.has(i)) continue;
    const itemAuthor = (jsItems[i].author || '').toLowerCase();
    if (itemAuthor === cleanAuthor) {
      candidates.push({ index: i, item: jsItems[i] });
    }
  }

  if (candidates.length === 0) return null;

  // If only one candidate, use it
  if (candidates.length === 1) {
    consumedSet.add(candidates[0].index);
    return candidates[0].item;
  }

  // Multiple candidates by same author — match by caption similarity
  let bestMatch = candidates[0];
  let bestScore = 0;

  for (const c of candidates) {
    const itemCaption = (c.item.desc || '').trim().toLowerCase();
    // Simple similarity: count matching words
    const captionWords = cleanCaption.split(/\s+/).filter(Boolean);
    const itemWords = new Set(itemCaption.split(/\s+/).filter(Boolean));
    let matchingWords = 0;
    for (const w of captionWords) {
      if (itemWords.has(w)) matchingWords++;
    }
    const score = captionWords.length > 0 ? matchingWords / captionWords.length : 0;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = c;
    }
  }

  consumedSet.add(bestMatch.index);
  return bestMatch.item;
}

/**
 * Extracts data from all currently visible article elements on the page.
 * Used for screenshots and fallback engagement metrics.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<object[]>}
 */
async function _extractVisibleArticles(page) {
  return page.evaluate((sel) => {
    const articles = document.querySelectorAll(sel.videoArticle);
    const results = [];

    for (const article of articles) {
      try {
        // Author — first <a href="/@username"> with text content
        const authorLinks = article.querySelectorAll('a[href^="/@"]');
        let authorUsername = '';
        for (const link of authorLinks) {
          const text = (link.textContent || '').trim();
          if (text && text.length > 0) {
            authorUsername = text;
            break;
          }
        }
        // Fallback: extract from href
        if (!authorUsername) {
          const avatarLink = article.querySelector(sel.authorAvatar);
          if (avatarLink) {
            const href = avatarLink.getAttribute('href') || '';
            authorUsername = href.replace('/@', '');
          }
        }

        // Caption
        const descEl = article.querySelector(sel.videoDesc);
        const caption = descEl ? (descEl.textContent || '').trim() : '';

        // Engagement metrics (fallback — JS state provides exact numbers)
        const likesEl = article.querySelector(sel.likes);
        const commentsEl = article.querySelector(sel.comments);
        const sharesEl = article.querySelector(sel.shares);
        const bookmarksEl = article.querySelector(sel.bookmarks);

        const likesText = likesEl ? likesEl.textContent.trim() : '0';
        const commentsText = commentsEl ? commentsEl.textContent.trim() : '0';
        const sharesText = sharesEl ? sharesEl.textContent.trim() : '0';
        const bookmarksText = bookmarksEl ? bookmarksEl.textContent.trim() : '0';

        // Music
        const musicEl = article.querySelector(sel.musicLink);
        const musicHref = musicEl ? musicEl.getAttribute('href') || '' : '';

        results.push({
          articleId: article.id || '',
          authorUsername,
          caption,
          likesText,
          commentsText,
          sharesText,
          bookmarksText,
          musicHref,
        });
      } catch {
        // Skip broken articles
      }
    }

    return results;
  }, SELECTORS).then((rawArticles) => {
    // Parse numbers outside of page.evaluate (we have parseNumber in Node context)
    return rawArticles.map((a) => ({
      ...a,
      likes: parseNumber(a.likesText),
      comments: parseNumber(a.commentsText),
      shares: parseNumber(a.sharesText),
      bookmarks: parseNumber(a.bookmarksText),
    }));
  });
}

/**
 * Loads saved cookies from disk into the browser context.
 * @param {import('playwright').BrowserContext} context
 */
async function _loadCookies(context) {
  try {
    const cookieData = await fs.promises.readFile(CONFIG.cookiePath, 'utf8');
    const cookies = JSON.parse(cookieData);
    if (Array.isArray(cookies) && cookies.length > 0) {
      await context.addCookies(cookies);
      logger.log(MOD, `Loaded ${cookies.length} cookies`);
    }
  } catch {
    logger.log(MOD, 'No saved cookies found — starting fresh session');
  }
}

/**
 * Saves current cookies to disk for session persistence.
 * @param {import('playwright').BrowserContext} context
 */
async function _saveCookies(context) {
  try {
    const cookies = await context.cookies();
    const cookieDir = path.dirname(CONFIG.cookiePath);
    await fs.promises.mkdir(cookieDir, { recursive: true });
    await fs.promises.writeFile(CONFIG.cookiePath, JSON.stringify(cookies, null, 2));
    logger.log(MOD, `Saved ${cookies.length} cookies`);
  } catch (err) {
    logger.warn(MOD, 'Failed to save cookies', err);
  }
}

module.exports = { scrapeOnce, parseNumber, SELECTORS };
