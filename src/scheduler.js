/**
 * Cron scheduler aligned to Indonesian peak hours (WIB / UTC+7).
 * Runs a once-per-minute tick that checks whether enough time has passed
 * since the last scrape based on the current time window's interval.
 */

// Force all Date operations in this module to use WIB
process.env.TZ = 'Asia/Jakarta';

const cron = require('node-cron');
const logger = require('./logger');
const { runPipelineOnce } = require('./pipeline');

// Slack module may not be implemented yet — import defensively
let notifyScraperDown = null;
let notifyDailySummary = null;
try {
  const slack = require('./notifications/slack');
  if (typeof slack.notifyScraperDown === 'function') {
    notifyScraperDown = slack.notifyScraperDown;
  }
  if (typeof slack.notifyDailySummary === 'function') {
    notifyDailySummary = slack.notifyDailySummary;
  }
} catch {
  // slack.js not yet implemented
}

const MOD = 'SCHEDULER';

// ---------------------------------------------------------------------------
// Schedule definition — intervals in minutes per WIB time window
// ---------------------------------------------------------------------------

const SCHEDULE = {
  morning:   { start: 5,  end: 8,  intervalMinutes: 30,  aiAnalysis: true },
  work:      { start: 8,  end: 11, intervalMinutes: 90,  aiAnalysis: false },
  lunch:     { start: 11, end: 14, intervalMinutes: 30,  aiAnalysis: true },
  afternoon: { start: 14, end: 18, intervalMinutes: 60,  aiAnalysis: false },
  primetime: { start: 18, end: 22, intervalMinutes: 20,  aiAnalysis: true },
  latenight: { start: 22, end: 24, intervalMinutes: 45,  aiAnalysis: true },
  sleep:     { start: 0,  end: 5,  intervalMinutes: 120, aiAnalysis: false },
};

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

let lastScrapeTime = null;     // Date object
let scrapeRunning = false;
let consecutiveFailures = 0;
let totalScrapesToday = 0;
let dailyStats = { new: 0, updated: 0, errors: 0 };

// Cron task references for cleanup
let mainCron = null;
let resetCron = null;
let briefCron = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the schedule window for the current WIB hour.
 *
 * @returns {{ name: string, config: { start: number, end: number, intervalMinutes: number, aiAnalysis: boolean } }}
 */
function getCurrentWindow() {
  const hour = new Date().getHours(); // WIB due to TZ override

  for (const [name, config] of Object.entries(SCHEDULE)) {
    if (config.start <= config.end) {
      // Normal range (e.g. 5-8)
      if (hour >= config.start && hour < config.end) {
        return { name, config };
      }
    } else {
      // Wrap-around range (e.g. 22-24 doesn't wrap, but defensive)
      if (hour >= config.start || hour < config.end) {
        return { name, config };
      }
    }
  }

  // Fallback — should never happen with the schedule above covering 0-24
  return { name: 'sleep', config: SCHEDULE.sleep };
}

/**
 * Calculates the next expected scrape time based on last scrape and current interval.
 * @returns {Date|null}
 */
function getNextScrapeTime() {
  if (!lastScrapeTime) return null;
  const { config } = getCurrentWindow();
  return new Date(lastScrapeTime.getTime() + config.intervalMinutes * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Main tick — runs every minute
// ---------------------------------------------------------------------------

async function onTick() {
  const { name, config } = getCurrentWindow();

  // Check if enough time has elapsed since the last scrape
  const now = Date.now();
  const intervalMs = config.intervalMinutes * 60 * 1000;
  const elapsed = lastScrapeTime ? now - lastScrapeTime.getTime() : Infinity;

  if (elapsed < intervalMs) {
    // Not time yet — silent (avoid spamming logs every minute)
    return;
  }

  // Guard against overlapping runs
  if (scrapeRunning) {
    logger.warn(MOD, `Skipped — previous scrape still running (window: ${name})`);
    return;
  }

  // Time to scrape
  logger.log(MOD, `Triggering scrape in "${name}" window (interval: ${config.intervalMinutes}m)`);
  scrapeRunning = true;

  try {
    const result = await runPipelineOnce();

    // Success — reset failure counter, update stats
    consecutiveFailures = 0;
    totalScrapesToday++;
    dailyStats.new += result.new;
    dailyStats.updated += result.updated;
    dailyStats.errors += result.errors;

    logger.log(MOD, `Scrape #${totalScrapesToday} complete: +${result.new} new, ${result.updated} updated, ${result.errors} errors`);

  } catch (err) {
    consecutiveFailures++;
    logger.error(MOD, `Scrape failed (${consecutiveFailures} consecutive failures)`, err);

    // After 3 consecutive failures, alert via Slack
    if (consecutiveFailures >= 3) {
      logger.error(MOD, 'ALERT: 3 consecutive scrape failures — notifying Slack');
      try {
        if (notifyScraperDown) {
          await notifyScraperDown({
            consecutiveFailures,
            lastError: err.message,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (slackErr) {
        logger.warn(MOD, 'Failed to send scraper-down notification', slackErr);
      }
    }
  } finally {
    lastScrapeTime = new Date();
    scrapeRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Daily reset at 00:00 WIB
// ---------------------------------------------------------------------------

function onDailyReset() {
  logger.log(MOD, `Daily reset — today's totals: ${totalScrapesToday} scrapes, `
    + `${dailyStats.new} new, ${dailyStats.updated} updated, ${dailyStats.errors} errors`);

  totalScrapesToday = 0;
  dailyStats = { new: 0, updated: 0, errors: 0 };
}

// ---------------------------------------------------------------------------
// Daily brief at 08:00 WIB
// ---------------------------------------------------------------------------

async function onDailyBrief() {
  const summary = {
    totalScrapes: totalScrapesToday,
    ...dailyStats,
    consecutiveFailures,
    timestamp: new Date().toISOString(),
  };

  logger.log(MOD, 'Sending daily brief', summary);

  try {
    if (notifyDailySummary) {
      await notifyDailySummary(summary);
      logger.log(MOD, 'Daily brief sent to Slack');
    } else {
      logger.warn(MOD, 'Slack not configured — daily brief skipped');
    }
  } catch (err) {
    logger.warn(MOD, 'Failed to send daily brief', err);
  }
}

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

/**
 * Starts all cron jobs.
 * Called by server.js on startup.
 */
function start() {
  const { name, config } = getCurrentWindow();
  logger.log(MOD, `Starting scheduler — current window: "${name}" (every ${config.intervalMinutes}m)`);

  // Main tick: every minute
  mainCron = cron.schedule('* * * * *', () => {
    onTick().catch((err) => {
      logger.error(MOD, 'Tick handler crashed', err);
    });
  });

  // Daily reset: 00:00 WIB
  resetCron = cron.schedule('0 0 * * *', () => {
    onDailyReset();
  });

  // Daily brief: 08:00 WIB
  briefCron = cron.schedule('0 8 * * *', () => {
    onDailyBrief().catch((err) => {
      logger.error(MOD, 'Daily brief handler crashed', err);
    });
  });

  logger.log(MOD, 'Cron jobs registered: main (every min), daily-reset (00:00), daily-brief (08:00)');
}

/**
 * Stops all cron jobs.
 * Called by server.js on shutdown.
 */
function stop() {
  if (mainCron) { mainCron.stop(); mainCron = null; }
  if (resetCron) { resetCron.stop(); resetCron = null; }
  if (briefCron) { briefCron.stop(); briefCron = null; }
  logger.log(MOD, 'All cron jobs stopped');
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Returns current scheduler status for the /status/pipeline endpoint.
 *
 * @returns {{ currentWindow: string, currentInterval: number, lastScrapeTime: string|null, nextScrapeTime: string|null, totalScrapesToday: number }}
 */
function getSchedulerStatus() {
  const { name, config } = getCurrentWindow();
  const next = getNextScrapeTime();

  return {
    currentWindow: name,
    currentInterval: config.intervalMinutes,
    lastScrapeTime: lastScrapeTime ? lastScrapeTime.toISOString() : null,
    nextScrapeTime: next ? next.toISOString() : null,
    totalScrapesToday,
  };
}

module.exports = {
  SCHEDULE,
  getCurrentWindow,
  getSchedulerStatus,
  start,
  stop,
};
