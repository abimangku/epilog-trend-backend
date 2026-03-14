/**
 * Pure scoring functions for engagement metrics.
 * No side effects, no I/O, no external dependencies.
 */

// Maximum expected weighted engagement volume for normalization.
// Mega-viral: ~5M likes + 50K comments*2 + 600K shares*3 = ~6.9M. log10(6.9M) ≈ 6.84
// Use 10M as ceiling so scores don't cluster near 100.
const MAX_VOLUME = 10_000_000;

/**
 * Calculates weighted engagement volume for FYP scoring (views=0 context).
 * Comments weighted 2x (deeper engagement), shares weighted 3x (distribution).
 * @param {number} likes
 * @param {number} comments
 * @param {number} shares
 * @returns {number} Weighted volume
 */
function weightedVolume(likes, comments, shares) {
  return likes + comments * 2 + shares * 3;
}

/**
 * Calculates engagement rate as a percentage.
 *
 * When views > 0, uses classic (likes+comments+shares)/views formula.
 * When views is 0/null/undefined (FYP context), switches to logarithmic
 * volume-based scoring using weighted engagement counts.
 *
 * @param {number} likes
 * @param {number} comments
 * @param {number} shares
 * @param {number} views
 * @returns {number} Engagement rate as percentage (0-100+).
 */
function calculateEngagementRate(likes, comments, shares, views) {
  if (views && views > 0) {
    return ((likes + comments + shares) / views) * 100;
  }
  // FYP-native: volume-based score using logarithmic scaling
  const volume = weightedVolume(likes, comments, shares);
  if (volume <= 0) return 0;
  return (Math.log10(volume + 1) / Math.log10(MAX_VOLUME + 1)) * 100;
}

/**
 * Calculates velocity score from time-series engagement snapshots.
 *
 * Measures how fast engagement is growing by computing the rate of change
 * between consecutive snapshots, weighted toward recent changes.
 *
 * @param {Array<{views: number, likes: number, comments: number, shares: number, captured_at: string}>} snapshots
 *   Ordered oldest to newest.
 * @param {object|null} [previousSnapshot] - Most recent snapshot from a previous pipeline run
 * @param {object|null} [currentMetrics] - Current scrape metrics for cross-run delta
 * @returns {number} Velocity score normalized to 0-100.
 */
function calculateVelocityScore(snapshots, previousSnapshot, currentMetrics) {
  if ((!snapshots || snapshots.length === 0) && !previousSnapshot) return 0;
  if (!snapshots) snapshots = [];

  // Cross-run velocity: compare current metrics to previous pipeline run's snapshot
  if (previousSnapshot && currentMetrics) {
    const prevTime = new Date(previousSnapshot.captured_at).getTime();
    const currTime = new Date(currentMetrics.captured_at || Date.now()).getTime();
    const hoursBetween = (currTime - prevTime) / (1000 * 60 * 60);

    // Ignore stale snapshots (>72h) or invalid time gaps
    if (hoursBetween > 0 && hoursBetween < 72) {
      const currViews = currentMetrics.views || 0;
      const prevViews = previousSnapshot.views || 0;

      if (currViews > 0 && prevViews > 0) {
        // Normal mode: view-based velocity
        const viewsPerHour = Math.max(0, (currViews - prevViews) / hoursBetween);
        return Math.min(100, Math.round(
          (Math.log10(Math.max(viewsPerHour, 1)) / Math.log10(100000)) * 100 * 100
        ) / 100);
      } else {
        // FYP mode: weighted volume delta
        const currVolume = (currentMetrics.likes || 0) + (currentMetrics.comments || 0) * 2 + (currentMetrics.shares || 0) * 3;
        const prevVolume = (previousSnapshot.likes || 0) + (previousSnapshot.comments || 0) * 2 + (previousSnapshot.shares || 0) * 3;
        const volumePerHour = Math.max(0, (currVolume - prevVolume) / hoursBetween);
        const MAX_VOLUME_VELOCITY = 10000000;
        return Math.min(100, Math.round(
          (Math.log10(Math.max(volumePerHour, 1)) / Math.log10(MAX_VOLUME_VELOCITY)) * 100 * 100
        ) / 100);
      }
    }
  }

  // Fall through to existing single-batch behavior below
  if (snapshots.length === 0) return 0;

  const isFYP = snapshots.every((s) => !s.views || s.views === 0);

  // Single snapshot: return engagement score, capped at 100
  if (snapshots.length === 1) {
    const s = snapshots[0];
    if (isFYP) {
      const vol = weightedVolume(s.likes, s.comments, s.shares);
      if (vol <= 0) return 0;
      return Math.min((Math.log10(vol + 1) / Math.log10(MAX_VOLUME + 1)) * 100, 100);
    }
    const rate = calculateEngagementRate(s.likes, s.comments, s.shares, s.views);
    return Math.min(rate, 100);
  }

  // Calculate metric for each snapshot: weighted volume (FYP) or engagement rate
  const metrics = snapshots.map((s) => {
    if (isFYP) {
      return weightedVolume(s.likes, s.comments, s.shares);
    }
    return calculateEngagementRate(s.likes, s.comments, s.shares, s.views);
  });

  // Calculate rate of change between consecutive snapshots
  const changes = [];
  for (let i = 1; i < metrics.length; i++) {
    const prev = metrics[i - 1];
    if (prev === 0) {
      changes.push(metrics[i] > 0 ? 100 : 0);
    } else {
      changes.push(((metrics[i] - prev) / prev) * 100);
    }
  }

  // Weight recent changes higher: most recent = 1.0, previous = 0.7, before that = 0.4
  const weights = [0.4, 0.7, 1.0];
  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < changes.length; i++) {
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

  const isFYP = snapshots.every((s) => !s.views || s.views === 0);

  // Use weighted volume (FYP) or engagement rate for metric comparison
  const metrics = snapshots.map((s) => {
    if (isFYP) {
      return weightedVolume(s.likes, s.comments, s.shares);
    }
    return calculateEngagementRate(s.likes, s.comments, s.shares, s.views);
  });

  // Calculate the last two velocity changes
  const prevChange = metrics[metrics.length - 2] - metrics[metrics.length - 3];
  const currentChange = metrics[metrics.length - 1] - metrics[metrics.length - 2];

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

/**
 * Calculates weighted engagement rate where different actions have different weights.
 * Shares (3x) > Saves (2x) > Comments (1.5x) > Likes (1x).
 * This better reflects TikTok's own algorithm weighting.
 *
 * @param {number} likes
 * @param {number} comments
 * @param {number} shares
 * @param {number} bookmarks - Saves/bookmarks count
 * @param {number} views
 * @returns {number} Weighted engagement rate as percentage (0-100+)
 */
function calculateWeightedEngagementRate(likes, comments, shares, bookmarks, views) {
  const safeBookmarks = bookmarks || 0;
  if (views && views > 0) {
    const weighted = likes + comments * 1.5 + shares * 3 + safeBookmarks * 2;
    return (weighted / views) * 100;
  }
  // FYP-native: volume-based score
  const volume = likes + comments * 2 + shares * 3 + safeBookmarks * 2;
  if (volume <= 0) return 0;
  return (Math.log10(volume + 1) / Math.log10(MAX_VOLUME + 1)) * 100;
}

/**
 * Calculates share ratio — shares as a percentage of views.
 * This is the single strongest externally measurable virality predictor.
 *
 * @param {number} shares
 * @param {number} views
 * @returns {number} Share ratio as percentage (0-100), capped at 100
 */
function calculateShareRatio(shares, views) {
  if (!views || views <= 0 || !shares) return 0;
  return Math.min((shares / views) * 100, 100);
}

/**
 * Half-life for recency decay in hours. Exported for testability.
 * At 12h, a trend retains 50% of its recency score.
 */
const RECENCY_HALF_LIFE_HOURS = 12;

/**
 * Calculates exponential decay multiplier based on trend age.
 * Used as final multiplier on composite trend score.
 *
 * @param {string|null} scrapedAt - ISO timestamp of when trend was scraped
 * @param {Date} [now=new Date()] - Current time (injectable for testing)
 * @returns {number} Multiplier 0.0-1.0 (1.0 = brand new, 0.5 = half-life age)
 */
function calculateRecencyMultiplier(scrapedAt, now) {
  if (!scrapedAt) return 1.0;
  const scrapedTime = new Date(scrapedAt).getTime();
  if (isNaN(scrapedTime)) return 1.0;
  const currentTime = (now || new Date()).getTime();
  const ageHours = Math.max(0, (currentTime - scrapedTime) / (1000 * 60 * 60));
  return Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS);
}

module.exports = {
  calculateEngagementRate,
  calculateVelocityScore,
  calculateMomentum,
  calculateWeightedEngagementRate,
  calculateShareRatio,
  calculateRecencyMultiplier,
  RECENCY_HALF_LIFE_HOURS,
};
