/**
 * TikTok FYP Scraper — scrolls the For You Page, extracts video metadata,
 * captures screenshots, and returns structured data for the AI pipeline.
 *
 * FYP shows likes, comments, bookmarks, and shares inline for every video.
 * Views are NOT shown on FYP — we set views to 0 and rely on other metrics.
 *
 * @module scrapers/tiktok
 */

const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const MOD = 'SCRAPER';

// ---------------------------------------------------------------------------
// All TikTok FYP DOM selectors in one place.
// Last verified: 2026-03-01 against live TikTok FYP (tiktok.com, locale id-ID).
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

  // Direct link to the video page — href is /@username/video/{id}
  videoLink: 'a[href*="/video/"]',

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
 * Scrapes TikTok's For You Page (FYP). Scrolls through the feed,
 * extracts video metadata, and captures screenshots.
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
  const seenUrls = new Set();

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
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    });

    // Load cookies for session persistence
    await _loadCookies(context);

    const page = await context.newPage();

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

    logger.log(MOD, 'FYP loaded, beginning scroll extraction...');

    // Scroll and extract loop
    let scrollAttempts = 0;
    const maxScrollAttempts = maxVideos * 3; // safety limit

    while (videos.length < maxVideos && scrollAttempts < maxScrollAttempts) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        logger.log(MOD, `Timeout reached (${timeoutMs}ms) — stopping with ${videos.length} videos`);
        break;
      }

      scrollAttempts++;

      // Extract all currently visible articles
      const articleData = await _extractVisibleArticles(page);

      for (const article of articleData) {
        if (videos.length >= maxVideos) break;

        // Build video URL — prefer direct video link, fall back to profile
        let videoUrl = null;
        if (article.videoPath && article.videoPath.includes('/video/')) {
          // Handle both relative (/@ ...) and absolute (https://...) hrefs
          if (article.videoPath.startsWith('http')) {
            videoUrl = article.videoPath;
          } else {
            videoUrl = `https://www.tiktok.com${article.videoPath}`;
          }
        } else if (article.authorUsername) {
          videoUrl = `https://www.tiktok.com/@${article.authorUsername}`;
        }

        // Dedup: video URLs are unique; profile URLs need caption suffix
        const dedupKey = videoUrl && videoUrl.includes('/video/')
          ? videoUrl
          : videoUrl + '|' + (article.caption || '');
        if (!videoUrl || seenUrls.has(dedupKey)) continue;
        seenUrls.add(dedupKey);

        // Take screenshot of the article
        let screenshotPath = null;
        try {
          const hash = videoHash(videoUrl);
          screenshotPath = path.join(CONFIG.screenshotDir, `${hash}.png`);
          const articleEl = await page.$(
            `#${article.articleId}`
          );
          if (articleEl) {
            await articleEl.screenshot({ path: screenshotPath });
          } else {
            // Fallback: full page screenshot
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
          views: 0, // FYP does not show view counts
          likes: article.likes,
          comments: article.comments,
          shares: article.shares,
          bookmarks: article.bookmarks,
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

    logger.log(MOD, `FYP scrape complete: ${videos.length} videos, ${screenshots.length} screenshots`);

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
 * Extracts data from all currently visible article elements on the page.
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

        // Video URL — direct link to /@username/video/{id}
        const videoLinkEl = article.querySelector(sel.videoLink);
        let videoPath = '';
        if (videoLinkEl) {
          const rawHref = videoLinkEl.getAttribute('href') || '';
          // Validate: must contain /video/ followed by digits
          if (/\/video\/\d+/.test(rawHref)) {
            videoPath = rawHref;
          }
        }

        // Caption
        const descEl = article.querySelector(sel.videoDesc);
        const caption = descEl ? (descEl.textContent || '').trim() : '';

        // Engagement metrics
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
          videoPath,
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
