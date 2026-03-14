/**
 * Pure functions for detecting Indonesian cultural signals in TikTok content.
 * No side effects, no I/O, no external dependencies.
 */

const calendarData = require('../config/cultural-calendar.json');

/**
 * Cultural signal keyword map. Keys are signal names, values are arrays of
 * case-insensitive keywords to match against title + hashtags.
 */
const CULTURAL_KEYWORDS = {
  ramadan: ['ramadan', 'puasa', 'sahur', 'buka puasa', 'ngabuburit', 'takjil', 'iftar', 'suhoor'],
  lebaran: ['lebaran', 'eid', 'idul fitri', 'mudik', 'ketupat', 'halal bihalal', 'thr'],
  imlek: ['imlek', 'chinese new year', 'tahun baru cina', 'barongsai', 'angpao'],
  independence_day: ['17 agustus', 'kemerdekaan', 'dirgahayu', 'merah putih', 'hut ri'],
  school_season: ['back to school', 'masuk sekolah', 'ospek', 'orientasi', 'ppdb', 'ajaran baru'],
  year_end: ['akhir tahun', 'tahun baru', 'new year', 'resolusi', 'liburan akhir tahun'],
  indonesian_slang: [
    'stecu', 'gabut', 'bucin', 'cuan', 'sultan', 'mager', 'baper', 'julid',
    'ngakak', 'receh', 'spill', 'healing', 'literally me', 'aku banget',
    'no cap', 'bestie', 'slay', 'anjir', 'astaga',
  ],
  cross_platform: [
    'repost', 'trending everywhere', 'viral di mana-mana',
    'semua orang', 'semua bikin',
  ],
};

/**
 * Indonesian location hashtags for content origin detection.
 */
const INDONESIAN_LOCATION_TAGS = [
  'id', 'indonesia', 'jakarta', 'bandung', 'surabaya', 'bali', 'jogja',
];

/**
 * Common Indonesian words for language detection.
 */
const INDONESIAN_WORDS = [
  'dan', 'yang', 'dengan', 'untuk', 'tidak', 'bisa', 'aku', 'kamu', 'ini', 'itu',
];

/**
 * Detects Indonesian cultural signals from a video's title and hashtags.
 *
 * Performs case-insensitive substring matching against cultural moment
 * keywords covering religious holidays, national events, slang, and
 * cross-platform virality signals.
 *
 * @param {string} title - Video title
 * @param {string[]} hashtags - Array of hashtag strings (without # prefix)
 * @returns {string[]} Array of matched signal names (e.g. ['ramadan', 'indonesian_slang'])
 */
function detectCulturalSignals(title, hashtags) {
  const searchText = [
    title || '',
    ...(hashtags || []),
  ].join(' ').toLowerCase();

  const matched = [];

  for (const [signal, keywords] of Object.entries(CULTURAL_KEYWORDS)) {
    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        matched.push(signal);
        break; // One match per signal is enough
      }
    }
  }

  return matched;
}

/**
 * Estimates confidence that content originates from Indonesian TikTok.
 *
 * Scoring components:
 * - Indonesian slang detected: +0.4
 * - Indonesian cultural moment detected: +0.3
 * - Indonesian location hashtags: +0.2
 * - Title contains Indonesian words: +0.1
 *
 * @param {string} title - Video title
 * @param {string[]} hashtags - Array of hashtag strings (without # prefix)
 * @returns {number} Confidence score 0.0 to 1.0
 */
function isIndonesianContent(title, hashtags) {
  const titleLower = (title || '').toLowerCase();
  const hashtagsLower = (hashtags || []).map((h) => h.toLowerCase());
  const allText = [titleLower, ...hashtagsLower].join(' ');

  let confidence = 0;

  // Indonesian slang: +0.4
  const slangKeywords = CULTURAL_KEYWORDS.indonesian_slang;
  const hasSlang = slangKeywords.some((kw) => allText.includes(kw));
  if (hasSlang) confidence += 0.4;

  // Indonesian cultural moment: +0.3
  // Check all cultural signals except slang and cross_platform
  const culturalSignals = Object.entries(CULTURAL_KEYWORDS)
    .filter(([key]) => key !== 'indonesian_slang' && key !== 'cross_platform');
  const hasCultural = culturalSignals.some(([, keywords]) =>
    keywords.some((kw) => allText.includes(kw))
  );
  if (hasCultural) confidence += 0.3;

  // Indonesian location hashtags: +0.2
  const hasLocation = hashtagsLower.some((tag) =>
    INDONESIAN_LOCATION_TAGS.includes(tag)
  );
  if (hasLocation) confidence += 0.2;

  // Title contains Indonesian words: +0.1
  // Use word boundary matching to avoid false positives (e.g. "dandelion" matching "dan")
  const titleWords = titleLower.split(/\s+/);
  const hasIndonesianWords = INDONESIAN_WORDS.some((word) =>
    titleWords.includes(word)
  );
  if (hasIndonesianWords) confidence += 0.1;

  return Math.min(confidence, 1.0);
}

/**
 * Returns cultural moments that are currently active for a given date.
 * Checks the cultural-calendar.json config for matching date ranges.
 *
 * @param {Date} [date=new Date()] - Date to check
 * @returns {Array<{name: string, label: string, score_boost: number, brand_relevance: object}>}
 */
function getActiveCulturalMoments(date) {
  const d = date || new Date();
  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate();
  const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const active = [];

  for (const event of calendarData.events) {
    for (const period of event.periods) {
      if (period.recurring === 'monthly') {
        // Payday: 25th to 1st of next month
        if (day >= 25 || day <= 1) {
          active.push({
            name: event.name,
            label: event.label,
            score_boost: event.score_boost,
            brand_relevance: event.brand_relevance,
          });
        }
        break;
      }

      const start = period.start;
      const end = period.end;

      if (start <= end) {
        // Normal range (e.g., "03-01" to "04-10")
        if (mmdd >= start && mmdd <= end) {
          active.push({
            name: event.name,
            label: event.label,
            score_boost: event.score_boost,
            brand_relevance: event.brand_relevance,
          });
          break;
        }
      } else {
        // Wrapping range (e.g., "12-15" to "01-05" or "10-01" to "03-31")
        if (mmdd >= start || mmdd <= end) {
          active.push({
            name: event.name,
            label: event.label,
            score_boost: event.score_boost,
            brand_relevance: event.brand_relevance,
          });
          break;
        }
      }
    }
  }

  return active;
}

module.exports = {
  CULTURAL_KEYWORDS,
  INDONESIAN_LOCATION_TAGS,
  INDONESIAN_WORDS,
  detectCulturalSignals,
  isIndonesianContent,
  getActiveCulturalMoments,
};
