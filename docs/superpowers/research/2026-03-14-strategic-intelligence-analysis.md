# Epilog Trend Analyzer — Strategic Intelligence Analysis

> Deep research into making the TikTok trend intelligence platform smarter, more culturally aware, and capable of developing "taste."

**Date:** 2026-03-14
**For:** Epilog Creative, Jakarta
**Clients:** Godrej Indonesia — Stella (air freshener), HIT Kecoa (insecticide), NYU (personal care)

---

## Table of Contents

1. [Where to Find Trends: Data Sources](#1-where-to-find-trends-data-sources)
2. [Anti-Detection Strategy](#2-anti-detection-strategy)
3. [The Anatomy of a TikTok Trend](#3-the-anatomy-of-a-tiktok-trend)
4. [Understanding Replicable Content](#4-understanding-replicable-content)
5. [Understanding the Client: Brand Empathy](#5-understanding-the-client-brand-empathy)
6. [Indonesian Cultural Intelligence](#6-indonesian-cultural-intelligence)
7. [Developing "Taste": Quality Filtering](#7-developing-taste-quality-filtering)
8. [Current Platform Gaps](#8-current-platform-gaps)
9. [Strategic Recommendations](#9-strategic-recommendations-prioritized)

---

## 1. Where to Find Trends: Data Sources

### Current: FYP Scraping (What We Have)

The For You Page is the algorithmic pulse of TikTok. It shows what the algorithm is actively pushing, with full engagement metrics inline (views, likes, comments, shares, saves). This is our primary data source and should remain so.

**What FYP gives us:**
- Full video metadata from JS state (`$PREFETCH_CACHE`, `__UNIVERSAL_DATA_FOR_REHYDRATION__`)
- Real view counts via `stats.playCount`
- Engagement metrics: likes, comments, shares, saves (bookmarks)
- Audio/music metadata
- Screenshots for multimodal AI analysis
- ~6 initial items + ~3 SSR items + ~12 per scroll batch via API interception

**FYP limitations:**
- Only shows what TikTok decides to show for our session/locale profile
- No macro-level trend aggregation
- Consecutive scrapes within ~2 minutes cause zero-article responses
- Logged-out FYP returns generic popular content, not personalized

### New Source #1: TikTok Creative Center (HIGH PRIORITY)

**The single most valuable addition we can make.** TikTok's own analytics tool at `ads.tiktok.com/business/creativecenter` provides structured, country-filterable trending data — publicly accessible, no API key required.

| Tab | Data Available | Update Frequency |
|-----|---------------|-----------------|
| Trending Hashtags | Name, view count, trajectory (rising/falling), "new to top 100" badge | Daily |
| Trending Songs | Name, artist, usage count, business-approved flag | Daily |
| Trending Creators | Username, follower count, engagement | Daily |
| Trending Videos | Top-performing videos with view counts | Daily |
| Keyword Insights | Search volume data, trending keywords | Daily |

**Filterable by country (Indonesia) and time period (7 or 30 days).**

A community-maintained reverse-engineered API exists (`tiktok-discover-api.vercel.app`) with endpoints for trending videos, songs, hashtags, and top ads — all filterable by country. Apify also has a Creative Center scraper actor.

**Implementation approach:** Add a second scraper module (`src/scrapers/creative-center.js`) that fetches trending data from Creative Center daily. This gives us macro-level trend context that FYP micro-level data alone cannot provide.

### New Source #2: Sound/Audio Pages (HIGH PRIORITY)

Individual sound pages (`tiktok.com/music/{title}-{id}`) expose:
- Total number of videos using the sound
- Daily creation rate (new videos per day)
- Whether the sound is officially "trending"
- Top videos using the sound

**Why this matters:** Sound adoption velocity is one of the strongest early trend signals. When a sound suddenly spikes in usage, it precedes the visual trend by 12-48 hours. In Asia, viral sounds now peak within 3.4 days (down from 5.1 days in 2024). This is a leading indicator.

Third-party tracking: TokChart (tokchart.com) tracks trending music within past 24 hours by location.

**Implementation approach:** After FYP scrape, extract unique audio IDs and fetch their sound pages to get usage counts. Track usage count over time to detect velocity spikes.

### New Source #3: Search Autocomplete (MEDIUM PRIORITY)

TikTok's search autocomplete suggestions reflect what real users are actively searching for. This is a leading indicator — it shows what users want before content fully surfaces on FYP.

**Implementation approach:** Seed the search bar with category-relevant terms (e.g., "stella", "parfum", "nyamuk", "rambut") and capture autocomplete suggestions. Compare suggestions across scrape sessions to detect emerging search trends.

### New Source #4: Hashtag Pages (MEDIUM PRIORITY)

Individual hashtag pages (`tiktok.com/tag/{hashtag}`) show aggregate view counts across all videos using that hashtag. Cross-referencing FYP hashtags with their hashtag page data gives us velocity — is this hashtag's total view count accelerating?

### Data Source Priority Matrix

| Source | Trend Signal Strength | Implementation Effort | Priority |
|--------|----------------------|----------------------|----------|
| FYP (current) | HIGH — algorithmic pulse | Already built | Maintain |
| Creative Center | VERY HIGH — structured, filterable | Medium (new scraper) | P0 |
| Sound pages | VERY HIGH — leading indicator | Low (extend existing) | P0 |
| Search autocomplete | HIGH — leading indicator | Low | P1 |
| Hashtag pages | MEDIUM-HIGH — velocity data | Low | P1 |
| Creator profiles | MEDIUM — authority context | Medium | P2 |
| Explore page | MEDIUM — editorial trends | Medium | P2 |

---

## 2. Anti-Detection Strategy

### How TikTok Detects Bots (2026)

TikTok employs a sophisticated, multi-layered detection system:

**Layer 1: Browser Fingerprinting**
- TLS fingerprint during HTTPS handshake (JA3/JA4 fingerprint)
- `navigator.webdriver` detection (Playwright sets this to `true` by default)
- Canvas fingerprinting, WebGL signatures, audio context fingerprinting
- CDP (Chrome DevTools Protocol) detection — the biggest concern in 2025-2026

**Layer 2: JavaScript VM Security**
- TikTok runs a custom JavaScript Virtual Machine for security token generation
- `msToken`, `X-Bogus`, and `_signature` parameters are generated by this VM
- These change frequently and are the main barrier to unofficial API access

**Layer 3: Behavioral Analysis**
- Scroll timing patterns (too uniform = bot)
- Mouse movement patterns (too smooth = bot)
- Action timing (too precise = bot)
- Session duration and interaction patterns
- Rate limiting: consecutive scrapes within ~2 minutes return zero articles

**Layer 4: Network & Session**
- IP reputation scoring
- Cookie/session token tracking
- CAPTCHA triggers on suspicious patterns
- Device integrity checks

### Recommended Stealth Improvements

**1. Use Real Chrome Instead of Chromium**
```javascript
// Current (detectable)
const browser = await chromium.launch({ headless: true });

// Better (harder to fingerprint)
const browser = await chromium.launch({
  channel: 'chrome',      // Use real Chrome, not Chromium
  headless: 'new',         // New headless mode (closer to real browser)
});
```

**2. Implement Log-Normal Delay Distribution**
Instead of uniform random delays (3-5 seconds), use log-normal distribution which matches real human behavior — most actions are quick, with occasional long pauses:

```javascript
function humanDelay(median = 3000, sigma = 0.5) {
  const normal = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
  return Math.max(1000, median * Math.exp(sigma * normal));
}
```

**3. Add Mouse Jitter**
Real humans don't click precisely in the center of elements. Add slight random offsets and occasional micro-movements.

**4. Consider rebrowser-patches**
A stealth library that patches Playwright/Puppeteer to avoid common detection vectors. More maintained than `puppeteer-extra-plugin-stealth` in 2026.

**5. Session Management**
- Rotate user agents across sessions
- Maintain cookie persistence (already doing this with `cookies/tiktok.json`)
- Wait 3+ minutes between scrape sessions (already at 2-3 min, increase slightly)
- Vary session duration (don't always scrape for exactly 90 seconds)

### Operational Guidelines

| Parameter | Current | Recommended |
|-----------|---------|-------------|
| Min delay between scrapes | ~2 min | 3-5 min |
| Session duration | Fixed 90s timeout | Variable 60-120s |
| Scroll delay | Uniform 3-5s | Log-normal (median 3s) |
| Browser | Chromium headless | Chrome (`channel: 'chrome'`), `headless: 'new'` |
| User agent | Static | Rotate from pool of 5-10 |
| Mouse movement | None | Jitter on clicks |

### Legal Considerations

- TikTok's ToS prohibits scraping, but enforcement is primarily technical (blocking), not legal
- The platform's own Creative Center is publicly available — scraping that is lower risk
- Keep scraping volume moderate (4x daily at peak hours is reasonable)
- Never scrape private/restricted content
- Store only metadata and screenshots (transient) — don't download videos

---

## 3. The Anatomy of a TikTok Trend

### How Trends Form on TikTok

```
Creator posts video with novel element (format, sound, concept)
  → TikTok shows to seed group (200-500 users)
  → High completion rate + shares trigger wider distribution
  → Early adopters replicate with variations
  → Sound/format becomes recognizable template
  → Mainstream adoption (100K+ videos)
  → Saturation (diminishing novelty)
  → Decline (audience fatigue)
  → Residual (becomes permanent format vocabulary)
```

### Trend Types (Different Detection Needed)

| Type | Definition | Detection Signal | Lifespan |
|------|-----------|-----------------|----------|
| **Audio Trends** | A specific sound drives content creation | Sound usage velocity spike | 3-7 days peak (Asia: 3.4 days) |
| **Format Trends** | A replicable content template | Similar video structures appearing across creators | 1-4 weeks |
| **Topic Trends** | A subject/event driving content | Hashtag velocity + keyword clustering | Days to weeks |
| **Challenge Trends** | Participatory format with clear rules | Hashtag + specific actions/movements | 1-2 weeks |
| **Meme Trends** | Visual/textual template with variations | Image/text pattern recognition | 3-10 days |
| **Commerce Trends** | Product/shopping-driven content | TikTok Shop signals + product mentions | Tied to sales events |

### Lifecycle Stages & Detection Signals

**Emerging (0-24 hours)**
- Sound usage count growing >200%/day
- Small creators (nano/micro) dominating, not macro/mega
- Low total video count but high engagement per video
- Hashtag doesn't exist or has <1M total views

**Growing (1-3 days)**
- Multiple independent creators adopting without coordination
- Sound usage count growing >50%/day
- Mid-tier creators starting to participate
- Cross-hashtag spread (format appearing under different topic hashtags)

**Peaking (3-7 days)**
- Macro/mega creators and brands joining
- Sound usage growth slowing but absolute numbers high
- Media coverage or cross-platform spillover
- Satire/meta-commentary versions appearing

**Declining (1-2 weeks)**
- Diminishing novelty signal
- "Late to the trend" self-awareness in captions
- Engagement rates dropping on new entries
- Stitch/duet reactions > original format entries

**Dead/Residual**
- Minimal new entries
- Format becomes part of permanent vocabulary (e.g., POV format)
- Sound usage returns to baseline

### The Algorithm's Role

TikTok's 2026 algorithm signal hierarchy (by weight):
1. **Watch time / completion rate** (~40-50%) — NOT externally measurable
2. **First 2 seconds retention** — NOT externally measurable
3. **Shares** — strongest EXTERNALLY measurable signal
4. **Saves/Bookmarks** — signals evergreen content
5. **Comments** — especially thoughtful/long ones
6. **Likes** — lowest weight ("basic reflex")
7. **Search relevance** — TikTok now transcribes spoken content via NLP

**Key insight:** We can't measure the two highest-weight signals (watch time, retention). But we CAN measure the next most important ones: shares and saves. Our current engagement rate formula should weight these more heavily.

### Improved Engagement Scoring

Current formula treats all engagement equally. Recommended weighted approach:

```
virality_score = (shares * 3 + saves * 2 + comments * 1.5 + likes * 1) / views
```

Additionally: **Share ratio** (`shares / views`) alone is the single strongest externally measurable predictor of algorithmic boost.

---

## 4. Understanding Replicable Content

### What Makes Content Replicable for Brands

**Low Barrier (Easy to Replicate)**
- Uses trending audio (creator just needs to lip-sync or use as background)
- Simple premise (one clear hook, phone-shot, natural lighting)
- Template format (POV, "get ready with me," before/after)
- No special equipment or location needed
- Cultural relevance without specificity (relatable everyday scenarios)

**High Barrier (Hard to Replicate)**
- Requires specific talent (dance, singing, physical comedy)
- Location-dependent (specific landmarks, events)
- Production-heavy (editing, VFX, multi-camera)
- Personality-dependent (creator's unique charisma)

### Brand-Safe Replication Strategies

For each Godrej brand:

**Stella (air freshener):**
- Room makeover/transformation content (before/after)
- "Morning routine" content with home ambiance
- "Wangi rumah" (house smells good) reactions from guests
- Kos-kosan upgrade content (budget living improvement)
- Lebaran preparation (cleaning and freshening the house for guests)

**HIT Kecoa (insecticide):**
- Humor-driven "nyamuk/kecoa encounter" POV content
- Rainy season preparation content
- "Emak-emak vs kecoa" comedy scenarios
- Practical tips with entertainment value
- Dengue awareness content (HIT already won gold for this approach)

**NYU (hair color):**
- Hair transformation reveals (before/after)
- Glow-up content tied to cultural moments (Lebaran, back-to-school)
- "First time coloring" tutorial format
- Shade comparison videos
- GRWM (Get Ready With Me) featuring NYU

### Replicability Score Components

```
replicability_score = weighted_average(
  production_simplicity,     // Can it be shot on a phone?
  format_clarity,            // Is the template obvious?
  audio_availability,        // Is the sound available for business use?
  brand_fit_naturalness,     // Does the brand fit organically, not forced?
  cultural_timeliness,       // Is it tied to a current moment?
)
```

---

## 5. Understanding the Client: Brand Empathy

### Current State: Static Brand Descriptions

The current `brand-fit.js` uses hardcoded brand descriptions in the LLM prompt. This is a starting point but lacks:
- Dynamic understanding of what each brand is currently doing
- Seasonal relevance adjustment
- Competitive context
- Brand personality nuance

### Brand Personality Profiles

**Stella (Megasari Makmur/Godrej)**
- **Core identity:** Freshness, home comfort, clean living
- **Audience:** Ibu rumah tangga (housewives), young adults setting up first homes, kos-kosan residents
- **Emotional territory:** Pride in a well-kept home, hospitality, welcoming guests
- **Cultural hooks:** Lebaran preparation (clean house for guests), daily routines, room makeovers
- **Category context:** Indonesia air freshener market growing at 8.9% CAGR. Stella leads domestically. Competitors: Air Wick, Glade
- **NEVER touch:** Content that implies dirty/shameful homes, content that is overtly sexual, politically charged content
- **Content sweet spot:** Aspirational but accessible home improvement, "small upgrades that make a big difference"

**HIT Kecoa (Godrej)**
- **Core identity:** Protection, reliability, strength against pests
- **Audience:** All households, especially in tropical/urban areas
- **Emotional territory:** Peace of mind, protecting family, "I've got this handled"
- **Cultural hooks:** Rainy season (dengue/mosquito awareness), shared frustration with pests, humor about universal kecoa encounters
- **Category context:** HIT vs Baygon is the primary rivalry. Baygon has embraced humor on TikTok. HIT's Dengue Alert System won gold in Real-Time Marketing (29M warnings delivered, doubled CTRs)
- **NEVER touch:** Content that could cause panic about health/disease without solution, graphic/disgusting pest imagery
- **Content sweet spot:** Humor + practical value. "We all hate kecoa, here's how to deal" energy

**NYU (Godrej)**
- **Core identity:** Self-expression, transformation, beauty confidence
- **Audience:** Young women (18-30), beauty enthusiasts, first-time hair colorers
- **Emotional territory:** "New me" energy, creative self-expression, beauty confidence
- **Cultural hooks:** Glow-up for Lebaran, back-to-school transformation, "new semester new look", Valentine's/anniversary looks
- **Category context:** NYU is #6 in Indonesia hair color (4.0% share). Market leader is Garnier (20.6%). Key differentiation: ammonia-free, beginner-friendly. Competitors investing heavily in creator partnerships
- **NEVER touch:** Content that implies natural hair is ugly/wrong, culturally insensitive beauty standards, content promoting unsafe chemical use
- **Content sweet spot:** Transformation reveals, "first time coloring" tutorials, shade comparisons, GRWM content

### Dynamic Brand Context (Recommended Addition)

Instead of static descriptions, the brand-fit prompt should include:
1. **Current brand campaigns** — what messaging is the brand pushing right now?
2. **Seasonal relevance** — what cultural moment are we in? (Ramadan → Stella home prep; Rainy season → HIT protection; Back-to-school → NYU glow-up)
3. **Competitor activity** — what are Baygon/Garnier/Glade doing on TikTok right now?
4. **Recent brand content** — what has the brand posted recently? (tone, format, reception)

This could be implemented as a `brand-context.json` file that Epilog's team updates monthly, or even weekly. The pipeline reads it and injects it into the brand-fit prompt.

---

## 6. Indonesian Cultural Intelligence

### The Cultural Calendar

The platform needs a dynamic cultural calendar that adjusts scoring based on the current moment. Trends that align with upcoming cultural events deserve amplified attention.

| Period | Events | Content Themes | Brand Relevance |
|--------|--------|---------------|----------------|
| **Jan-Feb** | Imlek (Chinese New Year) | Angpao, family gatherings, nian gao | Stella (hosting), NYU (festive looks) |
| **Mar** | Pre-Ramadan, Nyepi (Bali) | Preparation, cleaning, shopping | Stella (high), HIT (moderate), NYU (moderate) |
| **Mar-Apr** | Ramadan | Bukber, sahur, mudik prep, religious content | ALL brands (peak season) |
| **Apr** | Lebaran (Idul Fitri), Kartini Day | Mudik, open house, kebaya | Stella (peak), NYU (lebaran looks) |
| **May** | Post-Lebaran | Back to routine | Low season |
| **Jun-Jul** | Back to School | New semester content, student life | NYU (glow-up) |
| **Aug** | Hari Kemerdekaan (17 Agustus) | Lomba 17-an, patriotic content | Moderate for all |
| **Sep-Oct** | Start of rainy season | Dengue awareness, home prep | HIT (peak), Stella (home care) |
| **Nov** | 11.11 sale | Shopping, haul content | Commerce-driven for all |
| **Dec** | 12.12 (Harbolnas), Christmas, NYE | Mega-sales, year-end content | Commerce-driven for all |
| **Monthly: 25th-1st** | Tanggal Gajian (payday) | "Treat yourself" content, hauls | Purchase intent spike for all |

**Key stat:** 66% of TikTok users recall payday sales content. 77% view payday as "treat yourself" time. 78% hold items in cart waiting for payday.

### Language & Slang Detection

Language patterns are a quality and audience signal:

| Pattern | Signal | Audience |
|---------|--------|----------|
| Jakarta bahasa gaul (gue, lo, emang, banget) | Mainstream entertainment | Urban youth, broad appeal |
| Heavy English code-switching ("So basically gue tuh...") | Aspirational/educated content | Urban, cosmopolitan |
| Regional language (Javanese, Sundanese, etc.) | Hyperlocal authenticity | Regional audiences |
| Pure formal Indonesian | Educational/institutional | Broader/older demographics |
| Alay language (stylized spelling) | Lower perceived quality | Very young users |

**Key slang to track:**
- **Gacor** — "performing well, on a streak" (hot content)
- **Sultan** — wealthy/generous person (used humorously)
- **Bocil** — young/immature users
- **Baper** — taking things too personally (150x frequency in one TikTok study)
- **Receh** — cheap/easy humor (a whole content genre)
- **Delulu** — "delusional" (from English, "delulu is the solulu")
- **Anak kos** — boarding house resident (represents budget urban life)
- **Emak-emak** — fearless mothers (aspirational energy)

### Indonesia-Specific Content Formats

| Format | Description | Brand Applicability |
|--------|-------------|-------------------|
| **Warung review** | Street food/traditional eatery reviews with ASMR | Low brand fit (authentic, can't be co-opted) |
| **Kos-kosan life** | Boarding house living hacks, room tours | Stella (room freshener), NYU (small-space beauty) |
| **Jujur review** | Honest product reviews (pro AND con) | HIGH — surviving scrutiny builds credibility |
| **Kondangan** | Wedding attendance content (outfit, event) | NYU (wedding looks), Stella (event prep) |
| **Bukber vlog** | Breaking-fast gathering documentation | Stella (home hosting) |
| **Mudik content** | Holiday travel home (long journeys, family) | Moderate for all |
| **Live selling** | Real-time product demos and sales | Commerce-driven format |
| **Lomba 17-an** | Independence Day traditional games | Fun/patriotic, moderate brand fit |
| **Emak-emak energy** | Fearless mother content | HIT (protecting the family), Stella (home pride) |

### Cultural Sensitivity Boundaries

**Religious sensitivity:**
- Ramadan content must be respectful (no eating/drinking imagery during fasting hours)
- Islamic values are central to majority audience
- Christmas content is acceptable (significant Christian population) but secondary

**Political topics:**
- Avoid all political content alignment
- Regional identity content is fine; political identity content is not

**Social class:**
- "Sultan" humor is acceptable; mocking poverty is not
- Kos-kosan/budget content should be empowering, not pitying
- Ibu-ibu/emak-emak content should be empowering

---

## 7. Developing "Taste": Quality Filtering

### The "Taste" Framework

"Taste" is the platform's ability to distinguish between:
- Content worth watching vs garbage
- Authentic trends vs manufactured/artificial ones
- Trends worth brand investment vs trends that waste effort
- Content that's culturally resonant vs content that's generic

### Quality Signals (Positive)

| Signal | What It Indicates | How to Detect |
|--------|------------------|---------------|
| High share ratio (shares/views) | Content people want others to see | `shareCount / playCount` |
| High save ratio (saves/views) | Evergreen/reference content | `collectCount / playCount` |
| Creator-to-follower breakout | Algorithm pushing content beyond audience | `playCount >> followerCount` |
| Multi-creator adoption | Format is independently replicable | Same format appearing across unrelated creators |
| Audio velocity spike | Sound driving content creation | Sound usage count acceleration |
| Comment depth | Genuine engagement, not just emoji | Comment length, reply chains |
| Cross-hashtag spread | Trend transcending single community | Format appearing under different topic hashtags |

### Noise Signals (Negative)

| Signal | What It Indicates | How to Detect |
|--------|------------------|---------------|
| Engagement bait patterns | "Like if you agree", "Comment your sign" | Caption keyword detection |
| Uniform engagement patterns | Bot activity or engagement pods | Suspiciously consistent like/comment ratios |
| Single-creator isolation | Not a trend, just one viral video | No replication by other creators |
| Celebrity-only adoption | Top-down push, not organic | Only macro/mega creators, no nano/micro |
| Duplicate/spam content | Content farms | Near-identical captions across accounts |
| Very short duration + high views | Artificial loop farming | Video duration <5s with millions of views |

### "Worth the Effort" Scoring

Not every trend is worth a brand's time. The platform should score:

```
effort_value = (
  trend_momentum *        // Is it still growing?
  brand_fit_score *       // Does it match the brand?
  replicability *         // Can the brand actually do this?
  cultural_timeliness *   // Is the timing right?
  audience_overlap        // Does the trend reach our audience?
) / estimated_effort      // How hard is it to produce?
```

### Creator Authority (Revised Approach)

Per the user's insight: **high views don't always come from high-follower creators.** On TikTok, the algorithm is the great equalizer. A 500-follower creator can get 10M views.

**What to track instead of raw follower count:**

1. **Breakout ratio** — `views / expected_baseline_for_follower_count`. A video with 5M views from a 2K-follower account is a MUCH stronger trend signal than 5M from a 10M-follower account
2. **Content consistency** — does this creator repeatedly produce performing videos? Multiple viral videos from a small creator = genuine talent/trend-sense
3. **Trend originator vs amplifier** — did they START the format or replicate it? Originators with small followings signal organic virality
4. **Repeat FYP appearance** — if the same small creator keeps appearing across scrape sessions, the algorithm consistently favors them

**Creator tier is context, not quality filter.** A trend dominated by nano/micro creators is more likely organic and more replicable than one dominated by mega creators.

---

## 8. Current Platform Gaps

### Critical Gaps (47 identified across 12 modules)

**Scraper (`src/scrapers/tiktok.js`):**
- No `collectCount` (saves/bookmarks) extraction — high-value signal being ignored
- No video duration extraction
- No creator follower count extraction from JS state
- No deduplication across scrape sessions (same video counted multiple times)

**Scoring Engine (`src/scoring/`):**
- Engagement rate treats all metrics equally (should weight shares > saves > comments > likes)
- No share ratio calculation (`shares / views`)
- No breakout ratio calculation (`views / expected_for_creator_size`)
- Hardcoded lifecycle thresholds untested against production data
- No time-of-day scoring adjustment

**AI Pipeline (`src/ai/`):**
- Trash Gate doesn't use engagement scores (relies only on LLM judgment of metadata)
- Trash Gate has fixed SIGNAL target (30-40%) instead of dynamic threshold
- No sentiment analysis on captions
- No audio/sound lifecycle tracking
- Static cultural keyword lists (no dynamic calendar)
- No feedback loop — we never validate whether our recommendations were good

**Brand Fit (`src/ai/brand-fit.js`):**
- Static brand descriptions (no seasonal context, no competitive awareness)
- No "brand safety" boundary enforcement beyond LLM judgment
- No creator-brand affinity signals

**Database (`src/database/supabase.js`):**
- No pipeline deduplication (same video can be upserted multiple times across runs)
- No audio/sound tracking table
- No cultural calendar table

**Patterns (`src/patterns/`):**
- Static cultural keyword lists in `cultural.js`
- Format detection in `formats.js` uses only hashtag heuristics, not content analysis
- No audio pattern tracking

---

## 9. Strategic Recommendations (Prioritized)

### Tier 1: High Impact, Low Effort (Do First)

**1. Extract and weight `collectCount` (saves/bookmarks)**
- Already available in JS state
- Add to scraper extraction, scoring, and engagement rate formula
- Weight: shares (3x) > saves (2x) > comments (1.5x) > likes (1x)

**2. Calculate share ratio as primary virality signal**
- `share_ratio = shares / views`
- This is the single strongest externally measurable predictor of algorithmic boost
- Add as a new column to `trends` table

**3. Add sound/audio usage tracking**
- After FYP scrape, fetch sound pages for unique audio IDs
- Track usage count over time to detect velocity spikes
- New table: `audio_trends` (audio_id, title, artist, usage_count, scraped_at)
- Sound velocity spike = 12-48 hour leading indicator of visual trend

**4. Implement cultural calendar**
- JSON config file with cultural events and date ranges
- Score amplification for trends that align with upcoming events
- Payday detection (25th-1st of month) for commerce-relevant trends

**5. Improve Trash Gate with engagement data**
- Pass engagement scores to Trash Gate LLM call
- Let it consider share ratio and engagement rate alongside metadata
- Dynamic SIGNAL threshold based on overall scrape quality

### Tier 2: High Impact, Medium Effort (Do Next)

**6. Add TikTok Creative Center as second data source**
- New scraper module: `src/scrapers/creative-center.js`
- Fetch trending hashtags, sounds, and videos filtered by Indonesia
- Run daily (not 4x/day like FYP — Creative Center updates daily)
- Cross-reference with FYP data for trend validation

**7. Implement pipeline deduplication**
- Hash-based deduplication across scrape sessions
- Track `first_seen_at` and `last_seen_at` for each video
- Distinguish "still trending" from "newly discovered"

**8. Add breakout ratio scoring**
- Extract creator follower count from JS state or profile pages
- Calculate `breakout_ratio = views / median_views_for_follower_tier`
- High breakout ratio = strong organic trend signal

**9. Dynamic brand context**
- `brand-context.json` file that Epilog team updates monthly
- Includes: current campaigns, seasonal focus, competitor activity
- Pipeline reads and injects into brand-fit prompt

**10. Feedback loop**
- Track which trends Epilog actually acted on (via `team_feedback` table)
- Correlate recommendations with outcomes
- Use to calibrate scoring thresholds over time

### Tier 3: Medium Impact, Higher Effort (Roadmap)

**11. Search autocomplete monitoring**
- Seed search with category terms, capture suggestions
- Compare across sessions to detect emerging search trends

**12. Sentiment analysis on captions**
- Detect tone (humor, educational, emotional, commercial)
- Use as input to brand-fit scoring

**13. Format classification via multimodal AI**
- Use screenshots + captions to classify content format
- Map to known replicable formats (POV, GRWM, jujur review, etc.)

**14. Creator consistency tracking**
- Track creators across scrape sessions
- Identify creators who repeatedly produce trending content
- Build creator authority scores based on performance, not follower count

**15. Cross-platform spillover detection**
- Monitor if TikTok trends are appearing on Instagram Reels / YouTube Shorts
- Cross-platform presence = trend durability signal

---

## Appendix A: TikTok Creative Center Endpoints

Known public endpoints (via community reverse-engineering):

| Endpoint | Parameters | Returns |
|----------|-----------|---------|
| `getTrendingVideos` | country, page, limit, period | Top videos by country |
| `getTrendingSongs` | country, page, limit, period | Top sounds by country |
| `getTopAds` | country, page, limit, period, feed_type | Top ad creatives |
| Popular hashtags | country, period | Trending hashtags |
| Popular creators | country | Trending creators |
| Video search | keyword, country | Videos matching keyword |

## Appendix B: Indonesian FMCG Competitive Landscape

| Category | Brand (Godrej) | Market Position | Key Competitors | TikTok Activity |
|----------|---------------|-----------------|-----------------|-----------------|
| Air Freshener | Stella | Category leader (Indonesia) | Air Wick (Reckitt), Glade (SC Johnson) | Moderate |
| Insecticide | HIT | Top 2 | Baygon (SC Johnson), Vape (Fumakilla) | Baygon active with humor |
| Hair Color | NYU | #6 (4.0% share) | Garnier (20.6%), Sasha, Miranda, L'Oreal | Heavy creator partnerships needed |

## Appendix C: Algorithm Weight Reference

| Signal | Weight | Externally Measurable? |
|--------|--------|----------------------|
| Watch time / completion rate | ~40-50% | No |
| First 2 seconds retention | Very High | No |
| Shares | Highest engagement | Yes (`shareCount`) |
| Saves/Bookmarks | High | Yes (`collectCount`) |
| Comments | Medium-High | Yes (`commentCount`) |
| Likes | Low | Yes (`diggCount`) |
| Search relevance (NLP) | Medium (new 2026) | No |
| Follower-to-view ratio | Indirect | Calculable |
| Sound usage velocity | High | Yes (sound pages) |
| Hashtag view velocity | Medium | Yes (hashtag pages) |

---

*Research conducted 2026-03-14. Sources include Buffer, Sprout Social, Hootsuite, TikTok Creative Center, ScrapFly, DemandSage, Campaign Asia, Marketing Interactive, Favikon, ContentGrip, ResearchGate, and direct codebase analysis.*
