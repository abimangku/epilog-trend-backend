const logger = require('../logger');

const MOD = 'HEALTH_CHECK';

/**
 * Checks if key TikTok FYP selectors are present in the DOM.
 * Launches a headless browser, navigates to TikTok, verifies selectors exist.
 *
 * @param {object} [deps] - Injectable dependencies for testing
 * @param {Function} [deps.createPipelineEvent] - Event logger
 * @param {Function} [deps.alertSelectorHealth] - Slack alert for selector failures
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
      if (deps.alertSelectorHealth) {
        try {
          await deps.alertSelectorHealth(msg);
        } catch (slackErr) {
          logger.warn(MOD, `Failed to send selector health Slack alert: ${slackErr.message}`);
        }
      }
      return { ok: false, details: msg };
    }

    const successMsg = `${articles.length} articles found`;
    logger.log(MOD, `Health check passed: ${successMsg}`);
    if (deps.createPipelineEvent) {
      try {
        await deps.createPipelineEvent(null, 'selector_health_ok', 'info', successMsg);
      } catch (eventErr) {
        logger.warn(MOD, `Failed to write selector health event: ${eventErr.message}`);
      }
    }
    return { ok: true, details: successMsg };
  } catch (err) {
    const msg = `Health check failed: ${err.message}`;
    logger.error(MOD, msg, err);
    if (deps.createPipelineEvent) {
      await deps.createPipelineEvent(null, 'health_check', 'critical', msg);
    }
    if (deps.alertSelectorHealth) {
      try {
        await deps.alertSelectorHealth(msg);
      } catch (slackErr) {
        logger.warn(MOD, `Failed to send selector health Slack alert: ${slackErr.message}`);
      }
    }
    return { ok: false, details: msg };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { checkSelectors };
