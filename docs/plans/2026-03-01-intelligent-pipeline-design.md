# Intelligent Pipeline Design

**Date:** 2026-03-01
**Status:** Approved
**Author:** Claude Code + Abi

## Problem

The current system scrapes TikTok /explore, extracts basic metadata, runs a single-pass LLM analysis, and pushes to Supabase. It lacks strategic intelligence, visual context, cross-trend pattern recognition, and the CLAUDE.md rules don't reflect reality or connect frontend and backend.

## Decisions

| Decision | Choice |
|----------|--------|
| AI depth | Deep multi-pass (trash gate, deep analysis, cross-trend synthesis) |
| Scrape scope | FYP only (algorithmic focus, like a real user) |
| AI ownership | Backend owns ALL AI writes (no Edge Functions for AI) |
| Repo sync | Shared contract in both CLAUDE.md files |
| Visual context | Screenshot capture per video during FYP scroll |
| Architecture | Option A: The Intelligent Pipeline |

## Architecture

```
FYP Scroll + Screenshot → Scoring Engine → Trash Gate (batch LLM)
    → Deep Analysis (per-trend, multimodal LLM)
    → Cross-Trend Synthesis (batch LLM)
    → Brand Fit (per-brand, per-trend LLM)
    → Supabase → Frontend (Realtime)
```

### Data Flow

1. **FYP Scraper** scrolls For You Page. Captures 30-50 videos per session. Takes screenshot of each video. Extracts full engagement metrics inline (FYP shows views, likes, comments, shares directly).

2. **Scoring Engine** runs pure-function scoring on all videos: engagement rate, velocity (from snapshots), replication count, format detection, cultural signals, lifecycle stage, urgency level.

3. **Phase 1 - Trash Gate** (one batch LLM call): All videos sent as a batch. LLM classifies each as SIGNAL or NOISE. Aggressive filtering — only 30-40% survive. Saves tokens on low-value content.

4. **Phase 2 - Deep Analysis** (one LLM call per surviving trend, multimodal): Sends video metadata + screenshot to LLM. Returns: why trending, cultural context, replication signal, brand safety, creative angles, confidence, virality trajectory.

5. **Phase 3 - Cross-Trend Synthesis** (one batch LLM call on all surviving trends): Identifies meta-trends, emerging patterns, cultural pulse, brand priorities, taste check. This is where strategic intelligence lives.

6. **Brand Fit Scoring** (per-brand, per-trend): Enhanced with screenshot context and Phase 2 analysis as input. Generates creative brief for each brand x trend combination.

7. **Database Write**: Backend upserts to trends, engagement_snapshots, trend_analysis, client_brand_fit.

8. **Frontend**: Receives updates via Supabase Realtime. Displays in CommandCenter, TrendDeepDive, ClientBriefs.

## FYP Scraper Design

- Navigate to tiktok.com (FYP is default for logged-out users with id-ID locale)
- Scroll slowly, pausing 3-5 seconds per video (human-like)
- For each visible video: extract URL, author, title, hashtags, audio, views, likes, comments, shares
- Take screenshot of each video (save to screenshots/ directory, named by video hash)
- Continue until maxVideos reached or timeout (90 seconds)
- Session management: cookie persistence, locale id-ID, timezone Asia/Jakarta

### FYP vs Explore

FYP is the default view for TikTok. Videos show full engagement metrics inline (unlike Explore cards which only show likes). This eliminates the need for Phase 2 page visits, making scraping faster and more reliable.

## 3-Phase AI Pipeline

### Phase 1: Trash Gate

- **Input**: All scraped videos (metadata only, no screenshots)
- **LLM**: One batch call to Gemini Flash via OpenRouter
- **Output**: Array of {url, verdict: 'signal'|'noise', reason}
- **Goal**: Kill 60-70% of content immediately
- **Cost**: ~$0.005 per run

### Phase 2: Deep Analysis

- **Input**: Each surviving trend (metadata + screenshot)
- **LLM**: One multimodal call per trend (Gemini Flash)
- **Output**: Structured JSON with: summary, why_trending, cultural_context, replication_signal, brand_safety, creative_angles, confidence, virality_trajectory, key_insights, trash_check
- **Writes to**: `trend_analysis` table with `analysis_type: 'deep_analysis'`
- **Cost**: ~$0.01-0.03 per trend

### Phase 3: Cross-Trend Synthesis

- **Input**: All surviving trends + their Phase 2 analyses
- **LLM**: One batch call (Gemini Flash)
- **Output**: Meta-trends, emerging patterns, cultural pulse, brand priorities, taste check
- **Writes to**: `trend_analysis` table with `analysis_type: 'cross_trend_synthesis'`, `trend_id: null` (it's a batch insight, not per-trend)
- **Cost**: ~$0.01-0.02 per run

### Brand Fit Scoring

- **Input**: Each surviving trend + Phase 2 analysis + screenshot
- **LLM**: One call per brand per trend (3 brands x N trends)
- **Output**: fit_score, fit_reasoning, content_angle, entry_angle, content_ideas, risk_level, urgency_level, brand_entry_confidence, hours_to_act, brief_generated
- **Writes to**: `client_brand_fit` table
- **Cost**: ~$0.01 per brand-trend pair

### Total Cost Per Pipeline Run

Assuming 50 scraped, 15-20 signals:
- Trash Gate: $0.005
- Deep Analysis: 15-20 x $0.02 = $0.30-0.40
- Cross-Trend Synthesis: $0.015
- Brand Fit: 15-20 x 3 x $0.01 = $0.45-0.60
- **Total: ~$0.50-1.00 per run**

At 6 runs/day (peak hours only): ~$3-6/day, ~$90-180/month

## Database Changes

### Table Ownership (Updated)

| Table | Backend Writes | Frontend Reads | Frontend Writes |
|-------|---|---|---|
| `trends` | YES (upsert) | YES | NO |
| `engagement_snapshots` | YES (insert) | YES | NO |
| `trend_analysis` | YES (upsert) | YES | NO |
| `client_brand_fit` | YES (upsert) | YES | NO |
| `team_feedback` | NO | YES | YES |
| `taste_weights` | Future (feedback loop) | YES | NO |

### Schema Additions

- `trend_analysis.analysis_type`: Use 'deep_analysis' for Phase 2, 'cross_trend_synthesis' for Phase 3
- `trend_analysis.trend_id`: Nullable for cross-trend synthesis rows (batch insight, not per-trend)
- Screenshots: Stored locally in `screenshots/` directory, not in Supabase. Transient — used only during AI analysis within a pipeline run.

## CLAUDE.md Updates

### Backend CLAUDE.md

- Fix table ownership (backend owns trend_analysis and client_brand_fit writes)
- Add frontend repo location and sync rules
- Add cross-repo schema contract
- Add AI pipeline architecture documentation
- Add FYP scraper strategy documentation

### Frontend CLAUDE.md

- Add shared schema contract (identical to backend)
- Add backend repo reference
- Add "when backend changes" sync rules
- Add display rules for AI analysis, synthesis, screenshots

### Shared Contract (in both CLAUDE.md files)

```
Backend WRITES to: trends, engagement_snapshots, trend_analysis, client_brand_fit
Frontend READS from: all 6 tables
Frontend WRITES to: team_feedback only

When the backend adds/changes a column:
1. Update backend CLAUDE.md
2. Update frontend src/types/index.ts
3. Update frontend src/integrations/supabase/types.ts
4. Push both repos
```

## Files That Change

### Backend (EPILOG-TREND-ANALYZER)

| File | Change |
|------|--------|
| `src/scrapers/tiktok.js` | Rewrite for FYP scrolling + screenshot capture |
| `src/ai/analyzer.js` | Rewrite for 3-phase pipeline (trash gate, deep analysis, synthesis) |
| `src/ai/brand-fit.js` | Enhanced with screenshot + Phase 2 context |
| `src/pipeline.js` | Rewire to orchestrate 3-phase AI |
| `CLAUDE.md` | Updated ownership, cross-repo rules, AI docs |
| `.gitignore` | Add screenshots/ |

### Frontend (EPILOG-TREND-FRONTEND)

| File | Change |
|------|--------|
| `src/types/index.ts` | Add any new fields if needed |
| `CLAUDE.md` | Add shared contract + backend reference |

## Success Criteria

1. FYP scraper extracts 30-50 videos per run with full engagement metrics
2. Screenshots captured for every scraped video
3. Trash Gate filters out 60-70% of content in one batch call
4. Deep Analysis produces strategic, culturally-aware insights per trend
5. Cross-Trend Synthesis identifies meta-trends and brand priorities
6. Brand Fit generates actionable creative briefs
7. Frontend displays all analysis in real-time
8. CLAUDE.md in both repos has matching schema contracts
9. Total pipeline cost stays under $1 per run
