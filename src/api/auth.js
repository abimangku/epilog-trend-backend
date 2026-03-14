const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const logger = require('../logger');
const { requireAuth } = require('./middleware');

const MOD = 'AUTH';
const router = express.Router();

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

    const pinHash = process.env.TEAM_PIN_HASH;
    if (!pinHash) {
      logger.error(MOD, 'TEAM_PIN_HASH env var not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const valid = await bcrypt.compare(pin, pinHash);
    if (!valid) {
      logger.warn(MOD, `Failed PIN attempt from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid PIN' });
    }

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
