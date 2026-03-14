/**
 * Slack webhook notifications for trend alerts, scraper health, and daily briefs.
 * All functions are fire-and-forget — Slack failures never crash the pipeline.
 */

const axios = require('axios');
const logger = require('../logger');

const MOD = 'SLACK';
const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

if (!WEBHOOK_URL) {
  logger.warn(MOD, 'SLACK_WEBHOOK_URL not set — all Slack notifications will be skipped');
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Posts a message payload to the Slack webhook.
 * Returns true on success, false on failure. Never throws.
 *
 * @param {object} payload - Slack message payload ({ text } or { text, blocks })
 * @returns {Promise<boolean>}
 */
async function post(payload) {
  if (!WEBHOOK_URL) return false;

  try {
    await axios.post(WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    return true;
  } catch (err) {
    logger.error(MOD, 'Failed to send Slack message', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// notifyActNow
// ---------------------------------------------------------------------------

/**
 * Sends a high-urgency trend alert to Slack.
 *
 * Only sends if at least one brand fit has confidence > 65%.
 * If brandFits is empty or missing, sends without the client match section.
 *
 * @param {object} trend - Enriched trend object from the pipeline
 * @param {Array<{client_name: string, brand_entry_confidence: number, entry_angle: string}>} [brandFits=[]]
 * @returns {Promise<boolean>}
 */
async function notifyActNow(trend, brandFits = []) {
  // Filter to high-confidence fits
  const highConfidenceFits = (brandFits || []).filter(
    (fit) => fit.brand_entry_confidence > 65
  );

  // If brandFits were provided but none passed the threshold, skip
  if (brandFits && brandFits.length > 0 && highConfidenceFits.length === 0) {
    logger.log(MOD, `Skipped act_now notification for "${trend.title}" — no brand fits above 65%`);
    return false;
  }

  // Build the client match section
  let clientSection = '';
  if (highConfidenceFits.length > 0) {
    const lines = highConfidenceFits.map(
      (fit) => `• ${fit.client_name} — ${fit.brand_entry_confidence}% confidence\n  _${fit.entry_angle}_`
    );
    clientSection = `\n*Client Match:*\n${lines.join('\n')}\n`;
  }

  // Calculate hours remaining (rough estimate: act_now trends are < 12h window)
  const hoursOld = trend.scraped_at
    ? (Date.now() - new Date(trend.scraped_at).getTime()) / (1000 * 60 * 60)
    : 0;
  const hoursToAct = Math.max(0, Math.round(12 - hoursOld));

  const text = [
    ':red_circle: *ACT NOW — Trend Alert*',
    `*${trend.title || 'Untitled trend'}*`,
    `Platform: TikTok | Lifecycle: ${trend.lifecycle_stage || 'unknown'} | Score: ${trend.trend_score || 0}`,
    '',
    `:busts_in_silhouette: ${trend.replication_count || 0} creators using this format`,
    `:zap: Velocity: ${trend.velocity_score || 0} | :bar_chart: Engagement: ${trend.engagement_rate || 0}%`,
    clientSection,
    `:stopwatch: ${hoursToAct} hours remaining`,
    `<${trend.url || '#'}|View on TikTok>`,
  ].join('\n');

  const ok = await post({ text });

  if (ok) {
    logger.log(MOD, `Act-now alert sent for: ${trend.title}`);
  }

  return ok;
}

// ---------------------------------------------------------------------------
// notifyScraperDown
// ---------------------------------------------------------------------------

/**
 * Sends a warning that the scraper appears to be down.
 *
 * @param {object} [details] - Optional context about the failure
 * @param {number} [details.consecutiveFailures]
 * @param {string} [details.lastError]
 * @param {string} [details.timestamp]
 * @returns {Promise<boolean>}
 */
async function notifyScraperDown(details = {}) {
  const extra = details.lastError ? `\nLast error: _${details.lastError}_` : '';
  const failures = details.consecutiveFailures
    ? ` (${details.consecutiveFailures} consecutive failures)`
    : '';

  const text = `:warning: *Trend Watcher scraper may be down*${failures}`
    + `\nLast scrape was over 3 hours ago. Check Mac Mini.${extra}`;

  const ok = await post({ text });

  if (ok) {
    logger.log(MOD, 'Scraper-down alert sent');
  }

  return ok;
}

// ---------------------------------------------------------------------------
// notifyDailySummary
// ---------------------------------------------------------------------------

/**
 * Sends the 08:00 WIB daily digest to Slack.
 *
 * @param {object} stats
 * @param {number} stats.totalScrapes - Total scrape runs in the last 24h
 * @param {number} stats.new - New trends discovered
 * @param {number} stats.updated - Existing trends updated
 * @param {number} stats.errors - Processing errors
 * @param {number} [stats.actNowCount] - Trends that triggered act_now
 * @param {number} [stats.consecutiveFailures] - Current failure streak
 * @returns {Promise<boolean>}
 */
async function notifyDailySummary(stats) {
  const healthEmoji = (stats.consecutiveFailures || 0) >= 3 ? ':x:' : ':white_check_mark:';

  const text = [
    ':newspaper: *Trend Watcher — Daily Brief*',
    `_${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}_`,
    '',
    ':mag: *Scraping*',
    `• Total scrape runs: ${stats.totalScrapes || 0}`,
    `• New trends discovered: ${stats.new || 0}`,
    `• Existing trends updated: ${stats.updated || 0}`,
    `• Processing errors: ${stats.errors || 0}`,
    '',
    ':bell: *Alerts*',
    `• Act-now alerts sent: ${stats.actNowCount || 0}`,
    '',
    `${healthEmoji} *System Health*`,
    `• Consecutive failures: ${stats.consecutiveFailures || 0}`,
    `• Status: ${(stats.consecutiveFailures || 0) >= 3 ? 'DEGRADED' : 'Healthy'}`,
  ].join('\n');

  const ok = await post({ text });

  if (ok) {
    logger.log(MOD, 'Daily summary sent');
  }

  return ok;
}

// ---------------------------------------------------------------------------
// sendRaw
// ---------------------------------------------------------------------------

/**
 * Sends a plain text message to Slack. Used for debugging.
 *
 * @param {string} text - Plain text message
 * @returns {Promise<boolean>}
 */
async function sendRaw(text) {
  if (!text) return false;

  const ok = await post({ text });

  if (ok) {
    logger.log(MOD, 'Raw message sent');
  }

  return ok;
}

// ---------------------------------------------------------------------------
// alertSelectorHealth
// ---------------------------------------------------------------------------

/** Last selector health alert timestamp (throttle: 1 per 24h) */
let lastSelectorAlertAt = 0;

/**
 * Sends Slack alert when TikTok selectors fail health check.
 * Throttled to max 1 alert per 24 hours.
 *
 * @param {string} details - Description of which selectors failed
 * @returns {Promise<boolean>} Whether alert was sent
 */
async function alertSelectorHealth(details) {
  const now = Date.now();
  if (now - lastSelectorAlertAt < 24 * 60 * 60 * 1000) {
    logger.log(MOD, 'Selector health alert throttled (already sent in last 24h)');
    return false;
  }

  const sent = await sendRaw(
    ':rotating_light: *TikTok Selector Health Check FAILED*\n' +
    '```\n' + details + '\n```\n' +
    'The scraper may not be collecting data. Check `src/scrapers/tiktok.js` SELECTORS.'
  );

  if (sent) lastSelectorAlertAt = now;
  return sent;
}

module.exports = {
  notifyActNow,
  notifyScraperDown,
  notifyDailySummary,
  sendRaw,
  alertSelectorHealth,
};
