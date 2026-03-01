# Trend Watcher — Backend

The Mac Mini backend for Epilog Creative's TikTok trend intelligence platform. It scrapes TikTok Explore via headless Chromium on a WIB-aligned cron schedule, scores each video through a 3D scoring engine (engagement, velocity, replication), detects Indonesian cultural patterns, writes enriched trend data to Supabase, and sends Slack alerts when high-urgency trends surface. The Lovable-built frontend reads from the same Supabase project — this backend only writes data, never serves it directly to browsers.

## System Requirements

- macOS (Mac Mini M-series recommended)
- Node.js 20+ (managed via [fnm](https://github.com/Schniz/fnm))
- Playwright (Chromium auto-installs via `npx playwright install chromium`)
- cloudflared via Homebrew (`brew install cloudflare/cloudflare/cloudflared`)
- Supabase project with `trends` and `engagement_snapshots` tables

## Quick Start

```bash
# 1. Clone the repo
git clone <your-repo-url> && cd EPILOG-TREND-ANALYZER

# 2. Install dependencies
npm install

# 3. Install Chromium for Playwright
npx playwright install chromium

# 4. Configure environment
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_SECRET, SLACK_WEBHOOK_URL

# 5. Verify Supabase connection
node scripts/test-db-write.js

# 6. First manual scrape (dry run — scores only, no DB writes)
node scripts/test-pipeline.js

# 7. First real scrape (writes to Supabase)
npm run scrape

# 8. Start server locally
npm run dev

# 9. Set up Cloudflare Tunnel (see cloudflare/setup-instructions.md)

# 10. Go permanent — auto-start on login, restart on crash
bash scripts/install-launchd.sh
```

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | `https://abc123.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anon/public key | `eyJhbGciOiJIUzI1NiIs...` |
| `PORT` | HTTP server port | `3001` |
| `AUTH_SECRET` | Secret for `/trigger` and `/webhook` endpoints | `your-random-secret-here` |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook for alerts | `https://hooks.slack.com/services/T.../B.../xxx` |
| `NODE_ENV` | Environment mode | `development` or `production` |

## Architecture

```
TikTok Explore
      │
      ▼
┌─────────────┐
│   Scraper    │  Playwright headless Chromium
│  (tiktok.js) │  Anti-detection: stealth headers, random delays
└──────┬──────┘
       │ raw videos[]
       ▼
┌─────────────┐
│   Scoring    │  engagement.js  → engagement rate, velocity, momentum
│   Engine     │  replication.js → audio reuse, hashtag clustering
│              │  classifier.js  → composite score, classification, lifecycle, urgency
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Pattern    │  formats.js  → 10 content formats (tutorial, mukbang, duet, etc.)
│  Detection   │  cultural.js → 8 Indonesian cultural signals (ramadan, lebaran, etc.)
└──────┬──────┘
       │ enriched trends[]
       ▼
┌─────────────┐
│  Supabase    │  trends table (upsert by hash)
│  Database    │  engagement_snapshots table (append-only time series)
└──────┬──────┘
       │
       ├──▶ Edge Functions → trend_analysis, client_brand_fit
       │
       └──▶ Lovable Frontend (reads directly from Supabase)
```

## Scraping Schedule

The scheduler runs on WIB (UTC+7) time, aligned to Indonesian social media peak hours:

| Window | WIB Hours | Interval | AI Analysis | Rationale |
|---|---|---|---|---|
| Morning | 05:00–08:00 | 30 min | Yes | Early trend detection |
| Work | 08:00–11:00 | 90 min | No | Lower activity |
| Lunch | 11:00–14:00 | 30 min | Yes | Lunch break peak |
| Afternoon | 14:00–18:00 | 60 min | No | Moderate activity |
| Primetime | 18:00–22:00 | 20 min | Yes | Highest engagement window |
| Late Night | 22:00–00:00 | 45 min | Yes | Viral content surfaces |
| Sleep | 00:00–05:00 | 120 min | No | Minimal activity |

## Useful Commands

### npm scripts

| Command | Description |
|---|---|
| `npm start` | Start server in production mode |
| `npm run dev` | Start server with nodemon (auto-restart on changes) |
| `npm run scrape` | Run a single scrape (no server, just scrape + exit) |
| `npm test` | Run unit tests (106 tests across scoring + patterns) |
| `npm run tunnel` | Start Cloudflare Tunnel manually |

### Shell scripts

| Script | Description |
|---|---|
| `bash scripts/install-launchd.sh` | Install launchd services for auto-start on login |
| `bash scripts/uninstall-launchd.sh` | Remove launchd services |
| `bash scripts/status.sh` | Show service status, health check, and recent logs |
| `bash scripts/update.sh` | Pull latest code, install deps, restart server |

### Integration test scripts

| Script | Description |
|---|---|
| `node scripts/test-db-write.js` | Supabase round-trip: write, verify, delete |
| `node scripts/test-pipeline.js` | Scrape + score dry-run (no DB writes) |

### Server endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /health` | No | Health check — returns status, Supabase connectivity, trends count |
| `POST /trigger/scrape` | Yes | Manually trigger a pipeline run (async, returns 202) |
| `GET /status/pipeline` | No | Current pipeline status — running, last result, duration |
| `POST /webhook/test` | Yes | Webhook connectivity test |

Auth endpoints require `x-auth-secret` header matching the `AUTH_SECRET` env var.

## Troubleshooting

### Scraper returns 0 results

- TikTok may have changed their DOM structure
- Check `SELECTORS` constant in `src/scrapers/tiktok.js`
- Temporarily set `headless: false` in the Playwright launch options to see what the browser sees
- TikTok may be rate-limiting — wait 5 minutes and retry
- Run `npx playwright install chromium` to ensure browser is up to date

### Supabase writes failing

- Verify `.env` values are correct (URL and anon key)
- Run `node scripts/test-db-write.js` to isolate the issue
- Check Supabase dashboard for RLS policy issues on `trends` and `engagement_snapshots` tables
- Ensure the anon key has INSERT and UPDATE permissions

### Cloudflare Tunnel not connecting

- `cloudflared tunnel list` to verify the tunnel exists
- Check `~/.cloudflared/` for the credentials JSON file
- Run the tunnel manually first: `cloudflared tunnel run trend-watcher`
- Verify DNS CNAME record points to `<tunnel-id>.cfargotunnel.com`

### Server crashes on boot

- Check `logs/stderr.log` for the error
- Run `npm start` manually to see the error in terminal
- Verify all `.env` variables are set (especially `SUPABASE_URL` and `SUPABASE_ANON_KEY`)
- Check if port 3001 is already in use: `lsof -i :3001`

### Scheduler not triggering scrapes

- Run `bash scripts/status.sh` to check service status
- Check `logs/app.log` for scheduler tick messages
- The scheduler is timezone-sensitive — verify `TZ=Asia/Jakarta` is set
- First scrape triggers immediately on startup (elapsed time = Infinity)

## Connecting to Lovable Frontend

The frontend and backend share the same Supabase project but have strict table ownership:

| Table | Writer | Reader |
|---|---|---|
| `trends` | Backend (this repo) | Frontend, Edge Functions |
| `engagement_snapshots` | Backend (this repo) | Frontend, Edge Functions |
| `trend_analysis` | Edge Functions | Frontend |
| `client_brand_fit` | Edge Functions | Frontend |
| `team_feedback` | Frontend | Edge Functions |
| `taste_weights` | Edge Functions | Frontend |

The backend **never** reads from or writes to `trend_analysis`, `client_brand_fit`, `team_feedback`, or `taste_weights`. This separation ensures the frontend and backend can evolve independently.

## Updating

```bash
bash scripts/update.sh
```

This pulls the latest code, runs `npm install`, restarts the trendwatcher service via `launchctl kickstart`, waits 3 seconds, and shows the health check result.
