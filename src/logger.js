const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const MAX_LOG_AGE_DAYS = 7;

// Ensure logs/ directory exists (async, fire-and-forget on load)
let logsReady = fs.promises.mkdir(LOGS_DIR, { recursive: true }).catch(() => {});

let currentRunId = null;

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

/**
 * Returns the path for today's log file.
 * @returns {string} e.g. logs/app-2026-03-14.log
 */
function getLogFilePath() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(LOGS_DIR, `app-${date}.log`);
}

/**
 * Formats a Date as YYYY-MM-DD HH:mm:ss in local time.
 * @param {Date} date
 * @returns {string}
 */
function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Builds a structured JSON log entry.
 * @param {string} level - 'info', 'error', or 'warn'
 * @param {string} mod - Module name
 * @param {string} message - Log message
 * @param {*} [extra] - Optional data or Error
 * @returns {object}
 */
function buildEntry(level, mod, message, extra) {
  const entry = { timestamp: new Date().toISOString(), level, module: mod, message };
  if (currentRunId) entry.runId = currentRunId;
  if (extra !== null && extra !== undefined) {
    if (extra instanceof Error) {
      entry.error = { message: extra.message, stack: extra.stack };
    } else {
      entry.data = extra;
    }
  }
  return entry;
}

/**
 * Builds a formatted human-readable log line (dev mode).
 * @param {string} level - LOG, ERROR, or WARN
 * @param {string} mod - Module name (e.g. 'SCRAPER', 'DB')
 * @param {string} message
 * @param {*} [extra] - Optional data or Error to append
 * @returns {string}
 */
function formatLine(level, mod, message, extra) {
  let line = `[${timestamp()}] [${mod}] ${message}`;
  if (extra !== null && extra !== undefined) {
    if (extra instanceof Error) {
      line += ` | ${extra.message}`;
      if (extra.stack) {
        line += `\n${extra.stack}`;
      }
    } else if (typeof extra === 'object') {
      line += ` | ${JSON.stringify(extra)}`;
    } else {
      line += ` | ${extra}`;
    }
  }
  return line;
}

/**
 * Appends a JSON line to today's log file (production only).
 * @param {object} entry - Structured log entry
 */
async function appendToFile(entry) {
  try {
    await logsReady;
    const filePath = getLogFilePath();
    await fs.promises.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    // Last resort — if we can't write to log file, stderr is acceptable
    process.stderr.write(`[LOGGER] Failed to write to log file: ${err.message}\n`);
  }
}

/**
 * Deletes log files older than MAX_LOG_AGE_DAYS (7 days).
 * Called on startup and via a daily interval.
 */
async function rotateLogs() {
  try {
    await logsReady;
    const files = await fs.promises.readdir(LOGS_DIR);
    const cutoff = Date.now() - (MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000);

    for (const file of files) {
      if (!file.startsWith('app-') || !file.endsWith('.log')) continue;

      const filePath = path.join(LOGS_DIR, file);
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fs.promises.unlink(filePath);
        }
      } catch (_) {
        // Ignore individual file errors
      }
    }
  } catch (err) {
    process.stderr.write(`[LOGGER] Log rotation failed: ${err.message}\n`);
  }
}

/**
 * Sets a correlation run ID that is included in all subsequent log entries.
 * Pass null to clear it.
 * @param {string|null} id - Pipeline run ID or null to clear
 */
function setRunId(id) {
  currentRunId = id;
}

/**
 * Log an informational message.
 * @param {string} mod - Module identifier (e.g. 'SCRAPER', 'DB', 'SCHEDULER')
 * @param {string} message - Human-readable message
 * @param {*} [data=null] - Optional data payload to append
 */
function log(mod, message, data = null) {
  if (process.env.NODE_ENV === 'production') {
    appendToFile(buildEntry('info', mod, message, data));
  } else {
    const line = formatLine('LOG', mod, message, data);
    process.stdout.write(`${COLORS.green}${line}${COLORS.reset}\n`);
  }
}

/**
 * Log an error.
 * @param {string} mod - Module identifier
 * @param {string} message - Human-readable message
 * @param {Error|*} [err=null] - Error object or extra data
 */
function error(mod, message, err = null) {
  if (process.env.NODE_ENV === 'production') {
    appendToFile(buildEntry('error', mod, message, err));
  } else {
    const line = formatLine('ERROR', mod, message, err);
    process.stderr.write(`${COLORS.red}${line}${COLORS.reset}\n`);
  }
}

/**
 * Log a warning.
 * @param {string} mod - Module identifier
 * @param {string} message - Human-readable message
 * @param {*} [data=null] - Optional data payload
 */
function warn(mod, message, data = null) {
  if (process.env.NODE_ENV === 'production') {
    appendToFile(buildEntry('warn', mod, message, data));
  } else {
    const line = formatLine('WARN', mod, message, data);
    process.stderr.write(`${COLORS.yellow}${line}${COLORS.reset}\n`);
  }
}

// Run log rotation on startup and schedule daily rotation
rotateLogs();
setInterval(rotateLogs, 24 * 60 * 60 * 1000).unref();

module.exports = { log, error, warn, setRunId };
