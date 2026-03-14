# Trend Watcher Frontend Remake — Design Spec

## Overview

Complete frontend rebuild for Epilog Creative's Trend Watcher tool. Replaces the existing Lovable-built React frontend with a new Vite React SPA built from scratch, designed as a **"Smart Magazine"** — an editorial-style creative exploration tool for content strategists and creators.

The existing Lovable frontend remains as fallback. This is a separate codebase (`frontend/`) within the same repo as the backend, served by the same Express process on the Mac Mini.

## Problem Statement

The current frontend is functional but:
- **Not insightful enough** — shows data but doesn't tell stories or explain WHY content is interesting
- **Too generic** — feels like a dashboard, not a creative tool. Doesn't invite exploration
- **Missing features** — no personal bookmarks, no pattern analytics, no format/audio tracking, no cultural calendar
- **Binary classification is too rigid** — "not a trend" doesn't mean "not worth making." Content with high views and fun formats should still surface

## Users

- **Content strategists** — browse daily, find opportunities, evaluate brand fit, write briefs
- **Content creators** — need quick inspiration, specific content angles, reference videos
- Small team (2-5 people), mix of creative and analytical mindsets
- Solo workflow — individuals discover and decide independently
- AI is a suggestion engine, not a decision maker. Team uses their own creative judgment

## Design Philosophy

1. **Creative exploration tool, not urgency dashboard** — browse and discover first, act second
2. **AI suggests, humans decide** — every AI recommendation is transparent and overridable
3. **Content is the interface** — thumbnails, captions, and context ARE the UI. Minimal chrome
4. **Explain WHY, not just WHAT** — every recommendation includes plain-language reasoning
5. **"Not trending" ≠ "not worth making"** — fun, high-view content surfaces even without trend signals

## Information Architecture

### Navigation: Collapsible sidebar (desktop), bottom tabs (mobile)

```
Main
  ├── Today's Pulse      — Editorial home page, cultural snapshot
  ├── Explore            — Full content browser, thumbnail grid
  └── For You            — AI-curated picks by opportunity type

Brands
  ├── Stella             — Per-brand content hub
  ├── HIT Kecoa          — Per-brand content hub
  └── NYU                — Per-brand content hub

Library
  ├── Saved              — Personal bookmarks & collections
  └── Patterns           — Meta-level analytics & charts

System
  └── Settings           — Pipeline status, admin controls
```

### Key Design Decisions
- **Sidebar nav, not top bar** — more room for labels, brand indicators, collapsible
- **Brands as first-class nav items** — not hidden in filter dropdowns
- **"For You" vs "Explore" split** — AI-curated (opinionated) vs user-driven (full control)
- **Urgency is a tag, not the organizing principle** — team decides what's urgent

---

## Pages

### 1. PIN Entry

Simple centered PIN input (4-6 digits). No email, no signup, no password reset. One PIN for the whole team.

- PIN verified against server (`POST /api/auth/pin`)
- Returns JWT session token (7-day expiry, stored in localStorage)
- All subsequent API calls use Bearer token

### 2. Today's Pulse (Home)

The morning briefing. Opens like a magazine cover.

**Sections:**
1. **Cultural Snapshot** — AI-written paragraph summarizing what Indonesian TikTok feels like right now. Written editorially, not clinically. Trending hashtag pills below.
   - Data source: `trend_analysis` where `analysis_type = 'cross_trend_synthesis'`, latest record. `summary` field = cultural pulse.
2. **Top 3 Opportunities** — Card grid with thumbnails, titles, author, views, one-sentence AI reasoning, brand pills (colored by brand).
   - Data source: Top 3 from `client_brand_fit` joined with `trends` and `trend_analysis`, sorted by composite of `fit_score` + `trend_score`.
3. **Trending Audio** — List of top 3 audio tracks with usage count and rising/peaking/stable indicator.
   - Data source: Aggregated from `trends` grouped by `audio_id`, counted per scrape cycle. Lifecycle derived from count trajectory.
4. **Patterns This Week** — 3 meta-trend summaries from cross-trend synthesis.
   - Data source: `trend_analysis` where `analysis_type = 'cross_trend_synthesis'`, `key_insights` array.

**Realtime:** Subscribe to `trends` INSERT and `trend_analysis` INSERT to refresh when new scrape completes.

### 3. Explore

Full browsable feed of ALL scraped content.

**Layout:**
- 4-column thumbnail grid (desktop), 2-column (tablet), 1-column (mobile)
- Grid/List view toggle (list = compact rows with inline metrics)
- Infinite scroll with "load more" fallback

**Card anatomy (grid view):**
- Thumbnail with overlays: view count (bottom-left), lifecycle badge (top-right), save button (top-left)
- Title (2-line clamp), author, brand pills with fit scores, trend score

**Filters:**
- Lifecycle stage: emerging, growing, peaking, declining, all
- Content format: tutorial, POV, ASMR, challenge, duet, mukbang, unboxing, storytime, all
- Brand match: Stella, HIT Kecoa, NYU, no match, all
- Engagement range: slider or preset buckets
- Cultural moment: Ramadan, lebaran, imlek, school season, all
- Date range: preset (today, 7d, 14d, 30d) or custom
- Sort: recent, views, engagement rate, trend score, velocity

**Active filter chips** shown below filter bar with "Clear all" action.

**Click behavior:** Opens slide-over detail panel (right side), grid dims behind it.

**Data source:** `trends` with optional joins to `trend_analysis` and `client_brand_fit`. Filters applied as Supabase query parameters.

### 4. Slide-Over Detail Panel

Opens from the right on any card click across any page. 480px wide on desktop, full-screen on mobile.

**Sections (top to bottom):**
1. **Header** — prev/next arrows (keyboard arrows too), Save button, Open TikTok button, close button
2. **TikTok video embed** — official embed via `tiktok.com/embed.js`, 9:16 ratio
3. **Title + meta** — full title, author, views, likes, shares
4. **Metric tiles** — 4-up grid: trend score, engagement rate, velocity, replication count
5. **"Why this is interesting"** — AI analysis in plain language (`trend_analysis.summary` + `why_trending`)
6. **Key Insights** — bullet list from `trend_analysis.key_insights`
7. **Hashtags** — tag pills from `trends.hashtags`
8. **Brand Opportunities** — per-brand cards showing fit score, entry angle, content ideas. Low-fit brands dimmed (opacity 0.5), not hidden
9. **"Your Take"** — one-click vote (Gold / Good / Wrong timing / Skip) + optional note. Writes to `team_feedback`

**Navigation:** prev/next arrows cycle through the current page's filtered result set. Keyboard left/right arrows supported.

### 5. For You

AI-curated recommendations grouped by creative opportunity type.

**Sections:**
1. **High Potential** — high engagement + growing + strong brand fit. Top composite scores from `client_brand_fit` joined with `trends`.
2. **Fun to Replicate** — high views + entertaining format + easy to adapt, even without strong trend signals. Filtered by: `views > median` AND format detected AND `classification` in ('noise', 'emerging_trend'). Shows "no brand match — format reference only" when no brand fits.
3. **Rising Quietly** — emerging lifecycle + accelerating momentum. Filtered by: `lifecycle_stage = 'emerging'` AND `momentum = 1` (accelerating).
4. **Audio Going Viral** — audio tracks with rising usage across multiple creators. Aggregated from `trends` by `audio_id` with growth rate calculation.

**Card layout:** Horizontal (thumbnail left, context right). Each card has a left-border reasoning block — AI explains WHY in one sentence.

**Filter:** Brand dropdown to show only opportunities relevant to one brand.

**Data:** ~12 curated picks total. Quality over quantity. Re-computed each scrape cycle.

### 6. Brand Pages (×3)

One page per brand (Stella, HIT Kecoa, NYU), identical layout, parameterized route `/brand/:name`.

**Sections:**
1. **Brand header** — brand name, category, dot indicator (brand color), AI-written landscape summary (from cross-trend synthesis `brand_relevance_notes` parsed for this brand), opportunity count, strong-fit count (fit_score > 70)
2. **Best Opportunity** — hero card (large) with full entry angle, 3 content ideas, Save/Copy/TikTok buttons. Top `client_brand_fit` record by `fit_score` for this brand.
3. **More Opportunities** — compact rows (small thumbnail, title, fit score, one-word angle descriptor). Remaining `client_brand_fit` records sorted by `fit_score` descending. Low-fit (< 30) dimmed.

**Click behavior:** Any row opens the slide-over detail panel.

### 7. Saved

Personal bookmarks and collections (mood boards).

**Layout:**
- Tab bar: "All saved" + user-created collection names
- Collection cards: 2×2 thumbnail grid preview, name, item count, last updated
- Recently saved list: compact rows with "Move to..." dropdown

**Features:**
- Create new collection (name only)
- Add any trend to Saved from anywhere (star button on cards, Save button in detail panel)
- Organize into collections (drag or "Move to..." dropdown)
- Items can live in multiple collections
- Remove from collection or delete entirely
- Collections stored per PIN session (since there's one shared PIN, all saves are shared)

**Data:** New tables `saved_items`, `collections`, `collection_items`. See Database Additions.

### 8. Patterns

Meta-level analytics page. Chart-driven.

**Sections:**
1. **Format Distribution** — horizontal bar chart (Recharts). % of scraped content by detected format (tutorial, POV, ASMR, etc.). Growing formats highlighted in green.
   - Data: Aggregated from `trends.hashtags` and `trends.title` using pattern detection logic (same as `src/patterns/formats.js`).
2. **Engagement Over Time** — line chart (Recharts). Average engagement rate by day over selected period.
   - Data: `engagement_snapshots` aggregated by date.
3. **Cultural Calendar** — horizontal timeline bar showing Indonesian cultural moments (Ramadan, Lebaran, Imlek, school season, independence day, year end) with a "now" marker.
   - Data: Hardcoded calendar events + detected cultural signals from `trends`.
4. **Audio Momentum** — cards showing top audio tracks sorted by growth rate (not total usage). Progress bar + percentage change.
   - Data: `trends` grouped by `audio_id`, compared across scrape cycles.

**Time range toggle:** 14 days / 30 days / All time.

### 9. Settings

Replaces current Admin page. Tucked away, operational.

**Sections:**
- Pipeline status: scraper health, last scrape time, total trends, analysis completion %
- Manual triggers: Force re-scan, Force re-analysis
- Recent feedback log: last 20 team votes
- PIN management: Change PIN (requires current PIN)

---

## Visual Design

### Color Palette
- **Background:** `#141414` (page), `#1a1a1a` (panels), `#1c1c1c` (cards), `#222` (thumbnails/inputs)
- **Borders:** `#262626` (cards), `#222` (dividers), `#2a2a2a` (inputs)
- **Text:** `#f5f5f5` (primary), `#e5e5e5` (headings), `#d4d4d4` (body), `#a3a3a3` (secondary), `#737373` (tertiary), `#525252` (muted), `#404040` (disabled)
- **Brand colors (only color pops in the UI):**
  - Stella: `#22c55e` (green)
  - HIT Kecoa: `#ef4444` (red)
  - NYU: `#f59e0b` (amber)
- **Lifecycle badges:**
  - emerging: `#3b82f6` (blue)
  - growing: `#22c55e` (green)
  - peaking: `#f59e0b` (amber)
  - viral: `#ef4444` (red)
  - declining: `#525252` (gray)

### Typography
- **Font:** Geist Sans (UI), system fallback stack
- **Hierarchy:** font-weight and font-size only, not color variety
- **Section labels:** 11px, uppercase, letter-spacing 0.5-1px, `#525252`
- **Body:** 13px, line-height 1.5-1.7
- **Headings:** 15-20px, weight 500-600, letter-spacing -0.3px

### Principles
- Always dark mode. No toggle
- Color only where it means something — brand indicators, lifecycle badges, growth/decline
- No gradients, no glowing borders, no purple
- Content (thumbnails, captions, AI text) IS the interface. Minimal chrome
- Neutral zinc/gray palette. Warm, not cold

---

## Tech Stack

### Frontend
| Package | Version | Purpose |
|---------|---------|---------|
| `vite` | 5.x | Build tool |
| `react` | 18.x | UI framework |
| `react-dom` | 18.x | DOM rendering |
| `typescript` | 5.x | Type safety |
| `react-router-dom` | 6.x | Client-side routing |
| `tailwindcss` | 4.x | Utility-first CSS |
| `@radix-ui/react-dialog` | latest | Accessible dialog primitives |
| `@radix-ui/react-dropdown-menu` | latest | Dropdown menus |
| `@radix-ui/react-tabs` | latest | Tab navigation |
| `@radix-ui/react-tooltip` | latest | Tooltips |
| `@radix-ui/react-slider` | latest | Range slider (engagement filter) |
| `@tanstack/react-query` | 5.x | Server state management, caching |
| `@supabase/supabase-js` | 2.x | Supabase client + realtime |
| `zustand` | 4.x | Client state (UI prefs, filters, auth) |
| `recharts` | 2.x | Charts (Patterns page) |
| `framer-motion` | 11.x | Animations (panel slide, transitions) |
| `lucide-react` | latest | Icons |
| `date-fns` | 3.x | Date formatting |
| `geist` | latest | Font family |

### Not Using (removed from old stack)
- `shadcn/ui` — using Radix primitives directly, styling ourselves
- `next-themes` — always dark
- `react-hook-form` + `zod` — only form is PIN entry
- `sonner` — custom minimal toast

### Backend Additions (Express endpoints)

```
POST /api/auth/pin          — Verify PIN, return JWT
GET  /api/auth/verify       — Validate JWT session
GET  /api/collections       — List collections
POST /api/collections       — Create collection
PUT  /api/collections/:id   — Rename collection
DELETE /api/collections/:id — Delete collection
POST /api/collections/:id/items      — Add trend to collection
DELETE /api/collections/:id/items/:tid — Remove trend from collection
GET  /api/saved             — List all saved trends
POST /api/saved/:trendId    — Save a trend
DELETE /api/saved/:trendId  — Unsave a trend
GET  /api/patterns/formats  — Format distribution aggregation
GET  /api/patterns/audio    — Audio momentum aggregation
```

### Database Additions

```sql
-- Saved items (bookmarked trends)
CREATE TABLE saved_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trend_id UUID NOT NULL REFERENCES trends(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Named collections (mood boards)
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many: collections ↔ saved items
CREATE TABLE collection_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  trend_id UUID NOT NULL REFERENCES trends(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(collection_id, trend_id)
);

-- RLS policies: anon SELECT, INSERT, UPDATE, DELETE on all three tables
```

### Project Structure

```
frontend/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── package.json
├── tsconfig.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── router.tsx
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── api.ts
│   │   └── utils.ts
│   ├── stores/
│   │   ├── ui.ts
│   │   └── auth.ts
│   ├── hooks/
│   │   ├── use-trends.ts
│   │   ├── use-analysis.ts
│   │   ├── use-brand-fit.ts
│   │   ├── use-snapshots.ts
│   │   ├── use-collections.ts
│   │   ├── use-realtime.ts
│   │   └── use-keyboard.ts
│   ├── pages/
│   │   ├── PinEntry.tsx
│   │   ├── Pulse.tsx
│   │   ├── Explore.tsx
│   │   ├── ForYou.tsx
│   │   ├── Brand.tsx
│   │   ├── Saved.tsx
│   │   ├── Patterns.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── AppShell.tsx
│   │   │   └── MobileNav.tsx
│   │   ├── cards/
│   │   │   ├── TrendCard.tsx
│   │   │   ├── OpportunityCard.tsx
│   │   │   ├── RecommendationCard.tsx
│   │   │   └── CompactRow.tsx
│   │   ├── detail/
│   │   │   ├── DetailPanel.tsx
│   │   │   ├── VideoEmbed.tsx
│   │   │   ├── MetricTiles.tsx
│   │   │   ├── BrandFitSection.tsx
│   │   │   └── UserAssessment.tsx
│   │   ├── patterns/
│   │   │   ├── FormatChart.tsx
│   │   │   ├── EngagementChart.tsx
│   │   │   ├── CulturalCalendar.tsx
│   │   │   └── AudioMomentum.tsx
│   │   ├── filters/
│   │   │   ├── FilterBar.tsx
│   │   │   ├── FilterChips.tsx
│   │   │   └── SearchInput.tsx
│   │   └── shared/
│   │       ├── Badge.tsx
│   │       ├── BrandPill.tsx
│   │       ├── Toast.tsx
│   │       └── Skeleton.tsx
│   └── types/
│       └── index.ts
```

### Deployment

- `npm run build` produces `frontend/dist/`
- Express serves `dist/` as static files: `app.use(express.static('frontend/dist'))`
- SPA fallback: all non-API routes serve `index.html`
- Same Mac Mini, same process, same port
- No separate deployment pipeline

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `G` | Go to Today's Pulse |
| `E` | Go to Explore |
| `F` | Go to For You |
| `S` | Go to Saved |
| `P` | Go to Patterns |
| `←` / `→` | Prev/next in detail panel |
| `Esc` | Close detail panel |
| `/` | Focus search (on Explore page) |
| `B` | Bookmark/save current trend (when panel open) |

---

## Mobile Considerations

- Sidebar collapses to bottom tab bar (5 tabs: Pulse, Explore, For You, Brands, Saved)
- Detail panel opens full-screen on mobile (slide up from bottom)
- Grid view: 1 column on mobile, 2 on tablet
- Filter bar: horizontal scroll on mobile
- Swipe left/right for prev/next in detail panel

---

## What This Spec Does NOT Cover

- User accounts or multi-user auth (single PIN for team)
- Export to PDF/CSV (can be added later as Express endpoint)
- Slack integration from frontend (backend already handles Slack notifications)
- Historical trend comparison view (future enhancement)
- Taste weights management UI (future — currently system-managed)
