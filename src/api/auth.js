const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const logger = require('../logger');
const { requireAuth } = require('./middleware');

const MOD = 'AUTH';
const router = express.Router();

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

/**
 * POST /api/auth/pin — Verify PIN, return JWT.
 * Request body: { pin: "1234" }
 * Response 200: { token: "jwt..." }
 * Response 400: { error: "PIN is required" }
 * Response 401: { error: "Invalid PIN" }
 * Response 500: { error: "Server configuration error" } | { error: "Authentication failed" }
 */
router.post('/pin', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || typeof pin !== 'string') {
      return res.status(400).json({ error: 'PIN is required' });
    }

    // Check lockout before processing
    if (checkLockout(req.ip)) {
      logger.warn(MOD, `Locked-out IP ${req.ip} attempted PIN auth`);
      return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    }

    const pinHash = process.env.TEAM_PIN_HASH;
    if (!pinHash) {
      logger.error(MOD, 'TEAM_PIN_HASH env var not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const valid = await bcrypt.compare(pin, pinHash);
    if (!valid) {
      recordFailedAttempt(req.ip);
      logger.warn(MOD, `Failed PIN attempt from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    clearFailedAttempts(req.ip);

    const token = jwt.sign(
      { type: 'team', iat: Math.floor(Date.now() / 1000) },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    logger.log(MOD, `PIN auth successful from ${req.ip}`);
    res.json({ token });
  } catch (err) {
    logger.error(MOD, 'PIN auth error', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * GET /api/auth/verify — Validate JWT session.
 * Header: Authorization: Bearer <jwt>
 * Response 200: { valid: true }
 * Response 401: handled by requireAuth middleware (missing/invalid token).
 */
router.get('/verify', requireAuth, (req, res) => {
  res.json({ valid: true });
});

module.exports = router;
