/**
 * Wraps an async function with retry logic and exponential backoff.
 *
 * @param {() => Promise<*>} fn - Async function to execute
 * @param {object} opts
 * @param {number} [opts.retries=3] - Max retry attempts after initial failure
 * @param {number} [opts.baseDelay=1000] - Base delay in ms (doubles each retry)
 * @param {(error: Error, attempt: number) => void} [opts.onRetry] - Called before each retry
 * @returns {Promise<*>} Result of fn
 * @throws {Error} The last error if all attempts fail
 */
async function withRetry(fn, opts = {}) {
  const { retries = 3, baseDelay = 1000, onRetry } = opts;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        if (onRetry) onRetry(err, attempt + 1);
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

module.exports = { withRetry };
