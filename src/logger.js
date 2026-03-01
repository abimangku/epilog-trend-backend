const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'app.log');

// Ensure logs/ directory exists (async, fire-and-forget on load)
let logsReady = fs.promises.mkdir(LOGS_DIR, { recursive: true }).catch(() => {});

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

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
 * Builds a formatted log line.
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
 * Appends a line to the log file (production only).
 * @param {string} line
 */
async function appendToFile(line) {
  try {
    await logsReady;
    await fs.promises.appendFile(LOG_FILE, line + '\n', 'utf8');
  } catch (err) {
    // Last resort — if we can't write to log file, stderr is acceptable
    process.stderr.write(`[LOGGER] Failed to write to log file: ${err.message}\n`);
  }
}

/**
 * Log an informational message.
 * @param {string} mod - Module identifier (e.g. 'SCRAPER', 'DB', 'SCHEDULER')
 * @param {string} message - Human-readable message
 * @param {*} [data=null] - Optional data payload to append
 */
function log(mod, message, data = null) {
  const line = formatLine('LOG', mod, message, data);
  if (process.env.NODE_ENV === 'production') {
    appendToFile(line);
  } else {
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
  const line = formatLine('ERROR', mod, message, err);
  if (process.env.NODE_ENV === 'production') {
    appendToFile(line);
  } else {
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
  const line = formatLine('WARN', mod, message, data);
  if (process.env.NODE_ENV === 'production') {
    appendToFile(line);
  } else {
    process.stderr.write(`${COLORS.yellow}${line}${COLORS.reset}\n`);
  }
}

module.exports = { log, error, warn };
