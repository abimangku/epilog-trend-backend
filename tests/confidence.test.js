const { calibrateConfidence } = require('../src/scoring/confidence');

describe('calibrateConfidence', () => {
  const baseTrend = {
    engagement_rate: 5.0,
    replication_count: 1,
    velocity_score: 50,
    lifecycle_stage: 'growing',
  };

  test('normal case — no adjustments when all metrics are healthy', () => {
    const result = calibrateConfidence(75, baseTrend);
    expect(result).toBe(75);
  });

  test('high confidence + low engagement → downgrade by 15', () => {
    const trend = { ...baseTrend, engagement_rate: 1.5 };
    // rawConfidence 80 > 60 AND engagement_rate 1.5 < 2 → 80 - 15 = 65
    const result = calibrateConfidence(80, trend);
    expect(result).toBe(65);
  });

  test('low confidence + low engagement → no downgrade (rawConfidence <= 60)', () => {
    const trend = { ...baseTrend, engagement_rate: 1.0 };
    // rawConfidence 50 <= 60, so rule 2 does not fire
    const result = calibrateConfidence(50, trend);
    expect(result).toBe(50);
  });

  test('zero replication → cap at 50', () => {
    const trend = { ...baseTrend, replication_count: 0 };
    // rawConfidence 90, capped to 50
    const result = calibrateConfidence(90, trend);
    expect(result).toBe(50);
  });

  test('zero replication with already-low confidence stays unchanged', () => {
    const trend = { ...baseTrend, replication_count: 0 };
    // rawConfidence 30, already below 50 cap
    const result = calibrateConfidence(30, trend);
    expect(result).toBe(30);
  });

  test('high replication (>= 3) → boost by 10', () => {
    const trend = { ...baseTrend, replication_count: 5 };
    // 75 + 10 = 85
    const result = calibrateConfidence(75, trend);
    expect(result).toBe(85);
  });

  test('declining lifecycle → downgrade by 10', () => {
    const trend = { ...baseTrend, lifecycle_stage: 'declining' };
    // 75 - 10 = 65
    const result = calibrateConfidence(75, trend);
    expect(result).toBe(65);
  });

  test('dead lifecycle → downgrade by 20', () => {
    const trend = { ...baseTrend, lifecycle_stage: 'dead' };
    // 75 - 20 = 55
    const result = calibrateConfidence(75, trend);
    expect(result).toBe(55);
  });

  test('multiple rules stacking: low engagement + zero replication + declining', () => {
    const trend = {
      engagement_rate: 0.5,
      replication_count: 0,
      velocity_score: 10,
      lifecycle_stage: 'declining',
    };
    // Start: 85
    // Rule 2: engagement < 2 AND rawConf > 60 → 85 - 15 = 70
    // Rule 3: replication_count === 0 → min(70, 50) = 50
    // Rule 5: declining → 50 - 10 = 40
    const result = calibrateConfidence(85, trend);
    expect(result).toBe(40);
  });

  test('multiple rules stacking: low engagement + zero replication + dead', () => {
    const trend = {
      engagement_rate: 1.0,
      replication_count: 0,
      velocity_score: 5,
      lifecycle_stage: 'dead',
    };
    // Start: 90
    // Rule 2: 90 - 15 = 75
    // Rule 3: min(75, 50) = 50
    // Rule 6: 50 - 20 = 30
    const result = calibrateConfidence(90, trend);
    expect(result).toBe(30);
  });

  test('clamping at 0 — extreme downgrade does not go negative', () => {
    const trend = {
      engagement_rate: 0.1,
      replication_count: 0,
      velocity_score: 0,
      lifecycle_stage: 'dead',
    };
    // Start: 10
    // Rule 2: 10 <= 60, no downgrade → 10
    // Rule 3: min(10, 50) = 10
    // Rule 6: 10 - 20 = -10 → clamped to 0
    const result = calibrateConfidence(10, trend);
    expect(result).toBe(0);
  });

  test('clamping at 100 — boost does not exceed 100', () => {
    const trend = { ...baseTrend, replication_count: 10 };
    // rawConfidence 95 + 10 = 105 → clamped to 100
    const result = calibrateConfidence(95, trend);
    expect(result).toBe(100);
  });

  test('realistic Indonesian trend: emak-emak belanja content with high replication', () => {
    const trend = {
      engagement_rate: 8.5,
      replication_count: 7,
      velocity_score: 72,
      lifecycle_stage: 'peaking',
    };
    // Start: 82
    // Rule 4: replication >= 3 → 82 + 10 = 92
    // No other rules fire
    const result = calibrateConfidence(82, trend);
    expect(result).toBe(92);
  });

  test('realistic Indonesian trend: niche konten kreator with low engagement', () => {
    const trend = {
      engagement_rate: 0.8,
      replication_count: 0,
      velocity_score: 15,
      lifecycle_stage: 'emerging',
    };
    // Start: 70
    // Rule 2: engagement < 2 AND rawConf > 60 → 70 - 15 = 55
    // Rule 3: replication === 0 → min(55, 50) = 50
    const result = calibrateConfidence(70, trend);
    expect(result).toBe(50);
  });
});
