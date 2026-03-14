const {
  detectFormat,
  calculatePatternScore,
} = require('../src/patterns/formats');

const {
  detectCulturalSignals,
  isIndonesianContent,
  getActiveCulturalMoments,
} = require('../src/patterns/cultural');

// ===========================================================================
// formats.js — detectFormat
// ===========================================================================

describe('detectFormat', () => {
  test('empty inputs return empty array', () => {
    expect(detectFormat('', [])).toEqual([]);
    expect(detectFormat(null, null)).toEqual([]);
  });

  test('detects single format from title', () => {
    expect(detectFormat('POV kamu ketemu mantan', [])).toContain('pov');
  });

  test('case insensitive matching', () => {
    expect(detectFormat('TUTORIAL MAKEUP', [])).toContain('tutorial');
    expect(detectFormat('Glow Up Challenge', [])).toContain('transformation');
    expect(detectFormat('Glow Up Challenge', [])).toContain('challenge');
  });

  test('detects format from hashtags', () => {
    expect(detectFormat('Look at this', ['asmr', 'satisfying'])).toContain('asmr');
  });

  test('Indonesian-English mixed title: tutorial format', () => {
    const formats = detectFormat('Cara mudah bikin nasi goreng — easy tutorial', ['masak']);
    expect(formats).toContain('tutorial');
  });

  test('Indonesian-English mixed title: storytime format', () => {
    const formats = detectFormat('Cerita pengalaman kerja di luar negeri', ['storytime', 'fyp']);
    expect(formats).toContain('storytime');
  });

  test('detects multiple formats simultaneously', () => {
    const formats = detectFormat('POV: Tutorial cara glow up', ['challenge']);
    expect(formats).toContain('pov');
    expect(formats).toContain('tutorial');
    expect(formats).toContain('transformation');
    expect(formats).toContain('challenge');
    expect(formats.length).toBe(4);
  });

  test('detects mukbang with Indonesian keyword', () => {
    expect(detectFormat('Review makanan viral', ['kuliner'])).toContain('mukbang');
  });

  test('detects unboxing with Indonesian keyword', () => {
    expect(detectFormat('Buka paket shopee haul', [])).toContain('unboxing');
  });

  test('detects dayinlife', () => {
    expect(detectFormat('Day in my life as a barista', ['daily'])).toContain('dayinlife');
  });

  test('detects dayinlife with Indonesian keyword', () => {
    expect(detectFormat('Rutinitas pagi aku', [])).toContain('dayinlife');
  });

  test('detects duet/collab', () => {
    expect(detectFormat('Duet bareng artis', ['collab'])).toContain('duet');
  });

  test('no false positive on partial word match for challenge', () => {
    // "cobain" should match challenge
    expect(detectFormat('Cobain resep baru', [])).toContain('challenge');
  });

  test('title-only detection without hashtags', () => {
    expect(detectFormat('Before after skincare routine', [])).toContain('transformation');
  });

  test('hashtag-only detection without title', () => {
    expect(detectFormat('', ['unboxing', 'haul'])).toContain('unboxing');
  });
});

// ===========================================================================
// formats.js — calculatePatternScore
// ===========================================================================

describe('calculatePatternScore', () => {
  test('all empty returns 0', () => {
    expect(calculatePatternScore([], [], 0)).toBe(0);
  });

  test('null inputs return 0', () => {
    expect(calculatePatternScore(null, null, null)).toBe(0);
  });

  test('format bonus: +10 per format, capped at 30', () => {
    expect(calculatePatternScore(['pov'], [], 0)).toBe(10);
    expect(calculatePatternScore(['pov', 'tutorial'], [], 0)).toBe(20);
    expect(calculatePatternScore(['pov', 'tutorial', 'asmr'], [], 0)).toBe(30);
    // 4 formats still capped at 30
    expect(calculatePatternScore(['pov', 'tutorial', 'asmr', 'mukbang'], [], 0)).toBe(30);
  });

  test('cultural bonus: +15 per signal, capped at 30', () => {
    expect(calculatePatternScore([], ['ramadan'], 0)).toBe(15);
    expect(calculatePatternScore([], ['ramadan', 'indonesian_slang'], 0)).toBe(30);
    // 3 signals still capped at 30
    expect(calculatePatternScore([], ['ramadan', 'lebaran', 'indonesian_slang'], 0)).toBe(30);
  });

  test('replication boost: (count/100)*40, capped at 40', () => {
    expect(calculatePatternScore([], [], 50)).toBe(20);  // 50/100*40 = 20
    expect(calculatePatternScore([], [], 100)).toBe(40); // 100/100*40 = 40
    expect(calculatePatternScore([], [], 200)).toBe(40); // capped at 40
  });

  test('combined score with all components', () => {
    // 2 formats (20) + 1 cultural (15) + 50 replication (20) = 55
    expect(calculatePatternScore(['pov', 'tutorial'], ['ramadan'], 50)).toBe(55);
  });

  test('total capped at 100', () => {
    // 3 formats (30) + 2 cultural (30) + 200 replication (40) = 100
    expect(calculatePatternScore(
      ['pov', 'tutorial', 'asmr'],
      ['ramadan', 'lebaran'],
      200
    )).toBe(100);
  });
});

// ===========================================================================
// cultural.js — detectCulturalSignals
// ===========================================================================

describe('detectCulturalSignals', () => {
  test('empty inputs return empty array', () => {
    expect(detectCulturalSignals('', [])).toEqual([]);
    expect(detectCulturalSignals(null, null)).toEqual([]);
  });

  test('detects ramadan signals', () => {
    expect(detectCulturalSignals('Menu sahur simple', ['ramadan'])).toContain('ramadan');
  });

  test('detects ramadan from multi-word keyword', () => {
    expect(detectCulturalSignals('Ide buka puasa', [])).toContain('ramadan');
  });

  test('detects lebaran signals', () => {
    expect(detectCulturalSignals('Outfit lebaran 2026', ['mudik'])).toContain('lebaran');
  });

  test('detects lebaran from thr keyword', () => {
    expect(detectCulturalSignals('Tips kelola THR', [])).toContain('lebaran');
  });

  test('detects imlek signals', () => {
    expect(detectCulturalSignals('Dekorasi imlek', ['angpao'])).toContain('imlek');
  });

  test('detects independence_day signals', () => {
    expect(detectCulturalSignals('Dirgahayu Indonesia', ['merah putih'])).toContain('independence_day');
  });

  test('detects school_season signals', () => {
    expect(detectCulturalSignals('Ospek kampus survival guide', ['back to school'])).toContain('school_season');
  });

  test('detects year_end signals', () => {
    expect(detectCulturalSignals('Resolusi tahun baru 2027', [])).toContain('year_end');
  });

  test('detects indonesian_slang', () => {
    expect(detectCulturalSignals('Gabut di rumah', ['mager'])).toContain('indonesian_slang');
  });

  test('detects multiple slang terms (only one match per signal)', () => {
    const signals = detectCulturalSignals('Bucin mager gabut', ['receh', 'ngakak']);
    expect(signals).toContain('indonesian_slang');
    // Should only appear once despite multiple keyword matches
    expect(signals.filter((s) => s === 'indonesian_slang').length).toBe(1);
  });

  test('detects cross_platform signals', () => {
    expect(detectCulturalSignals('Viral di mana-mana', [])).toContain('cross_platform');
    expect(detectCulturalSignals('Semua orang bikin ini', [])).toContain('cross_platform');
  });

  test('detects multiple cultural moments simultaneously', () => {
    const signals = detectCulturalSignals(
      'Menu sahur spill resep akhir tahun',
      ['ramadan', 'healing']
    );
    expect(signals).toContain('ramadan');
    expect(signals).toContain('indonesian_slang');
    expect(signals).toContain('year_end');
  });

  test('no match on unrelated English content', () => {
    expect(detectCulturalSignals('Amazing sunset in California', ['travel', 'beach'])).toEqual([]);
  });
});

// ===========================================================================
// cultural.js — isIndonesianContent
// ===========================================================================

describe('isIndonesianContent', () => {
  test('purely English content returns low confidence', () => {
    const confidence = isIndonesianContent(
      'Amazing transformation before and after',
      ['beauty', 'skincare', 'fyp']
    );
    expect(confidence).toBe(0);
  });

  test('purely English with no signals returns 0', () => {
    expect(isIndonesianContent('Just a random video', ['fun', 'vibes'])).toBe(0);
  });

  test('Indonesian slang adds 0.4', () => {
    const confidence = isIndonesianContent('Gabut di rumah', ['random']);
    expect(confidence).toBeCloseTo(0.4);
  });

  test('Indonesian cultural moment adds 0.3', () => {
    const confidence = isIndonesianContent('Outfit ideas', ['lebaran']);
    expect(confidence).toBeCloseTo(0.3);
  });

  test('Indonesian location hashtag adds 0.2', () => {
    const confidence = isIndonesianContent('Nice view', ['jakarta']);
    expect(confidence).toBeCloseTo(0.2);
  });

  test('Indonesian words in title adds 0.1', () => {
    const confidence = isIndonesianContent('Ini yang aku suka', ['cool']);
    expect(confidence).toBeCloseTo(0.1);
  });

  test('mixed Indonesian-English (common on TikTok Indonesia)', () => {
    // slang (gabut=0.4) + location (indonesia=0.2) + words (yang,aku=0.1) = 0.7
    const confidence = isIndonesianContent(
      'Gabut aja yang penting healing aku banget',
      ['indonesia', 'fyp']
    );
    expect(confidence).toBeCloseTo(0.7);
  });

  test('full Indonesian content hits multiple signals', () => {
    // slang (bucin=0.4) + cultural (ramadan/sahur=0.3) + location (jakarta=0.2) + words (untuk=0.1) = 1.0
    const confidence = isIndonesianContent(
      'Menu sahur untuk bucin',
      ['ramadan', 'jakarta', 'fyp']
    );
    expect(confidence).toBeCloseTo(1.0);
  });

  test('capped at 1.0', () => {
    // Even with everything matching, should not exceed 1.0
    const confidence = isIndonesianContent(
      'Gabut sahur aku bucin ngakak yang ini',
      ['ramadan', 'jakarta', 'indonesia', 'lebaran']
    );
    expect(confidence).toBeLessThanOrEqual(1.0);
  });

  test('word boundary: "dan" does not match "dandelion"', () => {
    // "dandelion" should NOT trigger Indonesian word detection for "dan"
    const confidence = isIndonesianContent('Pretty dandelion field', ['nature']);
    expect(confidence).toBe(0);
  });

  test('word boundary: "ini" does not match "miniature"', () => {
    const confidence = isIndonesianContent('Miniature food collection', ['tiny']);
    expect(confidence).toBe(0);
  });

  test('location tag matching is exact', () => {
    // "bali" tag should match, but "balinese" tag should not
    expect(isIndonesianContent('Beach', ['bali'])).toBeCloseTo(0.2);
    expect(isIndonesianContent('Beach', ['balinese'])).toBe(0);
  });
});

// ===========================================================================
// cultural.js — getActiveCulturalMoments
// ===========================================================================

describe('getActiveCulturalMoments', () => {
  it('returns ramadan for March 15', () => {
    const moments = getActiveCulturalMoments(new Date('2026-03-15'));
    expect(moments.some(m => m.name === 'ramadan')).toBe(true);
  });

  it('returns independence_day for August 17', () => {
    const moments = getActiveCulturalMoments(new Date('2026-08-17'));
    expect(moments.some(m => m.name === 'independence_day')).toBe(true);
  });

  it('returns payday for the 25th of any month', () => {
    const moments = getActiveCulturalMoments(new Date('2026-06-25'));
    expect(moments.some(m => m.name === 'payday')).toBe(true);
  });

  it('returns payday for the 1st of any month', () => {
    const moments = getActiveCulturalMoments(new Date('2026-06-01'));
    expect(moments.some(m => m.name === 'payday')).toBe(true);
  });

  it('returns empty for a non-event date like May 15', () => {
    const moments = getActiveCulturalMoments(new Date('2026-05-15'));
    expect(moments.length).toBe(0);
  });

  it('returns harbolnas for 11.11', () => {
    const moments = getActiveCulturalMoments(new Date('2026-11-11'));
    expect(moments.some(m => m.name === 'harbolnas')).toBe(true);
  });

  it('handles year-end wrapping (Dec 25)', () => {
    const moments = getActiveCulturalMoments(new Date('2026-12-25'));
    expect(moments.some(m => m.name === 'year_end')).toBe(true);
  });

  it('handles year-end wrapping (Jan 3)', () => {
    const moments = getActiveCulturalMoments(new Date('2026-01-03'));
    expect(moments.some(m => m.name === 'year_end')).toBe(true);
  });

  it('returns rainy_season for November', () => {
    const moments = getActiveCulturalMoments(new Date('2026-11-15'));
    expect(moments.some(m => m.name === 'rainy_season')).toBe(true);
  });

  it('does not return rainy_season for June', () => {
    const moments = getActiveCulturalMoments(new Date('2026-06-15'));
    expect(moments.some(m => m.name === 'rainy_season')).toBe(false);
  });
});
