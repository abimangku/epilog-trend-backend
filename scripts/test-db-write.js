#!/usr/bin/env node

/**
 * Integration test: Supabase write/read/delete round-trip.
 *
 * Creates a fake trend, verifies it appears, creates a snapshot,
 * verifies it appears, then cleans up both rows.
 *
 * Exit code 0 = all pass, 1 = any fail.
 *
 * Usage: node scripts/test-db-write.js
 */

require('dotenv').config();

const {
  supabase,
  generateTrendHash,
  upsertTrend,
  createEngagementSnapshot,
  testConnection,
} = require('../src/database/supabase');

// ---------------------------------------------------------------------------
// Test data — clearly fake so it's easy to identify and clean up
// ---------------------------------------------------------------------------

const TEST_PREFIX = '__TEST_DB_WRITE__';

const fakeTrend = {
  platform: 'tiktok',
  title: `${TEST_PREFIX} Cara Bikin Nasi Goreng Anti Gagal #tutorial`,
  url: `https://tiktok.com/@testuser/${TEST_PREFIX}${Date.now()}`,
  author: 'test_user_epilog',
  author_tier: 'micro',
  views: 150000,
  likes: 12000,
  comments: 800,
  shares: 450,
  hashtags: ['tutorial', 'nasigoreng', 'fyp', 'masak'],
  audio_id: 'test-audio-001',
  audio_title: 'Original Sound - Test',
  engagement_rate: 8.83,
  velocity_score: 42.5,
  replication_count: 3,
  lifecycle_stage: 'emerging',
  momentum: 0,
  scraped_at: new Date().toISOString(),
  trend_score: 35.7,
  classification: 'emerging_trend',
  urgency_level: 'watch',
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const results = [];

function log(step, pass, detail) {
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`  [${icon}] ${step}${detail ? ` — ${detail}` : ''}`);
  results.push({ step, pass });
}

async function run() {
  console.log('');
  console.log('=== test-db-write: Supabase round-trip test ===');
  console.log('');

  let trendId = null;

  // -----------------------------------------------------------------------
  // Step 1 — Verify connection
  // -----------------------------------------------------------------------
  try {
    const ok = await testConnection();
    log('1. Supabase connection', ok, ok ? 'connected' : 'unreachable');
    if (!ok) {
      console.log('\n  Cannot continue without DB connection.\n');
      process.exit(1);
    }
  } catch (err) {
    log('1. Supabase connection', false, err.message);
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Step 2 — Upsert trend
  // -----------------------------------------------------------------------
  try {
    const { inserted, trend_id } = await upsertTrend(fakeTrend);
    trendId = trend_id;
    log('2. upsertTrend()', !!trend_id, `id=${trend_id}, inserted=${inserted}`);
  } catch (err) {
    log('2. upsertTrend()', false, err.message);
  }

  // -----------------------------------------------------------------------
  // Step 3 — Verify trend row exists
  // -----------------------------------------------------------------------
  if (trendId) {
    try {
      const { data, error } = await supabase
        .from('trends')
        .select('id, title, classification, urgency_level, trend_score')
        .eq('id', trendId)
        .single();

      if (error) throw new Error(error.message);

      const titleMatch = data.title.includes(TEST_PREFIX);
      const classMatch = data.classification === 'emerging_trend';
      const urgencyMatch = data.urgency_level === 'watch';
      const scoreMatch = typeof data.trend_score === 'number';
      const pass = titleMatch && classMatch && urgencyMatch && scoreMatch;

      log('3. Verify trend row', pass,
        `title=${titleMatch}, classification=${classMatch}, urgency=${urgencyMatch}, score=${scoreMatch}`);
    } catch (err) {
      log('3. Verify trend row', false, err.message);
    }
  } else {
    log('3. Verify trend row', false, 'skipped — no trend_id from step 2');
  }

  // -----------------------------------------------------------------------
  // Step 4 — Create engagement snapshot
  // -----------------------------------------------------------------------
  let snapshotId = null;

  if (trendId) {
    try {
      const snapshot = await createEngagementSnapshot(trendId, {
        views: fakeTrend.views,
        likes: fakeTrend.likes,
        comments: fakeTrend.comments,
        shares: fakeTrend.shares,
      });

      snapshotId = snapshot.id;
      log('4. createEngagementSnapshot()', !!snapshotId, `id=${snapshotId}`);
    } catch (err) {
      log('4. createEngagementSnapshot()', false, err.message);
    }
  } else {
    log('4. createEngagementSnapshot()', false, 'skipped — no trend_id');
  }

  // -----------------------------------------------------------------------
  // Step 5 — Verify snapshot row exists
  // -----------------------------------------------------------------------
  if (snapshotId) {
    try {
      const { data, error } = await supabase
        .from('engagement_snapshots')
        .select('id, trend_id, views, likes')
        .eq('id', snapshotId)
        .single();

      if (error) throw new Error(error.message);

      const trendMatch = data.trend_id === trendId;
      const viewsMatch = data.views === fakeTrend.views;
      const pass = trendMatch && viewsMatch;

      log('5. Verify snapshot row', pass,
        `trend_id=${trendMatch}, views=${viewsMatch}`);
    } catch (err) {
      log('5. Verify snapshot row', false, err.message);
    }
  } else {
    log('5. Verify snapshot row', false, 'skipped — no snapshot_id');
  }

  // -----------------------------------------------------------------------
  // Step 6 — Cleanup: delete snapshot then trend
  // -----------------------------------------------------------------------
  let cleanupOk = true;

  if (snapshotId) {
    const { error } = await supabase
      .from('engagement_snapshots')
      .delete()
      .eq('id', snapshotId);
    if (error) {
      console.log(`  WARNING: Failed to delete snapshot ${snapshotId}: ${error.message}`);
      cleanupOk = false;
    }
  }

  if (trendId) {
    // Delete any remaining snapshots for this trend (safety)
    await supabase
      .from('engagement_snapshots')
      .delete()
      .eq('trend_id', trendId);

    const { error } = await supabase
      .from('trends')
      .delete()
      .eq('id', trendId);
    if (error) {
      console.log(`  WARNING: Failed to delete trend ${trendId}: ${error.message}`);
      cleanupOk = false;
    }
  }

  log('6. Cleanup test rows', cleanupOk,
    cleanupOk ? 'both rows deleted' : 'some cleanup failed');

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  const allPassed = passed === total;

  console.log(`=== Result: ${passed}/${total} passed ${allPassed ? '✓' : '✗'} ===`);
  console.log('');

  process.exit(allPassed ? 0 : 1);
}

run().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
