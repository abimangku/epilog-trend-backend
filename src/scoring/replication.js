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

/**
 * Calculates saturation index — ratio of big creators in a trend's replicator set.
 * High saturation = big creators already jumped in (you're late).
 * Low saturation = small creators leading (early signal, high value).
 *
 * Unknown-tier creators are excluded from both numerator and denominator.
 *
 * @param {string} trendAudioId - The trend's audio_id
 * @param {string[]} trendHashtags - The trend's hashtags
 * @param {Array<{audio_id: string, author: string, author_tier: string, hashtags: string[]}>} allVideos
 *   All videos in the current batch, each with author_tier set.
 * @returns {number} Saturation index 0..1 (0 = no big creators, 1 = all big creators)
 */
function calculateSaturationIndex(trendAudioId, trendHashtags, allVideos) {
  if (!allVideos || allVideos.length <= 1) return 0;

  const normalizedTags = (trendHashtags || []).map(t => t.toLowerCase().trim());

  // Find replicators: other videos sharing the same audio OR overlapping hashtags
  const replicators = allVideos.filter(v => {
    // Audio match
    if (trendAudioId && v.audio_id === trendAudioId) return true;
    // Hashtag overlap (at least 1 shared tag)
    if (normalizedTags.length > 0 && v.hashtags && v.hashtags.length > 0) {
      const vTags = v.hashtags.map(t => t.toLowerCase().trim());
      return normalizedTags.some(tag => vTags.includes(tag));
    }
    return false;
  });

  // Need at least 2 replicators (including the trend itself) to compute meaningful saturation
  if (replicators.length <= 1) return 0;

  // Exclude unknown-tier creators from saturation math
  const knownReplicators = replicators.filter(v => v.author_tier && v.author_tier !== 'unknown');
  if (knownReplicators.length === 0) return 0;

  const BIG_TIERS = new Set(['macro', 'mega']);
  const bigCount = knownReplicators.filter(v => BIG_TIERS.has(v.author_tier)).length;

  return Math.round((bigCount / knownReplicators.length) * 10000) / 10000;
}

module.exports = {
  calculateReplicationScore,
  getReplicationCount,
  calculateSaturationIndex,
};
