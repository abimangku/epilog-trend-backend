'use strict';

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
