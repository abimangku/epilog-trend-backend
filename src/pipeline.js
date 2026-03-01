/**
 * Pipeline orchestrator — connects scraping, scoring, pattern detection,
 * database persistence, and notifications into a single run.
 */

const logger = require('./logger');
const { scrapeOnce } = require('./scrapers/tiktok');
const {
  calculateEngagementRate,
  calculateVelocityScore,
  calculateMomentum,
} = require('./scoring/engagement');
const {
  calculateReplicationScore,
  getReplicationCount,
} = require('./scoring/replication');
const {
  classifyTrend,
  calculateLifecycleStage,
  assignUrgencyLevel,
  compositeScore,
} = require('./scoring/classifier');
const { detectFormat, calculatePatternScore } = require('./patterns/formats');
const { detectCulturalSignals } = require('./patterns/cultural');
const {
  supabase,
  generateTrendHash,
  upsertTrend,
  createEngagementSnapshot,
  getRecentSnapshots,
  testConnection,
} = require('./database/supabase');

// Slack module may not be implemented yet — import defensively
let notifyActNow = null;
try {
  const slack = require('./notifications/slack');
  if (typeof slack.notifyActNow === 'function') {
    notifyActNow = slack.notifyActNow;
  }
} catch {
  // slack.js not yet implemented — notifications disabled
}

const MOD = 'PIPELINE';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a momentum string label to a numeric value for DB storage.
 * @param {string} momentum - 'accelerating' | 'stable' | 'decelerating'
 * @returns {number} 1, 0, or -1
 */
function momentumToNumber(momentum) {
  if (momentum === 'accelerating') return 1;
  if (momentum === 'decelerating') return -1;
  return 0;
}

/**
 * Looks up an existing trend by hash and returns its id and scraped_at.
 * Returns null if the trend does not exist yet.
 *
 * @param {string} hash - SHA256 hash of platform|url|title
 * @returns {Promise<{id: string, scraped_at: string}|null>}
 */
async function findExistingTrend(hash) {
  const { data } = await supabase
    .from('trends')
    .select('id, scraped_at')
    .eq('hash', hash)
    .maybeSingle();
  return data || null;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Runs the full scrape-score-persist-notify pipeline.
 *
 * Steps:
 * 1. Scrape TikTok Explore
 * 2. Calculate batch-level replication signals
 * 3. For each video: compute engagement, velocity, momentum, replication,
 *    pattern, composite, lifecycle, classification, urgency
 * 4. Upsert enriched trend + create engagement snapshot
 * 5. Notify Slack for confirmed_trend + act_now
 *
 * @returns {Promise<{new: number, updated: number, errors: number}>}
 */
async function runPipeline() {
  const stats = { new: 0, updated: 0, errors: 0 };

  try {
    // -----------------------------------------------------------------------
    // Step 0 — Verify Supabase is reachable
    // -----------------------------------------------------------------------
    const connected = await testConnection();
    if (!connected) {
      logger.error(MOD, 'CRITICAL: Supabase unreachable — aborting pipeline');
      return stats;
    }

    // -----------------------------------------------------------------------
    // Step 1 — Scrape
    // -----------------------------------------------------------------------
    const videos = await scrapeOnce();
    logger.log(MOD, `Scraped ${videos.length} videos from TikTok Explore`);

    if (videos.length === 0) {
      logger.warn(MOD, 'No videos scraped — returning early');
      return stats;
    }

    // -----------------------------------------------------------------------
    // Step 2 — Batch-level replication analysis
    // -----------------------------------------------------------------------
    const replicationData = calculateReplicationScore(videos);
    logger.log(MOD, 'Batch replication analysis complete', {
      audioSignals: replicationData.audioMap.size,
      hashtagClusters: replicationData.hashtagClusters.size,
    });

    // -----------------------------------------------------------------------
    // Step 3 + 4 — Per-video scoring and persistence
    // -----------------------------------------------------------------------
    const actNowTrends = [];

    for (const video of videos) {
      try {
        // --- Engagement rate ---
        const engagementRate = calculateEngagementRate(
          video.likes, video.comments, video.shares, video.views
        );

        // --- Lookup existing trend for historical snapshots ---
        const hash = generateTrendHash(video.platform, video.url, video.title);
        const existing = await findExistingTrend(hash);

        let snapshots = [];
        let firstSeenAt = new Date(); // default: now (new trend)

        if (existing) {
          // getRecentSnapshots returns DESC; scoring expects ASC — reverse
          const rawSnapshots = await getRecentSnapshots(existing.id);
          snapshots = rawSnapshots.reverse();
          firstSeenAt = new Date(existing.scraped_at);
        }

        // --- Velocity ---
        const velocityScore = snapshots.length > 0
          ? calculateVelocityScore(snapshots)
          : Math.min(engagementRate, 100);

        // --- Momentum ---
        const momentum = calculateMomentum(snapshots);

        // --- Replication ---
        const replicationCount = getReplicationCount(
          video.audio_id, video.hashtags, replicationData
        );

        // --- Pattern detection ---
        const formats = detectFormat(video.title, video.hashtags);
        const culturalSignals = detectCulturalSignals(video.title, video.hashtags);
        const patternScore = calculatePatternScore(
          formats, culturalSignals, replicationCount
        );

        // --- Composite score ---
        const composite = compositeScore(
          engagementRate, velocityScore, replicationCount, patternScore
        );

        // --- Lifecycle stage ---
        const lifecycleStage = calculateLifecycleStage(snapshots, replicationCount);

        // --- Classification ---
        const classification = classifyTrend({
          engagement_rate: engagementRate,
          velocity_score: velocityScore,
          replication_count: replicationCount,
        }, patternScore);

        // --- Urgency ---
        const hoursOld = (Date.now() - firstSeenAt.getTime()) / (1000 * 60 * 60);
        const urgencyLevel = assignUrgencyLevel(lifecycleStage, hoursOld);

        // --- Build enriched trend object ---
        const enrichedTrend = {
          platform: video.platform,
          title: video.title,
          url: video.url,
          author: video.author,
          author_tier: video.author_tier,
          views: video.views,
          likes: video.likes,
          comments: video.comments,
          shares: video.shares,
          hashtags: video.hashtags,
          audio_id: video.audio_id,
          audio_title: video.audio_title,
          engagement_rate: Math.round(engagementRate * 100) / 100,
          velocity_score: Math.round(velocityScore * 100) / 100,
          replication_count: replicationCount,
          lifecycle_stage: lifecycleStage,
          momentum: momentumToNumber(momentum),
          scraped_at: video.scraped_at,
          trend_score: composite,
          classification,
          urgency_level: urgencyLevel,
        };

        // --- Step 4: Write to Supabase ---
        const { inserted, trend_id } = await upsertTrend(enrichedTrend);

        if (inserted) {
          stats.new++;
        } else {
          stats.updated++;
        }

        await createEngagementSnapshot(trend_id, {
          views: video.views,
          likes: video.likes,
          comments: video.comments,
          shares: video.shares,
        });

        // Track confirmed_trend + act_now for Slack notification
        if (classification === 'confirmed_trend' && urgencyLevel === 'act_now') {
          actNowTrends.push(enrichedTrend);
        }

      } catch (err) {
        stats.errors++;
        logger.error(MOD, `Failed to process video: ${video.title || video.url}`, err);
      }
    }

    // -----------------------------------------------------------------------
    // Step 5 — Post-process: notify Slack for act_now confirmed trends
    // -----------------------------------------------------------------------
    if (actNowTrends.length > 0) {
      logger.log(MOD, `${actNowTrends.length} confirmed trends with act_now urgency`);

      for (const trend of actNowTrends) {
        try {
          if (notifyActNow) {
            await notifyActNow(trend);
            logger.log(MOD, `Slack notification sent: ${trend.title}`);
          } else {
            logger.warn(MOD, `Slack not configured — skipped notification for: ${trend.title}`);
          }
        } catch (err) {
          logger.warn(MOD, `Slack notification failed for: ${trend.title}`, err);
        }
      }
    }

    logger.log(MOD, `Pipeline complete. ${stats.new} new, ${stats.updated} updated, ${stats.errors} errors.`);

  } catch (err) {
    logger.error(MOD, 'Pipeline failed', err);
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Cron-friendly wrapper with timing
// ---------------------------------------------------------------------------

/**
 * Wraps runPipeline with start/end timestamps and duration logging.
 * Used by the cron scheduler.
 *
 * @returns {Promise<{new: number, updated: number, errors: number}>}
 */
async function runPipelineOnce() {
  const startTime = Date.now();
  logger.log(MOD, `Pipeline run started at ${new Date(startTime).toISOString()}`);

  const stats = await runPipeline();

  const endTime = Date.now();
  const durationSec = ((endTime - startTime) / 1000).toFixed(1);
  logger.log(MOD, `Pipeline run finished at ${new Date(endTime).toISOString()} (${durationSec}s)`);

  return stats;
}

module.exports = { runPipeline, runPipelineOnce };
