# Phase 1: Critical Fixes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate crash vectors, harden auth, validate inputs, add error boundaries, and make Supabase writes retry-safe.

**Architecture:** Add defensive layers at every boundary: process-level crash handlers, middleware-based rate limiting and input validation, React error boundaries, and a retry wrapper around all Supabase writes. No new tables or migrations — this is purely hardening existing code.

**Tech Stack:** Node.js (CommonJS), Express 5, PM2, express-rate-limit, helmet, React 18 (error boundaries)

**Spec:** `docs/superpowers/specs/2026-03-14-enterprise-hardening-design.md` — Phase 1 sections 1.1–1.6

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/retry.js` | Create | Generic async retry-with-backoff wrapper (pure utility) |
| `src/config/validate-env.js` | Create | Startup env var validation — fail fast if missing |
| `src/middleware/rate-limiter.js` | Create | express-rate-limit config for auth + trigger endpoints |
| `src/middleware/validate.js` | Create | Input validation/sanitization helpers for API routes |
| `ecosystem.config.js` | Create | PM2 production config |
| `src/server.js` | Modify | Add process handlers, helmet, rate limiter, env validation, remove hand-rolled rateLimitTrigger |
| `src/api/auth.js` | Modify | Add PIN lockout logic |
| `src/api/saved.js` | Modify | Add input validation |
| `src/api/collections.js` | Modify | Add input validation |
| `src/api/patterns.js` | Modify | Add input validation |
| `src/api/for-you.js` | Modify | Add input validation |
| `src/database/supabase.js` | Modify | Wrap write functions with retry |
| `frontend/src/components/shared/ErrorBoundary.tsx` | Create | React error boundary component |
| `frontend/src/App.tsx` | Modify | Wrap RouterProvider with root ErrorBoundary |
| `frontend/src/router.tsx` | Modify | Add per-route ErrorBoundary wrapping |
| `tests/retry.test.js` | Create | Unit tests for retry utility |
| `tests/validate-env.test.js` | Create | Unit tests for env validation |
| `tests/validate.test.js` | Create | Unit tests for input validation |
| `package.json` | Modify | Add express-rate-limit, helmet deps |

---

## Chunk 1: Retry Utility + Supabase Write Hardening

### Task 1: Retry Utility

**Files:**
- Create: `src/utils/retry.js`
- Create: `tests/retry.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/retry.test.js`:

```javascript
const { withRetry } = require('../src/utils/retry');

describe('withRetry', () => {
  test('returns result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 3, baseDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on failure and succeeds on second attempt', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 3, baseDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('throws after all retries exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(
      withRetry(fn, { retries: 3, baseDelay: 10 })
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  test('calls onRetry callback on each retry', async () => {
    const onRetry = jest.fn();
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('ok');
    await withRetry(fn, { retries: 3, baseDelay: 10, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2);
  });

  test('does not retry if retries is 0', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(
      withRetry(fn, { retries: 0, baseDelay: 10 })
    ).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/retry.test.js --verbose`
Expected: FAIL — `Cannot find module '../src/utils/retry'`

- [ ] **Step 3: Implement the retry utility**

Create `src/utils/retry.js`:

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/retry.test.js --verbose`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/retry.js tests/retry.test.js
git commit -m "feat: add retry utility with exponential backoff"
```

---

### Task 2: Wrap Supabase Writes with Retry

**Files:**
- Modify: `src/database/supabase.js`

**Context:** The file exports 5 write functions: `upsertTrend`, `createEngagementSnapshot`, `upsertTrendAnalysis`, `insertCrossTrendSynthesis`, `upsertBrandFits`. Each currently throws on Supabase errors. Wrap the core Supabase calls (not the whole function) with `withRetry` to handle transient network errors.

- [ ] **Step 1: Add retry import and helper**

At the top of `src/database/supabase.js`, after line 3 (`const logger = require('../logger');`), add:

```javascript
const { withRetry } = require('../utils/retry');

/**
 * Wraps a Supabase operation with retry logic. Logs each retry attempt.
 * On final failure, logs the operation context for manual recovery.
 * @param {string} operation - Description for logging (e.g. 'upsert trend')
 * @param {() => Promise<*>} fn - The Supabase call to retry
 * @returns {Promise<*>}
 */
async function retrySupabase(operation, fn) {
  try {
    return await withRetry(fn, {
      retries: 3,
      baseDelay: 1000,
      onRetry: (err, attempt) => {
        logger.warn(MOD, `Retry ${attempt}/3 for ${operation}: ${err.message}`);
      },
    });
  } catch (err) {
    logger.error(MOD, `All retries exhausted for ${operation} — data may be lost`, err);
    throw err;
  }
}
```

- [ ] **Step 2: Wrap upsertTrend**

In `upsertTrend()`, wrap the two Supabase calls. Replace the existing check + upsert block (lines 99-116) with:

```javascript
  // Check if this hash already exists so we can report inserted vs updated
  const { data: existing } = await retrySupabase(
    `check trend ${hash.slice(0, 8)}`,
    () => supabase.from('trends').select('id').eq('hash', hash).maybeSingle()
  );

  const isInsert = !existing;

  const { data, error: upsertError } = await retrySupabase(
    `upsert trend ${trendData.title.slice(0, 30)}`,
    () => supabase.from('trends').upsert(row, { onConflict: 'hash' }).select('id').single()
  );
```

- [ ] **Step 3: Wrap createEngagementSnapshot**

Replace the insert call (lines 148-152) with:

```javascript
  const { data, error: insertError } = await retrySupabase(
    `snapshot for ${trendId.slice(0, 8)}`,
    () => supabase.from('engagement_snapshots').insert(row).select().single()
  );
```

- [ ] **Step 4: Wrap upsertTrendAnalysis**

Replace the check call (lines 277-281) with:

```javascript
  const { data: existing } = await retrySupabase(
    `check analysis ${trendId.slice(0, 8)}`,
    () => supabase.from('trend_analysis').select('id').eq('trend_id', trendId).maybeSingle()
  );
```

Replace the entire if/else block (lines 286-305) with:

```javascript
  if (existing) {
    const result = await retrySupabase(
      `update analysis ${existing.id.slice(0, 8)}`,
      () => supabase.from('trend_analysis').update(fields).eq('id', existing.id).select().single()
    );
    data = result.data;
    error = result.error;
  } else {
    const result = await retrySupabase(
      `insert analysis ${trendId.slice(0, 8)}`,
      () => supabase.from('trend_analysis').insert({ trend_id: trendId, ...fields }).select().single()
    );
    data = result.data;
    error = result.error;
  }
```

Note: The existing `let data; let error;` declarations on lines 283-284 remain unchanged. The `data = result.data; error = result.error;` assignments are preserved from the original code.

- [ ] **Step 5: Wrap insertCrossTrendSynthesis**

Replace the insert call (lines 344-348) with:

```javascript
  const { data, error: insertError } = await retrySupabase(
    'insert cross-trend synthesis',
    () => supabase.from('trend_analysis').insert(row).select().single()
  );
```

- [ ] **Step 6: Wrap upsertBrandFits**

Replace the upsert call (lines 370-373) with:

```javascript
  const { data, error: upsertError } = await retrySupabase(
    `upsert ${brandFits.length} brand fits`,
    () => supabase.from('client_brand_fit').upsert(brandFits, { onConflict: 'trend_id,brand_name' }).select()
  );
```

- [ ] **Step 7: Run existing tests to verify nothing broke**

Run: `npx jest --verbose`
Expected: All existing tests pass (scoring + patterns)

- [ ] **Step 8: Commit**

```bash
git add src/database/supabase.js
git commit -m "feat: wrap all Supabase writes with retry + exponential backoff"
```

---

## Chunk 2: Environment Validation + Process Crash Handlers

### Task 3: Environment Variable Validation

**Files:**
- Create: `src/config/validate-env.js`
- Create: `tests/validate-env.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/validate-env.test.js`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/validate-env.test.js --verbose`
Expected: FAIL — `Cannot find module '../src/config/validate-env'`

- [ ] **Step 3: Implement env validation**

Create `src/config/validate-env.js`:

```javascript
/**
 * Validates that all required environment variables are present and valid.
 * Call at server startup — fails fast with a clear error message.
 *
 * @param {Record<string, string|undefined>} env - The environment variables to check (default: process.env)
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.onWarn] - Warning callback (default: logger.warn)
 * @throws {Error} If any required variables are missing
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/validate-env.test.js --verbose`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

- [ ] **Step 6: Update CLAUDE.md environment variable table**

In `CLAUDE.md`, add `JWT_SECRET` and `TEAM_PIN_HASH` to the Environment Variables table:

```
| `JWT_SECRET` | Secret key for signing JWT tokens (min 32 chars recommended) |
| `TEAM_PIN_HASH` | bcrypt hash of the team PIN for frontend auth |
```

Also remove `SLACK_WEBHOOK_URL` from the table (no longer used).

- [ ] **Step 7: Commit**

```bash
git add src/config/validate-env.js tests/validate-env.test.js CLAUDE.md
git commit -m "feat: add startup env var validation with fail-fast"
```

---

### Task 4: Process Crash Handlers + PM2 Config

**Files:**
- Modify: `src/server.js`
- Create: `ecosystem.config.js`
- Modify: `package.json`

- [ ] **Step 1: Add process crash handlers to server.js**

At the top of `src/server.js`, after line 7 (`const { runPipelineOnce } = require('./pipeline');`), add:

```javascript
const { validateEnv } = require('./config/validate-env');

// ---------------------------------------------------------------------------
// Catch uncaught exceptions and unhandled rejections
// ---------------------------------------------------------------------------

process.on('unhandledRejection', (reason, promise) => {
  logger.error(MOD, 'Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (err) => {
  logger.error(MOD, 'Uncaught exception — PM2 will restart the process', err);
  // Let the error propagate — PM2 handles restart. Do not call process.exit()
  // per project convention (CLAUDE.md bans process.exit).
});
```

- [ ] **Step 2: Add env validation to startup**

In `src/server.js`, inside the `start()` function (line 228), add at the very beginning before the Supabase test:

```javascript
  // Validate required environment variables — throw to prevent startup
  // (thrown error propagates naturally; PM2 handles restart per CLAUDE.md convention)
  validateEnv(process.env, {
    onWarn: (msg) => logger.warn(MOD, msg),
  });
  logger.log(MOD, 'Environment variables validated');
```

- [ ] **Step 3: Create PM2 ecosystem config**

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'trend-watcher',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      restart_delay: 1000,
      max_restarts: 10,       // Stop restarting after 10 unstable restarts (exits before min_uptime)
      min_uptime: '15000',    // 15s — exit before this threshold counts as an unstable restart
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      // Log files — PM2 manages rotation
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
```

- [ ] **Step 4: Add start:prod script to package.json**

In `package.json`, add to scripts:

```json
"start:prod": "pm2 start ecosystem.config.js --env production",
"stop:prod": "pm2 stop trend-watcher",
"logs:prod": "pm2 logs trend-watcher"
```

- [ ] **Step 5: Run existing tests to verify nothing broke**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/server.js ecosystem.config.js package.json
git commit -m "feat: add process crash handlers, env validation, PM2 config"
```

---

## Chunk 3: Auth Hardening + Rate Limiting

### Task 5: Rate Limiter Middleware

**Files:**
- Create: `src/middleware/rate-limiter.js`
- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

Run: `npm install express-rate-limit helmet`

- [ ] **Step 2: Create rate limiter middleware**

Create `src/middleware/rate-limiter.js`:

```javascript
const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for PIN auth endpoint.
 * 5 attempts per 15 minutes per IP.
 */
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many PIN attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for trigger endpoints.
 * 10 requests per minute per IP.
 */
const triggerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Rate limit exceeded. Max 10 requests per minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API rate limiter.
 * 100 requests per minute per IP.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Rate limit exceeded. Try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { pinLimiter, triggerLimiter, apiLimiter };
```

- [ ] **Step 3: Commit**

```bash
git add src/middleware/rate-limiter.js package.json package-lock.json
git commit -m "feat: add express-rate-limit middleware for auth and trigger endpoints"
```

---

### Task 6: PIN Lockout + Mount Rate Limiters

**Files:**
- Modify: `src/api/auth.js`
- Modify: `src/server.js`

- [ ] **Step 1: Add PIN lockout to auth.js**

In `src/api/auth.js`, after line 7 (`const router = express.Router();`), add:

```javascript
// ---------------------------------------------------------------------------
// PIN brute-force lockout (in-memory, resets on restart)
// ---------------------------------------------------------------------------

const PIN_LOCKOUT_MAX = 10;
const PIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const failedAttempts = new Map(); // ip -> { count, lockedUntil }

function checkLockout(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.lockedUntil) {
    failedAttempts.delete(ip);
    return false;
  }
  return entry.count >= PIN_LOCKOUT_MAX;
}

function recordFailedAttempt(ip) {
  const entry = failedAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= PIN_LOCKOUT_MAX) {
    entry.lockedUntil = Date.now() + PIN_LOCKOUT_DURATION_MS;
    logger.warn(MOD, `IP ${ip} locked out after ${PIN_LOCKOUT_MAX} failed PIN attempts`);
  }
  failedAttempts.set(ip, entry);
}

function clearFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

// Clean stale lockout entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failedAttempts) {
    if (now > entry.lockedUntil && entry.lockedUntil > 0) failedAttempts.delete(ip);
  }
}, 30 * 60 * 1000).unref();
```

- [ ] **Step 2: Add lockout check to PIN route**

In `src/api/auth.js`, inside the `router.post('/pin', ...)` handler, add at the very beginning of the try block (after `const { pin } = req.body;` but before the PIN validation):

```javascript
    // Check lockout before processing
    if (checkLockout(req.ip)) {
      logger.warn(MOD, `Locked-out IP ${req.ip} attempted PIN auth`);
      return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    }
```

After the `if (!valid)` block (line 33), add `recordFailedAttempt(req.ip);` before the return:

```javascript
    if (!valid) {
      recordFailedAttempt(req.ip);
      logger.warn(MOD, `Failed PIN attempt from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid PIN' });
    }
```

After the successful `bcrypt.compare`, add:

```javascript
    clearFailedAttempts(req.ip);
```

- [ ] **Step 3: Mount rate limiters and helmet in server.js**

In `src/server.js`, add import after the existing requires:

```javascript
const helmet = require('helmet');
const { pinLimiter, triggerLimiter, apiLimiter } = require('./middleware/rate-limiter');
```

After `app.use(express.json());` (line 88), add:

```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.tiktok.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", process.env.SUPABASE_URL || '', "https://*.supabase.co"],
      frameSrc: ["'self'", "https://www.tiktok.com"],
    },
  },
}));
```

- [ ] **Step 4: Apply rate limiters to routes**

**IMPORTANT: Route registration order matters.** The `/api/auth` route MUST be registered before the generic `/api` middleware, otherwise auth requests hit `requireJwtAuth` first and are rejected. Preserve the existing order from `server.js` lines 103-106.

Replace line 103 (`app.use('/api/auth', authRouter);`) with:

```javascript
app.use('/api/auth', pinLimiter, authRouter);
```

Replace line 106 (`app.use('/api', requireJwtAuth);`) with:

```javascript
app.use('/api', apiLimiter, requireJwtAuth);
```

Replace `rateLimitTrigger` on line 148 with `triggerLimiter`:

```javascript
app.post('/trigger/scrape', triggerLimiter, requireAuth, (req, res) => {
```

- [ ] **Step 5: Remove hand-rolled rate limiter**

Remove the entire hand-rolled rate limiter block from `src/server.js` — lines 50-79 (the `rateLimitMap`, constants, `rateLimitTrigger` function, and the cleanup interval).

- [ ] **Step 6: Run existing tests to verify nothing broke**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/server.js src/api/auth.js
git commit -m "feat: add PIN lockout, helmet security headers, mount rate limiters"
```

---

## Chunk 4: Input Validation

### Task 7: Input Validation Middleware

**Files:**
- Create: `src/middleware/validate.js`
- Create: `tests/validate.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/validate.test.js`:

```javascript
const { sanitizeString, validateInt, validateDays, validateLimit } = require('../src/middleware/validate');

describe('sanitizeString', () => {
  test('strips HTML tags', () => {
    expect(sanitizeString('<script>alert("xss")</script>Hello'))
      .toBe('alert("xss")Hello');
  });

  test('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  test('truncates to maxLength', () => {
    expect(sanitizeString('a'.repeat(300), 200).length).toBe(200);
  });

  test('returns empty string for null/undefined', () => {
    expect(sanitizeString(null)).toBe('');
    expect(sanitizeString(undefined)).toBe('');
  });
});

describe('validateInt', () => {
  test('parses valid integer string', () => {
    expect(validateInt('42', 1, 100, 10)).toBe(42);
  });

  test('returns default for non-numeric', () => {
    expect(validateInt('abc', 1, 100, 10)).toBe(10);
  });

  test('clamps to min', () => {
    expect(validateInt('0', 1, 100, 10)).toBe(1);
  });

  test('clamps to max', () => {
    expect(validateInt('999', 1, 100, 10)).toBe(100);
  });

  test('returns default for undefined', () => {
    expect(validateInt(undefined, 1, 100, 10)).toBe(10);
  });
});

describe('validateDays', () => {
  test('returns valid days', () => {
    expect(validateDays('7')).toBe(7);
  });

  test('clamps to 1-90 range', () => {
    expect(validateDays('0')).toBe(1);
    expect(validateDays('200')).toBe(90);
  });

  test('returns 14 as default', () => {
    expect(validateDays(undefined)).toBe(14);
  });
});

describe('validateLimit', () => {
  test('returns valid limit', () => {
    expect(validateLimit('50')).toBe(50);
  });

  test('clamps to 1-500 range', () => {
    expect(validateLimit('0')).toBe(1);
    expect(validateLimit('1000')).toBe(500);
  });

  test('returns 100 as default', () => {
    expect(validateLimit(undefined)).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/validate.test.js --verbose`
Expected: FAIL — `Cannot find module '../src/middleware/validate'`

- [ ] **Step 3: Implement validation helpers**

Create `src/middleware/validate.js`:

```javascript
/**
 * Strips HTML tags and trims a string. Returns empty string for null/undefined.
 * @param {*} str - Input value
 * @param {number} [maxLength=200] - Maximum allowed length
 * @returns {string} Sanitized string
 */
function sanitizeString(str, maxLength = 200) {
  if (str === null || str === undefined) return '';
  const cleaned = String(str).replace(/<[^>]*>/g, '').trim();
  return cleaned.slice(0, maxLength);
}

/**
 * Parses and clamps an integer value within a range.
 * @param {*} value - Input value (string or number)
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @param {number} defaultVal - Default if value is not a valid number
 * @returns {number}
 */
function validateInt(value, min, max, defaultVal) {
  if (value === null || value === undefined) return defaultVal;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultVal;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * Validates a "days" query parameter. Range: 1-90, default: 14.
 * @param {*} value
 * @returns {number}
 */
function validateDays(value) {
  return validateInt(value, 1, 90, 14);
}

/**
 * Validates a "limit" query parameter. Range: 1-500, default: 100.
 * @param {*} value
 * @returns {number}
 */
function validateLimit(value) {
  return validateInt(value, 1, 500, 100);
}

module.exports = { sanitizeString, validateInt, validateDays, validateLimit };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/validate.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/middleware/validate.js tests/validate.test.js
git commit -m "feat: add input validation and sanitization helpers"
```

---

### Task 8: Apply Validation to API Routes

**Files:**
- Modify: `src/api/saved.js`
- Modify: `src/api/collections.js`
- Modify: `src/api/patterns.js`
- Modify: `src/api/for-you.js`

**Context:** Read each file first to understand its route handlers, then add validation. The validation import and usage pattern is the same for each file.

- [ ] **Step 1: Add validation to `src/api/patterns.js`**

Add import at the top (after line 4):

```javascript
const { validateDays } = require('../middleware/validate');
```

Replace line 15 (`const days = parseInt(req.query.days) || 14;`) with:

```javascript
    const days = validateDays(req.query.days);
```

Replace line 59 (`const totalDays = parseInt(req.query.days) || 6;`) with:

```javascript
    const totalDays = validateDays(req.query.days);
```

- [ ] **Step 2: Verify `src/api/for-you.js` needs no changes**

Read `src/api/for-you.js` and confirm line 18 hardcodes `7 * 24 * 60 * 60 * 1000` with no `req.query` input. No user-controllable params exist — no changes required.

- [ ] **Step 3: Add validation to `src/api/collections.js`**

Add import at the top (after line 3):

```javascript
const { sanitizeString } = require('../middleware/validate');
```

In POST `/` handler (line 57), replace line 64 (`{ name: name.trim() }`) with:

```javascript
      .insert({ name: sanitizeString(name, 100) })
```

In PUT `/:id` handler (line 84), replace line 94 (`{ name: name.trim(), ...}`) with:

```javascript
      .update({ name: sanitizeString(name, 100), updated_at: new Date().toISOString() })
```

- [ ] **Step 4: Verify `src/api/saved.js` needs no changes**

Read `src/api/saved.js` and confirm it only uses `req.params.trendId` (UUID from URL path, passed to parameterized Supabase queries). No `req.query` or `req.body` string inputs exist — no changes required.

- [ ] **Step 5: Run existing tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/api/patterns.js src/api/collections.js
git commit -m "feat: add input validation to API route handlers"
```

---

## Chunk 5: Frontend Error Boundaries

### Task 9: React Error Boundary Component

**Files:**
- Create: `frontend/src/components/shared/ErrorBoundary.tsx`

- [ ] **Step 1: Create ErrorBoundary component**

Create `frontend/src/components/shared/ErrorBoundary.tsx`:

```tsx
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _info: React.ErrorInfo) {
    // Intentionally empty — React already logs to console in dev mode.
    // In production, errors propagate to window.onerror for monitoring.
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8">
          <h2
            className="text-[16px] font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Something went wrong
          </h2>
          <p
            className="text-[13px] mb-4 text-center max-w-[400px]"
            style={{ color: 'var(--text-muted)' }}
          >
            An unexpected error occurred. Try refreshing the page or click retry below.
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 rounded-lg text-[12px]"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              color: 'var(--text-primary)',
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/shared/ErrorBoundary.tsx
git commit -m "feat: add React ErrorBoundary component"
```

---

### Task 10: Mount Error Boundaries in App and Router

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Wrap RouterProvider in App.tsx with root ErrorBoundary**

In `frontend/src/App.tsx`, add the import and wrap:

```tsx
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 2: Add per-route ErrorBoundary wrapping in router.tsx**

In `frontend/src/router.tsx`, add the import and wrap each child route:

```tsx
import { ErrorBoundary } from './components/shared/ErrorBoundary';
```

Wrap each child route element (but NOT AppShell — that's covered by the root boundary in App.tsx):

```tsx
export const router = createBrowserRouter([
  {
    path: '/pin',
    element: <PinEntry />,
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <ErrorBoundary><Pulse /></ErrorBoundary> },
      { path: 'explore', element: <ErrorBoundary><Explore /></ErrorBoundary> },
      { path: 'for-you', element: <ErrorBoundary><ForYou /></ErrorBoundary> },
      { path: 'brand/:name', element: <ErrorBoundary><Brand /></ErrorBoundary> },
      { path: 'saved', element: <ErrorBoundary><Saved /></ErrorBoundary> },
      { path: 'patterns', element: <ErrorBoundary><Patterns /></ErrorBoundary> },
      { path: 'settings', element: <ErrorBoundary><Settings /></ErrorBoundary> },
    ],
  },
]);
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/router.tsx
git commit -m "feat: mount error boundaries on App root and all routes"
```

---

## Chunk 6: Final Verification

### Task 11: Run All Tests + Build

- [ ] **Step 1: Run all backend tests**

Run: `npx jest --verbose`
Expected: All tests pass (scoring, patterns, retry, validate-env, validate)

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Verify server starts**

Run: `node -e "require('./src/config/validate-env').validateEnv(require('dotenv').config().parsed || {})" 2>&1 || true`
Expected: Either passes validation or lists which env vars are missing (confirming the validation works)

- [ ] **Step 4: Final commit if any cleanup needed**

Review all changes with `git diff --stat` and ensure everything is committed.
