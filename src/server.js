require('dotenv').config();

const express = require('express');
const path = require('path');
const logger = require('./logger');
const { testConnection, supabase, acknowledgePipelineEvents } = require('./database/supabase');
const { runPipelineOnce } = require('./pipeline');
const { validateEnv } = require('./config/validate-env');
const authRouter = require('./api/auth');
const { requireAuth: requireJwtAuth } = require('./api/middleware');
const savedRouter = require('./api/saved');
const collectionsRouter = require('./api/collections');
const patternsRouter = require('./api/patterns');
const forYouRouter = require('./api/for-you');
const schedulesRouter = require('./api/schedules');
const helmet = require('helmet');
const { pinLimiter, triggerLimiter, apiLimiter } = require('./middleware/rate-limiter');

const MOD = 'SERVER';

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
// Express app
// ---------------------------------------------------------------------------

const app = express();

// Middleware
app.use(express.json());

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
app.use('/api/auth', pinLimiter, authRouter);

// All other /api/* routes require JWT
app.use('/api', apiLimiter, requireJwtAuth);

app.use('/api/saved', savedRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/patterns', patternsRouter);
app.use('/api/for-you', forYouRouter);
app.use('/api/schedules', schedulesRouter);

app.post('/api/events/acknowledge', async (req, res) => {
  try {
    await acknowledgePipelineEvents(req.body.eventIds || null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to acknowledge events' });
  }
});

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

  // Get last pipeline run
  let lastPipelineRun = null;
  try {
    const { data } = await supabase
      .from('pipeline_runs')
      .select('started_at, completed_at, status, videos_scraped, videos_analyzed')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastPipelineRun = data;
  } catch {
    // Non-critical
  }

  // Determine health status
  const lastRunAge = lastPipelineRun?.completed_at
    ? (Date.now() - new Date(lastPipelineRun.completed_at).getTime()) / 1000
    : null;

  let status = 'healthy';
  if (!supabaseOk) status = 'unhealthy';
  else if (!lastPipelineRun || lastRunAge > 6 * 3600) status = 'degraded';
  else if (lastPipelineRun.status === 'failed') status = 'degraded';

  const statusCode = status === 'unhealthy' ? 503 : 200;
  const mem = process.memoryUsage();

  res.status(statusCode).json({
    status,
    supabase: supabaseOk,
    lastPipelineRun: lastPipelineRun ? {
      startedAt: lastPipelineRun.started_at,
      completedAt: lastPipelineRun.completed_at,
      status: lastPipelineRun.status,
      videosScraped: lastPipelineRun.videos_scraped,
      videosAnalyzed: lastPipelineRun.videos_analyzed,
    } : null,
    pipelineRunning,
    trendsCount,
    uptime: Math.round(process.uptime()),
    memory_mb: Math.round(mem.heapUsed / 1024 / 1024),
    version: '1.1.0',
  });
});

// ---------------------------------------------------------------------------
// POST /trigger/scrape
// ---------------------------------------------------------------------------

app.post('/trigger/scrape', triggerLimiter, requireAuth, (req, res) => {
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
app.get('{*path}', (req, res, next) => {
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
  // Validate required environment variables — throw to prevent startup
  // (thrown error propagates naturally; PM2 handles restart per CLAUDE.md convention)
  validateEnv(process.env, {
    onWarn: (msg) => logger.warn(MOD, msg),
  });
  logger.log(MOD, 'Environment variables validated');

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
