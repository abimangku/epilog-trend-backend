# Phase 4: AI Quality & UX Polish — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve AI output quality (prompts, confidence calibration, brand fit depth) and polish the frontend UX (loading states, detail panel, onboarding).

**Architecture:** Backend prompt rewrites + new scoring module + DB migrations for new columns. Frontend gets fade-in animations, collapsible detail sections, engagement sparkline, copy-to-clipboard, and first-launch onboarding.

**Tech Stack:** Node.js (CommonJS), OpenRouter/Gemini Flash, Supabase, React/TypeScript, recharts, framer-motion, Tailwind CSS

---

## Chunk 1: Backend AI Quality (Tasks 1-4)

### Task 1: DB migrations for Phase 4 columns

Add new columns to `trend_analysis` and `client_brand_fit` tables via Supabase MCP.

**Migrations:**
- `trend_analysis`: add `analysis_version` (text nullable), `raw_confidence` (int nullable), `calibrated_confidence` (int nullable)
- `client_brand_fit`: add `risk_notes` (text nullable), `timing` (text nullable)

Note: `fit_reasoning` already exists as text in `client_brand_fit`. The spec says jsonb but we keep it as text since the existing column works and the frontend already reads it.

**Steps:**
- [ ] Run SQL via Supabase MCP to add `analysis_version` column to `trend_analysis`
- [ ] Run SQL via Supabase MCP to add `raw_confidence` and `calibrated_confidence` columns to `trend_analysis`
- [ ] Run SQL via Supabase MCP to add `risk_notes` and `timing` columns to `client_brand_fit`
- [ ] Update `frontend/src/types/index.ts` — add new fields to `TrendAnalysis` and `ClientBrandFit` interfaces

**Files:**
- Modify: `frontend/src/types/index.ts`

---

### Task 2: Rewrite Deep Analysis prompt + analysis_version

Rewrite the `deepAnalysis()` prompt in `src/ai/analyzer.js` for Indonesian cultural specificity, concrete creative angles, and few-shot examples. Add `analysis_version` field tracking.

**Files:**
- Modify: `src/ai/analyzer.js` — rewrite prompt in `deepAnalysis()`, add `ANALYSIS_VERSION` constant (e.g. `'v2.0'`), include in return object
- Modify: `src/database/supabase.js` — pass `analysis_version` in `upsertTrendAnalysis()`

**Prompt requirements:**
- Reference Ramadan cycles, lebaran, regional humor styles, local slang
- Force concrete creative angles: "Describe a specific 15-second video concept a brand could film tomorrow"
- Add 2 few-shot example analyses showing expected depth
- Keep same JSON response schema but expect richer content
- Set `analysis_version: ANALYSIS_VERSION` in return object

**Steps:**
- [ ] Add `ANALYSIS_VERSION = 'v2.0'` constant at top of `src/ai/analyzer.js`
- [ ] Rewrite the prompt string in `deepAnalysis()` with Indonesian cultural specificity, concrete angles, and 2 few-shot examples
- [ ] Add `analysis_version: ANALYSIS_VERSION` to the return object in `deepAnalysis()` (line ~267)
- [ ] In `src/database/supabase.js` `upsertTrendAnalysis()`, add `analysis_version: analysis.analysis_version || null` to the `fields` object
- [ ] Commit

---

### Task 3: Rewrite Cross-Trend Synthesis prompt

Rewrite the `crossTrendSynthesis()` prompt to identify format convergence, audio clustering, timing patterns, and contrarian takes.

**Files:**
- Modify: `src/ai/analyzer.js` — rewrite prompt in `crossTrendSynthesis()`

**Prompt requirements:**
- "Are multiple unrelated topics using the same video format?"
- "Are different creators using the same audio in different contexts?"
- "What trend does everyone think is big but the data says is declining?"
- Force structured meta-analysis, not just individual summaries

**Steps:**
- [ ] Rewrite the prompt string in `crossTrendSynthesis()` with format convergence, audio clustering, timing patterns, contrarian takes
- [ ] Keep same JSON response schema (`meta_trends`, `emerging_patterns`, `cultural_pulse`, `brand_priorities`, `taste_check`)
- [ ] Commit

---

### Task 4: Confidence score calibration

Create a pure-function calibration module that post-processes LLM confidence using engagement metrics, data freshness, and replication signals. Wire it into the pipeline.

**Files:**
- Create: `src/scoring/confidence.js` — `calibrateConfidence(rawConfidence, trend)` pure function
- Create: `tests/confidence.test.js` — unit tests
- Modify: `src/ai/analyzer.js` — import and call calibration after deep analysis
- Modify: `src/database/supabase.js` — write `raw_confidence` and `calibrated_confidence` fields

**Calibration rules (pure function):**
- Input: `rawConfidence` (0-100 from LLM), `trend` object with `engagement_rate`, `replication_count`, `velocity_score`, `lifecycle_stage`
- High confidence + low engagement (engagement_rate < 2) → downgrade by 15
- Trend seen only once (replication_count === 0) → cap at 50
- High replication (replication_count >= 3) → boost by 10
- Declining lifecycle → downgrade by 10
- Clamp result to 0-100

**Steps:**
- [ ] Create `src/scoring/confidence.js` with `calibrateConfidence(rawConfidence, trend)` function
- [ ] Create `tests/confidence.test.js` with tests for each calibration rule
- [ ] Run tests to verify
- [ ] In `src/ai/analyzer.js` `deepAnalysis()`: import `calibrateConfidence`, call it on `parsed.confidence * 100`, return both `raw_confidence` and `calibrated_confidence`
- [ ] In `src/database/supabase.js` `upsertTrendAnalysis()`: add `raw_confidence` and `calibrated_confidence` to `fields`
- [ ] Commit

---

### Task 5: Brand Fit prompt expansion + new fields

Expand the brand fit prompt in `src/ai/brand-fit.js` to require risk assessment, timing recommendation, and structured reasoning. Write new fields to DB.

**Files:**
- Modify: `src/ai/brand-fit.js` — expand prompt, parse `risk_notes` and `timing` from LLM response
- Modify: `src/database/supabase.js` — no change needed (upsertBrandFits already passes through all fields)

**Prompt additions:**
- Require `risk_notes`: "What could go wrong if this brand jumps on this trend?"
- Require `timing`: one of `"act_now"`, `"this_week"`, `"watch"`
- Require 3 specific reasons for the score in `fit_reasoning`

**Steps:**
- [ ] Expand the JSON response schema in `buildBrandFitPrompt()` to include `risk_notes` and `timing`
- [ ] In `scoreBrandFit()` result mapping, add `risk_notes: b.risk_notes || ''` and `timing: b.timing || 'watch'`
- [ ] Commit

---

## Chunk 2: Frontend UX Polish (Tasks 6-9)

### Task 6: Frontend types + fade-in animation

Update frontend types for new DB columns and add fade-in CSS animation.

**Files:**
- Modify: `frontend/src/types/index.ts` — add `analysis_version`, `raw_confidence`, `calibrated_confidence` to TrendAnalysis; add `risk_notes`, `timing` to ClientBrandFit
- Modify: `frontend/src/index.css` — add `@keyframes fadeIn` and `.fade-in` utility class

**Steps:**
- [ ] Add fields to TrendAnalysis interface: `analysis_version: string | null`, `raw_confidence: number | null`, `calibrated_confidence: number | null`
- [ ] Add fields to ClientBrandFit interface: `risk_notes: string | null`, `timing: string | null`
- [ ] Add fade-in keyframes and utility class to `index.css`
- [ ] Commit

---

### Task 7: Detail Panel — collapsible sections + engagement sparkline + copy brief

Restructure the detail panel into collapsible sections with visual hierarchy. Add engagement sparkline and "Copy Brief" button.

**Files:**
- Modify: `frontend/src/components/detail/DetailPanel.tsx` — restructure into collapsible sections, add key metrics at top, add sparkline, add copy brief
- Modify: `frontend/src/components/detail/BrandFitSection.tsx` — show `risk_notes`, `timing` badge
- Create: `frontend/src/components/detail/EngagementSparkline.tsx` — mini sparkline using recharts
- Create: `frontend/src/components/detail/CopyBrief.tsx` — copy-to-clipboard button

**Steps:**
- [ ] Create `EngagementSparkline.tsx` — uses `useSnapshots` hook, renders a `<ResponsiveContainer>` with `<AreaChart>` from recharts showing views over time
- [ ] Create `CopyBrief.tsx` — button that formats brand fit data into a text brief and copies to clipboard
- [ ] Modify `BrandFitSection.tsx` — show `timing` as a colored badge, show `risk_notes` below entry angle
- [ ] Modify `DetailPanel.tsx`:
  - Add collapsible sections (Overview, Analysis, Brand Fit, Engagement) using `useState` toggles
  - Show key metrics (trend_score, lifecycle, confidence) as large numbers at top
  - Add `<EngagementSparkline>` in Engagement section
  - Add `<CopyBrief>` button in Brand Fit section
  - Wrap content cards with `fade-in` class
- [ ] Commit

---

### Task 8: Loading & transition polish

Add skeleton screens matched to content layout, fade-in on data load, and optimistic bookmark toggle.

**Files:**
- Modify: `frontend/src/components/shared/Skeleton.tsx` — add `DetailSkeleton`, `BrandFitSkeleton` variants
- Modify: `frontend/src/hooks/use-collections.ts` — add optimistic update to `useSaveTrend` and `useUnsaveTrend`
- Modify: `frontend/src/components/detail/DetailPanel.tsx` — use `DetailSkeleton` instead of "Loading..." text

**Steps:**
- [ ] Add `DetailSkeleton` component to `Skeleton.tsx` — mimics detail panel layout
- [ ] Add `BrandFitSkeleton` component to `Skeleton.tsx`
- [ ] Add optimistic updates to `useSaveTrend`: set `onMutate` to optimistically add item, `onError` to roll back
- [ ] Add optimistic updates to `useUnsaveTrend`: same pattern
- [ ] Replace "Loading..." text in DetailPanel with `<DetailSkeleton />`
- [ ] Commit

---

### Task 9: Onboarding empty state

Add first-launch detection and onboarding UI when no pipeline runs exist.

**Files:**
- Create: `frontend/src/components/shared/Onboarding.tsx` — first-launch UI
- Modify: `frontend/src/pages/Pulse.tsx` — show onboarding when no pipeline_runs exist

**Steps:**
- [ ] Create `Onboarding.tsx` with explanation text and "Run First Scan" button
- [ ] In `Pulse.tsx`, import `useLatestRun` from `use-pipeline-status` hook
- [ ] If `useLatestRun` returns null data (no runs), show `<Onboarding />` instead of "No trends yet" message
- [ ] The "Run First Scan" button is informational only (tells user scans run automatically based on schedule) — we don't expose the `/trigger/scrape` auth secret in the frontend
- [ ] Commit

---

### Task 10: Run all tests + build

Final verification.

**Steps:**
- [ ] Run `npx jest --verbose` — all tests pass
- [ ] Run `cd frontend && npx tsc --noEmit` — no type errors
- [ ] Verify all changes committed
