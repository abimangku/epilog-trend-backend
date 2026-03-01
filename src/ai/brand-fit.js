/**
 * AI Brand Fit Scorer — calls OpenRouter to score trend-brand fit
 * for each Godrej Indonesia brand. Fills the client_brand_fit table.
 */

const axios = require('axios');
const logger = require('../logger');

const MOD = 'AI_BRAND_FIT';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * The three Godrej Indonesia brands we score every trend against.
 */
const BRANDS = [
  {
    brand_name: 'Stella',
    brand_category: 'air freshener / home fragrance',
    description: 'Stella is a leading Indonesian air freshener and home fragrance brand. Products include room sprays, car fresheners, bathroom fresheners, and aromatherapy diffusers. Target audience: Indonesian homemakers, young couples, and car owners.',
  },
  {
    brand_name: 'HIT Kecoa',
    brand_category: 'insecticide / pest control',
    description: 'HIT Kecoa is an Indonesian insecticide brand specializing in cockroach and pest control. Products include aerosol sprays, chalk, and baits. Target audience: Indonesian households dealing with tropical pests.',
  },
  {
    brand_name: 'NYU',
    brand_category: 'personal care / hair color',
    description: 'NYU is an Indonesian personal care brand known for affordable hair color products. Products include hair dye, hair care, and styling. Target audience: young Indonesian women and men interested in hair color trends.',
  },
];

/**
 * Scores a trend against all three brands using an LLM.
 * Returns an array of brand fit objects ready for DB insertion.
 *
 * @param {object} trend - Enriched trend object from the pipeline
 * @param {string} trendId - UUID of the trend in the trends table
 * @returns {Promise<object[]>} Array of brand fit objects (one per brand)
 */
async function scoreBrandFit(trend, trendId) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn(MOD, 'OPENROUTER_API_KEY not set — skipping brand fit scoring');
    return [];
  }

  const prompt = buildBrandFitPrompt(trend);

  try {
    const response = await axios.post(OPENROUTER_URL, {
      model: 'google/gemini-2.0-flash-001',
      messages: [
        {
          role: 'system',
          content: `You are a brand strategist for Epilog Creative in Jakarta, Indonesia. Score TikTok trends for brand fit against three Godrej Indonesia brands. Be specific about content angles and realistic about risks. Always respond in valid JSON.`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
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

    if (!parsed.brands || !Array.isArray(parsed.brands)) {
      logger.warn(MOD, 'Unexpected response structure — missing brands array');
      return [];
    }

    const results = parsed.brands.map((b) => ({
      trend_id: trendId,
      brand_name: b.brand_name || '',
      client_name: b.brand_name || '',
      brand_category: b.brand_category || '',
      fit_score: b.fit_score || 0,
      fit_reasoning: b.fit_reasoning || '',
      content_angle: b.content_angle || '',
      entry_angle: b.entry_angle || '',
      content_ideas: b.content_ideas || [],
      risk_level: b.risk_level || 'low',
      urgency_level: b.urgency_level || 'watch',
      brand_entry_confidence: b.brand_entry_confidence || 0,
      hours_to_act: b.hours_to_act || 72,
      brief_generated: b.brief_generated || null,
    }));

    logger.log(MOD, `Brand fit scored: ${trend.title}`, {
      scores: results.map((r) => `${r.brand_name}:${r.fit_score}`).join(', '),
    });

    return results;
  } catch (err) {
    if (err.response) {
      logger.error(MOD, `OpenRouter API error (${err.response.status}): ${trend.title}`, err.response.data);
    } else {
      logger.error(MOD, `Failed to score brand fit: ${trend.title}`, err);
    }
    return [];
  }
}

/**
 * Builds the brand fit scoring prompt.
 * @param {object} trend
 * @returns {string}
 */
function buildBrandFitPrompt(trend) {
  const brandDescriptions = BRANDS.map(
    (b) => `- ${b.brand_name} (${b.brand_category}): ${b.description}`
  ).join('\n');

  return `Score this TikTok trend for brand fit against these 3 Indonesian brands.

TREND:
- Title: ${trend.title}
- Author: ${trend.author || 'unknown'}
- Views: ${(trend.views || 0).toLocaleString()}
- Hashtags: ${(trend.hashtags || []).join(', ')}
- Audio: ${trend.audio_title || 'unknown'}
- Engagement Rate: ${trend.engagement_rate}%
- Lifecycle Stage: ${trend.lifecycle_stage}
- Classification: ${trend.classification}
- Urgency: ${trend.urgency_level}
- Trend Score: ${trend.trend_score}

BRANDS:
${brandDescriptions}

Respond with this exact JSON structure:
{
  "brands": [
    {
      "brand_name": "Stella",
      "brand_category": "air freshener / home fragrance",
      "fit_score": 0 to 100,
      "fit_reasoning": "Why this trend fits or doesn't fit Stella",
      "content_angle": "Specific TikTok content angle Stella could use",
      "entry_angle": "How the brand should enter this trend",
      "content_ideas": ["idea 1", "idea 2"],
      "risk_level": "low" or "medium" or "high",
      "urgency_level": "watch" or "consider" or "act_now",
      "brand_entry_confidence": 0 to 100,
      "hours_to_act": number of hours before trend becomes stale,
      "brief_generated": "One-paragraph creative brief for the content team"
    },
    {
      "brand_name": "HIT Kecoa",
      ...same structure...
    },
    {
      "brand_name": "NYU",
      ...same structure...
    }
  ]
}`;
}

module.exports = { scoreBrandFit, BRANDS };
