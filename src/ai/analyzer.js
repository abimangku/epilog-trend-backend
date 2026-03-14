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
const { withRetry } = require('../utils/retry');
const { calibrateConfidence } = require('../scoring/confidence');

const MOD = 'AI_ANALYZER';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.0-flash-001';
const ANALYSIS_VERSION = 'v2.0';

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
 * Calls OpenRouter API with retry on 429 and 5xx errors.
 * @param {object} payload - The request body
 * @param {number} [timeout=30000] - Request timeout in ms
 * @returns {Promise<object>} Parsed response data
 */
async function callOpenRouter(payload, timeout = 30000) {
  return withRetry(async () => {
    const response = await axios.post(OPENROUTER_URL, payload, {
      headers: _headers(),
      timeout,
    });
    return response.data;
  }, {
    retries: 3,
    baseDelay: 2000,
    onRetry: (err, attempt) => {
      const status = err.response?.status || 'unknown';
      logger.warn(MOD, `OpenRouter retry ${attempt}/3 (HTTP ${status}): ${err.message}`);
    },
  });
}

/**
 * Safely parses JSON from LLM response content.
 * Returns null if parsing fails instead of throwing.
 * @param {string} content - Raw LLM response string
 * @param {string} context - Description for logging
 * @returns {object|null}
 */
function safeParseJSON(content, context) {
  try {
    return JSON.parse(content);
  } catch (err) {
    logger.error(MOD, `JSON parse failed for ${context}: ${content.slice(0, 200)}`, err);
    return null;
  }
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
    const shareRatio = v.views > 0 ? ((v.shares / v.views) * 100).toFixed(2) : 'N/A';
    return `[${i}] @${v.author} — "${(v.title || '').slice(0, 100)}" | Views: ${(v.views || 0).toLocaleString()} Likes: ${v.likes} Comments: ${v.comments} Shares: ${v.shares} Bookmarks: ${v.bookmarks || 0} | Engagement Rate: ${v.engagement_rate || 'N/A'}% | Share Ratio: ${shareRatio}% | Hashtags: ${(v.hashtags || []).join(', ')} | Audio: ${v.audio_title || 'unknown'}`;
  }).join('\n');

  const prompt = `You are a TikTok trend filter for Epilog Creative, a digital marketing agency in Jakarta, Indonesia. Your clients are Godrej Indonesia brands (Stella air freshener, HIT Kecoa insecticide, NYU hair color).

Review these ${videos.length} TikTok FYP videos and classify each as SIGNAL or NOISE.

SIGNAL = Worth analyzing deeper. Could be a trend, culturally relevant, has replication potential, interesting for brand marketing. Be generous with emerging signals.
NOISE = Low-value content. Personal vlog with no trend angle, too niche, no brand relevance, duplicate of common format with no twist.

USE THE ENGAGEMENT DATA to inform your decision:
- High share ratio (>1%) = strong virality signal, lean toward SIGNAL
- High bookmark count relative to likes = evergreen/reference content, lean toward SIGNAL
- Very low engagement across all metrics = likely NOISE
- But don't reject low-view content from small creators if the format is interesting — small creators with novel formats are STRONG signals

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
    const data = await callOpenRouter({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a trend filtering AI. Respond only in valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    }, 30000);

    const content = data.choices[0].message.content;
    const parsed = safeParseJSON(content, 'trashGate');

    if (!parsed || !parsed.results || !Array.isArray(parsed.results)) {
      logger.warn(MOD, 'Trash Gate: unexpected response — treating all as signals');
      return videos.map((v) => ({ url: v.url, verdict: 'signal', reason: 'Parse error' }));
    }

    // Map results back to videos by index
    const verdicts = videos.map((v, i) => {
      const match = parsed.results.find((r) => r.index === i);
      return {
        url: v.url,
        verdict: match ? match.verdict.toLowerCase() : 'signal',
        reason: match ? match.reason : 'No verdict returned',
      };
    });

    const signals = verdicts.filter((v) => v.verdict === 'signal').length;
    const noise = verdicts.filter((v) => v.verdict === 'noise').length;
    logger.log(MOD, `Trash Gate: ${signals} signals, ${noise} noise (${videos.length} total)`);

    return verdicts;
  } catch (err) {
    const status = err.response?.status || 'unknown';
    logger.error(MOD, `Trash Gate failed after retries (HTTP ${status}) — treating all as signals`, err);
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

  const prompt = `You are a senior TikTok trend analyst at Epilog Creative, a digital marketing agency in Jakarta. You live and breathe Indonesian TikTok culture. Analyze this trend with deep cultural specificity for our clients: Stella (air freshener), HIT Kecoa (insecticide), NYU (hair color) — all Godrej Indonesia brands targeting the Indonesian mass market.

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

CULTURAL CONTEXT YOU MUST CONSIDER:
- Indonesian cultural calendar: Ramadan/puasa, lebaran/Eid, back-to-school (Juli), 17 Agustus (Independence Day/HUT RI), year-end/Natal/liburan akhir tahun. Map the trend to any upcoming or current cultural moment.
- Regional humor styles: receh humor (cheesy/corny jokes that go viral), relatable konten (slice-of-life "ini gue banget" content), POV format, "gue vs lo" dynamics, drama rumah tangga skits.
- Local slang & TikTok-native language: FYP, masuk FYP, viral, gacor, sultan, bocil, bestie, slay, anak kos, emak-emak, baper, receh, gabut, mager, flexing.
- Indonesian audience segments: Gen Z kota besar, ibu-ibu/emak-emak, anak kos, keluarga muda.

CREATIVE ANGLE REQUIREMENTS:
For each creative angle, describe a SPECIFIC 15-second video concept a brand could film TOMORROW. Include: script outline (what happens beat by beat), audio choice (original sound, trending audio, or voiceover style), and visual style (POV, split-screen, transitions, text overlay style).

=== FEW-SHOT EXAMPLE 1 (high-quality analysis) ===
Input: A POV skit "ketika emak-emak belanja bulanan" with 500K likes, audio "Aku Suka Body Mama" remix
Output excerpt:
{
  "summary": "POV skit format showing exaggerated monthly grocery shopping behavior of Indonesian mothers. The 'emak-emak belanja bulanan' trope resonates across demographics because it taps into universal family humor. 500K likes in 2 days signals strong replication potential.",
  "why_trending": "Emak-emak content consistently performs on Indonesian TikTok because it bridges Gen Z creators (making the content) with millennial/Gen X audiences (sharing it on WhatsApp). The specific audio remix adds comedic timing that elevates the format.",
  "cultural_context": "Belanja bulanan is a deeply Indonesian ritual — the monthly Indomaret/Alfamart run or pasar trip. This content peaks around gajian (payday, tanggal 25-1). Relatable across all socioeconomic levels in Indonesia.",
  "creative_angles": [
    "Stella: 15s POV 'ketika emak-emak nyium bau aneh di dapur sebelum tamu datang'. Beat 1 (0-3s): POV walking into kitchen, sniffing, disgusted face. Beat 2 (4-8s): frantic cleaning montage with receh expressions. Beat 3 (9-13s): sprays Stella, satisfied smile. Beat 4 (14-15s): tamu arrives, 'wangi banget rumahnya tante!' Text overlay throughout. Audio: trending 'Aku Suka Body Mama' remix. Visual: handheld POV, quick cuts, emoji text overlays.",
    "HIT Kecoa: 15s 'gue vs kecoa' split-screen battle. Beat 1 (0-4s): left side shows person chilling, right side shows kecoa creeping. Beat 2 (5-9s): eye contact moment, dramatic zoom. Beat 3 (10-13s): grab HIT, spray action shot. Beat 4 (14-15s): victory pose with HIT can. Audio: epic battle music trending sound. Visual: split-screen, slow-mo on spray moment.",
    "NYU: 15s 'emak-emak glow up challenge'. Beat 1 (0-5s): 'sebelum' look with hair wrapped in towel. Beat 2 (6-10s): applying NYU hair color process (sped up). Beat 3 (11-15s): reveal with hair flip, family reaction shots. Audio: 'Glow Up' trending sound. Visual: before/after transition with flash effect."
  ]
}

=== FEW-SHOT EXAMPLE 2 (high-quality analysis) ===
Input: Ramadan recipe hack "buka puasa modal 15rb" with 200K shares, original audio
Output excerpt:
{
  "summary": "Budget buka puasa recipe content showing creative iftar meals under 15,000 IDR. High share count (200K) indicates strong WhatsApp forwarding behavior typical of Ramadan content. This is a seasonal trend with 2-3 week remaining lifespan.",
  "why_trending": "Ramadan content economy peaks 2 weeks before lebaran. Budget food content specifically resonates because it combines religious observance with economic relatability. The '15rb' price anchor makes it feel accessible and shareable to family WhatsApp groups.",
  "cultural_context": "Buka puasa is the most communal daily moment during Ramadan in Indonesia. Budget recipes tap into gotong royong values and practical household management. Content like this gets forwarded by ibu-ibu to family groups, creating organic reach beyond TikTok.",
  "creative_angles": [
    "Stella: 15s 'persiapan rumah buat buka puasa bareng'. Beat 1 (0-4s): messy living room after seharian puasa. Beat 2 (5-9s): quick clean-up montage. Beat 3 (10-12s): spray Stella di ruang tamu. Beat 4 (13-15s): keluarga datang, 'mashaAllah wangi'. Audio: calming Ramadan nasheed trending. Visual: satisfying cleaning ASMR style, warm lighting.",
    "NYU: 15s 'glow up sebelum silaturahmi lebaran'. Beat 1 (0-3s): 'H-3 lebaran, rambut masih kusam'. Beat 2 (4-10s): NYU application time-lapse. Beat 3 (11-15s): lebaran outfit reveal with fresh hair color, family compliments. Audio: 'Selamat Hari Raya' modern remix. Visual: aesthetic transition, golden hour lighting."
  ]
}

=== END EXAMPLES ===

Now analyze the trend above with the same depth and specificity. Respond with this exact JSON schema:
{
  "summary": "2-3 sentence summary of the trend and why it matters for Indonesian market",
  "why_trending": "Why this is trending in Indonesia right now — reference specific cultural moments, audience behaviors, or platform dynamics",
  "cultural_context": "Deep Indonesian cultural context — reference specific calendar moments, regional behaviors, slang, audience segments",
  "replication_signal": "How replicable is this format? Who is copying it and how? What makes it easy/hard to replicate?",
  "brand_safety": "Any brand safety concerns? Score 0-100 (100=perfectly safe)",
  "creative_angles": ["Specific 15-second video concept with script outline, audio choice, and visual style for each brand"],
  "confidence": 0.0 to 1.0,
  "virality_trajectory": "rising" or "peaking" or "declining",
  "key_insights": ["insight 1", "insight 2", "insight 3"],
  "relevance_score": 0 to 100,
  "virality_score": 0 to 100,
  "brand_safety_score": 0 to 100,
  "replication_signal_score": 0 to 100,
  "trash_check": { "passed": true/false, "reasons": ["reason if failed"] },
  "recommended_action": "One of: 'Act immediately', 'Prepare content', 'Monitor closely', 'Watch passively', 'Skip'"
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
    const data = await callOpenRouter({
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
    }, 45000);

    const content = data.choices[0].message.content;
    const parsed = safeParseJSON(content, 'deepAnalysis');

    if (!parsed) {
      logger.warn(MOD, `Deep analysis: JSON parse failed for ${(video.title || '').slice(0, 50)}`);
      return null;
    }

    const model = data.model || MODEL;

    const rawConf = Math.round((parsed.confidence || 0) * 100);
    const calibratedConf = calibrateConfidence(rawConf, video);

    logger.log(MOD, `Deep analysis complete: ${(video.title || '').slice(0, 50)}`, { model, rawConf, calibratedConf });

    return {
      analysis_type: 'deep_analysis',
      summary: parsed.summary || '',
      key_insights: parsed.key_insights || [],
      brand_relevance_notes: parsed.cultural_context || '',
      recommended_action: parsed.recommended_action || '',
      confidence: calibratedConf,
      raw_confidence: rawConf,
      calibrated_confidence: calibratedConf,
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
      analysis_version: ANALYSIS_VERSION,
    };
  } catch (err) {
    const status = err.response?.status || 'unknown';
    logger.error(MOD, `Deep analysis failed after retries (HTTP ${status}): ${(video.title || '').slice(0, 50)}`, err);
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
  Likes: ${v.likes} | Comments: ${v.comments} | Shares: ${v.shares} | Views: ${v.views || 'N/A'}
  Audio: ${v.audio_title || 'Unknown'}
  Hashtags: ${(v.hashtags || []).join(', ')}
  AI Summary: ${(a.summary || 'No analysis').slice(0, 150)}
  Why Trending: ${(a.why_trending || 'Unknown').slice(0, 150)}
  Cultural Context: ${(a.cultural_context || 'Unknown').slice(0, 150)}
  Virality Trajectory: ${a.virality_trajectory || 'Unknown'}`;
  }).join('\n\n');

  const prompt = `You are a senior cross-trend strategist for Epilog Creative in Jakarta, Indonesia. Your clients are three Godrej Indonesia brands: Stella (air freshener), HIT Kecoa (insecticide), NYU (hair color). You are analyzing the Indonesian TikTok FYP — not global TikTok.

Your job is to think ACROSS trends, not about individual videos. Look at the full batch below and extract strategic intelligence.

SURVIVING TRENDS FROM THIS FYP SCRAPE (${analyzedTrends.length} total):
${trendSummaries}

ANALYSIS FRAMEWORK — answer each of these:

1. FORMAT CONVERGENCE
Are multiple unrelated topics using the same video format? For example, are 3 different niches (cooking, fashion, comedy) all using POV skits, or all using the "get ready with me" structure, or all using split-screen duets? Format convergence signals that a template is becoming universal — brands can hijack the format without being tied to a single niche. Identify any converging formats and list which trend indices share them.

2. AUDIO CLUSTERING
Are different creators using the same audio track in different contexts? When one sound crosses niches, it signals peak virality and a narrow window for brand hijacking before the audio feels stale. Note which audios appear more than once and what it means for brand content timing. Even if no audio repeats in this batch, flag any audio that feels primed for crossover based on its usage context.

3. TIMING PATTERNS
Are certain content types clustering around cultural or calendar moments? In Indonesia this includes Ramadan, Lebaran/Idul Fitri, payday cycles (tanggal gajian), back-to-school (masuk sekolah), year-end/Natalan, 17 Agustus, or even daily patterns like sahur/buka puasa content. Flag any timing signals and what they mean for the next 1-2 weeks of content planning.

4. CONTRARIAN TAKES
What trend does everyone think is big but the data actually says is declining or overhyped? Look at engagement velocity, share-to-like ratios, and virality trajectories. If a trend has high likes but low shares and a "declining" trajectory, it may be past peak. Call out overhyped trends honestly — this is the most valuable signal for clients who want to avoid wasting budget on dying formats. Also flag any quiet trend that the data suggests is undervalued.

5. INDONESIAN CREATOR CULTURE CONTEXT
Frame everything through the lens of Indonesian TikTok: FYP ID algorithm behavior, konten kreator culture, brand hijacking patterns unique to Indonesian creators (e.g., organic product placement in daily vlogs, "jujur review" formats, warung/kos-kosan settings). What does this batch tell us about where Indonesian TikTok culture is heading?

Respond with this JSON (no extra keys):
{
  "meta_trends": [
    { "name": "Pattern name (e.g., 'POV format convergence')", "description": "What connects these trends — reference format convergence, audio clustering, or timing patterns where relevant", "trend_indices": [1, 3, 5] }
  ],
  "emerging_patterns": ["Pattern 1 emerging across TikTok ID — be specific about format, audio, or cultural signal", "Pattern 2 — include contrarian or timing insight"],
  "cultural_pulse": "A 2-3 sentence summary of what Indonesian TikTok culture feels like RIGHT NOW based on this batch. Reference specific creator behaviors, formats, or cultural moments. Do not be generic.",
  "brand_priorities": {
    "Stella": "Specific action for Stella this cycle — reference which meta_trend or format to hijack, which audio to use, and timing. Include a contrarian warning if relevant.",
    "HIT Kecoa": "Specific action for HIT Kecoa this cycle — same specificity as above.",
    "NYU": "Specific action for NYU this cycle — same specificity as above."
  },
  "taste_check": "Honest assessment: are these trends genuinely worth pursuing or are we chasing noise? Flag any overhyped trends by index. Flag any undervalued trends. Rate overall signal quality of this batch."
}`;

  try {
    const data = await callOpenRouter({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a cross-trend synthesis AI for the Indonesian TikTok market. Think across trends, not about individual videos. Identify format convergence, audio clustering, timing patterns, and contrarian signals. Be specific and actionable. Always respond in valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    }, 45000);

    const content = data.choices[0].message.content;
    const parsed = safeParseJSON(content, 'crossTrendSynthesis');

    if (!parsed) {
      logger.warn(MOD, 'Cross-trend synthesis: JSON parse failed');
      return null;
    }

    const model = data.model || MODEL;

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
      confidence: 80,
      model_version: model,
    };
  } catch (err) {
    const status = err.response?.status || 'unknown';
    logger.error(MOD, `Cross-trend synthesis failed after retries (HTTP ${status})`, err);
    return null;
  }
}

module.exports = { trashGate, deepAnalysis, crossTrendSynthesis };
