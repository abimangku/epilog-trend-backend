const express = require('express');
const logger = require('../logger');
const { supabase } = require('../database/supabase');

const { validateDays } = require('../middleware/validate');

const MOD = 'API:PATTERNS';
const router = express.Router();

/**
 * GET /api/patterns/formats — Format distribution across recent trends.
 * Query: ?days=14
 */
router.get('/formats', async (req, res) => {
  try {
    const days = validateDays(req.query.days);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: trends, error } = await supabase
      .from('trends')
      .select('detected_formats')
      .gte('scraped_at', since);

    if (error) {
      logger.error(MOD, 'Failed to fetch trends for format analysis', error);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }

    const formatCounts = {};
    for (const trend of trends) {
      const formats = trend.detected_formats || [];
      for (const format of formats) {
        formatCounts[format] = (formatCounts[format] || 0) + 1;
      }
    }

    const total = trends.length || 1;
    const result = Object.entries(formatCounts)
      .map(([format, count]) => ({
        format,
        count,
        percentage: Math.round((count / total) * 100),
        growth: 0,
      }))
      .sort((a, b) => b.count - a.count);

    res.json(result);
  } catch (err) {
    logger.error(MOD, 'Format patterns error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/patterns/audio — Audio tracks sorted by growth rate.
 * Query: ?days=6
 */
router.get('/audio', async (req, res) => {
  try {
    const totalDays = validateDays(req.query.days);
    const halfDays = Math.floor(totalDays / 2);
    const now = new Date();
    const midpoint = new Date(now - halfDays * 24 * 60 * 60 * 1000);
    const start = new Date(now - totalDays * 24 * 60 * 60 * 1000);

    const { data: recent, error: e1 } = await supabase
      .from('trends')
      .select('audio_id, audio_title')
      .not('audio_id', 'is', null)
      .gte('scraped_at', midpoint.toISOString());

    const { data: prior, error: e2 } = await supabase
      .from('trends')
      .select('audio_id, audio_title')
      .not('audio_id', 'is', null)
      .gte('scraped_at', start.toISOString())
      .lt('scraped_at', midpoint.toISOString());

    if (e1 || e2) {
      logger.error(MOD, 'Failed to fetch audio data', e1 || e2);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }

    const recentCounts = {};
    const audioTitles = {};
    for (const t of (recent || [])) {
      recentCounts[t.audio_id] = (recentCounts[t.audio_id] || 0) + 1;
      audioTitles[t.audio_id] = t.audio_title;
    }

    const priorCounts = {};
    for (const t of (prior || [])) {
      priorCounts[t.audio_id] = (priorCounts[t.audio_id] || 0) + 1;
      if (!audioTitles[t.audio_id]) audioTitles[t.audio_id] = t.audio_title;
    }

    const allAudioIds = new Set([...Object.keys(recentCounts), ...Object.keys(priorCounts)]);
    const result = [];

    for (const audioId of allAudioIds) {
      const current = recentCounts[audioId] || 0;
      const previous = priorCounts[audioId] || 0;
      const growthPct = previous > 0
        ? Math.round(((current - previous) / previous) * 100)
        : (current > 0 ? 100 : 0);

      let status = 'stable';
      if (growthPct > 50) status = 'rising';
      else if (growthPct < -10) status = 'declining';

      if (current > 0 || previous > 0) {
        result.push({
          audio_id: audioId,
          audio_title: audioTitles[audioId] || 'Unknown',
          current_count: current,
          previous_count: previous,
          growth_pct: growthPct,
          status,
        });
      }
    }

    result.sort((a, b) => b.growth_pct - a.growth_pct);
    res.json(result.slice(0, 20));
  } catch (err) {
    logger.error(MOD, 'Audio patterns error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
