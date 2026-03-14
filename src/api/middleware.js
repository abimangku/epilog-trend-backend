const jwt = require('jsonwebtoken');
const logger = require('../logger');

const MOD = 'AUTH_MW';

/**
 * Express middleware that verifies JWT from Authorization header.
 * Rejects with 401 if token is missing or invalid.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = decoded;
    next();
  } catch (err) {
    logger.error(MOD, 'JWT verification failed', err);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
