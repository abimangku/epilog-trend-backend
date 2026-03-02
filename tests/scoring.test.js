const {
  calculateEngagementRate,
  calculateVelocityScore,
  calculateMomentum,
} = require('../src/scoring/engagement');

const {
  calculateReplicationScore,
  getReplicationCount,
} = require('../src/scoring/replication');

const {
  classifyTrend,
  calculateLifecycleStage,
  assignUrgencyLevel,
  compositeScore,
} = require('../src/scoring/classifier');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a snapshot N hours ago with given metrics. */
function snap(hoursAgo, views, likes, comments, shares) {
  const ts = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  return { views, likes, comments, shares, captured_at: ts };
}

/** Creates a minimal trend object for replication tests. */
function trend(audioId, author, hashtags) {
  return { audio_id: audioId, author, hashtags };
}

// ===========================================================================
// engagement.js
// ===========================================================================

describe('calculateEngagementRate', () => {
  test('normal case', () => {
    // (100 + 50 + 25) / 10000 * 100 = 1.75%
    expect(calculateEngagementRate(100, 50, 25, 10000)).toBeCloseTo(1.75);
  });

  test('zero views with engagement returns FYP volume score (not 0)', () => {
    const result = calculateEngagementRate(100, 50, 25, 0);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('null views with engagement returns FYP volume score (not 0)', () => {
    const result = calculateEngagementRate(100, 50, 25, null);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('undefined views with engagement returns FYP volume score (not 0)', () => {
    const result = calculateEngagementRate(100, 50, 25, undefined);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('all zeros returns 0', () => {
    expect(calculateEngagementRate(0, 0, 0, 0)).toBe(0);
  });

  test('high engagement', () => {
    // (500 + 200 + 100) / 1000 * 100 = 80%
    expect(calculateEngagementRate(500, 200, 100, 1000)).toBeCloseTo(80);
  });
});

describe('calculateVelocityScore', () => {
  test('zero snapshots returns 0', () => {
    expect(calculateVelocityScore([])).toBe(0);
  });

  test('null snapshots returns 0', () => {
    expect(calculateVelocityScore(null)).toBe(0);
  });

  test('single snapshot returns capped engagement rate', () => {
    // engagement rate: (100+50+25)/10000*100 = 1.75
    const result = calculateVelocityScore([snap(1, 10000, 100, 50, 25)]);
    expect(result).toBeCloseTo(1.75);
  });

  test('single snapshot with very high engagement caps at 100', () => {
    // engagement rate: (900+900+900)/1000*100 = 270 -> capped at 100
    const result = calculateVelocityScore([snap(1, 1000, 900, 900, 900)]);
    expect(result).toBe(100);
  });

  test('two snapshots with increasing engagement produces positive velocity', () => {
    const snapshots = [
      snap(2, 10000, 100, 50, 25),   // rate = 1.75%
      snap(1, 20000, 400, 150, 100),  // rate = 3.25%
    ];
    const result = calculateVelocityScore(snapshots);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('two snapshots with decreasing engagement returns 0 (clamped)', () => {
    const snapshots = [
      snap(2, 10000, 400, 150, 100), // rate = 6.5%
      snap(1, 20000, 100, 50, 25),   // rate = 0.875%
    ];
    const result = calculateVelocityScore(snapshots);
    expect(result).toBe(0);
  });

  test('three snapshots applies weighted recency', () => {
    const snapshots = [
      snap(3, 10000, 100, 50, 25),   // rate = 1.75%
      snap(2, 10000, 200, 100, 50),  // rate = 3.5%
      snap(1, 10000, 500, 200, 100), // rate = 8.0%
    ];
    const result = calculateVelocityScore(snapshots);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});

describe('calculateMomentum', () => {
  test('fewer than 3 snapshots returns stable', () => {
    expect(calculateMomentum([])).toBe('stable');
    expect(calculateMomentum([snap(1, 1000, 100, 50, 25)])).toBe('stable');
    expect(calculateMomentum([snap(2, 1000, 100, 50, 25), snap(1, 2000, 200, 100, 50)])).toBe('stable');
  });

  test('accelerating when current change exceeds previous by >20%', () => {
    const snapshots = [
      snap(3, 10000, 100, 50, 25),  // rate = 1.75
      snap(2, 10000, 150, 60, 30),  // rate = 2.4, change = +0.65
      snap(1, 10000, 300, 120, 60), // rate = 4.8, change = +2.4
    ];
    expect(calculateMomentum(snapshots)).toBe('accelerating');
  });

  test('decelerating when current change drops below 80% of previous', () => {
    const snapshots = [
      snap(3, 10000, 100, 50, 25),  // rate = 1.75
      snap(2, 10000, 500, 200, 100), // rate = 8.0, change = +6.25
      snap(1, 10000, 510, 205, 102), // rate = 8.17, change = +0.17
    ];
    expect(calculateMomentum(snapshots)).toBe('decelerating');
  });

  test('stable when change is similar', () => {
    const snapshots = [
      snap(3, 10000, 100, 50, 25),  // rate = 1.75
      snap(2, 10000, 200, 100, 50), // rate = 3.5, change = +1.75
      snap(1, 10000, 300, 150, 75), // rate = 5.25, change = +1.75
    ];
    expect(calculateMomentum(snapshots)).toBe('stable');
  });
});

// ===========================================================================
// replication.js
// ===========================================================================

describe('calculateReplicationScore', () => {
  test('empty trends returns empty maps', () => {
    const result = calculateReplicationScore([]);
    expect(result.audioMap.size).toBe(0);
    expect(result.hashtagClusters.size).toBe(0);
  });

  test('counts unique authors per audio_id', () => {
    const trends = [
      trend('audio1', 'alice', ['#fyp']),
      trend('audio1', 'bob', ['#fyp']),
      trend('audio1', 'alice', ['#trend']), // duplicate author
      trend('audio2', 'carol', ['#fyp']),
    ];
    const result = calculateReplicationScore(trends);
    expect(result.audioMap.get('audio1')).toBe(2); // alice + bob
    expect(result.audioMap.get('audio2')).toBe(1); // carol
  });

  test('finds hashtag pairs co-occurring in 5+ trends', () => {
    const trends = [];
    // 6 different authors using #dance + #challenge
    for (let i = 0; i < 6; i++) {
      trends.push(trend(`audio${i}`, `user${i}`, ['#dance', '#challenge', '#fyp']));
    }
    // 3 authors using #food + #review (below threshold)
    for (let i = 0; i < 3; i++) {
      trends.push(trend(`food${i}`, `chef${i}`, ['#food', '#review']));
    }

    const result = calculateReplicationScore(trends);

    // #challenge|#dance should appear (normalized + sorted)
    expect(result.hashtagClusters.get('#challenge|#dance')).toBe(6);
    expect(result.hashtagClusters.get('#challenge|#fyp')).toBe(6);
    expect(result.hashtagClusters.get('#dance|#fyp')).toBe(6);

    // #food|#review only 3 times — below threshold
    expect(result.hashtagClusters.has('#food|#review')).toBe(false);
  });

  test('skips trends with no audio_id', () => {
    const trends = [
      trend(null, 'alice', ['#fyp']),
      trend('', 'bob', ['#fyp']),
    ];
    const result = calculateReplicationScore(trends);
    expect(result.audioMap.size).toBe(0);
  });
});

describe('getReplicationCount', () => {
  test('returns audio count when higher', () => {
    const data = {
      audioMap: new Map([['audio1', 15]]),
      hashtagClusters: new Map([['#dance|#fyp', 8]]),
    };
    expect(getReplicationCount('audio1', ['#dance', '#fyp'], data)).toBe(15);
  });

  test('returns hashtag cluster count when higher', () => {
    const data = {
      audioMap: new Map([['audio1', 3]]),
      hashtagClusters: new Map([['#dance|#fyp', 12]]),
    };
    expect(getReplicationCount('audio1', ['#dance', '#fyp'], data)).toBe(12);
  });

  test('returns 0 when no matches', () => {
    const data = {
      audioMap: new Map(),
      hashtagClusters: new Map(),
    };
    expect(getReplicationCount('unknown', ['#random'], data)).toBe(0);
  });

  test('handles null audio_id', () => {
    const data = {
      audioMap: new Map([['audio1', 10]]),
      hashtagClusters: new Map(),
    };
    expect(getReplicationCount(null, ['#fyp'], data)).toBe(0);
  });
});

// ===========================================================================
// classifier.js
// ===========================================================================

describe('classifyTrend', () => {
  test('confirmed_trend: replication >= 20 AND patternScore >= 15', () => {
    expect(classifyTrend(
      { replication_count: 20, velocity_score: 10, engagement_rate: 5 }, 15
    )).toBe('confirmed_trend');
  });

  test('confirmed_trend at exact thresholds', () => {
    expect(classifyTrend(
      { replication_count: 20, velocity_score: 0, engagement_rate: 0 }, 15
    )).toBe('confirmed_trend');
  });

  test('emerging_trend: replication >= 5 AND velocity >= 40', () => {
    expect(classifyTrend(
      { replication_count: 5, velocity_score: 40, engagement_rate: 5 }, 5
    )).toBe('emerging_trend');
  });

  test('brand_opportunity: engagement_rate >= 40', () => {
    expect(classifyTrend(
      { replication_count: 2, velocity_score: 10, engagement_rate: 40 }, 3
    )).toBe('brand_opportunity');
  });

  test('brand_opportunity: velocity_score >= 50', () => {
    expect(classifyTrend(
      { replication_count: 2, velocity_score: 50, engagement_rate: 5 }, 3
    )).toBe('brand_opportunity');
  });

  test('viral_moment: velocity >= 60 AND replication < 5', () => {
    expect(classifyTrend(
      { replication_count: 4, velocity_score: 60, engagement_rate: 5 }, 3
    )).toBe('viral_moment');
  });

  test('noise: everything else', () => {
    expect(classifyTrend(
      { replication_count: 2, velocity_score: 10, engagement_rate: 5 }, 3
    )).toBe('noise');
  });

  test('priority ordering: confirmed_trend beats emerging_trend', () => {
    // Matches both confirmed_trend and emerging_trend criteria
    expect(classifyTrend(
      { replication_count: 25, velocity_score: 50, engagement_rate: 50 }, 20
    )).toBe('confirmed_trend');
  });

  test('priority ordering: emerging_trend beats brand_opportunity', () => {
    // replication=5, velocity=50 matches both emerging_trend and brand_opportunity
    expect(classifyTrend(
      { replication_count: 5, velocity_score: 50, engagement_rate: 50 }, 5
    )).toBe('emerging_trend');
  });
});

describe('calculateLifecycleStage', () => {
  test('empty snapshots returns emerging', () => {
    expect(calculateLifecycleStage([], 0)).toBe('emerging');
  });

  test('emerging: age < 24h AND replication < 20', () => {
    const snapshots = [snap(10, 5000, 100, 50, 25)];
    expect(calculateLifecycleStage(snapshots, 5)).toBe('emerging');
  });

  test('dead: age > 120h', () => {
    const snapshots = [
      snap(130, 5000, 100, 50, 25),
      snap(125, 5000, 100, 50, 25),
      snap(121, 5000, 100, 50, 25),
    ];
    expect(calculateLifecycleStage(snapshots, 10)).toBe('dead');
  });

  test('dead: decelerating with low engagement', () => {
    // Drops must get BIGGER so momentum = 'decelerating':
    // rates: 3.0, 1.75, 0.08
    // prevChange: 1.75 - 3.0 = -1.25
    // currentChange: 0.08 - 1.75 = -1.67  (bigger drop = decelerating)
    // Final engagement rate 0.08% < 2% threshold
    const snapshots = [
      snap(60, 10000, 200, 80, 20),   // rate = 3.0%
      snap(50, 10000, 100, 50, 25),   // rate = 1.75%
      snap(40, 10000, 5, 2, 1),       // rate = 0.08%
    ];
    expect(calculateLifecycleStage(snapshots, 5)).toBe('dead');
  });

  test('peaking: replication >= 50', () => {
    const snapshots = [snap(30, 100000, 5000, 2000, 1000)];
    expect(calculateLifecycleStage(snapshots, 50)).toBe('peaking');
  });

  test('peaking: age > 48h AND stable momentum', () => {
    const snapshots = [
      snap(55, 10000, 100, 50, 25),  // rate = 1.75
      snap(52, 10000, 200, 100, 50), // rate = 3.5, change = +1.75
      snap(49, 10000, 300, 150, 75), // rate = 5.25, change = +1.75 (stable)
    ];
    expect(calculateLifecycleStage(snapshots, 30)).toBe('peaking');
  });

  test('growing: age 24-72h AND accelerating', () => {
    const snapshots = [
      snap(36, 10000, 100, 50, 25),
      snap(30, 10000, 200, 100, 50),
      snap(25, 10000, 500, 250, 125),
    ];
    expect(calculateLifecycleStage(snapshots, 10)).toBe('growing');
  });

  test('growing: age 24-72h AND replication 20-49', () => {
    const snapshots = [snap(30, 50000, 2000, 1000, 500)];
    expect(calculateLifecycleStage(snapshots, 25)).toBe('growing');
  });
});

describe('assignUrgencyLevel', () => {
  test('act_now: peaking AND hoursOld < 12', () => {
    expect(assignUrgencyLevel('peaking', 6)).toBe('act_now');
    expect(assignUrgencyLevel('peaking', 11)).toBe('act_now');
  });

  test('act_now: growing AND hoursOld < 8', () => {
    expect(assignUrgencyLevel('growing', 5)).toBe('act_now');
    expect(assignUrgencyLevel('growing', 7)).toBe('act_now');
  });

  test('decide_today: growing AND hoursOld 8-36', () => {
    expect(assignUrgencyLevel('growing', 8)).toBe('decide_today');
    expect(assignUrgencyLevel('growing', 20)).toBe('decide_today');
    expect(assignUrgencyLevel('growing', 36)).toBe('decide_today');
  });

  test('decide_today: peaking AND hoursOld 12-36', () => {
    expect(assignUrgencyLevel('peaking', 12)).toBe('decide_today');
    expect(assignUrgencyLevel('peaking', 24)).toBe('decide_today');
    expect(assignUrgencyLevel('peaking', 36)).toBe('decide_today');
  });

  test('watch: emerging always', () => {
    expect(assignUrgencyLevel('emerging', 1)).toBe('watch');
    expect(assignUrgencyLevel('emerging', 100)).toBe('watch');
  });

  test('archive: declining', () => {
    expect(assignUrgencyLevel('declining', 50)).toBe('archive');
  });

  test('archive: dead', () => {
    expect(assignUrgencyLevel('dead', 200)).toBe('archive');
  });

  test('watch: peaking beyond 36 hours', () => {
    expect(assignUrgencyLevel('peaking', 48)).toBe('watch');
  });

  test('watch: growing beyond 36 hours', () => {
    expect(assignUrgencyLevel('growing', 48)).toBe('watch');
  });
});

describe('compositeScore', () => {
  test('all zeros returns 0', () => {
    expect(compositeScore(0, 0, 0, 0)).toBe(0);
  });

  test('known inputs produce expected weighted output', () => {
    // engagementRate=15, velocityScore=60, replicationCount=50, patternScore=80
    // replicationNorm = 50/100*100 = 50
    // engagementQuality = 15/30*100 = 50
    // score = 50*0.35 + 60*0.25 + 50*0.20 + 80*0.15 + 50*0.05
    //       = 17.5    + 15      + 10      + 12      + 2.5
    //       = 57.0
    expect(compositeScore(15, 60, 50, 80)).toBeCloseTo(57.0);
  });

  test('max replication capped at 100', () => {
    // replicationCount=200 -> replicationNorm = min(200, 100) = 100
    // engagementQuality = 30/30*100 = 100
    // score = 100*0.35 + 100*0.25 + 100*0.20 + 100*0.15 + 100*0.05 = 100
    expect(compositeScore(30, 100, 200, 100)).toBe(100);
  });

  test('capped at 100 even with extreme inputs', () => {
    expect(compositeScore(100, 100, 1000, 100)).toBe(100);
  });

  test('engagement quality normalization', () => {
    // engagementRate=60 -> engagementQuality = min(60/30*100, 100) = 100 (capped)
    // replicationNorm = 0
    // score = 0*0.35 + 0*0.25 + 100*0.20 + 0*0.15 + 100*0.05 = 25
    expect(compositeScore(60, 0, 0, 0)).toBeCloseTo(25);
  });

  test('replication dominance (35% weight)', () => {
    // Only replication: 100 creators, everything else 0
    // replicationNorm = 100
    // score = 100*0.35 = 35
    expect(compositeScore(0, 0, 100, 0)).toBeCloseTo(35);
  });

  test('velocity dominance (25% weight)', () => {
    // Only velocity: 100, everything else 0
    // score = 100*0.25 = 25
    expect(compositeScore(0, 100, 0, 0)).toBeCloseTo(25);
  });
});

// ===========================================================================
// engagement.js — FYP-native scoring (views=0)
// ===========================================================================

describe('calculateEngagementRate — FYP volume scoring (views=0)', () => {
  test('views=0 with typical FYP engagement returns meaningful score', () => {
    // 701K likes, 2557 comments, 18900 shares (real data from DB)
    const result = calculateEngagementRate(701200, 2557, 18900, 0);
    expect(result).toBeGreaterThan(30);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('views=0 with mega-viral engagement returns high score', () => {
    // 2.9M likes, 27900 comments, 644100 shares (real data from DB)
    const result = calculateEngagementRate(2900000, 27900, 644100, 0);
    expect(result).toBeGreaterThan(70);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('views=0 with small engagement returns low-to-mid score', () => {
    // ~1K total engagement -> weighted volume = 500 + 200 + 150 = 850
    const result = calculateEngagementRate(500, 100, 50, 0);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(50);
  });

  test('views=0 with zero engagement returns 0', () => {
    expect(calculateEngagementRate(0, 0, 0, 0)).toBe(0);
  });

  test('views=0 shares weighted highest (3x)', () => {
    const sharesHeavy = calculateEngagementRate(100, 100, 10000, 0);
    const likesHeavy = calculateEngagementRate(10000, 100, 100, 0);
    expect(sharesHeavy).toBeGreaterThan(likesHeavy);
  });

  test('views>0 still uses original rate formula', () => {
    expect(calculateEngagementRate(100, 50, 25, 10000)).toBeCloseTo(1.75);
  });
});

describe('calculateVelocityScore — FYP volume velocity (views=0)', () => {
  test('single snapshot with views=0 returns volume-based score', () => {
    const result = calculateVelocityScore([snap(1, 0, 701200, 2557, 18900)]);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('growing engagement between views=0 snapshots produces positive velocity', () => {
    const snapshots = [
      snap(2, 0, 100000, 500, 5000),
      snap(1, 0, 500000, 2500, 25000),
    ];
    const result = calculateVelocityScore(snapshots);
    expect(result).toBeGreaterThan(50);
  });

  test('flat engagement between views=0 snapshots produces low velocity', () => {
    const snapshots = [
      snap(2, 0, 100000, 500, 5000),
      snap(1, 0, 105000, 520, 5100),
    ];
    const result = calculateVelocityScore(snapshots);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(50);
  });

  test('views>0 snapshots still use original rate-based velocity', () => {
    const snapshots = [
      snap(2, 10000, 100, 50, 25),
      snap(1, 20000, 400, 150, 100),
    ];
    const result = calculateVelocityScore(snapshots);
    expect(result).toBeGreaterThan(0);
  });
});

describe('calculateMomentum — FYP volume momentum (views=0)', () => {
  test('accelerating with views=0 snapshots', () => {
    const snapshots = [
      snap(3, 0, 10000, 100, 500),
      snap(2, 0, 50000, 500, 2500),
      snap(1, 0, 300000, 3000, 15000),
    ];
    expect(calculateMomentum(snapshots)).toBe('accelerating');
  });

  test('decelerating with views=0 snapshots', () => {
    const snapshots = [
      snap(3, 0, 10000, 100, 500),
      snap(2, 0, 100000, 1000, 5000),
      snap(1, 0, 110000, 1100, 5500),
    ];
    expect(calculateMomentum(snapshots)).toBe('decelerating');
  });

  test('stable with views=0 snapshots', () => {
    // Weighted volumes: 117K -> 234K -> 351K
    // Changes: +117K, +117K (equal = stable)
    const snapshots = [
      snap(3, 0, 100000, 1000, 5000),
      snap(2, 0, 200000, 2000, 10000),
      snap(1, 0, 300000, 3000, 15000),
    ];
    expect(calculateMomentum(snapshots)).toBe('stable');
  });
});
