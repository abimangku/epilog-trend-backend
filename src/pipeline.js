/**
 * Pipeline orchestrator — connects scraping, scoring, pattern detection,
 * 3-phase AI analysis, brand fit scoring, database persistence, and
 * pipeline event tracking into a single run.
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
 *   → Pipeline event tracking
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
  calculateShareRatio,
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
const { detectCulturalSignals, getActiveCulturalMoments } = require('./patterns/cultural');
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
  createPipelineRun,
  updatePipelineRun,
  createPipelineEvent,
  checkConnection,
  updateTrendThumbnail,
  upsertAudioTrends,
  getLatestSnapshot,
} = require('./database/supabase');
const { trashGate, deepAnalysis, crossTrendSynthesis } = require('./ai/analyzer');
const { scoreBrandFit } = require('./ai/brand-fit');

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

  const runId = await createPipelineRun();
  logger.setRunId(runId);
  const runErrors = [];

  try {
    // -----------------------------------------------------------------------
    // Step 0 — Verify Supabase is reachable
    // -----------------------------------------------------------------------
    const connected = await checkConnection();
    if (!connected) {
      logger.error(MOD, 'CRITICAL: Supabase unreachable after 3 attempts — aborting pipeline');
      await createPipelineEvent(runId, 'startup', 'critical', 'Supabase unreachable — pipeline aborted');
      await updatePipelineRun(runId, { status: 'failed', errors: [{ stage: 'startup', message: 'Supabase unreachable' }] });
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
      await createPipelineEvent(runId, 'scrape', 'warning', 'Zero videos scraped — possible rate limit or DOM change');
      await updatePipelineRun(runId, { status: 'partial', videos_scraped: 0, errors: [{ stage: 'scrape', message: 'Zero videos' }] });
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

    for (const video of videos) {
      try {
        // --- Engagement rate ---
        const engagementRate = calculateEngagementRate(
          video.likes, video.comments, video.shares, video.views
        );

        // --- Share ratio ---
        const shareRatio = calculateShareRatio(video.shares, video.views);

        // --- Lookup existing trend for historical snapshots ---
        const hash = generateTrendHash(video.platform, video.url, video.title);
        const existing = await findExistingTrend(hash);

        let snapshots = [];
        let firstSeenAt = new Date();

        // Fetch latest snapshot for cross-run velocity
        let previousSnapshot = null;
        if (existing) {
          const rawSnapshots = await getRecentSnapshots(existing.id);
          snapshots = rawSnapshots.reverse();
          firstSeenAt = new Date(existing.scraped_at);
          previousSnapshot = await getLatestSnapshot(existing.id);
        }

        // --- Velocity ---
        const currentMetrics = {
          views: video.views || 0,
          likes: video.likes || 0,
          comments: video.comments || 0,
          shares: video.shares || 0,
          captured_at: new Date().toISOString(),
        };
        const velocityScore = snapshots.length > 0 || previousSnapshot
          ? calculateVelocityScore(snapshots, previousSnapshot, currentMetrics)
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

        // --- Calendar boost ---
        const activeMoments = getActiveCulturalMoments();
        let calendarBoost = 0;
        if (activeMoments.length > 0 && culturalSignals.length > 0) {
          const matchingMoment = activeMoments.find(m => culturalSignals.includes(m.name));
          if (matchingMoment) {
            calendarBoost = matchingMoment.score_boost;
          }
        }

        const patternScore = calculatePatternScore(
          formats, culturalSignals, replicationCount, calendarBoost
        );

        // --- Composite score ---
        const composite = compositeScore(
          engagementRate, velocityScore, replicationCount, patternScore,
          video.scraped_at || new Date().toISOString()
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
          share_ratio: Math.round(shareRatio * 100) / 100,
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
          detected_formats: formats,
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
          bookmarks: video.bookmarks || 0,
        });

        // --- Proxy thumbnail to Supabase Storage ---
        if (enrichedTrend.thumbnail_url) {
          try {
            const { proxyThumbnail } = require('./media/thumbnail-proxy');
            const storageUrl = await proxyThumbnail(enrichedTrend.thumbnail_url, trend_id);
            if (storageUrl) {
              await updateTrendThumbnail(trend_id, storageUrl);
            }
          } catch (thumbErr) {
            logger.warn(MOD, `Thumbnail proxy failed: ${enrichedTrend.title}`, thumbErr);
          }
        }

        // Track for AI pipeline
        enrichedVideos.push({
          enrichedTrend,
          trend_id,
          video,
        });

      } catch (err) {
        stats.errors++;
        logger.error(MOD, `Failed to process video: ${video.title || video.url}`, err);
      }
    }

    // -----------------------------------------------------------------------
    // Step 3b — Audio trend tracking
    // -----------------------------------------------------------------------
    try {
      const audioCount = await upsertAudioTrends(videos);
      logger.log(MOD, `Tracked ${audioCount} audio trends`);
    } catch (err) {
      logger.warn(MOD, 'Audio trend tracking failed (non-fatal)', err);
    }

    // -----------------------------------------------------------------------
    // Step 4 — Phase 1: Trash Gate (batch LLM filter)
    // -----------------------------------------------------------------------
    logger.log(MOD, `--- Phase 1: Trash Gate (${enrichedVideos.length} videos) ---`);

    const verdicts = await trashGate(enrichedVideos.map((ev) => ({
      ...ev.video,
      engagement_rate: ev.enrichedTrend.engagement_rate,
      share_ratio: ev.enrichedTrend.share_ratio,
    })));
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
        runErrors.push({ stage: 'deep_analysis', trendId: survivor.trend_id, error: err.message });
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
        runErrors.push({ stage: 'brand_fit', trendId: at.trend_id, error: err.message });
        logger.warn(MOD, `Brand fit scoring failed: ${at.enrichedTrend.title}`, err);
      }
    }

    // -----------------------------------------------------------------------
    // Step 8 — Cleanup screenshots (transient files)
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

    const runStatus = stats.errors > 0 ? 'partial' : 'success';
    await updatePipelineRun(runId, {
      status: runStatus,
      videos_scraped: stats.scraped,
      videos_passed_gate: stats.signals,
      videos_analyzed: stats.analyzed,
      videos_failed: stats.errors,
      errors: runErrors,
    });

    await createPipelineEvent(runId, 'complete', 'info',
      `Pipeline ${runStatus}: ${stats.scraped} scraped, ${stats.analyzed} analyzed, ${stats.errors} errors`);

    logger.setRunId(null);
  } catch (err) {
    logger.error(MOD, 'Pipeline failed', err);
    runErrors.push({ stage: 'pipeline', error: err.message });
    await updatePipelineRun(runId, { status: 'failed', errors: runErrors });
    await createPipelineEvent(runId, 'pipeline', 'critical', `Pipeline crashed: ${err.message}`);
    logger.setRunId(null);
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
