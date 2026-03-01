/**
 * Pure classification functions for trend lifecycle, urgency, and composite scoring.
 * No side effects, no I/O, no external dependencies.
 */

const { calculateEngagementRate, calculateMomentum } = require('./engagement');

/**
 * Classifies a trend into a category based on its metrics and pattern score.
 *
 * @param {object} trend
 * @param {number} trend.replication_count
 * @param {number} trend.velocity_score
 * @param {number} trend.engagement_rate
 * @param {number} patternScore - Pattern detection score (from patterns module)
 * @returns {'confirmed_trend' | 'emerging_trend' | 'brand_opportunity' | 'viral_moment' | 'noise'}
 */
function classifyTrend(trend, patternScore) {
  const { replication_count, velocity_score, engagement_rate } = trend;

  if (replication_count >= 20 && patternScore >= 15) {
    return 'confirmed_trend';
  }
  if (replication_count >= 5 && velocity_score >= 40) {
    return 'emerging_trend';
  }
  // viral_moment must be checked before brand_opportunity since
  // velocity >= 60 would also match brand_opportunity's velocity >= 50
  if (velocity_score >= 60 && replication_count < 5) {
    return 'viral_moment';
  }
  if (engagement_rate >= 40 || velocity_score >= 50) {
    return 'brand_opportunity';
  }
  return 'noise';
}

/**
 * Determines the lifecycle stage of a trend based on age, momentum, and replication.
 *
 * @param {Array<{views: number, likes: number, comments: number, shares: number, captured_at: string}>} snapshots
 *   Ordered oldest to newest.
 * @param {number} replicationCount
 * @returns {'emerging' | 'growing' | 'peaking' | 'declining' | 'dead'}
 */
function calculateLifecycleStage(snapshots, replicationCount) {
  if (!snapshots || snapshots.length === 0) return 'emerging';

  // Calculate age in hours from the oldest snapshot
  const oldest = new Date(snapshots[0].captured_at);
  const ageHours = (Date.now() - oldest.getTime()) / (1000 * 60 * 60);

  // Calculate momentum and current engagement rate
  const momentum = calculateMomentum(snapshots);
  const latest = snapshots[snapshots.length - 1];
  const engagementRate = calculateEngagementRate(
    latest.likes, latest.comments, latest.shares, latest.views
  );

  // Dead: old or decelerating with very low engagement
  if (ageHours > 120 || (momentum === 'decelerating' && engagementRate < 2)) {
    return 'dead';
  }

  // Declining: decelerating and not fresh
  if (momentum === 'decelerating' && ageHours > 48) {
    return 'declining';
  }

  // Peaking: high replication or mature and stable
  if (replicationCount >= 50 || (ageHours > 48 && momentum === 'stable')) {
    return 'peaking';
  }

  // Growing: medium age with acceleration or moderate replication
  if (ageHours >= 24 && ageHours <= 72 &&
      (momentum === 'accelerating' || (replicationCount >= 20 && replicationCount < 50))) {
    return 'growing';
  }

  // Emerging: fresh and low replication
  if (ageHours < 24 && replicationCount < 20) {
    return 'emerging';
  }

  // Fallback for trends between 24-72h without strong signals
  if (ageHours >= 24 && ageHours <= 72) {
    return 'growing';
  }

  return 'emerging';
}

/**
 * Assigns urgency level based on lifecycle stage and hours since first seen.
 *
 * @param {'emerging' | 'growing' | 'peaking' | 'declining' | 'dead'} lifecycleStage
 * @param {number} hoursOld - Hours since the trend was first scraped
 * @returns {'act_now' | 'decide_today' | 'watch' | 'archive'}
 */
function assignUrgencyLevel(lifecycleStage, hoursOld) {
  if (lifecycleStage === 'declining' || lifecycleStage === 'dead') {
    return 'archive';
  }

  if (lifecycleStage === 'emerging') {
    return 'watch';
  }

  if (lifecycleStage === 'peaking' && hoursOld < 12) {
    return 'act_now';
  }
  if (lifecycleStage === 'growing' && hoursOld < 8) {
    return 'act_now';
  }

  if (lifecycleStage === 'growing' && hoursOld >= 8 && hoursOld <= 36) {
    return 'decide_today';
  }
  if (lifecycleStage === 'peaking' && hoursOld >= 12 && hoursOld <= 36) {
    return 'decide_today';
  }

  // Peaking or growing beyond 36 hours — still worth watching
  return 'watch';
}

/**
 * Calculates the composite trend score (0-100) from multiple dimensions.
 *
 * Weights:
 * - Replication component (35%): replicationCount normalized to 0-100, capped at 100 creators
 * - Velocity (25%): velocityScore as-is
 * - Engagement quality (20%): engagementRate / 30 * 100, capped at 100
 * - Pattern (15%): patternScore as-is
 * - Raw engagement (5%): same as engagement quality
 *
 * @param {number} engagementRate
 * @param {number} velocityScore
 * @param {number} replicationCount
 * @param {number} patternScore
 * @returns {number} Composite score 0-100, rounded to 2 decimal places.
 */
function compositeScore(engagementRate, velocityScore, replicationCount, patternScore) {
  // Normalize replication: 0-100 creators mapped to 0-100 score
  const replicationNorm = Math.min((replicationCount / 100) * 100, 100);

  // Normalize engagement quality: 30% engagement rate = 100 score
  const engagementQuality = Math.min((engagementRate / 30) * 100, 100);

  const score =
    replicationNorm * 0.35 +
    velocityScore * 0.25 +
    engagementQuality * 0.20 +
    patternScore * 0.15 +
    engagementQuality * 0.05;

  return Math.round(Math.min(score, 100) * 100) / 100;
}

module.exports = {
  classifyTrend,
  calculateLifecycleStage,
  assignUrgencyLevel,
  compositeScore,
};
