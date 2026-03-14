'use strict';

/**
 * Validates that all required environment variables are present and valid.
 * Call at server startup — fails fast with a clear error message.
 *
 * @param {Record<string, string|undefined>} env - The environment variables to check (default: process.env)
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.onWarn] - Warning callback (default: no-op)
 * @throws {Error} If any required variables are missing or if SUPABASE_URL is not a valid URL
 */
function validateEnv(env, opts = {}) {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'AUTH_SECRET',
    'JWT_SECRET',
    'TEAM_PIN_HASH',
    'OPENROUTER_API_KEY',
  ];

  const missing = required.filter((key) => !env[key] || env[key].trim() === '');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Check your .env file and ensure all variables are set.'
    );
  }

  // Validate SUPABASE_URL is a valid URL
  try {
    new URL(env.SUPABASE_URL);
  } catch {
    throw new Error(
      `SUPABASE_URL is not a valid URL: "${env.SUPABASE_URL}". ` +
      'Expected format: https://<project-id>.supabase.co'
    );
  }

  // Warn on weak secrets
  const warn = opts.onWarn || (() => {});

  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) {
    warn(`JWT_SECRET is only ${env.JWT_SECRET.length} chars — recommend at least 32 for security`);
  }

  if (env.AUTH_SECRET && env.AUTH_SECRET.length < 16) {
    warn(`AUTH_SECRET is only ${env.AUTH_SECRET.length} chars — recommend at least 16`);
  }
}

module.exports = { validateEnv };
