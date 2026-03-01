/**
 * Pure scoring functions for replication signal detection.
 * Analyzes audio reuse and hashtag co-occurrence across a batch of trends.
 * No side effects, no I/O, no external dependencies.
 */

/**
 * Analyzes a batch of trends to build replication signal data.
 *
 * Groups trends by audio_id and counts unique authors per audio.
 * Finds hashtag pairs that co-occur in 5+ different trends.
 *
 * @param {Array<{audio_id: string, author: string, hashtags: string[]}>} trends
 *   Array of all trends scraped in the last 72 hours.
 * @returns {{audioMap: Map<string, number>, hashtagClusters: Map<string, number>}}
 *   audioMap: audio_id -> count of unique authors using that audio.
 *   hashtagClusters: "tag1|tag2" -> count of trends containing both hashtags.
 */
function calculateReplicationScore(trends) {
  if (!trends || trends.length === 0) {
    return { audioMap: new Map(), hashtagClusters: new Map() };
  }

  // --- Audio replication: count unique authors per audio_id ---
  const audioAuthors = new Map(); // audio_id -> Set<author>
  for (const trend of trends) {
    if (!trend.audio_id) continue;
    if (!audioAuthors.has(trend.audio_id)) {
      audioAuthors.set(trend.audio_id, new Set());
    }
    audioAuthors.get(trend.audio_id).add(trend.author);
  }

  const audioMap = new Map();
  for (const [audioId, authors] of audioAuthors) {
    audioMap.set(audioId, authors.size);
  }

  // --- Hashtag co-occurrence: find pairs appearing in 5+ trends ---
  const pairCounts = new Map(); // "tag1|tag2" -> count

  for (const trend of trends) {
    if (!trend.hashtags || trend.hashtags.length < 2) continue;

    // Normalize and deduplicate hashtags for this trend
    const tags = [...new Set(trend.hashtags.map((t) => t.toLowerCase().trim()))];
    tags.sort();

    // Generate all unique pairs
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = `${tags[i]}|${tags[j]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  // Filter to only pairs appearing in 5+ trends
  const hashtagClusters = new Map();
  for (const [pair, count] of pairCounts) {
    if (count >= 5) {
      hashtagClusters.set(pair, count);
    }
  }

  return { audioMap, hashtagClusters };
}

/**
 * Gets the replication count for a specific trend based on its audio and hashtags.
 *
 * Takes the max of:
 * - How many unique authors used the same audio_id
 * - The highest co-occurrence count among the trend's hashtag pairs
 *
 * @param {string} audioId - The trend's audio_id
 * @param {string[]} hashtags - The trend's hashtags
 * @param {{audioMap: Map<string, number>, hashtagClusters: Map<string, number>}} replicationData
 *   Output from calculateReplicationScore().
 * @returns {number} Integer replication count (minimum 0).
 */
function getReplicationCount(audioId, hashtags, replicationData) {
  const { audioMap, hashtagClusters } = replicationData;

  // Audio-based count
  const audioCount = (audioId && audioMap.has(audioId)) ? audioMap.get(audioId) : 0;

  // Hashtag cluster-based count: find the highest pair count for this trend's tags
  let maxHashtagCount = 0;
  if (hashtags && hashtags.length >= 2) {
    const tags = [...new Set(hashtags.map((t) => t.toLowerCase().trim()))];
    tags.sort();

    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = `${tags[i]}|${tags[j]}`;
        const count = hashtagClusters.get(key) || 0;
        if (count > maxHashtagCount) {
          maxHashtagCount = count;
        }
      }
    }
  }

  return Math.max(audioCount, maxHashtagCount);
}

module.exports = {
  calculateReplicationScore,
  getReplicationCount,
};
