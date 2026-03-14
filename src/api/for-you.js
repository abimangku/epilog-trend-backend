const express = require('express');
const logger = require('../logger');
const { supabase } = require('../database/supabase');
const { detectFormats } = require('../patterns/formats');

const MOD = 'API:FORYOU';
const router = express.Router();

/**
 * GET /api/for-you — Curated picks organized by opportunity type.
 * Returns: { high_potential, fun_to_replicate, rising_quietly, audio_going_viral }
 */
router.get('/', async (req, res) => {
  try {
    const { data: trends, error: tErr } = await supabase
      .from('trends')
      .select('*')
      .gte('scraped_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('trend_score', { ascending: false });

    if (tErr) {
      logger.error(MOD, 'Failed to fetch trends for For You', tErr);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }

    if (!trends || trends.length === 0) {
      return res.json({
        high_potential: [],
        fun_to_replicate: [],
        rising_quietly: [],
        audio_going_viral: [],
      });
    }

    const trendIds = trends.map(t => t.id);

    const { data: analyses } = await supabase
      .from('trend_analysis')
      .select('*')
      .in('trend_id', trendIds)
      .eq('analysis_type', 'deep_analysis');

    const analysisMap = {};
    for (const a of (analyses || [])) {
      analysisMap[a.trend_id] = a;
    }

    const { data: fits } = await supabase
      .from('client_brand_fit')
      .select('*')
      .in('trend_id', trendIds);

    const fitMap = {};
    for (const f of (fits || [])) {
      if (!fitMap[f.trend_id]) fitMap[f.trend_id] = [];
      fitMap[f.trend_id].push(f);
    }

    const enriched = trends.map(t => ({
      ...t,
      analysis: analysisMap[t.id] || null,
      brand_fits: fitMap[t.id] || [],
      detected_formats: detectFormats(t.title, t.hashtags || []),
      reason: analysisMap[t.id]?.summary || '',
    }));

    // 1. High Potential
    const highPotential = enriched
      .filter(t => {
        const maxFit = Math.max(0, ...t.brand_fits.map(f => f.fit_score || 0));
        return maxFit >= 60 && t.trend_score >= 50 &&
          ['growing', 'peaking'].includes(t.lifecycle_stage);
      })
      .slice(0, 4);

    // 2. Fun to Replicate
    const viewValues = enriched.map(t => t.views || 0).sort((a, b) => a - b);
    const p75 = viewValues[Math.floor(viewValues.length * 0.75)] || 0;

    const funToReplicate = enriched
      .filter(t =>
        (t.views || 0) >= p75 &&
        t.detected_formats.length > 0 &&
        ['noise', 'emerging_trend'].includes(t.classification) &&
        !highPotential.find(hp => hp.id === t.id)
      )
      .slice(0, 4);

    // 3. Rising Quietly
    const risingQuietly = enriched
      .filter(t =>
        t.lifecycle_stage === 'emerging' &&
        t.momentum === 1 &&
        !highPotential.find(hp => hp.id === t.id) &&
        !funToReplicate.find(fr => fr.id === t.id)
      )
      .slice(0, 4);

    // 4. Audio Going Viral
    const audioCounts = {};
    const audioTitles = {};
    const audioTrends = {};
    for (const t of enriched) {
      if (t.audio_id) {
        audioCounts[t.audio_id] = (audioCounts[t.audio_id] || 0) + 1;
        audioTitles[t.audio_id] = t.audio_title;
        if (!audioTrends[t.audio_id]) audioTrends[t.audio_id] = [];
        audioTrends[t.audio_id].push(t.id);
      }
    }

    const audioGoingViral = Object.entries(audioCounts)
      .filter(([, count]) => count >= 3)
      .map(([audioId, count]) => ({
        audio_id: audioId,
        audio_title: audioTitles[audioId] || 'Unknown',
        current_count: count,
        growth_pct: 0,
        trend_ids: audioTrends[audioId],
      }))
      .sort((a, b) => b.current_count - a.current_count)
      .slice(0, 4);

    res.json({
      high_potential: highPotential,
      fun_to_replicate: funToReplicate,
      rising_quietly: risingQuietly,
      audio_going_viral: audioGoingViral,
    });
  } catch (err) {
    logger.error(MOD, 'For You error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
