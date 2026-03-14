const express = require('express');
const logger = require('../logger');
const { supabase } = require('../database/supabase');

const MOD = 'API:SAVED';
const router = express.Router();

/**
 * GET /api/saved — List all saved trend IDs with their collection memberships.
 */
router.get('/', async (req, res) => {
  try {
    const { data: savedItems, error } = await supabase
      .from('saved_items')
      .select('id, trend_id, saved_at')
      .order('saved_at', { ascending: false });

    if (error) {
      logger.error(MOD, 'Failed to fetch saved items', error);
      return res.status(500).json({ error: 'Failed to fetch saved items' });
    }

    const trendIds = savedItems.map(s => s.trend_id);
    let collectionMap = {};

    if (trendIds.length > 0) {
      const { data: memberships, error: memError } = await supabase
        .from('collection_items')
        .select('trend_id, collection_id')
        .in('trend_id', trendIds);

      if (!memError && memberships) {
        for (const m of memberships) {
          if (!collectionMap[m.trend_id]) collectionMap[m.trend_id] = [];
          collectionMap[m.trend_id].push(m.collection_id);
        }
      }
    }

    const result = savedItems.map(s => ({
      ...s,
      collections: collectionMap[s.trend_id] || [],
    }));

    res.json(result);
  } catch (err) {
    logger.error(MOD, 'Saved items error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/saved/:trendId — Save a trend.
 */
router.post('/:trendId', async (req, res) => {
  try {
    const { trendId } = req.params;
    const { data, error } = await supabase
      .from('saved_items')
      .insert({ trend_id: trendId })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Already saved' });
      }
      logger.error(MOD, 'Failed to save trend', error);
      return res.status(500).json({ error: 'Failed to save trend' });
    }

    res.status(201).json(data);
  } catch (err) {
    logger.error(MOD, 'Save trend error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/saved/:trendId — Unsave a trend.
 */
router.delete('/:trendId', async (req, res) => {
  try {
    const { trendId } = req.params;

    await supabase
      .from('collection_items')
      .delete()
      .eq('trend_id', trendId);

    const { error } = await supabase
      .from('saved_items')
      .delete()
      .eq('trend_id', trendId);

    if (error) {
      logger.error(MOD, 'Failed to unsave trend', error);
      return res.status(500).json({ error: 'Failed to unsave trend' });
    }

    res.status(204).send();
  } catch (err) {
    logger.error(MOD, 'Unsave trend error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
