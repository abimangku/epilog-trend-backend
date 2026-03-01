/**
 * AI Trend Analyzer — calls OpenRouter to generate trend analysis.
 * Fills the trend_analysis table with AI-generated insights.
 */

const axios = require('axios');
const logger = require('../logger');

const MOD = 'AI_ANALYZER';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Analyzes a single trend using an LLM via OpenRouter.
 * Returns structured analysis: summary, key insights, brand relevance,
 * recommended action, scoring dimensions, and trash check.
 *
 * @param {object} trend - Enriched trend object from the pipeline
 * @param {string} trend.title
 * @param {string} trend.url
 * @param {string} trend.author
 * @param {number} trend.views
 * @param {number} trend.likes
 * @param {number} trend.comments
 * @param {number} trend.shares
 * @param {string[]} trend.hashtags
 * @param {string} trend.audio_title
 * @param {number} trend.engagement_rate
 * @param {number} trend.velocity_score
 * @param {number} trend.replication_count
 * @param {string} trend.lifecycle_stage
 * @param {string} trend.classification
 * @param {string} trend.urgency_level
 * @param {number} trend.trend_score
 * @returns {Promise<object|null>} Analysis object or null on failure
 */
async function analyzeTrend(trend) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn(MOD, 'OPENROUTER_API_KEY not set — skipping AI analysis');
    return null;
  }

  const prompt = buildAnalysisPrompt(trend);

  try {
    const response = await axios.post(OPENROUTER_URL, {
      model: 'google/gemini-2.0-flash-001',
      messages: [
        {
          role: 'system',
          content: `You are a TikTok trend analyst for Epilog Creative, a digital marketing agency in Jakarta, Indonesia. Your clients are Godrej Indonesia brands: Stella (air freshener/home fragrance), HIT Kecoa (insecticide/pest control), and NYU (personal care/hair color). Analyze trends for the Indonesian market. Always respond in valid JSON.`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://epilog-trend-watcher.com',
        'X-Title': 'Epilog Trend Watcher',
      },
      timeout: 30000,
    });

    const content = response.data.choices[0].message.content;
    const parsed = JSON.parse(content);
    const model = response.data.model || 'google/gemini-2.0-flash-001';

    logger.log(MOD, `Analyzed trend: ${trend.title}`, { model });

    return {
      analysis_type: 'general',
      summary: parsed.summary || '',
      key_insights: parsed.key_insights || [],
      brand_relevance_notes: parsed.brand_relevance_notes || '',
      recommended_action: parsed.recommended_action || '',
      confidence: parsed.confidence || 0,
      relevance_score: parsed.relevance_score || 0,
      virality_score: parsed.virality_score || 0,
      brand_safety_score: parsed.brand_safety_score || 100,
      replication_signal_score: parsed.replication_signal_score || 0,
      why_trending: parsed.why_trending || '',
      trash_check: parsed.trash_check || { passed: true, reasons: [] },
      model_version: model,
    };
  } catch (err) {
    if (err.response) {
      logger.error(MOD, `OpenRouter API error (${err.response.status}): ${trend.title}`, err.response.data);
    } else {
      logger.error(MOD, `Failed to analyze trend: ${trend.title}`, err);
    }
    return null;
  }
}

/**
 * Builds the analysis prompt for a given trend.
 * @param {object} trend
 * @returns {string}
 */
function buildAnalysisPrompt(trend) {
  return `Analyze this TikTok trend for Indonesian brand marketing potential.

TREND DATA:
- Title: ${trend.title}
- Author: ${trend.author || 'unknown'}
- Views: ${(trend.views || 0).toLocaleString()}
- Likes: ${(trend.likes || 0).toLocaleString()}
- Comments: ${(trend.comments || 0).toLocaleString()}
- Shares: ${(trend.shares || 0).toLocaleString()}
- Hashtags: ${(trend.hashtags || []).join(', ')}
- Audio: ${trend.audio_title || 'unknown'}
- Engagement Rate: ${trend.engagement_rate}%
- Velocity Score: ${trend.velocity_score}
- Replication Count: ${trend.replication_count}
- Lifecycle Stage: ${trend.lifecycle_stage}
- Classification: ${trend.classification}
- Urgency Level: ${trend.urgency_level}
- Trend Score: ${trend.trend_score}

Respond with this exact JSON structure:
{
  "summary": "2-3 sentence summary of what this trend is about and why it matters",
  "key_insights": ["insight 1", "insight 2", "insight 3"],
  "brand_relevance_notes": "How this trend could relate to Stella, HIT Kecoa, or NYU brands in Indonesia",
  "recommended_action": "Specific action recommendation (e.g. 'Create duet within 24h' or 'Monitor for 48h')",
  "confidence": 0.0 to 1.0,
  "relevance_score": 0 to 100,
  "virality_score": 0 to 100,
  "brand_safety_score": 0 to 100,
  "replication_signal_score": 0 to 100,
  "why_trending": "Brief explanation of why this is trending in Indonesia",
  "trash_check": {
    "passed": true or false,
    "reasons": ["reason if failed"]
  }
}`;
}

module.exports = { analyzeTrend };
