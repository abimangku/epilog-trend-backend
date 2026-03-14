const express = require('express');
const logger = require('../logger');
const { supabase } = require('../database/supabase');

const MOD = 'API:COLLECTIONS';
const router = express.Router();

/**
 * GET /api/collections — List all collections with item counts.
 */
router.get('/', async (req, res) => {
  try {
    const { data: collections, error } = await supabase
      .from('collections')
      .select('id, name, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      logger.error(MOD, 'Failed to fetch collections', error);
      return res.status(500).json({ error: 'Failed to fetch collections' });
    }

    const collectionIds = collections.map(c => c.id);
    let countMap = {};

    if (collectionIds.length > 0) {
      const { data: items, error: countError } = await supabase
        .from('collection_items')
        .select('collection_id')
        .in('collection_id', collectionIds);

      if (!countError && items) {
        for (const item of items) {
          countMap[item.collection_id] = (countMap[item.collection_id] || 0) + 1;
        }
      }
    }

    const result = collections.map(c => ({
      ...c,
      item_count: countMap[c.id] || 0,
    }));

    res.json(result);
  } catch (err) {
    logger.error(MOD, 'Collections error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/collections — Create a new collection.
 * Request: { name: "Ramadan Ideas" }
 */
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    const { data, error } = await supabase
      .from('collections')
      .insert({ name: name.trim() })
      .select()
      .single();

    if (error) {
      logger.error(MOD, 'Failed to create collection', error);
      return res.status(500).json({ error: 'Failed to create collection' });
    }

    res.status(201).json({ ...data, item_count: 0 });
  } catch (err) {
    logger.error(MOD, 'Create collection error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/collections/:id — Rename a collection.
 * Request: { name: "New Name" }
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    const { data, error } = await supabase
      .from('collections')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error(MOD, 'Failed to rename collection', error);
      return res.status(500).json({ error: 'Failed to rename collection' });
    }

    res.json(data);
  } catch (err) {
    logger.error(MOD, 'Rename collection error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/collections/:id — Delete a collection (items remain saved).
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('collections')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error(MOD, 'Failed to delete collection', error);
      return res.status(500).json({ error: 'Failed to delete collection' });
    }

    res.status(204).send();
  } catch (err) {
    logger.error(MOD, 'Delete collection error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/collections/:id/items — Add a trend to a collection.
 * Request: { trend_id: "uuid" }
 */
router.post('/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    const { trend_id } = req.body;
    if (!trend_id) {
      return res.status(400).json({ error: 'trend_id is required' });
    }

    await supabase
      .from('saved_items')
      .upsert({ trend_id }, { onConflict: 'trend_id' });

    const { data, error } = await supabase
      .from('collection_items')
      .insert({ collection_id: id, trend_id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Already in collection' });
      }
      logger.error(MOD, 'Failed to add to collection', error);
      return res.status(500).json({ error: 'Failed to add to collection' });
    }

    await supabase
      .from('collections')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id);

    res.status(201).json(data);
  } catch (err) {
    logger.error(MOD, 'Add to collection error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/collections/:id/items/:trendId — Remove a trend from a collection.
 */
router.delete('/:id/items/:trendId', async (req, res) => {
  try {
    const { id, trendId } = req.params;

    const { error } = await supabase
      .from('collection_items')
      .delete()
      .eq('collection_id', id)
      .eq('trend_id', trendId);

    if (error) {
      logger.error(MOD, 'Failed to remove from collection', error);
      return res.status(500).json({ error: 'Failed to remove from collection' });
    }

    res.status(204).send();
  } catch (err) {
    logger.error(MOD, 'Remove from collection error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
