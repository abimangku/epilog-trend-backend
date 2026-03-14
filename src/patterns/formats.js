/**
 * Pure functions for detecting replicable content formats from video metadata.
 * No side effects, no I/O, no external dependencies.
 */

/**
 * Format keyword map. Keys are format names, values are arrays of
 * case-insensitive keywords to match against title + hashtags.
 */
const FORMAT_KEYWORDS = {
  transformation: ['transformation', 'transform', 'before after', 'glow up', 'glowup', 'before vs after'],
  pov: ['pov', 'point of view'],
  tutorial: ['tutorial', 'how to', 'cara', 'langkah', 'tips', 'trick', 'cara mudah', 'belajar'],
  asmr: ['asmr', 'satisfying', 'relaxing', 'sound', 'suara'],
  storytime: ['storytime', 'story time', 'cerita', 'ceritain', 'pengalaman', 'kisah'],
  challenge: ['challenge', 'ikutin', 'cobain', 'coba', 'dare'],
  duet: ['duet', 'collab', 'collaboration', 'bareng'],
  mukbang: ['mukbang', 'makan', 'eating', 'food', 'kuliner', 'review makanan'],
  unboxing: ['unboxing', 'unbox', 'buka', 'haul', 'review produk'],
  dayinlife: ['day in my life', 'daily', 'rutinitas', 'kehidupan sehari'],
};

/**
 * Detects content formats from a video's title and hashtags.
 *
 * Performs case-insensitive substring matching against a predefined
 * keyword map covering common TikTok formats in English and Bahasa Indonesia.
 *
 * @param {string} title - Video title
 * @param {string[]} hashtags - Array of hashtag strings (without # prefix)
 * @returns {string[]} Array of matched format names (e.g. ['tutorial', 'mukbang'])
 */
function detectFormat(title, hashtags) {
  // Build a single searchable string from title + hashtags
  const searchText = [
    title || '',
    ...(hashtags || []),
  ].join(' ').toLowerCase();

  const matched = [];

  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        matched.push(format);
        break; // One match per format is enough
      }
    }
  }

  return matched;
}

/**
 * Calculates a pattern score from detected formats, cultural signals, replication,
 * and optional calendar-based boost.
 *
 * Components:
 * - Format bonus: +10 per format, capped at 30
 * - Cultural signal bonus: +15 per signal, capped at 30
 * - Replication boost: (replicationCount / 100) * 40, capped at 40
 * - Calendar boost: from cultural calendar (0-25)
 * - Total capped at 100
 *
 * @param {string[]} formats - Output from detectFormat()
 * @param {string[]} culturalSignals - Output from detectCulturalSignals()
 * @param {number} replicationCount - Number of creators replicating the format
 * @param {number} [calendarBoost=0] - Score boost from active cultural calendar events
 * @returns {number} Pattern score 0-100
 */
function calculatePatternScore(formats, culturalSignals, replicationCount, calendarBoost) {
  const formatBonus = Math.min((formats || []).length * 10, 30);
  const culturalBonus = Math.min((culturalSignals || []).length * 15, 30);
  const replicationBoost = Math.min(((replicationCount || 0) / 100) * 40, 40);
  const calBoost = calendarBoost || 0;

  const total = formatBonus + culturalBonus + replicationBoost + calBoost;
  return Math.round(Math.min(total, 100) * 100) / 100;
}

module.exports = {
  FORMAT_KEYWORDS,
  detectFormat,
  calculatePatternScore,
};
