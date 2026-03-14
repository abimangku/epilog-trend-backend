require('dotenv').config();

const express = require('express');
const path = require('path');
const logger = require('./logger');
const { testConnection, supabase } = require('./database/supabase');
const { runPipelineOnce } = require('./pipeline');
const authRouter = require('./api/auth');
const { requireAuth: requireJwtAuth } = require('./api/middleware');
const savedRouter = require('./api/saved');
const collectionsRouter = require('./api/collections');
const patternsRouter = require('./api/patterns');
const forYouRouter = require('./api/for-you');

const MOD = 'SERVER';

// ---------------------------------------------------------------------------
// Pipeline run state — shared across endpoints
// ---------------------------------------------------------------------------

let pipelineRunning = false;
let lastRun = null;        // ISO timestamp
let lastRunDuration = 0;   // milliseconds
let lastRunResult = null;  // { new, updated, errors }

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function requireAuth(req, res, next) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    logger.error(MOD, 'AUTH_SECRET not configured — rejecting request');
    return res.status(500).json({ error: 'Server auth not configured' });
  }

  const provided = req.headers['x-auth-secret'];
  if (!provided || provided !== secret) {
    logger.warn(MOD, `Unauthorized request to ${req.path} from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// ---------------------------------------------------------------------------
// Rate limiter for /trigger/* endpoints (60 req/min per IP)
// ---------------------------------------------------------------------------

const rateLimitMap = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;

function rateLimitTrigger(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;

  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 60 requests per minute.' });
  }

  next();
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.log(MOD, `${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ---------------------------------------------------------------------------
// JWT Auth routes (frontend PIN auth)
// ---------------------------------------------------------------------------
app.use('/api/auth', authRouter);

// All other /api/* routes require JWT
app.use('/api', requireJwtAuth);

app.use('/api/saved', savedRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/patterns', patternsRouter);
app.use('/api/for-you', forYouRouter);

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

app.get('/health', async (req, res) => {
  const supabaseOk = await testConnection();

  // Get trends count for status reporting
  let trendsCount = 0;
  try {
    const { count } = await supabase
      .from('trends')
      .select('*', { count: 'exact', head: true });
    trendsCount = count || 0;
  } catch {
    // Non-critical — report 0
  }

  const status = supabaseOk ? 'ok' : 'degraded';
  const statusCode = supabaseOk ? 200 : 503;

  res.status(statusCode).json({
    status,
    supabase: supabaseOk,
    lastScrape: lastRun,
    trendsCount,
    uptime: Math.round(process.uptime()),
    version: '1.0.0',
  });
});

// ---------------------------------------------------------------------------
// POST /trigger/scrape
// ---------------------------------------------------------------------------

app.post('/trigger/scrape', rateLimitTrigger, requireAuth, (req, res) => {
  if (pipelineRunning) {
    return res.status(409).json({
      error: 'Scrape already running',
      startedAt: lastRun,
    });
  }

  // Trigger pipeline asynchronously — respond immediately
  pipelineRunning = true;
  const triggerTime = new Date().toISOString();

  // Fire and forget — track state via module-level vars
  (async () => {
    const start = Date.now();
    try {
      const result = await runPipelineOnce();
      lastRunResult = result;
    } catch (err) {
      logger.error(MOD, 'Pipeline trigger failed', err);
      lastRunResult = { new: 0, updated: 0, errors: 1 };
    } finally {
      lastRunDuration = Date.now() - start;
      lastRun = new Date().toISOString();
      pipelineRunning = false;
    }
  })();

  res.status(202).json({
    message: 'Scrape triggered',
    timestamp: triggerTime,
  });
});

// ---------------------------------------------------------------------------
// GET /status/pipeline
// ---------------------------------------------------------------------------

app.get('/status/pipeline', (req, res) => {
  res.json({
    running: pipelineRunning,
    lastRun,
    lastRunDuration,
    lastRunResult,
  });
});

// ---------------------------------------------------------------------------
// POST /webhook/test
// ---------------------------------------------------------------------------

app.post('/webhook/test', requireAuth, (req, res) => {
  res.json({ message: 'Webhook endpoint alive' });
});

// ---------------------------------------------------------------------------
// Serve frontend static files
// ---------------------------------------------------------------------------

const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// SPA fallback — all non-API routes serve index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/health') ||
      req.path.startsWith('/trigger/') || req.path.startsWith('/status/') ||
      req.path.startsWith('/webhook/')) {
    return next();
  }
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) next();
  });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3001;

async function start() {
  // Test Supabase connectivity — log but don't crash
  const dbOk = await testConnection();
  if (dbOk) {
    logger.log(MOD, 'Supabase connection verified');
  } else {
    logger.warn(MOD, 'Supabase unreachable at startup — will retry on requests');
  }

  // Log auth config (length, not value)
  const authSecret = process.env.AUTH_SECRET;
  if (authSecret) {
    logger.log(MOD, `AUTH_SECRET configured (${authSecret.length} chars)`);
  } else {
    logger.warn(MOD, 'AUTH_SECRET not set — /trigger and /webhook endpoints will reject all requests');
  }

  // Import and start the scheduler (may be a stub — import defensively)
  try {
    const scheduler = require('./scheduler');
    if (typeof scheduler.start === 'function') {
      scheduler.start();
      logger.log(MOD, 'Scheduler started');
    } else {
      logger.warn(MOD, 'Scheduler module has no start() — skipping');
    }
  } catch (err) {
    logger.warn(MOD, 'Scheduler not available — running without cron', err);
  }

  // Start listening
  const server = app.listen(PORT, () => {
    logger.log(MOD, `Server listening on http://localhost:${PORT}`);
    logger.log(MOD, 'Endpoints:');
    logger.log(MOD, '  GET  /health          — Health check');
    logger.log(MOD, '  POST /trigger/scrape  — Manual scrape trigger (auth required)');
    logger.log(MOD, '  GET  /status/pipeline — Pipeline run status');
    logger.log(MOD, '  POST /webhook/test    — Webhook connectivity test (auth required)');
  });

  // ---------------------------
  // Graceful shutdown
  // ---------------------------
  function shutdown(signal) {
    logger.log(MOD, `${signal} received — shutting down`);

    server.close(() => {
      logger.log(MOD, 'HTTP server closed');
    });

    // Stop scheduler if it has a stop method
    try {
      const scheduler = require('./scheduler');
      if (typeof scheduler.stop === 'function') {
        scheduler.stop();
        logger.log(MOD, 'Scheduler stopped');
      }
    } catch {
      // Scheduler not loaded — nothing to stop
    }

    // Log warning if pipeline is mid-run during shutdown
    if (pipelineRunning) {
      logger.warn(MOD, 'Pipeline still running during shutdown — browser will be force-closed');
    }

    // Give in-flight requests 5 seconds to complete, then force exit
    setTimeout(() => {
      logger.warn(MOD, 'Forcing exit after timeout');
      process.exit(0);
    }, 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();

module.exports = { app };
