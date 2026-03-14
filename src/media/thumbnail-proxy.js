const axios = require('axios');
const logger = require('../logger');
const { supabase } = require('../database/supabase');

const MOD = 'THUMBNAIL_PROXY';
const BUCKET = 'trend-thumbnails';

/**
 * Downloads a thumbnail from TikTok CDN and uploads it to Supabase Storage.
 * Returns the Supabase Storage public URL, or null on failure.
 *
 * @param {string} originalUrl - TikTok CDN thumbnail URL
 * @param {string} trendId - UUID of the trend (used as filename)
 * @returns {Promise<string|null>} Supabase Storage public URL or null
 */
async function proxyThumbnail(originalUrl, trendId) {
  if (!originalUrl) return null;

  try {
    // Download from TikTok CDN
    const response = await axios.get(originalUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const storagePath = `${trendId}.${ext}`;

    // Upload to Supabase Storage (upsert)
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, response.data, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      logger.warn(MOD, `Upload failed for ${trendId}: ${uploadError.message}`);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    logger.log(MOD, `Proxied thumbnail for ${trendId.slice(0, 8)}`);
    return urlData.publicUrl;
  } catch (err) {
    logger.warn(MOD, `Thumbnail proxy failed for ${trendId.slice(0, 8)}: ${err.message}`);
    return null;
  }
}

/**
 * Deletes thumbnails older than the specified number of days from Storage.
 * @param {number} [daysOld=30] - Delete files older than this
 */
async function cleanupOldThumbnails(daysOld = 30) {
  try {
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list('', { limit: 1000 });

    if (error || !files) {
      logger.warn(MOD, 'Could not list thumbnails for cleanup', error);
      return;
    }

    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const old = files.filter((f) => new Date(f.created_at) < cutoff);

    if (old.length === 0) return;

    const paths = old.map((f) => f.name);
    const { error: deleteError } = await supabase.storage
      .from(BUCKET)
      .remove(paths);

    if (deleteError) {
      logger.warn(MOD, `Cleanup delete failed: ${deleteError.message}`);
    } else {
      logger.log(MOD, `Cleaned up ${old.length} old thumbnails`);
    }
  } catch (err) {
    logger.warn(MOD, 'Thumbnail cleanup failed', err);
  }
}

module.exports = { proxyThumbnail, cleanupOldThumbnails };
