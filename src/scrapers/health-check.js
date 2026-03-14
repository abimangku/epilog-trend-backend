const logger = require('../logger');

const MOD = 'HEALTH_CHECK';

/**
 * Checks if key TikTok FYP selectors are present in the DOM.
 * Launches a headless browser, navigates to TikTok, verifies selectors exist.
 *
 * @param {object} [deps] - Injectable dependencies for testing
 * @param {Function} [deps.createPipelineEvent] - Event logger
 * @returns {Promise<{ ok: boolean, details: string }>}
 */
async function checkSelectors(deps = {}) {
  let browser = null;

  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    });
    const page = await context.newPage();

    await page.goto('https://www.tiktok.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for video articles to appear
    const articles = await page.$$('article, [data-e2e="recommend-list-item-container"]');

    if (articles.length === 0) {
      const msg = 'No video articles found in FYP DOM — selectors may be broken';
      logger.error(MOD, msg);
      if (deps.createPipelineEvent) {
        await deps.createPipelineEvent(null, 'health_check', 'critical', msg);
      }
      return { ok: false, details: msg };
    }

    logger.log(MOD, `Health check passed: ${articles.length} articles found`);
    return { ok: true, details: `${articles.length} articles found` };
  } catch (err) {
    const msg = `Health check failed: ${err.message}`;
    logger.error(MOD, msg, err);
    if (deps.createPipelineEvent) {
      await deps.createPipelineEvent(null, 'health_check', 'critical', msg);
    }
    return { ok: false, details: msg };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { checkSelectors };
