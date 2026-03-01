/**
 * Pure scoring functions for engagement metrics.
 * No side effects, no I/O, no external dependencies.
 */

/**
 * Calculates engagement rate as a percentage.
 *
 * @param {number} likes
 * @param {number} comments
 * @param {number} shares
 * @param {number} views
 * @returns {number} Engagement rate as percentage (0-100+). Returns 0 if views is 0.
 */
function calculateEngagementRate(likes, comments, shares, views) {
  if (!views || views === 0) return 0;
  return ((likes + comments + shares) / views) * 100;
}

/**
 * Calculates velocity score from time-series engagement snapshots.
 *
 * Measures how fast engagement is growing by computing the rate of change
 * between consecutive snapshots, weighted toward recent changes.
 *
 * @param {Array<{views: number, likes: number, comments: number, shares: number, captured_at: string}>} snapshots
 *   Ordered oldest to newest.
 * @returns {number} Velocity score normalized to 0-100.
 */
function calculateVelocityScore(snapshots) {
  if (!snapshots || snapshots.length === 0) return 0;

  // Single snapshot: return raw engagement rate, capped at 100
  if (snapshots.length === 1) {
    const s = snapshots[0];
    const rate = calculateEngagementRate(s.likes, s.comments, s.shares, s.views);
    return Math.min(rate, 100);
  }

  // Calculate engagement rate for each snapshot
  const rates = snapshots.map((s) =>
    calculateEngagementRate(s.likes, s.comments, s.shares, s.views)
  );

  // Calculate rate of change between consecutive snapshots
  const changes = [];
  for (let i = 1; i < rates.length; i++) {
    const prev = rates[i - 1];
    if (prev === 0) {
      // If previous rate was 0, treat any growth as a large jump
      changes.push(rates[i] > 0 ? 100 : 0);
    } else {
      changes.push(((rates[i] - prev) / prev) * 100);
    }
  }

  // Weight recent changes higher: most recent = 1.0, previous = 0.7, before that = 0.4
  const weights = [0.4, 0.7, 1.0];
  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < changes.length; i++) {
    // Index from the end so the most recent change gets weight 1.0
    const weightIdx = weights.length - 1 - (changes.length - 1 - i);
    const w = weightIdx >= 0 ? weights[weightIdx] : 0.4;
    weightedSum += changes[i] * w;
    weightTotal += w;
  }

  if (weightTotal === 0) return 0;

  const raw = weightedSum / weightTotal;

  // Normalize to 0-100 range. Treat 50% weighted rate-of-change as velocity 100.
  const normalized = Math.max(0, Math.min(100, (raw / 50) * 100));
  return Math.round(normalized * 100) / 100;
}

/**
 * Determines momentum direction from engagement snapshots.
 *
 * Compares the most recent velocity change to the previous one.
 *
 * @param {Array<{views: number, likes: number, comments: number, shares: number, captured_at: string}>} snapshots
 *   Ordered oldest to newest.
 * @returns {'accelerating' | 'stable' | 'decelerating'}
 */
function calculateMomentum(snapshots) {
  if (!snapshots || snapshots.length < 3) return 'stable';

  const rates = snapshots.map((s) =>
    calculateEngagementRate(s.likes, s.comments, s.shares, s.views)
  );

  // Calculate the last two velocity changes
  const prevChange = rates[rates.length - 2] - rates[rates.length - 3];
  const currentChange = rates[rates.length - 1] - rates[rates.length - 2];

  // Guard against zero division — if previous change is zero, compare absolutes
  if (prevChange === 0 && currentChange === 0) return 'stable';
  if (prevChange === 0) return currentChange > 0 ? 'accelerating' : 'decelerating';

  // Use absolute magnitudes to compare direction-of-change correctly.
  // When engagement is dropping, "accelerating" means the drops are getting bigger.
  const absPrev = Math.abs(prevChange);
  const absCurr = Math.abs(currentChange);
  const sameDirection = (prevChange > 0 && currentChange > 0) || (prevChange < 0 && currentChange < 0);

  if (!sameDirection) {
    // Direction reversed — that's always a change in momentum
    return currentChange > 0 ? 'accelerating' : 'decelerating';
  }

  if (prevChange > 0) {
    // Both positive: growing faster = accelerating
    if (absCurr > absPrev * 1.2) return 'accelerating';
    if (absCurr < absPrev * 0.8) return 'decelerating';
  } else {
    // Both negative (engagement falling): bigger drops = decelerating
    if (absCurr > absPrev * 1.2) return 'decelerating';
    if (absCurr < absPrev * 0.8) return 'accelerating';
  }
  return 'stable';
}

module.exports = {
  calculateEngagementRate,
  calculateVelocityScore,
  calculateMomentum,
};
