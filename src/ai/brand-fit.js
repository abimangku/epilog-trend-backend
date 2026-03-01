/**
 * AI Brand Fit Scorer — calls OpenRouter (Gemini Flash) to score trend-brand
 * fit for each Godrej Indonesia brand. Enriched with Phase 2 deep analysis
 * context and optional multimodal screenshot.
 *
 * @module ai/brand-fit
 */

const axios = require('axios');
const fs = require('fs');
const logger = require('../logger');

const MOD = 'AI_BRAND_FIT';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.0-flash-001';

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
 * Standard headers for OpenRouter API calls.
 * @returns {object}
 */
function _headers() {
  return {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://epilog-trend-watcher.com',
    'X-Title': 'Epilog Trend Watcher',
  };
}

/**
 * Scores a trend against all three brands using an LLM.
 * Enriched with Phase 2 deep analysis context and optional screenshot.
 * Returns an array of brand fit objects ready for DB insertion.
 *
 * @param {object} trend - Enriched trend object from the pipeline
 * @param {string} trendId - UUID of the trend in the trends table
 * @param {object|null} analysis - Phase 2 deep analysis object (or null)
 * @param {string|null} screenshotPath - Absolute path to screenshot PNG (or null)
 * @returns {Promise<object[]>} Array of brand fit objects (one per brand)
 */
async function scoreBrandFit(trend, trendId, analysis, screenshotPath) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn(MOD, 'OPENROUTER_API_KEY not set — skipping brand fit scoring');
    return [];
  }

  const prompt = buildBrandFitPrompt(trend, analysis);

  // Build message content — multimodal if screenshot available
  const userContent = [];
  userContent.push({ type: 'text', text: prompt });

  if (screenshotPath) {
    try {
      const imgBuffer = await fs.promises.readFile(screenshotPath);
      const base64 = imgBuffer.toString('base64');
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${base64}` },
      });
    } catch (imgErr) {
      logger.warn(MOD, `Could not read screenshot: ${screenshotPath}`, imgErr);
    }
  }

  try {
    const response = await axios.post(OPENROUTER_URL, {
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a brand strategist for Epilog Creative in Jakarta, Indonesia. Score TikTok trends for brand fit against three Godrej Indonesia brands. Be specific about content angles and realistic about risks. Always respond in valid JSON.',
        },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }, {
      headers: _headers(),
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

    logger.log(MOD, `Brand fit scored: ${(trend.title || '').slice(0, 50)}`, {
      scores: results.map((r) => `${r.brand_name}:${r.fit_score}`).join(', '),
    });

    return results;
  } catch (err) {
    if (err.response) {
      logger.error(MOD, `OpenRouter API error (${err.response.status}): ${(trend.title || '').slice(0, 50)}`, err.response.data);
    } else {
      logger.error(MOD, `Failed to score brand fit: ${(trend.title || '').slice(0, 50)}`, err);
    }
    return [];
  }
}

/**
 * Builds the brand fit scoring prompt, enriched with Phase 2 analysis context.
 * @param {object} trend
 * @param {object|null} analysis - Phase 2 deep analysis (or null)
 * @returns {string}
 */
function buildBrandFitPrompt(trend, analysis) {
  const brandDescriptions = BRANDS.map(
    (b) => `- ${b.brand_name} (${b.brand_category}): ${b.description}`
  ).join('\n');

  let analysisContext = '';
  if (analysis) {
    analysisContext = `
AI DEEP ANALYSIS (from Phase 2):
- Summary: ${analysis.summary || 'N/A'}
- Why Trending: ${analysis.why_trending || 'N/A'}
- Cultural Context: ${analysis.cultural_context || 'N/A'}
- Creative Angles Identified: ${(analysis.creative_angles || []).join('; ')}
- Virality Trajectory: ${analysis.virality_trajectory || 'unknown'}
- Replication Signal: ${analysis.replication_signal_score || 'N/A'}/100
- Brand Safety: ${analysis.brand_safety_score || 'N/A'}/100
- Key Insights: ${(analysis.key_insights || []).join('; ')}
`;
  }

  return `Score this TikTok trend for brand fit against these 3 Indonesian brands.

TREND DATA:
- Title: "${trend.title || ''}"
- Author: @${trend.author || 'unknown'}
- Likes: ${(trend.likes || 0).toLocaleString()}
- Comments: ${(trend.comments || 0).toLocaleString()}
- Shares: ${(trend.shares || 0).toLocaleString()}
- Bookmarks: ${(trend.bookmarks || 0).toLocaleString()}
- Hashtags: ${(trend.hashtags || []).join(', ')}
- Audio: ${trend.audio_title || 'unknown'}
- Engagement Rate: ${trend.engagement_rate || 'N/A'}
- Lifecycle Stage: ${trend.lifecycle_stage || 'unknown'}
- Classification: ${trend.classification || 'unknown'}
- Urgency: ${trend.urgency_level || 'unknown'}
${analysisContext}
${analysis ? 'A screenshot of the video is also attached for visual context.' : ''}

BRANDS:
${brandDescriptions}

Respond with this exact JSON structure:
{
  "brands": [
    {
      "brand_name": "Stella",
      "brand_category": "air freshener / home fragrance",
      "fit_score": 0 to 100,
      "fit_reasoning": "Why this trend fits or doesn't fit Stella — reference the AI analysis and visual context if available",
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
