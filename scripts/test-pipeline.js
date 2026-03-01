#!/usr/bin/env node

/**
 * Integration test: Scrape + Score pipeline (read-only, no DB writes).
 *
 * 1. Verify Supabase connection
 * 2. Run scrapeOnce() and report video count
 * 3. Take the first 3 videos and run through the full scoring pipeline
 * 4. Log computed scores for each video
 *
 * Exit code 0 = all steps pass, 1 = any fail.
 *
 * Usage: node scripts/test-pipeline.js
 */

require('dotenv').config();

const { testConnection } = require('../src/database/supabase');
const { scrapeOnce } = require('../src/scrapers/tiktok');
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
const { detectFormat, calculatePatternScore } = require('../src/patterns/formats');
const { detectCulturalSignals } = require('../src/patterns/cultural');

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
  console.log('=== test-pipeline: Scrape + Score dry-run (no DB writes) ===');
  console.log('');

  // -----------------------------------------------------------------------
  // Step 1 — Verify Supabase connection
  // -----------------------------------------------------------------------
  try {
    const ok = await testConnection();
    log('1. Supabase connection', ok, ok ? 'connected' : 'unreachable');
    if (!ok) {
      console.log('\n  WARNING: DB unreachable, but continuing with scrape + score test.\n');
    }
  } catch (err) {
    log('1. Supabase connection', false, err.message);
    console.log('\n  WARNING: DB check threw, but continuing.\n');
  }

  // -----------------------------------------------------------------------
  // Step 2 — Scrape TikTok Explore
  // -----------------------------------------------------------------------
  let videos = [];
  try {
    console.log('  Launching headless browser for TikTok scrape...');
    console.log('  (This may take 30-60 seconds on first run)');
    console.log('');
    videos = await scrapeOnce();
    const pass = videos.length > 0;
    log('2. scrapeOnce()', pass, `${videos.length} videos scraped`);
  } catch (err) {
    log('2. scrapeOnce()', false, err.message);
    console.log('\n  Cannot continue without scraped videos.\n');
    printSummary();
    return;
  }

  if (videos.length === 0) {
    console.log('\n  No videos returned — TikTok may be blocking. Try again later.\n');
    printSummary();
    return;
  }

  // -----------------------------------------------------------------------
  // Step 3 — Batch replication analysis (all videos)
  // -----------------------------------------------------------------------
  let replicationData;
  try {
    replicationData = calculateReplicationScore(videos);
    log('3. Batch replication analysis', true,
      `${replicationData.audioMap.size} audio signals, ${replicationData.hashtagClusters.size} hashtag clusters`);
  } catch (err) {
    log('3. Batch replication analysis', false, err.message);
    printSummary();
    return;
  }

  // -----------------------------------------------------------------------
  // Step 4 — Score first 3 videos
  // -----------------------------------------------------------------------
  const sample = videos.slice(0, 3);
  let scoringPassed = true;

  console.log('');
  console.log(`  --- Scoring ${sample.length} sample videos ---`);
  console.log('');

  for (let i = 0; i < sample.length; i++) {
    const video = sample[i];
    try {
      // Engagement
      const engagementRate = calculateEngagementRate(
        video.likes, video.comments, video.shares, video.views
      );

      // Velocity (no snapshots for new videos — use engagement as proxy)
      const velocityScore = Math.min(engagementRate, 100);

      // Momentum (no snapshots)
      const momentum = 'stable';

      // Replication
      const replicationCount = getReplicationCount(
        video.audio_id, video.hashtags, replicationData
      );

      // Patterns
      const formats = detectFormat(video.title, video.hashtags);
      const culturalSignals = detectCulturalSignals(video.title, video.hashtags);
      const patternScore = calculatePatternScore(formats, culturalSignals, replicationCount);

      // Composite
      const composite = compositeScore(engagementRate, velocityScore, replicationCount, patternScore);

      // Lifecycle (no snapshots)
      const lifecycleStage = calculateLifecycleStage([], replicationCount);

      // Classification
      const classification = classifyTrend({
        engagement_rate: engagementRate,
        velocity_score: velocityScore,
        replication_count: replicationCount,
      }, patternScore);

      // Urgency
      const urgencyLevel = assignUrgencyLevel(lifecycleStage, 0);

      // Print results
      const truncTitle = (video.title || 'No title').substring(0, 60);
      console.log(`  Video ${i + 1}: "${truncTitle}${(video.title || '').length > 60 ? '...' : ''}"`);
      console.log(`    Author:       ${video.author || 'unknown'} (${video.author_tier || '-'})`);
      console.log(`    Views:        ${(video.views || 0).toLocaleString()}`);
      console.log(`    Engagement:   ${engagementRate.toFixed(2)}%`);
      console.log(`    Velocity:     ${velocityScore.toFixed(2)}`);
      console.log(`    Replication:  ${replicationCount}`);
      console.log(`    Formats:      ${formats.length > 0 ? formats.join(', ') : 'none'}`);
      console.log(`    Cultural:     ${culturalSignals.length > 0 ? culturalSignals.join(', ') : 'none'}`);
      console.log(`    Pattern:      ${patternScore.toFixed(2)}`);
      console.log(`    Composite:    ${composite.toFixed(2)}`);
      console.log(`    Lifecycle:    ${lifecycleStage}`);
      console.log(`    Class:        ${classification}`);
      console.log(`    Urgency:      ${urgencyLevel}`);
      console.log('');
    } catch (err) {
      console.log(`  Video ${i + 1}: SCORING FAILED — ${err.message}`);
      console.log('');
      scoringPassed = false;
    }
  }

  log('4. Score sample videos', scoringPassed,
    `${sample.length} videos scored${scoringPassed ? '' : ' (with errors)'}`);

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  printSummary();
}

function printSummary() {
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
