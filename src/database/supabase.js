const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const logger = require('../logger');

const MOD = 'DB';

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
    hashtags: trendData.hashtags,
    audio_id: trendData.audio_id,
    audio_title: trendData.audio_title,
    engagement_rate: trendData.engagement_rate,
    velocity_score: trendData.velocity_score,
    replication_count: trendData.replication_count,
    lifecycle_stage: trendData.lifecycle_stage,
    momentum: trendData.momentum,
    scraped_at: trendData.scraped_at,
    trend_score: trendData.trend_score,
    classification: trendData.classification,
    urgency_level: trendData.urgency_level,
  };

  // Check if this hash already exists so we can report inserted vs updated
  const { data: existing } = await supabase
    .from('trends')
    .select('id')
    .eq('hash', hash)
    .maybeSingle();

  const isInsert = !existing;

  const { data, error: upsertError } = await supabase
    .from('trends')
    .upsert(row, { onConflict: 'hash' })
    .select('id')
    .single();

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
    captured_at: new Date().toISOString(),
  };

  const { data, error: insertError } = await supabase
    .from('engagement_snapshots')
    .insert(row)
    .select()
    .single();

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

module.exports = {
  supabase,
  generateTrendHash,
  upsertTrend,
  createEngagementSnapshot,
  getRecentSnapshots,
  getRecentTrends,
  testConnection,
};
