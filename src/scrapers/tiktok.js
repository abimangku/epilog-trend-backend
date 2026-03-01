const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { calculateEngagementRate } = require('../scoring/engagement');

const MOD = 'SCRAPER';

// ---------------------------------------------------------------------------
// All TikTok DOM selectors in one place. Update here when TikTok changes DOM.
// ---------------------------------------------------------------------------
const SELECTORS = {
  // Explore page video cards
  videoCard: '[data-e2e="explore-item"], div[class*="DivItemContainer"], div[class*="video-feed-item"]',

  // Within a video card
  caption: '[data-e2e="explore-card-desc"], [data-e2e="video-desc"], div[class*="DivVideoCaption"] span',
  videoLink: 'a[href*="/video/"], a[href*="/@"]',
  author: '[data-e2e="explore-card-user-unique-id"], [data-e2e="video-author-uniqueid"], a[data-e2e="video-author-avatar"]',
  authorName: 'span[data-e2e="explore-card-user-unique-id"], span[class*="AuthorUniqueId"]',

  // Engagement metrics on cards
  views: '[data-e2e="explore-card-play-count"], strong[data-e2e="video-views"], span[class*="PlayCount"]',
  likes: '[data-e2e="explore-card-like-count"], strong[data-e2e="like-count"], span[class*="LikeCount"]',
  comments: '[data-e2e="explore-card-comment-count"], strong[data-e2e="comment-count"], span[class*="CommentCount"]',
  shares: '[data-e2e="explore-card-share-count"], strong[data-e2e="share-count"], span[class*="ShareCount"]',

  // Hashtags within caption
  hashtagLink: 'a[href*="/tag/"], a[data-e2e="search-common-link"]',

  // Audio
  audioLink: 'a[href*="/music/"], a[data-e2e="video-music"]',
  audioTitle: 'div[class*="MusicTitle"], [data-e2e="video-music"] span',

  // Explore page content container (wait target)
  exploreContainer: '[data-e2e="explore-item-list"], div[class*="DivExploreContainer"], main',
};

// ---------------------------------------------------------------------------
// Number parsing helper
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

  // Handle B (billions)
  const bMatch = upper.match(/^([\d.]+)\s*B$/);
  if (bMatch) {
    return Math.round(parseFloat(bMatch[1]) * 1_000_000_000) || 0;
  }

  // Handle M (millions)
  const mMatch = upper.match(/^([\d.]+)\s*M$/);
  if (mMatch) {
    return Math.round(parseFloat(mMatch[1]) * 1_000_000) || 0;
  }

  // Handle K (thousands)
  const kMatch = upper.match(/^([\d.]+)\s*K$/);
  if (kMatch) {
    return Math.round(parseFloat(kMatch[1]) * 1_000) || 0;
  }

  // Plain number
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

// ---------------------------------------------------------------------------
// TikTokScraper class
// ---------------------------------------------------------------------------

class TikTokScraper {
  /**
   * Creates a TikTokScraper instance.
   * Does not launch the browser — call init() first.
   */
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = process.env.SCRAPER_HEADLESS !== 'false';
    this.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
    this.viewport = { width: 1280, height: 800 };
    this.cookiesPath = path.join(process.cwd(), 'cookies', 'tiktok.json');
  }

  /**
   * Launches the browser, loads cookies, and warms the TikTok session.
   * Must be called before scrapeExplore().
   *
   * Side effects: creates cookies/ directory, writes cookie file,
   * launches a Chromium process.
   */
  async init() {
    // Ensure cookies directory exists
    const cookiesDir = path.dirname(this.cookiesPath);
    await fs.promises.mkdir(cookiesDir, { recursive: true });

    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins',
        '--disable-dev-shm-usage',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent: this.userAgent,
      viewport: this.viewport,
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    });

    // Load saved cookies if they exist
    try {
      const cookieData = await fs.promises.readFile(this.cookiesPath, 'utf8');
      const cookies = JSON.parse(cookieData);
      if (Array.isArray(cookies) && cookies.length > 0) {
        await this.context.addCookies(cookies);
        logger.log(MOD, `Loaded ${cookies.length} cookies from ${this.cookiesPath}`);
      }
    } catch {
      logger.log(MOD, 'No saved cookies found — starting fresh session');
    }

    this.page = await this.context.newPage();

    // Warm the session by visiting TikTok home
    try {
      await this.page.goto('https://www.tiktok.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await this.page.waitForTimeout(2000);
      await this._saveCookies();
      logger.log(MOD, 'Scraper initialized');
    } catch (err) {
      logger.warn(MOD, 'TikTok home page load slow — continuing anyway', err);
    }
  }

  /**
   * Scrapes the TikTok Explore page for trending videos.
   *
   * Navigates to /explore, scrolls to load content, extracts video metadata
   * from each card. Times out after 60 seconds and returns whatever was
   * collected so far.
   *
   * @param {number} [maxVideos=50] - Maximum videos to extract
   * @returns {Promise<object[]>} Array of video objects with engagement metrics
   */
  async scrapeExplore(maxVideos = 50) {
    const results = [];
    const startTime = Date.now();
    const TIMEOUT_MS = 60000;

    try {
      logger.log(MOD, `Starting explore scrape (max ${maxVideos} videos)`);

      await this.page.goto('https://www.tiktok.com/explore', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for content to appear
      try {
        await this.page.waitForSelector(SELECTORS.videoCard, { timeout: 15000 });
      } catch {
        logger.warn(MOD, 'Video cards not found with primary selector — trying fallback wait');
        await this.page.waitForTimeout(5000);
      }

      // Scroll down slowly 3 times to load more content (simulate human)
      for (let i = 0; i < 3; i++) {
        if (Date.now() - startTime > TIMEOUT_MS) break;
        await this.page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await this.page.waitForTimeout(2000 + Math.random() * 1000);
      }

      // Collect all video card elements
      const cards = await this.page.$$(SELECTORS.videoCard);
      logger.log(MOD, `Found ${cards.length} video cards on explore page`);

      for (const card of cards) {
        // Check timeout
        if (Date.now() - startTime > TIMEOUT_MS) {
          logger.warn(MOD, `Timeout reached — returning ${results.length} videos collected so far`);
          break;
        }

        // Check max videos
        if (results.length >= maxVideos) break;

        try {
          const video = await this._extractVideoData(card);
          if (video && video.url) {
            results.push(video);
          }
        } catch (err) {
          logger.warn(MOD, 'Failed to extract video card — skipping', err);
        }

        // Random delay between card parsing (1-3 seconds)
        await this.page.waitForTimeout(1000 + Math.random() * 2000);
      }

      await this._saveCookies();
      logger.log(MOD, `Scrape complete: ${results.length} videos extracted`);

    } catch (err) {
      logger.error(MOD, 'Explore scrape failed', err);
    }

    return results;
  }

  /**
   * Extracts video metadata from a single video card element.
   *
   * @param {import('playwright').ElementHandle} card - A video card DOM element
   * @returns {Promise<object|null>} Video data object or null if extraction fails
   * @private
   */
  async _extractVideoData(card) {
    // --- URL ---
    const linkEl = await card.$(SELECTORS.videoLink);
    const rawHref = linkEl ? await linkEl.getAttribute('href') : null;
    if (!rawHref) return null;
    const url = rawHref.startsWith('http') ? rawHref : `https://www.tiktok.com${rawHref}`;

    // --- Title / Caption ---
    const title = await this._getTextContent(card, SELECTORS.caption) || '';

    // --- Author ---
    let author = await this._getTextContent(card, SELECTORS.authorName) || '';
    if (!author && rawHref) {
      // Try to extract from URL: /@username/video/...
      const authorMatch = rawHref.match(/@([^/]+)/);
      if (authorMatch) author = authorMatch[1];
    }

    // --- Engagement metrics ---
    const viewsStr = await this._getTextContent(card, SELECTORS.views);
    const likesStr = await this._getTextContent(card, SELECTORS.likes);
    const commentsStr = await this._getTextContent(card, SELECTORS.comments);
    const sharesStr = await this._getTextContent(card, SELECTORS.shares);

    const views = parseNumber(viewsStr);
    const likes = parseNumber(likesStr);
    const comments = parseNumber(commentsStr);
    const shares = parseNumber(sharesStr);

    // --- Hashtags ---
    const hashtagEls = await card.$$(SELECTORS.hashtagLink);
    const hashtags = [];
    for (const el of hashtagEls) {
      const text = await el.textContent().catch(() => null);
      if (text) {
        const cleaned = text.trim().replace(/^#/, '');
        if (cleaned) hashtags.push(cleaned);
      }
    }

    // --- Audio ---
    const audioLinkEl = await card.$(SELECTORS.audioLink);
    let audioId = '';
    let audioTitle = '';
    if (audioLinkEl) {
      const audioHref = await audioLinkEl.getAttribute('href').catch(() => '');
      if (audioHref) {
        // Extract audio ID from URL: /music/song-name-1234567890
        const audioMatch = audioHref.match(/music\/.*?(\d+)(?:\?|$)/);
        if (audioMatch) audioId = audioMatch[1];
      }
      audioTitle = await this._getTextContent(card, SELECTORS.audioTitle) || '';
    }

    // --- Computed fields ---
    const engagementRate = calculateEngagementRate(likes, comments, shares, views);
    const hash = crypto
      .createHash('sha256')
      .update(`tiktok|${url}|${title}`)
      .digest('hex');

    return {
      platform: 'tiktok',
      title,
      url,
      author,
      author_tier: 'unknown', // follower count rarely visible on explore cards
      views,
      likes,
      comments,
      shares,
      hashtags,
      audio_id: audioId,
      audio_title: audioTitle,
      engagement_rate: Math.round(engagementRate * 100) / 100,
      velocity_score: 0, // calculated later from snapshots
      replication_count: 0, // calculated later from batch analysis
      lifecycle_stage: 'emerging', // default for new scrapes
      momentum: 0, // calculated later from snapshots
      scraped_at: new Date().toISOString(),
      hash,
    };
  }

  /**
   * Safely gets text content from the first matching selector within a parent.
   *
   * @param {import('playwright').ElementHandle} parent - Parent element to search within
   * @param {string} selector - CSS selector string
   * @returns {Promise<string|null>} Trimmed text content or null
   * @private
   */
  async _getTextContent(parent, selector) {
    try {
      const el = await parent.$(selector);
      if (!el) return null;
      const text = await el.textContent();
      return text ? text.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Saves current browser cookies to disk for session persistence.
   * @private
   */
  async _saveCookies() {
    try {
      const cookies = await this.context.cookies();
      await fs.promises.writeFile(
        this.cookiesPath,
        JSON.stringify(cookies, null, 2),
        'utf8'
      );
    } catch (err) {
      logger.warn(MOD, 'Failed to save cookies', err);
    }
  }

  /**
   * Closes the browser and cleans up resources.
   * Always call this after scraping, even if errors occurred.
   */
  async close() {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.context = null;
        this.page = null;
        logger.log(MOD, 'Browser closed');
      }
    } catch (err) {
      logger.error(MOD, 'Error closing browser', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience function for one-off scrapes
// ---------------------------------------------------------------------------

/**
 * Convenience function that creates a scraper, initializes, scrapes, and closes.
 * Used by `npm run scrape`.
 *
 * @param {number} [maxVideos=50] - Maximum videos to scrape
 * @returns {Promise<object[]>} Array of scraped video objects
 */
async function scrapeOnce(maxVideos = 50) {
  const scraper = new TikTokScraper();
  try {
    await scraper.init();
    const results = await scraper.scrapeExplore(maxVideos);
    logger.log(MOD, `scrapeOnce complete: ${results.length} videos`);
    return results;
  } catch (err) {
    logger.error(MOD, 'scrapeOnce failed', err);
    return [];
  } finally {
    await scraper.close();
  }
}

module.exports = {
  TikTokScraper,
  scrapeOnce,
  parseNumber,
  SELECTORS,
};
