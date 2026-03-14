const express = require('express');
const logger = require('../logger');
const { getScheduleConfig, updateScheduleConfig } = require('../database/supabase');

const MOD = 'API_SCHEDULES';
const router = express.Router();

/**
 * GET /api/schedules — List all schedule configs
 */
router.get('/', async (req, res) => {
  try {
    const schedules = await getScheduleConfig();
    res.json(schedules);
  } catch (err) {
    logger.error(MOD, 'Failed to list schedules', err);
    res.status(500).json({ error: 'Failed to load schedules' });
  }
});

/**
 * PATCH /api/schedules/:id — Update a schedule config
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled, ai_analysis_enabled, interval_minutes } = req.body;

    const update = {};
    if (typeof enabled === 'boolean') update.enabled = enabled;
    if (typeof ai_analysis_enabled === 'boolean') update.ai_analysis_enabled = ai_analysis_enabled;
    if (typeof interval_minutes === 'number' && interval_minutes > 0 && interval_minutes <= 180) {
      update.interval_minutes = interval_minutes;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await updateScheduleConfig(id, update);
    res.json({ ok: true });
  } catch (err) {
    logger.error(MOD, 'Failed to update schedule', err);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

module.exports = router;
