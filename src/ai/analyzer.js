/**
 * 3-Phase AI Trend Analyzer — calls OpenRouter (Gemini Flash) for:
 *   Phase 1: Trash Gate (batch filter)
 *   Phase 2: Deep Analysis (per-trend, multimodal with screenshot)
 *   Phase 3: Cross-Trend Synthesis (batch meta-analysis)
 *
 * @module ai/analyzer
 */

const axios = require('axios');
const fs = require('fs');
const logger = require('../logger');

const MOD = 'AI_ANALYZER';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.0-flash-001';

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

// ---------------------------------------------------------------------------
// Phase 1: Trash Gate
// ---------------------------------------------------------------------------

/**
 * Phase 1 — Trash Gate. Sends ALL scraped videos as one batch to the LLM.
 * Classifies each as SIGNAL (worth deeper analysis) or NOISE (skip).
 * Goal: filter out 60-70% of content in a single cheap call.
 *
 * If the API call fails, ALL videos are treated as signals (fail open).
 *
 * @param {object[]} videos - Array of scraped video objects from the FYP scraper
 * @returns {Promise<object[]>} Array of { url, verdict: 'signal'|'noise', reason }
 */
async function trashGate(videos) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn(MOD, 'OPENROUTER_API_KEY not set — treating all videos as signals');
    return videos.map((v) => ({ url: v.url, verdict: 'signal', reason: 'API key missing' }));
  }

  if (videos.length === 0) return [];

  const videoList = videos.map((v, i) => {
    return `[${i}] @${v.author} — "${(v.title || '').slice(0, 100)}" | Likes: ${v.likes} Comments: ${v.comments} Shares: ${v.shares} | Hashtags: ${(v.hashtags || []).join(', ')} | Audio: ${v.audio_title || 'unknown'}`;
  }).join('\n');

  const prompt = `You are a TikTok trend filter for Epilog Creative, a digital marketing agency in Jakarta, Indonesia. Your clients are Godrej Indonesia brands (Stella air freshener, HIT Kecoa insecticide, NYU hair color).

Review these ${videos.length} TikTok FYP videos and classify each as SIGNAL or NOISE.

SIGNAL = Worth analyzing deeper. Could be a trend, culturally relevant, has replication potential, interesting for brand marketing. Be generous with emerging signals.
NOISE = Low-value content. Personal vlog with no trend angle, too niche, no brand relevance, duplicate of common format with no twist.

Be aggressive — only 30-40% should survive as SIGNAL. We're looking for trends with marketing potential for Indonesian FMCG brands.

VIDEOS:
${videoList}

Respond with this exact JSON:
{
  "results": [
    { "index": 0, "verdict": "signal", "reason": "Brief reason" },
    { "index": 1, "verdict": "noise", "reason": "Brief reason" }
  ]
}

Include ALL ${videos.length} videos in your response.`;

  try {
    const response = await axios.post(OPENROUTER_URL, {
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a trend filtering AI. Respond only in valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    }, {
      headers: _headers(),
      timeout: 30000,
    });

    const content = response.data.choices[0].message.content;
    const parsed = JSON.parse(content);

    if (!parsed.results || !Array.isArray(parsed.results)) {
      logger.warn(MOD, 'Trash Gate: unexpected response — treating all as signals');
      return videos.map((v) => ({ url: v.url, verdict: 'signal', reason: 'Parse error' }));
    }

    // Map results back to videos by index
    const verdicts = videos.map((v, i) => {
      const match = parsed.results.find((r) => r.index === i);
      return {
        url: v.url,
        verdict: match ? match.verdict : 'signal',
        reason: match ? match.reason : 'No verdict returned',
      };
    });

    const signals = verdicts.filter((v) => v.verdict === 'signal').length;
    const noise = verdicts.filter((v) => v.verdict === 'noise').length;
    logger.log(MOD, `Trash Gate: ${signals} signals, ${noise} noise (${videos.length} total)`);

    return verdicts;
  } catch (err) {
    if (err.response) {
      logger.error(MOD, `Trash Gate API error (${err.response.status})`, err.response.data);
    } else {
      logger.error(MOD, 'Trash Gate failed — treating all as signals', err);
    }
    return videos.map((v) => ({ url: v.url, verdict: 'signal', reason: 'API error — fail open' }));
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Deep Analysis
// ---------------------------------------------------------------------------

/**
 * Phase 2 — Deep Analysis. Sends one video's metadata + screenshot (multimodal)
 * to the LLM for in-depth trend analysis.
 *
 * @param {object} video - Scraped video object with scores
 * @param {string|null} screenshotPath - Absolute path to screenshot PNG (or null)
 * @returns {Promise<object|null>} Analysis object for trend_analysis table, or null
 */
async function deepAnalysis(video, screenshotPath) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn(MOD, 'OPENROUTER_API_KEY not set — skipping deep analysis');
    return null;
  }

  const prompt = `Analyze this TikTok trend for Indonesian brand marketing potential.

TREND DATA:
- Author: @${video.author || 'unknown'}
- Caption: "${video.title || ''}"
- Likes: ${(video.likes || 0).toLocaleString()}
- Comments: ${(video.comments || 0).toLocaleString()}
- Shares: ${(video.shares || 0).toLocaleString()}
- Bookmarks: ${(video.bookmarks || 0).toLocaleString()}
- Hashtags: ${(video.hashtags || []).join(', ')}
- Audio: ${video.audio_title || 'unknown'}
- Engagement Rate: ${video.engagement_rate || 'N/A'}
- Velocity Score: ${video.velocity_score || 'N/A'}
- Replication Count: ${video.replication_count || 0}
- Lifecycle Stage: ${video.lifecycle_stage || 'unknown'}
- Classification: ${video.classification || 'unknown'}
- Urgency Level: ${video.urgency_level || 'unknown'}

${screenshotPath ? 'A screenshot of the video is attached for visual context.' : ''}

Our clients: Stella (air freshener), HIT Kecoa (insecticide), NYU (hair color) — all Indonesian market.

Respond with this JSON:
{
  "summary": "2-3 sentence summary of the trend and why it matters",
  "why_trending": "Why this is trending in Indonesia right now",
  "cultural_context": "Indonesian cultural context and relevance",
  "replication_signal": "How replicable is this format? Who's copying it?",
  "brand_safety": "Any brand safety concerns? Score 0-100 (100=perfectly safe)",
  "creative_angles": ["angle 1", "angle 2", "angle 3"],
  "confidence": 0.0 to 1.0,
  "virality_trajectory": "rising" or "peaking" or "declining",
  "key_insights": ["insight 1", "insight 2", "insight 3"],
  "relevance_score": 0 to 100,
  "virality_score": 0 to 100,
  "brand_safety_score": 0 to 100,
  "replication_signal_score": 0 to 100,
  "trash_check": { "passed": true/false, "reasons": ["reason if failed"] }
}`;

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
          content: 'You are a senior TikTok trend analyst for Epilog Creative in Jakarta, Indonesia. Provide deep, culturally-aware analysis. Always respond in valid JSON.',
        },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }, {
      headers: _headers(),
      timeout: 45000,
    });

    const content = response.data.choices[0].message.content;
    const parsed = JSON.parse(content);
    const model = response.data.model || MODEL;

    logger.log(MOD, `Deep analysis complete: ${(video.title || '').slice(0, 50)}`, { model });

    return {
      analysis_type: 'deep_analysis',
      summary: parsed.summary || '',
      key_insights: parsed.key_insights || [],
      brand_relevance_notes: parsed.cultural_context || '',
      recommended_action: '',
      confidence: parsed.confidence || 0,
      relevance_score: parsed.relevance_score || 0,
      virality_score: parsed.virality_score || 0,
      brand_safety_score: parsed.brand_safety_score || 100,
      replication_signal_score: parsed.replication_signal_score || 0,
      why_trending: parsed.why_trending || '',
      creative_angles: parsed.creative_angles || [],
      cultural_context: parsed.cultural_context || '',
      virality_trajectory: parsed.virality_trajectory || 'unknown',
      trash_check: parsed.trash_check || { passed: true, reasons: [] },
      model_version: model,
    };
  } catch (err) {
    if (err.response) {
      logger.error(MOD, `Deep analysis API error (${err.response.status}): ${(video.title || '').slice(0, 50)}`, err.response.data);
    } else {
      logger.error(MOD, `Deep analysis failed: ${(video.title || '').slice(0, 50)}`, err);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Cross-Trend Synthesis
// ---------------------------------------------------------------------------

/**
 * Phase 3 — Cross-Trend Synthesis. Sends ALL surviving trends + their Phase 2
 * analyses as one batch to identify meta-trends and strategic patterns.
 *
 * @param {object[]} analyzedTrends - Array of { video, analysis } pairs
 * @returns {Promise<object|null>} Synthesis object or null
 */
async function crossTrendSynthesis(analyzedTrends) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn(MOD, 'OPENROUTER_API_KEY not set — skipping cross-trend synthesis');
    return null;
  }

  if (analyzedTrends.length === 0) return null;

  const trendSummaries = analyzedTrends.map((t, i) => {
    const v = t.video;
    const a = t.analysis || {};
    return `[${i + 1}] @${v.author} — "${(v.title || '').slice(0, 80)}"
  Likes: ${v.likes} | Comments: ${v.comments} | Shares: ${v.shares}
  Hashtags: ${(v.hashtags || []).join(', ')}
  AI Summary: ${(a.summary || 'No analysis').slice(0, 150)}
  Why Trending: ${(a.why_trending || 'Unknown').slice(0, 150)}
  Cultural Context: ${(a.cultural_context || 'Unknown').slice(0, 150)}`;
  }).join('\n\n');

  const prompt = `You are a senior trend strategist for Epilog Creative in Jakarta, Indonesia. Your clients are Godrej Indonesia brands: Stella (air freshener), HIT Kecoa (insecticide), NYU (hair color).

Look at ALL these surviving TikTok trends together and identify strategic patterns.

SURVIVING TRENDS (${analyzedTrends.length} total):
${trendSummaries}

Respond with this JSON:
{
  "meta_trends": [
    { "name": "Trend pattern name", "description": "What connects these trends", "trend_indices": [1, 3, 5] }
  ],
  "emerging_patterns": ["Pattern 1 emerging across TikTok ID", "Pattern 2"],
  "cultural_pulse": "A 2-3 sentence summary of what Indonesian TikTok culture feels like RIGHT NOW",
  "brand_priorities": {
    "Stella": "What Stella should focus on this cycle and why",
    "HIT Kecoa": "What HIT Kecoa should focus on this cycle and why",
    "NYU": "What NYU should focus on this cycle and why"
  },
  "taste_check": "Are these trends genuinely interesting or are we chasing noise? Honest assessment."
}`;

  try {
    const response = await axios.post(OPENROUTER_URL, {
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a trend strategy AI. Think across trends, not about individual videos. Identify the big picture. Always respond in valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    }, {
      headers: _headers(),
      timeout: 45000,
    });

    const content = response.data.choices[0].message.content;
    const parsed = JSON.parse(content);
    const model = response.data.model || MODEL;

    logger.log(MOD, `Cross-trend synthesis complete (${analyzedTrends.length} trends)`, { model });

    return {
      analysis_type: 'cross_trend_synthesis',
      summary: parsed.cultural_pulse || '',
      key_insights: parsed.emerging_patterns || [],
      brand_relevance_notes: JSON.stringify(parsed.brand_priorities || {}),
      recommended_action: parsed.taste_check || '',
      meta_trends: parsed.meta_trends || [],
      brand_priorities: parsed.brand_priorities || {},
      cultural_pulse: parsed.cultural_pulse || '',
      taste_check: parsed.taste_check || '',
      confidence: 0.8,
      model_version: model,
    };
  } catch (err) {
    if (err.response) {
      logger.error(MOD, `Cross-trend synthesis API error (${err.response.status})`, err.response.data);
    } else {
      logger.error(MOD, 'Cross-trend synthesis failed', err);
    }
    return null;
  }
}

module.exports = { trashGate, deepAnalysis, crossTrendSynthesis };
