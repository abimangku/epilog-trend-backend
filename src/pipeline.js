/**
 * Pipeline orchestrator — connects scraping, scoring, pattern detection,
 * 3-phase AI analysis, brand fit scoring, database persistence, and
 * notifications into a single run.
 *
 * Flow:
 *   FYP Scrape + Screenshots
 *   → Batch replication analysis
 *   → Per-video scoring (engagement, velocity, momentum, etc.)
 *   → Upsert all trends + engagement snapshots
 *   → Phase 1: Trash Gate (batch LLM filter)
 *   → Phase 2: Deep Analysis (per-trend multimodal LLM)
 *   → Phase 3: Cross-Trend Synthesis (batch LLM meta-analysis)
 *   → Brand Fit scoring (per-trend, enriched with Phase 2 context)
 *   → Slack notifications
 *   → Screenshot cleanup
 */

const fs = require('fs');
const path = require('path');
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
  upsertTrendAnalysis,
  insertCrossTrendSynthesis,
  upsertBrandFits,
} = require('./database/supabase');
const { trashGate, deepAnalysis, crossTrendSynthesis } = require('./ai/analyzer');
const { scoreBrandFit } = require('./ai/brand-fit');

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

/**
 * Removes all files from the screenshots directory.
 * Called after pipeline completes — screenshots are transient.
 */
async function cleanupScreenshots() {
  const dir = path.join(process.cwd(), 'screenshots');
  try {
    const files = await fs.promises.readdir(dir);
    await Promise.all(files.map((f) => fs.promises.unlink(path.join(dir, f))));
    logger.log(MOD, `Cleaned up ${files.length} screenshots`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn(MOD, 'Screenshot cleanup failed', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Runs the full scrape → score → 3-phase AI → brand fit → notify pipeline.
 *
 * @returns {Promise<object>} Pipeline stats
 */
async function runPipeline() {
  const stats = {
    scraped: 0,
    new: 0,
    updated: 0,
    signals: 0,
    filtered: 0,
    analyzed: 0,
    synthesized: false,
    brand_fits: 0,
    errors: 0,
  };

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
    // Step 1 — Scrape FYP (returns { videos, screenshots })
    // -----------------------------------------------------------------------
    const scrapeResult = await scrapeOnce();
    const videos = scrapeResult.videos || [];
    stats.scraped = videos.length;
    logger.log(MOD, `Scraped ${videos.length} videos from TikTok FYP (${scrapeResult.screenshots.length} screenshots)`);

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
    // Step 3 — Per-video scoring and persistence
    // -----------------------------------------------------------------------
    // We score every video and persist to Supabase before AI filtering.
    // This ensures we have a complete record even for filtered-out videos.
    const enrichedVideos = []; // { enrichedTrend, trend_id, video }
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
        let firstSeenAt = new Date();

        if (existing) {
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
        const classification = classifyTrend(composite);

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
          bookmarks: video.bookmarks || 0,
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
          thumbnail_url: video.thumbnail_url || null,
          video_embed_url: video.video_embed_url || null,
        };

        // --- Upsert trend to Supabase ---
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

        // Track for AI pipeline
        enrichedVideos.push({
          enrichedTrend,
          trend_id,
          video,
        });

        // Track confirmed_trend + act_now for Slack
        if (classification === 'confirmed_trend' && urgencyLevel === 'act_now') {
          actNowTrends.push(enrichedTrend);
        }

      } catch (err) {
        stats.errors++;
        logger.error(MOD, `Failed to process video: ${video.title || video.url}`, err);
      }
    }

    // -----------------------------------------------------------------------
    // Step 4 — Phase 1: Trash Gate (batch LLM filter)
    // -----------------------------------------------------------------------
    logger.log(MOD, `--- Phase 1: Trash Gate (${enrichedVideos.length} videos) ---`);

    const verdicts = await trashGate(enrichedVideos.map((ev) => ev.video));
    const verdictMap = new Map(verdicts.map((v) => [v.url, v]));

    const survivors = enrichedVideos.filter((ev) => {
      const verdict = verdictMap.get(ev.video.url);
      return verdict && verdict.verdict === 'signal';
    });

    stats.signals = survivors.length;
    stats.filtered = enrichedVideos.length - survivors.length;
    logger.log(MOD, `Trash Gate: ${stats.signals} signals, ${stats.filtered} filtered out`);

    // -----------------------------------------------------------------------
    // Step 5 — Phase 2: Deep Analysis (per-trend multimodal LLM)
    // -----------------------------------------------------------------------
    logger.log(MOD, `--- Phase 2: Deep Analysis (${survivors.length} trends) ---`);

    const analyzedTrends = []; // { video, enrichedTrend, trend_id, analysis }

    for (const survivor of survivors) {
      try {
        const screenshotPath = survivor.video.screenshot_path || null;
        const analysis = await deepAnalysis(survivor.enrichedTrend, screenshotPath);

        if (analysis) {
          await upsertTrendAnalysis(survivor.trend_id, analysis);
          stats.analyzed++;
          analyzedTrends.push({
            video: survivor.video,
            enrichedTrend: survivor.enrichedTrend,
            trend_id: survivor.trend_id,
            analysis,
          });
        }
      } catch (err) {
        logger.warn(MOD, `Deep analysis failed: ${survivor.enrichedTrend.title}`, err);
      }
    }

    logger.log(MOD, `Deep analysis complete: ${stats.analyzed} trends analyzed`);

    // -----------------------------------------------------------------------
    // Step 6 — Phase 3: Cross-Trend Synthesis (batch LLM meta-analysis)
    // -----------------------------------------------------------------------
    if (analyzedTrends.length > 0) {
      logger.log(MOD, `--- Phase 3: Cross-Trend Synthesis (${analyzedTrends.length} trends) ---`);

      try {
        const synthesis = await crossTrendSynthesis(
          analyzedTrends.map((at) => ({ video: at.video, analysis: at.analysis }))
        );

        if (synthesis) {
          await insertCrossTrendSynthesis(synthesis);
          stats.synthesized = true;
          logger.log(MOD, 'Cross-trend synthesis saved');
        }
      } catch (err) {
        logger.warn(MOD, 'Cross-trend synthesis failed', err);
      }
    }

    // -----------------------------------------------------------------------
    // Step 7 — Brand Fit scoring (enriched with Phase 2 context + screenshot)
    // -----------------------------------------------------------------------
    logger.log(MOD, `--- Brand Fit Scoring (${analyzedTrends.length} trends × 3 brands) ---`);

    for (const at of analyzedTrends) {
      try {
        const screenshotPath = at.video.screenshot_path || null;
        const brandFits = await scoreBrandFit(
          at.enrichedTrend, at.trend_id, at.analysis, screenshotPath
        );

        if (brandFits.length > 0) {
          await upsertBrandFits(brandFits);
          stats.brand_fits += brandFits.length;
        }
      } catch (err) {
        logger.warn(MOD, `Brand fit scoring failed: ${at.enrichedTrend.title}`, err);
      }
    }

    // -----------------------------------------------------------------------
    // Step 8 — Slack notifications for act_now confirmed trends
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

    // -----------------------------------------------------------------------
    // Step 9 — Cleanup screenshots (transient files)
    // -----------------------------------------------------------------------
    await cleanupScreenshots();

    logger.log(MOD, 'Pipeline complete', {
      scraped: stats.scraped,
      new: stats.new,
      updated: stats.updated,
      signals: stats.signals,
      filtered: stats.filtered,
      analyzed: stats.analyzed,
      synthesized: stats.synthesized,
      brand_fits: stats.brand_fits,
      errors: stats.errors,
    });

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
 * @returns {Promise<object>} Pipeline stats
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
