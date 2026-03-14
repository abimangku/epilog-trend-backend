/**
 * Pure confidence calibration functions.
 * Adjusts raw LLM confidence scores using engagement metrics,
 * replication signals, and lifecycle stage data.
 * No side effects, no I/O, no external dependencies.
 */

/**
 * Calibrates a raw LLM confidence score by cross-referencing engagement,
 * replication, and lifecycle data from the scoring pipeline.
 *
 * Rules applied in order (cumulative):
 * 1. Start with rawConfidence
 * 2. If engagement_rate < 2 AND rawConfidence > 60: downgrade by 15
 * 3. If replication_count === 0: cap at 50
 * 4. If replication_count >= 3: boost by 10
 * 5. If lifecycle_stage === 'declining': downgrade by 10
 * 6. If lifecycle_stage === 'dead': downgrade by 20
 * 7. Clamp final result to 0-100
 *
 * @param {number} rawConfidence - LLM confidence score (0-100)
 * @param {object} trend - Trend object with scoring fields
 * @param {number} trend.engagement_rate - Engagement rate percentage
 * @param {number} trend.replication_count - Number of replications detected
 * @param {number} trend.velocity_score - Velocity score (0-100)
 * @param {string} trend.lifecycle_stage - One of: emerging, growing, peaking, declining, dead
 * @returns {number} Calibrated confidence score (0-100)
 */
function calibrateConfidence(rawConfidence, trend) {
  let score = rawConfidence;

  // Rule 2: Low engagement + high confidence = overconfident LLM
  if (trend.engagement_rate < 2 && rawConfidence > 60) {
    score -= 15;
  }

  // Rule 3: No replication = cap confidence
  if (trend.replication_count === 0) {
    score = Math.min(score, 50);
  }

  // Rule 4: High replication = boost confidence
  if (trend.replication_count >= 3) {
    score += 10;
  }

  // Rule 5: Declining lifecycle = downgrade
  if (trend.lifecycle_stage === 'declining') {
    score -= 10;
  }

  // Rule 6: Dead lifecycle = heavy downgrade
  if (trend.lifecycle_stage === 'dead') {
    score -= 20;
  }

  // Rule 7: Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

module.exports = { calibrateConfidence };
