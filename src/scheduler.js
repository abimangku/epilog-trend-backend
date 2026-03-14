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
const { checkSelectors } = require('./scrapers/health-check');
const { createPipelineEvent } = require('./database/supabase');
const { cleanupOldThumbnails } = require('./media/thumbnail-proxy');

const MOD = 'SCHEDULER';

// ---------------------------------------------------------------------------
// Schedule definition — intervals in minutes per WIB time window
// ---------------------------------------------------------------------------

const SCHEDULE = {
  morning:   { start: 5,  end: 8,  intervalMinutes: 60,  aiAnalysis: true },
  work:      { start: 8,  end: 11, intervalMinutes: 90,  aiAnalysis: false },
  lunch:     { start: 11, end: 14, intervalMinutes: 45,  aiAnalysis: true },
  afternoon: { start: 14, end: 18, intervalMinutes: 60,  aiAnalysis: false },
  primetime: { start: 18, end: 22, intervalMinutes: 60,  aiAnalysis: true },
  latenight: { start: 22, end: 24, intervalMinutes: 90,  aiAnalysis: true },
  sleep:     { start: 0,  end: 5,  intervalMinutes: 0,   aiAnalysis: false },
};

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

let lastScrapeTime = null;     // Date object
let nextScrapeAt = null;       // Unix timestamp (ms) — jittered threshold for next scrape
let scrapeRunning = false;
let consecutiveFailures = 0;
let consecutiveEmptyScrapes = 0;
let totalScrapesToday = 0;
let dailyStats = { new: 0, updated: 0, errors: 0 };

// Cron task references for cleanup
let mainCron = null;
let resetCron = null;
let briefCron = null;
let healthCron = null;
let cleanupCron = null;

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
  if (!nextScrapeAt) return null;
  return new Date(nextScrapeAt);
}

// ---------------------------------------------------------------------------
// Main tick — runs every minute
// ---------------------------------------------------------------------------

async function onTick() {
  const { name, config } = getCurrentWindow();

  // Skip disabled windows (intervalMinutes === 0)
  if (config.intervalMinutes === 0) return;

  // Check if it's time to scrape (threshold set once per scrape, not re-rolled)
  const now = Date.now();
  if (nextScrapeAt && now < nextScrapeAt) {
    return;
  }

  // Skip to next window after 3+ consecutive empty scrapes (1x → 2x → 4x → skip)
  if (consecutiveEmptyScrapes >= 3) {
    logger.warn(MOD, `3+ empty scrapes — skipping "${name}" window entirely`);
    // Clamp end hour: config.end=24 means midnight, use 23:59:59.999 to avoid overflow
    const endHour = config.end === 24 ? 23 : config.end;
    const endMin  = config.end === 24 ? 59 : 0;
    const endSec  = config.end === 24 ? 59 : 0;
    const windowEndMs = new Date().setHours(endHour, endMin, endSec, config.end === 24 ? 999 : 0);
    lastScrapeTime = new Date(windowEndMs);
    nextScrapeAt = windowEndMs; // prevent immediate re-fire on next tick
    consecutiveEmptyScrapes = 0;
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

    // Track empty scrapes for backoff (rate-limiting detection)
    if (result.scraped === 0) {
      consecutiveEmptyScrapes++;
      logger.warn(MOD, `Empty scrape #${consecutiveEmptyScrapes} — backing off`);
    } else {
      consecutiveEmptyScrapes = 0;
    }

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

    // After 3 consecutive failures, log critical alert
    // (pipeline_events table captures per-run failures)
    if (consecutiveFailures >= 3) {
      logger.error(MOD, `ALERT: ${consecutiveFailures} consecutive scrape failures`);
    }
  } finally {
    lastScrapeTime = new Date();
    scrapeRunning = false;

    // Sample jitter ONCE for next scrape — prevents re-rolling drift
    const { config: nextConfig } = getCurrentWindow();
    if (nextConfig.intervalMinutes > 0) {
      const jitter = 0.7 + (Math.random() * 0.6); // ±30% variance
      const backoff = consecutiveEmptyScrapes > 0
        ? Math.min(Math.pow(2, consecutiveEmptyScrapes), 4) // 2x at 1, 4x at 2, skip at 3+
        : 1;
      nextScrapeAt = Date.now() + nextConfig.intervalMinutes * 60 * 1000 * jitter * backoff;
    } else {
      nextScrapeAt = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Daily reset at 00:00 WIB
// ---------------------------------------------------------------------------

function onDailyReset() {
  logger.log(MOD, `Daily reset — today's totals: ${totalScrapesToday} scrapes, `
    + `${dailyStats.new} new, ${dailyStats.updated} updated, ${dailyStats.errors} errors`);

  totalScrapesToday = 0;
  consecutiveEmptyScrapes = 0;
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

  logger.log(MOD, 'Daily brief', summary);
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
  const intervalLabel = config.intervalMinutes === 0 ? 'disabled' : `every ${config.intervalMinutes}m`;
  logger.log(MOD, `Starting scheduler — current window: "${name}" (${intervalLabel})`);

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

  // Health check: every 6 hours
  healthCron = cron.schedule('0 */6 * * *', () => {
    checkSelectors({ createPipelineEvent }).catch((err) => {
      logger.error(MOD, 'Health check cron failed', err);
    });
  });

  // Nightly thumbnail cleanup: 03:00 WIB
  cleanupCron = cron.schedule('0 3 * * *', () => {
    cleanupOldThumbnails(30).catch((err) => {
      logger.error(MOD, 'Thumbnail cleanup cron failed', err);
    });
  });

  logger.log(MOD, 'Cron jobs registered: main (every min), daily-reset (00:00), daily-brief (08:00), health-check (every 6h), thumbnail-cleanup (03:00)');
}

/**
 * Stops all cron jobs.
 * Called by server.js on shutdown.
 */
function stop() {
  if (mainCron) { mainCron.stop(); mainCron = null; }
  if (resetCron) { resetCron.stop(); resetCron = null; }
  if (briefCron) { briefCron.stop(); briefCron = null; }
  if (healthCron) { healthCron.stop(); healthCron = null; }
  if (cleanupCron) { cleanupCron.stop(); cleanupCron = null; }
  logger.log(MOD, 'All cron jobs stopped');
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Returns current scheduler status for the /status/pipeline endpoint.
 *
 * @returns {{ currentWindow: string, currentInterval: number, effectiveInterval: number, backoffMultiplier: number, consecutiveEmptyScrapes: number, lastScrapeTime: string|null, nextScrapeTime: string|null, totalScrapesToday: number }}
 */
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

module.exports = {
  SCHEDULE,
  getCurrentWindow,
  getSchedulerStatus,
  start,
  stop,
};
