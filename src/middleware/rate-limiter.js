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
