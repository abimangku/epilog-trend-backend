'use strict';

const { validateEnv } = require('../src/config/validate-env');

describe('validateEnv', () => {
  const REQUIRED = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
    AUTH_SECRET: 'a'.repeat(32),
    JWT_SECRET: 'b'.repeat(32),
    TEAM_PIN_HASH: '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUV',
    OPENROUTER_API_KEY: 'sk-or-v1-test',
  };

  test('passes when all required vars are set', () => {
    expect(() => validateEnv(REQUIRED)).not.toThrow();
  });

  test('throws listing all missing vars', () => {
    expect(() => validateEnv({})).toThrow('SUPABASE_URL');
    expect(() => validateEnv({})).toThrow('Missing required');
  });

  test('throws if SUPABASE_URL is not a valid URL', () => {
    expect(() => validateEnv({ ...REQUIRED, SUPABASE_URL: 'not-a-url' }))
      .toThrow('SUPABASE_URL');
  });

  test('warns if JWT_SECRET is shorter than 32 chars', () => {
    const warnings = [];
    validateEnv({ ...REQUIRED, JWT_SECRET: 'short' }, { onWarn: (msg) => warnings.push(msg) });
    expect(warnings.some(w => w.includes('JWT_SECRET'))).toBe(true);
  });

  test('passes with valid URL formats', () => {
    expect(() => validateEnv({
      ...REQUIRED,
      SUPABASE_URL: 'https://tnvnevydxobtmiackdkz.supabase.co',
    })).not.toThrow();
  });
});
