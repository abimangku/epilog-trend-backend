const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const logger = require('../logger');
const { withRetry } = require('../utils/retry');

const MOD = 'DB';

/**
 * Wraps a Supabase operation with retry logic. Logs each retry attempt.
 * On final failure, logs the operation context for manual recovery.
 * @param {string} operation - Description for logging (e.g. 'upsert trend')
 * @param {() => Promise<*>} fn - The Supabase call to retry
 * @returns {Promise<*>}
 */
async function retrySupabase(operation, fn) {
  try {
    return await withRetry(fn, {
      retries: 3,
      baseDelay: 1000,
      onRetry: (err, attempt) => {
        logger.warn(MOD, `Retry ${attempt}/3 for ${operation}: ${err.message}`);
      },
    });
  } catch (err) {
    logger.error(MOD, `All retries exhausted for ${operation} — data may be lost`, err);
    throw err;
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  logger.warn(MOD, 'SUPABASE_URL or SUPABASE_ANON_KEY not set — database calls will fail');
}

/** @type {import('@supabase/supabase-js').SupabaseClient} */
const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder'
);

/**
 * Generates a deterministic SHA256 hash from platform + url + title.
 * Used as the conflict key for upserting trends.
 * @param {string} platform
 * @param {string} url
 * @param {string} title
 * @returns {string} 64-char hex hash
 */
function generateTrendHash(platform, url, title) {
  return crypto
    .createHash('sha256')
    .update(`${platform}|${url}|${title}`)
    .digest('hex');
}

/**
 * Upserts a trend into the 'trends' table.
 *
 * Generates a SHA256 hash of (platform + url + title) and uses the 'hash'
 * column as the upsert conflict key. On conflict, updates engagement metrics,
 * scores, and lifecycle fields.
 *
 * @param {object} trendData - Raw trend data matching the Trend interface columns
 * @param {string} trendData.platform
 * @param {string} trendData.title
 * @param {string} trendData.url
 * @param {string} trendData.author
 * @param {string} trendData.author_tier
 * @param {number} trendData.views
 * @param {number} trendData.likes
 * @param {number} trendData.comments
 * @param {number} trendData.shares
 * @param {string[]} trendData.hashtags
 * @param {string} trendData.audio_id
 * @param {string} trendData.audio_title
 * @param {number} trendData.engagement_rate
 * @param {number} trendData.velocity_score
 * @param {number} trendData.replication_count
 * @param {string} trendData.lifecycle_stage - One of: emerging, growing, peaking, declining, dead
 * @param {number} trendData.momentum
 * @param {string} trendData.scraped_at - ISO 8601 timestamp
 * @returns {Promise<{inserted: boolean, trend_id: string}>}
 * @throws {Error} If Supabase returns an error
 */
async function upsertTrend(trendData) {
  const hash = generateTrendHash(
    trendData.platform,
    trendData.url,
    trendData.title
  );

  const row = {
    hash,
    platform: trendData.platform,
    title: trendData.title,
    url: trendData.url,
    author: trendData.author,
    author_tier: trendData.author_tier,
    views: trendData.views,
    likes: trendData.likes,
    comments: trendData.comments,
    shares: trendData.shares,
    bookmarks: trendData.bookmarks || 0,
    hashtags: trendData.hashtags,
    audio_id: trendData.audio_id,
    audio_title: trendData.audio_title,
    engagement_rate: trendData.engagement_rate,
    share_ratio: trendData.share_ratio || null,
    velocity_score: trendData.velocity_score,
    replication_count: trendData.replication_count,
    lifecycle_stage: trendData.lifecycle_stage,
    momentum: trendData.momentum,
    scraped_at: trendData.scraped_at,
    trend_score: trendData.trend_score,
    classification: trendData.classification,
    urgency_level: trendData.urgency_level,
    thumbnail_url: trendData.thumbnail_url || null,
    video_embed_url: trendData.video_embed_url || null,
  };

  // Check if this hash already exists so we can report inserted vs updated
  const { data: existing } = await retrySupabase(
    `check trend ${hash.slice(0, 8)}`,
    () => supabase.from('trends').select('id').eq('hash', hash).maybeSingle()
  );

  const isInsert = !existing;

  const { data, error: upsertError } = await retrySupabase(
    `upsert trend ${trendData.title.slice(0, 30)}`,
    () => supabase.from('trends').upsert(row, { onConflict: 'hash' }).select('id').single()
  );

  if (upsertError) {
    logger.error(MOD, `Failed to upsert trend: ${trendData.title}`, upsertError);
    throw new Error(`Upsert trend failed: ${upsertError.message}`);
  }

  logger.log(MOD, `${isInsert ? 'Inserted' : 'Updated'} trend: ${trendData.title}`, { id: data.id, hash });

  return { inserted: isInsert, trend_id: data.id };
}

/**
 * Inserts a new engagement snapshot for a trend.
 *
 * Creates a point-in-time record of engagement metrics. Called every time
 * a trend is scraped to build the velocity time-series.
 *
 * @param {string} trendId - UUID of the trend (from trends.id)
 * @param {object} metrics
 * @param {number} metrics.views
 * @param {number} metrics.likes
 * @param {number} metrics.comments
 * @param {number} metrics.shares
 * @returns {Promise<object>} The inserted engagement_snapshot row
 * @throws {Error} If Supabase returns an error
 */
async function createEngagementSnapshot(trendId, metrics) {
  const row = {
    trend_id: trendId,
    views: metrics.views,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    bookmarks: metrics.bookmarks || 0,
    captured_at: new Date().toISOString(),
  };

  const { data, error: insertError } = await retrySupabase(
    `snapshot for ${trendId.slice(0, 8)}`,
    () => supabase.from('engagement_snapshots').insert(row).select().single()
  );

  if (insertError) {
    logger.error(MOD, `Failed to create snapshot for trend ${trendId}`, insertError);
    throw new Error(`Insert engagement snapshot failed: ${insertError.message}`);
  }

  logger.log(MOD, `Created engagement snapshot for trend ${trendId}`, {
    views: metrics.views,
    likes: metrics.likes,
  });

  return data;
}

/**
 * Returns the last N engagement snapshots for a given trend, newest first.
 *
 * Used by the scoring pipeline to calculate velocity from historical data.
 *
 * @param {string} trendId - UUID of the trend
 * @param {number} [limit=5] - Max snapshots to return
 * @returns {Promise<object[]>} Array of engagement_snapshot rows ordered by captured_at DESC
 * @throws {Error} If Supabase returns an error
 */
async function getRecentSnapshots(trendId, limit = 5) {
  const { data, error: queryError } = await supabase
    .from('engagement_snapshots')
    .select('*')
    .eq('trend_id', trendId)
    .order('captured_at', { ascending: false })
    .limit(limit);

  if (queryError) {
    logger.error(MOD, `Failed to fetch snapshots for trend ${trendId}`, queryError);
    throw new Error(`Get recent snapshots failed: ${queryError.message}`);
  }

  return data || [];
}

/**
 * Returns all trends scraped within the last N hours.
 *
 * Used by the replication scorer to analyze the full batch and detect
 * format clustering across recent trends.
 *
 * @param {number} [hoursBack=72] - How far back to look
 * @returns {Promise<object[]>} Array of trend rows
 * @throws {Error} If Supabase returns an error
 */
async function getRecentTrends(hoursBack = 72) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const { data, error: queryError } = await supabase
    .from('trends')
    .select('*')
    .gte('scraped_at', since)
    .order('scraped_at', { ascending: false });

  if (queryError) {
    logger.error(MOD, `Failed to fetch recent trends (${hoursBack}h)`, queryError);
    throw new Error(`Get recent trends failed: ${queryError.message}`);
  }

  logger.log(MOD, `Fetched ${(data || []).length} trends from last ${hoursBack}h`);
  return data || [];
}

/**
 * Tests database connectivity by running a lightweight query.
 *
 * @returns {Promise<boolean>} true if connection succeeds, false otherwise
 */
async function testConnection() {
  try {
    const { error: queryError } = await supabase
      .from('trends')
      .select('id', { count: 'exact', head: true });

    if (queryError) {
      logger.error(MOD, 'Connection test failed', queryError);
      return false;
    }

    logger.log(MOD, 'Connection test passed');
    return true;
  } catch (err) {
    logger.error(MOD, 'Connection test threw', err);
    return false;
  }
}

/**
 * Upserts a deep analysis row into the 'trend_analysis' table.
 * One deep analysis per trend — checks for existing row, then updates or inserts.
 *
 * Note: Uses check-then-write instead of Supabase .upsert() because the table
 * has a partial unique index on trend_id (WHERE trend_id IS NOT NULL) which
 * PostgREST's ON CONFLICT cannot target.
 *
 * @param {string} trendId - UUID of the trend
 * @param {object} analysis - Phase 2 deep analysis data
 * @returns {Promise<object>} The upserted row
 * @throws {Error} If Supabase returns an error
 */
async function upsertTrendAnalysis(trendId, analysis) {
  const fields = {
    analysis_type: analysis.analysis_type || 'deep_analysis',
    summary: analysis.summary,
    key_insights: analysis.key_insights,
    brand_relevance_notes: analysis.brand_relevance_notes,
    recommended_action: analysis.recommended_action,
    confidence: analysis.confidence,
    raw_confidence: analysis.raw_confidence || null,
    calibrated_confidence: analysis.calibrated_confidence || null,
    relevance_score: analysis.relevance_score || 0,
    virality_score: analysis.virality_score || 0,
    brand_safety_score: analysis.brand_safety_score || 100,
    replication_signal_score: analysis.replication_signal_score || 0,
    why_trending: analysis.why_trending || '',
    trash_check: analysis.trash_check || { passed: true, reasons: [] },
    model_version: analysis.model_version,
    analysis_version: analysis.analysis_version || null,
    analyzed_at: new Date().toISOString(),
  };

  // Check if a deep analysis already exists for this trend
  const { data: existing } = await retrySupabase(
    `check analysis ${trendId.slice(0, 8)}`,
    () => supabase.from('trend_analysis').select('id').eq('trend_id', trendId).maybeSingle()
  );

  let data;
  let error;

  if (existing) {
    const result = await retrySupabase(
      `update analysis ${existing.id.slice(0, 8)}`,
      () => supabase.from('trend_analysis').update(fields).eq('id', existing.id).select().single()
    );
    data = result.data;
    error = result.error;
  } else {
    const result = await retrySupabase(
      `insert analysis ${trendId.slice(0, 8)}`,
      () => supabase.from('trend_analysis').insert({ trend_id: trendId, ...fields }).select().single()
    );
    data = result.data;
    error = result.error;
  }

  if (error) {
    logger.error(MOD, `Failed to upsert trend analysis for ${trendId}`, error);
    throw new Error(`Upsert trend analysis failed: ${error.message}`);
  }

  logger.log(MOD, `${existing ? 'Updated' : 'Inserted'} deep analysis for ${trendId}`);
  return data;
}

/**
 * Inserts a cross-trend synthesis row into the 'trend_analysis' table.
 * These rows have trend_id = null and analysis_type = 'cross_trend_synthesis'.
 * Each pipeline run creates a new synthesis (insert, not upsert).
 *
 * @param {object} synthesis - Phase 3 cross-trend synthesis data
 * @returns {Promise<object>} The inserted row
 * @throws {Error} If Supabase returns an error
 */
async function insertCrossTrendSynthesis(synthesis) {
  const row = {
    trend_id: null,
    analysis_type: 'cross_trend_synthesis',
    summary: synthesis.summary || '',
    key_insights: synthesis.key_insights || [],
    brand_relevance_notes: synthesis.brand_relevance_notes || '',
    recommended_action: synthesis.recommended_action || '',
    confidence: synthesis.confidence || 0,
    relevance_score: 0,
    virality_score: 0,
    brand_safety_score: 100,
    replication_signal_score: 0,
    why_trending: synthesis.cultural_pulse || '',
    trash_check: { passed: true, reasons: [] },
    model_version: synthesis.model_version || '',
    analyzed_at: new Date().toISOString(),
  };

  const { data, error: insertError } = await retrySupabase(
    'insert cross-trend synthesis',
    () => supabase.from('trend_analysis').insert(row).select().single()
  );

  if (insertError) {
    logger.error(MOD, 'Failed to insert cross-trend synthesis', insertError);
    throw new Error(`Insert cross-trend synthesis failed: ${insertError.message}`);
  }

  logger.log(MOD, 'Inserted cross-trend synthesis row');
  return data;
}

/**
 * Upserts brand fit rows into the 'client_brand_fit' table.
 * One row per brand per trend.
 *
 * @param {object[]} brandFits - Array of brand fit objects with trend_id set
 * @returns {Promise<object[]>} The upserted rows
 * @throws {Error} If Supabase returns an error
 */
async function upsertBrandFits(brandFits) {
  if (!brandFits || brandFits.length === 0) return [];

  const { data, error: upsertError } = await retrySupabase(
    `upsert ${brandFits.length} brand fits`,
    () => supabase.from('client_brand_fit').upsert(brandFits, { onConflict: 'trend_id,brand_name' }).select()
  );

  if (upsertError) {
    logger.error(MOD, `Failed to upsert brand fits`, upsertError);
    throw new Error(`Upsert brand fits failed: ${upsertError.message}`);
  }

  logger.log(MOD, `Upserted ${(data || []).length} brand fit rows`);
  return data || [];
}

/**
 * Creates a new pipeline run record. Called at pipeline start.
 * @returns {Promise<string|null>} The run ID (UUID), or null on failure
 */
async function createPipelineRun() {
  const { data, error } = await retrySupabase(
    'create pipeline run',
    () => supabase.from('pipeline_runs').insert({
      started_at: new Date().toISOString(),
      status: 'running',
    }).select('id').single()
  );

  if (error) {
    logger.error(MOD, 'Failed to create pipeline run', error);
    return null;
  }

  return data.id;
}

/**
 * Updates an existing pipeline run with results. Called at pipeline end.
 * @param {string} runId - Pipeline run UUID
 * @param {object} update - Fields to update (status, videos_scraped, etc.)
 */
async function updatePipelineRun(runId, update) {
  if (!runId) return;

  const { error } = await retrySupabase(
    `update pipeline run ${runId.slice(0, 8)}`,
    () => supabase.from('pipeline_runs').update({
      ...update,
      completed_at: new Date().toISOString(),
    }).eq('id', runId)
  );

  if (error) {
    logger.error(MOD, `Failed to update pipeline run ${runId}`, error);
  }
}

/**
 * Creates a pipeline event for observability.
 * @param {string|null} runId - Pipeline run UUID (null for non-run events)
 * @param {string} stage - Pipeline stage name
 * @param {string} severity - 'info' | 'warning' | 'critical'
 * @param {string} message - Human-readable message
 * @param {object} [data] - Additional structured data
 */
async function createPipelineEvent(runId, stage, severity, message, data = {}) {
  const { error } = await retrySupabase(
    `event: ${stage}/${severity}`,
    () => supabase.from('pipeline_events').insert({
      run_id: runId,
      stage,
      severity,
      message,
      data,
    })
  );

  if (error) {
    logger.error(MOD, `Failed to create pipeline event: ${message}`, error);
  }
}

/**
 * Checks database connectivity with retry. Returns true if reachable.
 * Retries 3 times with 10-second delays before giving up.
 * @returns {Promise<boolean>}
 */
async function checkConnection() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ok = await testConnection();
    if (ok) return true;

    if (attempt < 2) {
      logger.warn(MOD, `Connection check failed (attempt ${attempt + 1}/3) — retrying in 10s`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  logger.error(MOD, 'Connection check failed after 3 attempts');
  return false;
}

/**
 * Updates the thumbnail_storage_url for a trend.
 * @param {string} trendId - Trend UUID
 * @param {string} storageUrl - Supabase Storage URL
 */
async function updateTrendThumbnail(trendId, storageUrl) {
  const { error } = await retrySupabase(
    `thumbnail ${trendId.slice(0, 8)}`,
    () => supabase.from('trends').update({ thumbnail_storage_url: storageUrl }).eq('id', trendId)
  );

  if (error) {
    logger.warn(MOD, `Failed to update thumbnail URL for ${trendId}`, error);
  }
}

/**
 * Gets all schedule config rows, ordered by label.
 * @returns {Promise<object[]>}
 */
async function getScheduleConfig() {
  const { data, error } = await supabase
    .from('schedule_config')
    .select('*')
    .order('label');

  if (error) {
    logger.error(MOD, 'Failed to get schedule config', error);
    return [];
  }
  return data || [];
}

/**
 * Updates a single schedule config row.
 * @param {string} id - Row UUID
 * @param {object} update - Fields to update
 */
async function updateScheduleConfig(id, update) {
  const { error } = await supabase
    .from('schedule_config')
    .update(update)
    .eq('id', id);

  if (error) {
    logger.error(MOD, `Failed to update schedule config ${id}`, error);
    throw error;
  }
}

/**
 * Marks pipeline events as acknowledged.
 * @param {string[]} [eventIds] - Specific event IDs, or null to acknowledge all unacknowledged
 */
async function acknowledgePipelineEvents(eventIds) {
  let query = supabase
    .from('pipeline_events')
    .update({ acknowledged: true });

  if (eventIds && eventIds.length > 0) {
    query = query.in('id', eventIds);
  } else {
    query = query.eq('acknowledged', false);
  }

  const { error } = await query;
  if (error) {
    logger.error(MOD, 'Failed to acknowledge pipeline events', error);
  }
}

/**
 * Upserts audio trend data from a pipeline scrape batch.
 * Groups by audio_id, counts unique authors, and tracks first/last seen.
 *
 * @param {Array<{audio_id: string, audio_title: string, author: string}>} videos
 * @returns {Promise<number>} Number of audio trends upserted
 */
async function upsertAudioTrends(videos) {
  const audioMap = new Map();
  for (const v of videos) {
    if (!v.audio_id) continue;
    if (!audioMap.has(v.audio_id)) {
      audioMap.set(v.audio_id, { title: v.audio_title || '', authors: new Set() });
    }
    audioMap.get(v.audio_id).authors.add(v.author);
  }

  let upserted = 0;
  const now = new Date().toISOString();

  for (const [audioId, data] of audioMap) {
    try {
      const { data: existing } = await retrySupabase(
        `check audio ${audioId.slice(0, 16)}`,
        () => supabase
          .from('audio_trends')
          .select('id, usage_count, unique_authors')
          .eq('audio_id', audioId)
          .order('scraped_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      );

      if (existing) {
        const { error } = await retrySupabase(
          `update audio ${audioId.slice(0, 16)}`,
          () => supabase.from('audio_trends')
            .update({
              audio_title: data.title,
              usage_count: (existing.usage_count || 0) + data.authors.size,
              unique_authors: (existing.unique_authors || 0) + data.authors.size,
              last_seen_at: now,
              scraped_at: now,
            })
            .eq('id', existing.id)
        );
        if (error) {
          logger.warn(MOD, `Failed to update audio trend ${audioId}: ${error.message}`);
          continue;
        }
      } else {
        const { error } = await retrySupabase(
          `insert audio ${audioId.slice(0, 16)}`,
          () => supabase.from('audio_trends').insert({
            audio_id: audioId,
            audio_title: data.title,
            usage_count: data.authors.size,
            unique_authors: data.authors.size,
            first_seen_at: now,
            last_seen_at: now,
            scraped_at: now,
          })
        );
        if (error) {
          logger.warn(MOD, `Failed to insert audio trend ${audioId}: ${error.message}`);
          continue;
        }
      }
      upserted++;
    } catch (err) {
      logger.warn(MOD, `Failed to upsert audio trend ${audioId}`, err);
    }
  }

  logger.log(MOD, `Upserted ${upserted} audio trends`);
  return upserted;
}

module.exports = {
  supabase,
  generateTrendHash,
  upsertTrend,
  createEngagementSnapshot,
  getRecentSnapshots,
  getRecentTrends,
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
  getScheduleConfig,
  updateScheduleConfig,
  acknowledgePipelineEvents,
};
