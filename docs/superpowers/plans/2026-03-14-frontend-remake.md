# Trend Watcher Frontend Remake — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new "Smart Magazine" frontend for the Trend Watcher tool — a Vite React SPA served by the existing Express backend on Mac Mini.

**Architecture:** New `frontend/` directory in the same repo. Vite builds to `frontend/dist/`, Express serves it as static files. New Express API routes handle auth (PIN/JWT), saved collections, and pattern aggregations. Frontend reads trend data from Supabase directly via client, writes feedback via Supabase, and calls Express API for auth + collections + patterns.

**Tech Stack:** React 18 + TypeScript + Vite 5 + Tailwind CSS 4 + Radix UI primitives + TanStack Query 5 + Zustand + Recharts + Framer Motion + Supabase JS client. Backend: Express + jsonwebtoken + bcrypt.

**Spec:** `docs/superpowers/specs/2026-03-14-frontend-remake-design.md`

---

## Chunk 1: Database + Backend API

### Task 1: Database Migrations

**Files:**
- Create: `supabase/migrations/saved_items.sql`

**Context:** Three new tables needed for the Saved/Collections feature. Applied via Supabase MCP tool.

- [ ] **Step 1: Write the migration SQL**

```sql
-- saved_items: bookmarked trends
CREATE TABLE saved_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trend_id UUID NOT NULL UNIQUE REFERENCES trends(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- collections: named mood boards
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- collection_items: many-to-many
CREATE TABLE collection_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  trend_id UUID NOT NULL REFERENCES trends(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(collection_id, trend_id)
);

-- RLS
ALTER TABLE saved_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_saved_items" ON saved_items FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_collections" ON collections FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_collection_items" ON collection_items FOR ALL TO anon USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run the SQL against project `tnvnevydxobtmiackdkz`.

- [ ] **Step 3: Verify tables exist**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('saved_items', 'collections', 'collection_items');
```

Expected: 3 rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/saved_items.sql
git commit -m "feat: add saved_items, collections, collection_items tables"
```

---

### Task 2: Backend Auth — PIN + JWT

**Files:**
- Create: `src/api/auth.js` — PIN verification + JWT endpoints
- Create: `src/api/middleware.js` — `requireAuth` JWT middleware
- Modify: `src/server.js` — Mount auth routes, add `jsonwebtoken` and `bcrypt` requires
- Modify: `package.json` — Add `jsonwebtoken` and `bcrypt` dependencies

**Context:** PIN stored as `TEAM_PIN_HASH` env var (bcrypt hash). JWT signed with `JWT_SECRET` env var. All `/api/*` routes except `/api/auth/pin` require valid JWT.

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/abimangkuagent/EPILOG-TREND-ANALYZER && npm install jsonwebtoken bcrypt
```

- [ ] **Step 2: Create `src/api/middleware.js`**

```javascript
const jwt = require('jsonwebtoken');
const logger = require('../logger');

/**
 * Express middleware that verifies JWT from Authorization header.
 * Rejects with 401 if token is missing or invalid.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = decoded;
    next();
  } catch (err) {
    logger.error('JWT verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
```

- [ ] **Step 3: Create `src/api/auth.js`**

```javascript
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const logger = require('../logger');

const router = express.Router();

/**
 * POST /api/auth/pin — Verify PIN, return JWT.
 * Request: { pin: "1234" }
 * Response 200: { token: "jwt..." }
 * Response 401: { error: "Invalid PIN" }
 */
router.post('/pin', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || typeof pin !== 'string') {
      return res.status(400).json({ error: 'PIN is required' });
    }

    const pinHash = process.env.TEAM_PIN_HASH;
    if (!pinHash) {
      logger.error('TEAM_PIN_HASH env var not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const valid = await bcrypt.compare(pin, pinHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    const token = jwt.sign(
      { type: 'team', iat: Math.floor(Date.now() / 1000) },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token });
  } catch (err) {
    logger.error('PIN auth error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * GET /api/auth/verify — Validate JWT session.
 * Header: Authorization: Bearer <jwt>
 * Response 200: { valid: true }
 * Response 401 handled by requireAuth middleware.
 */
router.get('/verify', (req, res) => {
  // If we reach here, requireAuth already validated the token
  res.json({ valid: true });
});

module.exports = router;
```

- [ ] **Step 4: Mount auth routes in `src/server.js`**

Add to `src/server.js` after existing route mounts:

```javascript
const authRouter = require('./api/auth');
const { requireAuth } = require('./api/middleware');

// Auth routes (no JWT required for /pin)
app.use('/api/auth', authRouter);

// All other /api routes require JWT
app.use('/api', requireAuth);
```

Note: The `/api/auth/verify` endpoint needs `requireAuth` applied. Mount order matters — the `requireAuth` on `/api` runs AFTER the `/api/auth` mount, so we need to apply it to `/verify` specifically. Adjust `auth.js` to import and use `requireAuth` on the verify route:

```javascript
// In auth.js, change the verify route:
const { requireAuth } = require('./middleware');
router.get('/verify', requireAuth, (req, res) => {
  res.json({ valid: true });
});
```

- [ ] **Step 5: Generate a PIN hash for .env**

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('1234', 10).then(h => console.log(h))"
```

Add to `.env`:
```
TEAM_PIN_HASH=<output from above>
JWT_SECRET=<generate a random 32-char string>
```

- [ ] **Step 6: Test manually**

```bash
# Start server
npm start &

# Test PIN auth
curl -X POST http://localhost:3001/api/auth/pin \
  -H "Content-Type: application/json" \
  -d '{"pin":"1234"}'
# Expected: {"token":"eyJ..."}

# Test verify with token
curl http://localhost:3001/api/auth/verify \
  -H "Authorization: Bearer <token from above>"
# Expected: {"valid":true}

# Test verify without token
curl http://localhost:3001/api/auth/verify
# Expected: 401
```

- [ ] **Step 7: Commit**

```bash
git add src/api/auth.js src/api/middleware.js src/server.js package.json package-lock.json
git commit -m "feat: add PIN auth with JWT — POST /api/auth/pin, GET /api/auth/verify"
```

---

### Task 3: Backend API — Saved & Collections

**Files:**
- Create: `src/api/saved.js` — CRUD for saved items
- Create: `src/api/collections.js` — CRUD for collections
- Modify: `src/server.js` — Mount saved and collections routes

**Context:** All these endpoints require JWT (behind `requireAuth` middleware). They use the Supabase client from `src/database/supabase.js`.

- [ ] **Step 1: Create `src/api/saved.js`**

```javascript
const express = require('express');
const logger = require('../logger');
const { supabase } = require('../database/supabase');

const router = express.Router();

/**
 * GET /api/saved — List all saved trend IDs with their collection memberships.
 */
router.get('/', async (req, res) => {
  try {
    const { data: savedItems, error } = await supabase
      .from('saved_items')
      .select('id, trend_id, saved_at')
      .order('saved_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch saved items:', error);
      return res.status(500).json({ error: 'Failed to fetch saved items' });
    }

    // Get collection memberships for all saved trends
    const trendIds = savedItems.map(s => s.trend_id);
    let collectionMap = {};

    if (trendIds.length > 0) {
      const { data: memberships, error: memError } = await supabase
        .from('collection_items')
        .select('trend_id, collection_id')
        .in('trend_id', trendIds);

      if (!memError && memberships) {
        for (const m of memberships) {
          if (!collectionMap[m.trend_id]) collectionMap[m.trend_id] = [];
          collectionMap[m.trend_id].push(m.collection_id);
        }
      }
    }

    const result = savedItems.map(s => ({
      ...s,
      collections: collectionMap[s.trend_id] || [],
    }));

    res.json(result);
  } catch (err) {
    logger.error('Saved items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/saved/:trendId — Save a trend (toggle: insert if not exists).
 */
router.post('/:trendId', async (req, res) => {
  try {
    const { trendId } = req.params;
    const { data, error } = await supabase
      .from('saved_items')
      .insert({ trend_id: trendId })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Already saved' });
      }
      logger.error('Failed to save trend:', error);
      return res.status(500).json({ error: 'Failed to save trend' });
    }

    res.status(201).json(data);
  } catch (err) {
    logger.error('Save trend error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/saved/:trendId — Unsave a trend.
 */
router.delete('/:trendId', async (req, res) => {
  try {
    const { trendId } = req.params;

    // Also remove from all collections
    await supabase
      .from('collection_items')
      .delete()
      .eq('trend_id', trendId);

    const { error } = await supabase
      .from('saved_items')
      .delete()
      .eq('trend_id', trendId);

    if (error) {
      logger.error('Failed to unsave trend:', error);
      return res.status(500).json({ error: 'Failed to unsave trend' });
    }

    res.status(204).send();
  } catch (err) {
    logger.error('Unsave trend error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Create `src/api/collections.js`**

```javascript
const express = require('express');
const logger = require('../logger');
const { supabase } = require('../database/supabase');

const router = express.Router();

/**
 * GET /api/collections — List all collections with item counts.
 */
router.get('/', async (req, res) => {
  try {
    const { data: collections, error } = await supabase
      .from('collections')
      .select('id, name, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch collections:', error);
      return res.status(500).json({ error: 'Failed to fetch collections' });
    }

    // Get item counts
    const collectionIds = collections.map(c => c.id);
    let countMap = {};

    if (collectionIds.length > 0) {
      const { data: items, error: countError } = await supabase
        .from('collection_items')
        .select('collection_id')
        .in('collection_id', collectionIds);

      if (!countError && items) {
        for (const item of items) {
          countMap[item.collection_id] = (countMap[item.collection_id] || 0) + 1;
        }
      }
    }

    const result = collections.map(c => ({
      ...c,
      item_count: countMap[c.id] || 0,
    }));

    res.json(result);
  } catch (err) {
    logger.error('Collections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/collections — Create a new collection.
 * Request: { name: "Ramadan Ideas" }
 */
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    const { data, error } = await supabase
      .from('collections')
      .insert({ name: name.trim() })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create collection:', error);
      return res.status(500).json({ error: 'Failed to create collection' });
    }

    res.status(201).json({ ...data, item_count: 0 });
  } catch (err) {
    logger.error('Create collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/collections/:id — Rename a collection.
 * Request: { name: "New Name" }
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    const { data, error } = await supabase
      .from('collections')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to rename collection:', error);
      return res.status(500).json({ error: 'Failed to rename collection' });
    }

    res.json(data);
  } catch (err) {
    logger.error('Rename collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/collections/:id — Delete a collection (items remain saved).
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('collections')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Failed to delete collection:', error);
      return res.status(500).json({ error: 'Failed to delete collection' });
    }

    res.status(204).send();
  } catch (err) {
    logger.error('Delete collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/collections/:id/items — Add a trend to a collection.
 * Request: { trend_id: "uuid" }
 */
router.post('/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    const { trend_id } = req.body;
    if (!trend_id) {
      return res.status(400).json({ error: 'trend_id is required' });
    }

    // Ensure item is saved first
    await supabase
      .from('saved_items')
      .upsert({ trend_id }, { onConflict: 'trend_id' });

    const { data, error } = await supabase
      .from('collection_items')
      .insert({ collection_id: id, trend_id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Already in collection' });
      }
      logger.error('Failed to add to collection:', error);
      return res.status(500).json({ error: 'Failed to add to collection' });
    }

    // Update collection timestamp
    await supabase
      .from('collections')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id);

    res.status(201).json(data);
  } catch (err) {
    logger.error('Add to collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/collections/:id/items/:trendId — Remove a trend from a collection.
 */
router.delete('/:id/items/:trendId', async (req, res) => {
  try {
    const { id, trendId } = req.params;

    const { error } = await supabase
      .from('collection_items')
      .delete()
      .eq('collection_id', id)
      .eq('trend_id', trendId);

    if (error) {
      logger.error('Failed to remove from collection:', error);
      return res.status(500).json({ error: 'Failed to remove from collection' });
    }

    res.status(204).send();
  } catch (err) {
    logger.error('Remove from collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 3: Mount in `src/server.js`**

After the auth routes mount, add:

```javascript
const savedRouter = require('./api/saved');
const collectionsRouter = require('./api/collections');

app.use('/api/saved', savedRouter);
app.use('/api/collections', collectionsRouter);
```

- [ ] **Step 4: Test manually with curl**

```bash
# Get token first
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/pin \
  -H "Content-Type: application/json" \
  -d '{"pin":"1234"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

# Create collection
curl -X POST http://localhost:3001/api/collections \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ramadan Ideas"}'
# Expected: 201 with collection object

# List collections
curl http://localhost:3001/api/collections \
  -H "Authorization: Bearer $TOKEN"
# Expected: array with 1 collection
```

- [ ] **Step 5: Commit**

```bash
git add src/api/saved.js src/api/collections.js src/server.js
git commit -m "feat: add saved items and collections CRUD API"
```

---

### Task 4: Backend API — Patterns & For You

**Files:**
- Create: `src/api/patterns.js` — Format distribution + audio momentum endpoints
- Create: `src/api/for-you.js` — Curated picks endpoint
- Modify: `src/server.js` — Mount pattern and for-you routes

- [ ] **Step 1: Create `src/api/patterns.js`**

```javascript
const express = require('express');
const logger = require('../logger');
const { supabase } = require('../database/supabase');
const { detectFormats } = require('../patterns/formats');

const router = express.Router();

/**
 * GET /api/patterns/formats — Format distribution across all recent trends.
 * Query params: ?days=14 (default 14)
 */
router.get('/formats', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 14;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: trends, error } = await supabase
      .from('trends')
      .select('title, hashtags')
      .gte('scraped_at', since);

    if (error) {
      logger.error('Failed to fetch trends for format analysis:', error);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }

    // Count formats using backend pattern detection
    const formatCounts = {};
    for (const trend of trends) {
      const formats = detectFormats(trend.title, trend.hashtags || []);
      for (const format of formats) {
        formatCounts[format] = (formatCounts[format] || 0) + 1;
      }
    }

    const total = trends.length || 1;
    const result = Object.entries(formatCounts)
      .map(([format, count]) => ({
        format,
        count,
        percentage: Math.round((count / total) * 100),
        growth: 0, // TODO: compare with prior period when enough data
      }))
      .sort((a, b) => b.count - a.count);

    res.json(result);
  } catch (err) {
    logger.error('Format patterns error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/patterns/audio — Audio tracks sorted by growth rate.
 * Query params: ?days=6 (default 6, split into two 3-day windows)
 */
router.get('/audio', async (req, res) => {
  try {
    const totalDays = parseInt(req.query.days) || 6;
    const halfDays = Math.floor(totalDays / 2);
    const now = new Date();
    const midpoint = new Date(now - halfDays * 24 * 60 * 60 * 1000);
    const start = new Date(now - totalDays * 24 * 60 * 60 * 1000);

    // Recent window
    const { data: recent, error: e1 } = await supabase
      .from('trends')
      .select('audio_id, audio_title')
      .not('audio_id', 'is', null)
      .gte('scraped_at', midpoint.toISOString());

    // Prior window
    const { data: prior, error: e2 } = await supabase
      .from('trends')
      .select('audio_id, audio_title')
      .not('audio_id', 'is', null)
      .gte('scraped_at', start.toISOString())
      .lt('scraped_at', midpoint.toISOString());

    if (e1 || e2) {
      logger.error('Failed to fetch audio data:', e1 || e2);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }

    // Count by audio_id
    const recentCounts = {};
    const audioTitles = {};
    for (const t of (recent || [])) {
      recentCounts[t.audio_id] = (recentCounts[t.audio_id] || 0) + 1;
      audioTitles[t.audio_id] = t.audio_title;
    }

    const priorCounts = {};
    for (const t of (prior || [])) {
      priorCounts[t.audio_id] = (priorCounts[t.audio_id] || 0) + 1;
      if (!audioTitles[t.audio_id]) audioTitles[t.audio_id] = t.audio_title;
    }

    // Compute growth
    const allAudioIds = new Set([...Object.keys(recentCounts), ...Object.keys(priorCounts)]);
    const result = [];

    for (const audioId of allAudioIds) {
      const current = recentCounts[audioId] || 0;
      const previous = priorCounts[audioId] || 0;
      const growthPct = previous > 0
        ? Math.round(((current - previous) / previous) * 100)
        : (current > 0 ? 100 : 0);

      let status = 'stable';
      if (growthPct > 50) status = 'rising';
      else if (growthPct < -10) status = 'declining';

      if (current > 0 || previous > 0) {
        result.push({
          audio_id: audioId,
          audio_title: audioTitles[audioId] || 'Unknown',
          current_count: current,
          previous_count: previous,
          growth_pct: growthPct,
          status,
        });
      }
    }

    result.sort((a, b) => b.growth_pct - a.growth_pct);
    res.json(result.slice(0, 20));
  } catch (err) {
    logger.error('Audio patterns error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Create `src/api/for-you.js`**

```javascript
const express = require('express');
const logger = require('../logger');
const { supabase } = require('../database/supabase');
const { detectFormats } = require('../patterns/formats');

const router = express.Router();

/**
 * GET /api/for-you — Curated picks organized by opportunity type.
 * Returns: { high_potential, fun_to_replicate, rising_quietly, audio_going_viral }
 */
router.get('/', async (req, res) => {
  try {
    // Fetch recent trends with analysis and brand fit
    const { data: trends, error: tErr } = await supabase
      .from('trends')
      .select('*')
      .gte('scraped_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('trend_score', { ascending: false });

    if (tErr) {
      logger.error('Failed to fetch trends for For You:', tErr);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }

    if (!trends || trends.length === 0) {
      return res.json({
        high_potential: [],
        fun_to_replicate: [],
        rising_quietly: [],
        audio_going_viral: [],
      });
    }

    const trendIds = trends.map(t => t.id);

    // Fetch analyses
    const { data: analyses } = await supabase
      .from('trend_analysis')
      .select('*')
      .in('trend_id', trendIds)
      .eq('analysis_type', 'deep_analysis');

    const analysisMap = {};
    for (const a of (analyses || [])) {
      analysisMap[a.trend_id] = a;
    }

    // Fetch brand fits
    const { data: fits } = await supabase
      .from('client_brand_fit')
      .select('*')
      .in('trend_id', trendIds);

    const fitMap = {};
    for (const f of (fits || [])) {
      if (!fitMap[f.trend_id]) fitMap[f.trend_id] = [];
      fitMap[f.trend_id].push(f);
    }

    // Enrich trends
    const enriched = trends.map(t => ({
      ...t,
      analysis: analysisMap[t.id] || null,
      brand_fits: fitMap[t.id] || [],
      detected_formats: detectFormats(t.title, t.hashtags || []),
      reason: analysisMap[t.id]?.summary || '',
    }));

    // 1. High Potential: strong brand fit + growing + high score
    const highPotential = enriched
      .filter(t => {
        const maxFit = Math.max(0, ...t.brand_fits.map(f => f.fit_score || 0));
        return maxFit >= 60 && t.trend_score >= 50 &&
          ['growing', 'peaking'].includes(t.lifecycle_stage);
      })
      .slice(0, 4);

    // 2. Fun to Replicate: high views + format detected + not already trending
    const viewValues = enriched.map(t => t.views || 0).sort((a, b) => a - b);
    const p75 = viewValues[Math.floor(viewValues.length * 0.75)] || 0;

    const funToReplicate = enriched
      .filter(t =>
        (t.views || 0) >= p75 &&
        t.detected_formats.length > 0 &&
        ['noise', 'emerging_trend'].includes(t.classification) &&
        !highPotential.find(hp => hp.id === t.id)
      )
      .slice(0, 4);

    // 3. Rising Quietly: emerging + accelerating
    const risingQuietly = enriched
      .filter(t =>
        t.lifecycle_stage === 'emerging' &&
        t.momentum === 1 &&
        !highPotential.find(hp => hp.id === t.id) &&
        !funToReplicate.find(fr => fr.id === t.id)
      )
      .slice(0, 4);

    // 4. Audio Going Viral (delegate to patterns/audio endpoint logic)
    const audioCounts = {};
    const audioTitles = {};
    const audioTrends = {};
    for (const t of enriched) {
      if (t.audio_id) {
        audioCounts[t.audio_id] = (audioCounts[t.audio_id] || 0) + 1;
        audioTitles[t.audio_id] = t.audio_title;
        if (!audioTrends[t.audio_id]) audioTrends[t.audio_id] = [];
        audioTrends[t.audio_id].push(t.id);
      }
    }

    const audioGoingViral = Object.entries(audioCounts)
      .filter(([, count]) => count >= 3)
      .map(([audioId, count]) => ({
        audio_id: audioId,
        audio_title: audioTitles[audioId] || 'Unknown',
        current_count: count,
        growth_pct: 0, // Simplified; full growth calc in patterns/audio
        trend_ids: audioTrends[audioId],
      }))
      .sort((a, b) => b.current_count - a.current_count)
      .slice(0, 4);

    res.json({
      high_potential: highPotential,
      fun_to_replicate: funToReplicate,
      rising_quietly: risingQuietly,
      audio_going_viral: audioGoingViral,
    });
  } catch (err) {
    logger.error('For You error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 3: Mount in `src/server.js`**

```javascript
const patternsRouter = require('./api/patterns');
const forYouRouter = require('./api/for-you');

app.use('/api/patterns', patternsRouter);
app.use('/api/for-you', forYouRouter);
```

- [ ] **Step 4: Test endpoints**

```bash
curl http://localhost:3001/api/patterns/formats -H "Authorization: Bearer $TOKEN"
curl http://localhost:3001/api/patterns/audio -H "Authorization: Bearer $TOKEN"
curl http://localhost:3001/api/for-you -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 5: Commit**

```bash
git add src/api/patterns.js src/api/for-you.js src/server.js
git commit -m "feat: add patterns and for-you API endpoints"
```

---

### Task 5: Backend — Serve Frontend Static Files

**Files:**
- Modify: `src/server.js` — Add static file serving and SPA fallback

- [ ] **Step 1: Add static serving to `src/server.js`**

After all API route mounts, before `app.listen()`:

```javascript
const path = require('path');

// Serve frontend static files
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// SPA fallback — all non-API routes serve index.html
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/health') && !req.path.startsWith('/scrape')) {
    res.sendFile(path.join(frontendDist, 'index.html'));
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server.js
git commit -m "feat: serve frontend dist as static files with SPA fallback"
```

---

## Chunk 2: Frontend Scaffold + Core Components

### Task 6: Scaffold Vite React Project

**Files:**
- Create: `frontend/` — entire Vite project scaffold

- [ ] **Step 1: Create the Vite project**

```bash
cd /Users/abimangkuagent/EPILOG-TREND-ANALYZER
npm create vite@latest frontend -- --template react-ts
cd frontend
```

- [ ] **Step 2: Install all dependencies**

```bash
npm install react-router-dom @tanstack/react-query @supabase/supabase-js zustand recharts framer-motion lucide-react date-fns geist @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-slider
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Configure `vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
})
```

- [ ] **Step 4: Configure Tailwind in `src/index.css`**

Replace contents of `frontend/src/index.css`:

```css
@import "tailwindcss";
@import "geist/font/sans";

:root {
  --bg-page: #141414;
  --bg-panel: #1a1a1a;
  --bg-card: #1c1c1c;
  --bg-input: #222222;
  --border-card: #262626;
  --border-divider: #222222;
  --border-input: #2a2a2a;
  --text-primary: #f5f5f5;
  --text-heading: #e5e5e5;
  --text-body: #d4d4d4;
  --text-secondary: #a3a3a3;
  --text-tertiary: #737373;
  --text-muted: #525252;
  --text-disabled: #404040;
  --brand-stella: #22c55e;
  --brand-hitkecoa: #ef4444;
  --brand-nyu: #f59e0b;
  --lifecycle-emerging: #3b82f6;
  --lifecycle-growing: #22c55e;
  --lifecycle-peaking: #f59e0b;
  --lifecycle-declining: #525252;
  --lifecycle-dead: #404040;
  --classification-viral: #ef4444;
  --classification-hot: #f97316;
}

body {
  background-color: var(--bg-page);
  color: var(--text-body);
  font-family: 'Geist Sans', 'Geist', system-ui, -apple-system, sans-serif;
  margin: 0;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 5: Create `frontend/src/types/index.ts`**

Copy and adapt types from the existing frontend, matching the Supabase schema. This file defines all shared TypeScript interfaces.

```typescript
export type LifecycleStage = 'emerging' | 'growing' | 'peaking' | 'declining' | 'dead';
export type Classification = 'noise' | 'emerging_trend' | 'rising_trend' | 'hot_trend' | 'viral';
export type UrgencyLevel = 'act_now' | 'decide_today' | 'watch' | 'archive';
export type FeedbackType = 'gold' | 'good_wrong_timing' | 'wrong_brand' | 'trash';
export type ClientName = 'Stella' | 'HIT Kecoa' | 'NYU';

export interface Trend {
  id: string;
  hash: string;
  platform: string;
  title: string;
  url: string;
  author: string | null;
  author_tier: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  hashtags: string[];
  audio_id: string | null;
  audio_title: string | null;
  engagement_rate: number;
  velocity_score: number;
  replication_count: number;
  lifecycle_stage: LifecycleStage;
  momentum: number;
  trend_score: number;
  classification: Classification;
  urgency_level: UrgencyLevel;
  thumbnail_url: string | null;
  video_embed_url: string | null;
  scraped_at: string;
  created_at: string;
  updated_at: string;
}

export interface TrendAnalysis {
  id: string;
  trend_id: string | null;
  analysis_type: 'deep_analysis' | 'cross_trend_synthesis';
  summary: string | null;
  why_trending: string | null;
  key_insights: string[] | null;
  brand_relevance_notes: string | null;
  recommended_action: string | null;
  confidence: number;
  relevance_score: number;
  virality_score: number;
  brand_safety_score: number;
  replication_signal_score: number;
  trash_check: { passed: boolean; reasons: string[] } | null;
  model_version: string | null;
  analyzed_at: string;
  created_at: string;
}

export interface ClientBrandFit {
  id: string;
  trend_id: string;
  brand_name: ClientName;
  client_name: string;
  brand_category: string | null;
  fit_score: number;
  fit_reasoning: string | null;
  content_angle: string | null;
  entry_angle: string | null;
  content_ideas: string[];
  risk_level: string;
  urgency_level: string | null;
  hours_to_act: number | null;
  brand_entry_confidence: number;
  brief_generated: string | null;
  created_at: string;
}

export interface EngagementSnapshot {
  id: string;
  trend_id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  captured_at: string;
}

export interface TeamFeedback {
  id: string;
  trend_id: string;
  voted_by: string;
  vote: FeedbackType;
  note: string | null;
  client_name: string;
  feedback: string;
  notes: string;
  voted_at: string;
  created_at: string;
}

export interface SavedItem {
  id: string;
  trend_id: string;
  saved_at: string;
  collections: string[];
}

export interface Collection {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface ForYouResponse {
  high_potential: EnrichedTrend[];
  fun_to_replicate: EnrichedTrend[];
  rising_quietly: EnrichedTrend[];
  audio_going_viral: AudioMomentum[];
}

export interface EnrichedTrend extends Trend {
  analysis: TrendAnalysis | null;
  brand_fits: ClientBrandFit[];
  detected_formats: string[];
  reason: string;
}

export interface AudioMomentum {
  audio_id: string;
  audio_title: string;
  current_count: number;
  previous_count: number;
  growth_pct: number;
  status: 'rising' | 'stable' | 'declining';
  trend_ids?: string[];
}

export interface FormatDistribution {
  format: string;
  count: number;
  percentage: number;
  growth: number;
}
```

- [ ] **Step 6: Create `frontend/src/lib/supabase.ts`**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tnvnevydxobtmiackdkz.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRudm5ldnlkeG9idG1pYWNrZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNjg1OTUsImV4cCI6MjA4Nzk0NDU5NX0.6XY4asZBs7IFo8Y3r1iAhvF4_51UadEerglKa1ZVZcg';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: true, persistSession: true },
});
```

- [ ] **Step 7: Create `frontend/src/lib/api.ts`**

```typescript
const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('tw_token');
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function verifyPin(pin: string): Promise<string> {
  const { token } = await apiFetch<{ token: string }>('/auth/pin', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
  localStorage.setItem('tw_token', token);
  return token;
}

export async function verifySession(): Promise<boolean> {
  try {
    await apiFetch('/auth/verify');
    return true;
  } catch {
    localStorage.removeItem('tw_token');
    return false;
  }
}
```

- [ ] **Step 8: Create `frontend/src/stores/auth.ts`**

```typescript
import { create } from 'zustand';

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  setAuthenticated: (value: boolean) => void;
  setLoading: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  authenticated: false,
  loading: true,
  setAuthenticated: (value) => set({ authenticated: value }),
  setLoading: (value) => set({ loading: value }),
}));
```

- [ ] **Step 9: Create `frontend/src/stores/ui.ts`**

```typescript
import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  viewMode: 'grid' | 'list';
  detailPanelTrendId: string | null;
  detailPanelTrendIds: string[];
  toggleSidebar: () => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  openDetailPanel: (trendId: string, trendIds: string[]) => void;
  closeDetailPanel: () => void;
  navigateDetail: (direction: 'prev' | 'next') => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  viewMode: 'grid',
  detailPanelTrendId: null,
  detailPanelTrendIds: [],
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setViewMode: (mode) => set({ viewMode: mode }),
  openDetailPanel: (trendId, trendIds) => set({ detailPanelTrendId: trendId, detailPanelTrendIds: trendIds }),
  closeDetailPanel: () => set({ detailPanelTrendId: null, detailPanelTrendIds: [] }),
  navigateDetail: (direction) => {
    const { detailPanelTrendId, detailPanelTrendIds } = get();
    if (!detailPanelTrendId || detailPanelTrendIds.length === 0) return;
    const idx = detailPanelTrendIds.indexOf(detailPanelTrendId);
    if (idx === -1) return;
    const nextIdx = direction === 'next'
      ? Math.min(idx + 1, detailPanelTrendIds.length - 1)
      : Math.max(idx - 1, 0);
    set({ detailPanelTrendId: detailPanelTrendIds[nextIdx] });
  },
}));
```

- [ ] **Step 10: Create router + App + main entry**

Create `frontend/src/router.tsx`:

```typescript
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { PinEntry } from './pages/PinEntry';
import { Pulse } from './pages/Pulse';
import { Explore } from './pages/Explore';
import { ForYou } from './pages/ForYou';
import { Brand } from './pages/Brand';
import { Saved } from './pages/Saved';
import { Patterns } from './pages/Patterns';
import { Settings } from './pages/Settings';

export const router = createBrowserRouter([
  {
    path: '/pin',
    element: <PinEntry />,
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Pulse /> },
      { path: 'explore', element: <Explore /> },
      { path: 'for-you', element: <ForYou /> },
      { path: 'brand/:name', element: <Brand /> },
      { path: 'saved', element: <Saved /> },
      { path: 'patterns', element: <Patterns /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);
```

Update `frontend/src/App.tsx`:

```typescript
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
```

Update `frontend/src/main.tsx`:

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 11: Create placeholder pages**

Create each page file with a minimal export so the router compiles:

`frontend/src/pages/PinEntry.tsx` — PIN form (functional, not placeholder):

```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { verifyPin } from '../lib/api';
import { useAuthStore } from '../stores/auth';

export function PinEntry() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifyPin(pin);
      setAuthenticated(true);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid PIN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
      <form onSubmit={handleSubmit} className="w-full max-w-xs">
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Trend Watcher
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          Enter PIN to continue
        </p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          autoFocus
          className="w-full rounded-lg px-4 py-3 text-lg text-center tracking-widest outline-none"
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-input)',
            color: 'var(--text-primary)',
          }}
        />
        {error && (
          <p className="mt-3 text-sm text-center" style={{ color: 'var(--brand-hitkecoa)' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading || pin.length < 4}
          className="w-full mt-4 rounded-lg px-4 py-3 text-sm font-medium transition-opacity disabled:opacity-30"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
        >
          {loading ? 'Verifying...' : 'Enter'}
        </button>
      </form>
    </div>
  );
}
```

For all other pages, create minimal placeholders:

```typescript
// frontend/src/pages/Pulse.tsx (and similar for Explore, ForYou, Brand, Saved, Patterns, Settings)
export function Pulse() {
  return <div className="p-7"><h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Today's Pulse</h1><p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>Coming soon</p></div>;
}
```

Create these files: `Pulse.tsx`, `Explore.tsx`, `ForYou.tsx`, `Brand.tsx`, `Saved.tsx`, `Patterns.tsx`, `Settings.tsx`

- [ ] **Step 12: Create AppShell + Sidebar layout**

Create `frontend/src/components/layout/AppShell.tsx`:

```typescript
import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { verifySession } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';

export function AppShell() {
  const navigate = useNavigate();
  const { authenticated, loading, setAuthenticated, setLoading } = useAuthStore();

  useEffect(() => {
    verifySession().then((valid) => {
      setAuthenticated(valid);
      setLoading(false);
      if (!valid) navigate('/pin');
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    );
  }

  if (!authenticated) return null;

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg-page)' }}>
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
```

Create `frontend/src/components/layout/Sidebar.tsx`:

```typescript
import { NavLink, useLocation } from 'react-router-dom';
import { useUIStore } from '../../stores/ui';

const mainNav = [
  { to: '/', label: 'Today\'s Pulse' },
  { to: '/explore', label: 'Explore' },
  { to: '/for-you', label: 'For You' },
];

const brandNav = [
  { to: '/brand/Stella', label: 'Stella', color: 'var(--brand-stella)' },
  { to: '/brand/HIT Kecoa', label: 'HIT Kecoa', color: 'var(--brand-hitkecoa)' },
  { to: '/brand/NYU', label: 'NYU', color: 'var(--brand-nyu)' },
];

const libraryNav = [
  { to: '/saved', label: 'Saved' },
  { to: '/patterns', label: 'Patterns' },
];

function SidebarLink({ to, label, color }: { to: string; label: string; color?: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `block rounded-lg px-3 py-2 text-[13px] transition-colors ${
          isActive ? 'font-medium' : ''
        }`
      }
      style={({ isActive }) => ({
        background: isActive ? 'var(--bg-card)' : 'transparent',
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
      })}
    >
      <span className="flex items-center gap-2.5">
        {color && (
          <span
            className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0"
            style={{ background: color }}
          />
        )}
        {label}
      </span>
    </NavLink>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] uppercase tracking-wider font-medium px-3 mb-1.5"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </div>
  );
}

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);

  if (collapsed) return null;

  return (
    <aside
      className="w-[220px] flex-shrink-0 flex flex-col py-5 px-3 overflow-y-auto border-r"
      style={{ background: 'var(--bg-page)', borderColor: 'var(--border-divider)' }}
    >
      <div className="mb-7 px-3">
        <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          Trend Watcher
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          Epilog Creative
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 mb-5">
        {mainNav.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      <SectionLabel>Brands</SectionLabel>
      <nav className="flex flex-col gap-0.5 mb-5">
        {brandNav.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      <SectionLabel>Library</SectionLabel>
      <nav className="flex flex-col gap-0.5 mb-5">
        {libraryNav.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      <div className="mt-auto pt-3 border-t" style={{ borderColor: 'var(--border-divider)' }}>
        <SidebarLink to="/settings" label="Settings" />
      </div>
    </aside>
  );
}
```

Create `frontend/src/components/layout/MobileNav.tsx` as a placeholder:

```typescript
export function MobileNav() {
  return null; // TODO: implement bottom tab bar for mobile
}
```

- [ ] **Step 13: Clean up Vite defaults**

Remove `frontend/src/App.css`, `frontend/src/assets/react.svg`, and update `frontend/index.html` title to "Trend Watcher".

- [ ] **Step 14: Verify the app builds and runs**

```bash
cd /Users/abimangkuagent/EPILOG-TREND-ANALYZER/frontend
npm run build
npm run dev
```

Open `http://localhost:5173` — should show PIN entry page. Enter PIN → redirects to Pulse placeholder with sidebar.

- [ ] **Step 15: Commit**

```bash
cd /Users/abimangkuagent/EPILOG-TREND-ANALYZER
git add frontend/
git commit -m "feat: scaffold frontend — Vite + React + Tailwind + routing + sidebar + PIN auth"
```

---

## Chunk 3: Data Hooks + Shared Components

### Task 7: TanStack Query Data Hooks

**Files:**
- Create: `frontend/src/hooks/use-trends.ts`
- Create: `frontend/src/hooks/use-analysis.ts`
- Create: `frontend/src/hooks/use-brand-fit.ts`
- Create: `frontend/src/hooks/use-snapshots.ts`
- Create: `frontend/src/hooks/use-collections.ts`
- Create: `frontend/src/hooks/use-realtime.ts`
- Create: `frontend/src/hooks/use-keyboard.ts`

**Context:** Each hook wraps a Supabase query or Express API call with TanStack Query for caching and loading states. Realtime hook manages Supabase channel subscriptions.

- [ ] **Step 1: Create all data hooks**

Each hook follows the same pattern — TanStack Query `useQuery` wrapping a Supabase or API call. Create each file with the appropriate query. Key hooks:

`use-trends.ts`: `supabase.from('trends').select('*').order('scraped_at', { ascending: false })`
`use-analysis.ts`: `supabase.from('trend_analysis').select('*')` with filters for `analysis_type` and `trend_id`
`use-brand-fit.ts`: `supabase.from('client_brand_fit').select('*')` with optional brand/trend filters
`use-snapshots.ts`: `supabase.from('engagement_snapshots').select('*')` with date range
`use-collections.ts`: `apiFetch('/collections')` and `apiFetch('/saved')` — wraps Express API
`use-realtime.ts`: Supabase channel subscription manager with reconnection logic
`use-keyboard.ts`: Global keyboard shortcut handler with input element suppression

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/
git commit -m "feat: add TanStack Query data hooks for all data sources"
```

---

### Task 8: Shared Components

**Files:**
- Create: `frontend/src/components/shared/Badge.tsx`
- Create: `frontend/src/components/shared/BrandPill.tsx`
- Create: `frontend/src/components/shared/Toast.tsx`
- Create: `frontend/src/components/shared/Skeleton.tsx`
- Create: `frontend/src/lib/utils.ts`

**Context:** Small, reusable components used across all pages.

- [ ] **Step 1: Create `utils.ts`**

```typescript
import { type ClassValue, clsx } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

export function getBrandColor(brand: string): string {
  const colors: Record<string, string> = {
    Stella: 'var(--brand-stella)',
    'HIT Kecoa': 'var(--brand-hitkecoa)',
    NYU: 'var(--brand-nyu)',
  };
  return colors[brand] || 'var(--text-muted)';
}

export function getLifecycleColor(stage: string): string {
  const colors: Record<string, string> = {
    emerging: 'var(--lifecycle-emerging)',
    growing: 'var(--lifecycle-growing)',
    peaking: 'var(--lifecycle-peaking)',
    declining: 'var(--lifecycle-declining)',
    dead: 'var(--lifecycle-dead)',
  };
  return colors[stage] || 'var(--text-muted)';
}
```

Note: Install `clsx` — `cd frontend && npm install clsx`

- [ ] **Step 2: Create Badge, BrandPill, Skeleton, Toast components**

Each is a small styled component using CSS variables. Badge renders lifecycle/classification labels. BrandPill renders brand name with colored dot. Skeleton renders animated placeholder shapes. Toast is a minimal notification system using Zustand.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/shared/ frontend/src/lib/utils.ts
git commit -m "feat: add shared components — Badge, BrandPill, Skeleton, Toast"
```

---

### Task 9: Card Components

**Files:**
- Create: `frontend/src/components/cards/TrendCard.tsx` — Grid card for Explore
- Create: `frontend/src/components/cards/OpportunityCard.tsx` — Hero card for Pulse + Brand
- Create: `frontend/src/components/cards/RecommendationCard.tsx` — Horizontal card for For You
- Create: `frontend/src/components/cards/CompactRow.tsx` — List row for Brand + Saved

**Context:** All cards receive trend data as props. Click handler opens the detail panel via `useUIStore.openDetailPanel()`. Save button calls the saved API. Brand pills show fit scores inline.

- [ ] **Step 1: Create all card components**

Each card component follows the visual design from the spec mockups. TrendCard = vertical with thumbnail. RecommendationCard = horizontal with reasoning block. OpportunityCard = large hero with entry angle + content ideas. CompactRow = minimal row with thumbnail, title, score.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/cards/
git commit -m "feat: add card components — TrendCard, OpportunityCard, RecommendationCard, CompactRow"
```

---

### Task 10: Detail Panel

**Files:**
- Create: `frontend/src/components/detail/DetailPanel.tsx` — Main panel container with slide animation
- Create: `frontend/src/components/detail/VideoEmbed.tsx` — TikTok embed
- Create: `frontend/src/components/detail/MetricTiles.tsx` — 4-up metrics grid
- Create: `frontend/src/components/detail/BrandFitSection.tsx` — Per-brand fit cards
- Create: `frontend/src/components/detail/UserAssessment.tsx` — Vote buttons + notes

**Context:** Panel reads `detailPanelTrendId` from UIStore. Fetches trend + analysis + brand fit data. Framer Motion `AnimatePresence` for slide animation. Keyboard arrows for prev/next.

- [ ] **Step 1: Create DetailPanel with slide-over animation**

Uses `framer-motion` `motion.div` with `initial={{ x: '100%' }}` `animate={{ x: 0 }}` for slide-in. Overlay dims the background. Close on Escape key. Prev/next arrows cycle through `detailPanelTrendIds`.

- [ ] **Step 2: Create VideoEmbed**

Loads TikTok embed script, extracts video ID from URL with `/video\/(\d+)/` regex, renders embed container. Returns null if no video URL.

- [ ] **Step 3: Create MetricTiles, BrandFitSection, UserAssessment**

MetricTiles = 4-up grid showing trend_score, engagement_rate, velocity_score, replication_count. BrandFitSection = per-brand cards with fit_score, entry_angle, content_ideas, dimmed if score < 30. UserAssessment = vote buttons writing to `team_feedback` via Supabase.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/detail/
git commit -m "feat: add slide-over detail panel with TikTok embed and brand fit"
```

---

### Task 11: Filter Components

**Files:**
- Create: `frontend/src/components/filters/FilterBar.tsx`
- Create: `frontend/src/components/filters/FilterChips.tsx`
- Create: `frontend/src/components/filters/SearchInput.tsx`

**Context:** FilterBar renders dropdown buttons. FilterChips shows active filters as removable pills. SearchInput is a debounced text input for searching by title/author/hashtag. Filter state stored in Zustand or local component state.

- [ ] **Step 1: Create filter components**
- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/filters/
git commit -m "feat: add filter bar, chips, and search input components"
```

---

## Chunk 4: Pages

### Task 12: Today's Pulse Page

**Files:**
- Modify: `frontend/src/pages/Pulse.tsx` — Replace placeholder

**Context:** Fetches latest cross-trend synthesis for cultural snapshot. Fetches top 3 opportunities from brand fit + trends. Renders OpportunityCards, trending audio list, patterns summary. Subscribes to realtime for auto-refresh.

- [ ] **Step 1: Implement Pulse page with all 4 sections**
- [ ] **Step 2: Verify with dev server**
- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Pulse.tsx
git commit -m "feat: implement Today's Pulse page — cultural snapshot, opportunities, audio, patterns"
```

---

### Task 13: Explore Page

**Files:**
- Modify: `frontend/src/pages/Explore.tsx` — Replace placeholder

**Context:** Full browsable grid of all trends. Uses FilterBar + SearchInput. Grid/List toggle. Infinite scroll via TanStack Query `useInfiniteQuery`. Click opens DetailPanel. Shows all trends including "no brand match" ones.

- [ ] **Step 1: Implement Explore with grid view, filters, infinite scroll**
- [ ] **Step 2: Verify with dev server**
- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Explore.tsx
git commit -m "feat: implement Explore page — thumbnail grid, filters, infinite scroll"
```

---

### Task 14: For You Page

**Files:**
- Modify: `frontend/src/pages/ForYou.tsx` — Replace placeholder

**Context:** Calls `GET /api/for-you`. Renders 4 sections with RecommendationCards. Brand dropdown filter. Each card shows reasoning block.

- [ ] **Step 1: Implement For You with all 4 sections**
- [ ] **Step 2: Verify with dev server**
- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ForYou.tsx
git commit -m "feat: implement For You page — high potential, fun to replicate, rising, audio"
```

---

### Task 15: Brand Page

**Files:**
- Modify: `frontend/src/pages/Brand.tsx` — Replace placeholder

**Context:** Parameterized by `:name`. Fetches brand fits for this brand + cross-trend synthesis for landscape summary. Hero OpportunityCard for best fit. CompactRows for remaining. Click opens DetailPanel.

- [ ] **Step 1: Implement Brand page with header, hero card, opportunity list**
- [ ] **Step 2: Verify all 3 brands render correctly**
- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Brand.tsx
git commit -m "feat: implement Brand page — per-brand content hub with opportunities"
```

---

### Task 16: Saved Page

**Files:**
- Modify: `frontend/src/pages/Saved.tsx` — Replace placeholder

**Context:** Calls Express API for collections and saved items. Tab bar for collection switching. Collection cards with thumbnail grid previews. Create/rename/delete collections. Add/remove items from collections.

- [ ] **Step 1: Implement Saved page with collections and bookmarks**
- [ ] **Step 2: Verify CRUD operations work**
- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Saved.tsx
git commit -m "feat: implement Saved page — collections, bookmarks, mood boards"
```

---

### Task 17: Patterns Page

**Files:**
- Modify: `frontend/src/pages/Patterns.tsx` — Replace placeholder
- Create: `frontend/src/components/patterns/FormatChart.tsx`
- Create: `frontend/src/components/patterns/EngagementChart.tsx`
- Create: `frontend/src/components/patterns/CulturalCalendar.tsx`
- Create: `frontend/src/components/patterns/AudioMomentum.tsx`

**Context:** Chart-heavy page using Recharts. Calls Express API for format and audio data. Engagement chart from Supabase engagement_snapshots. Cultural calendar is hardcoded timeline with "now" marker. Time range toggle (14d/30d/all).

- [ ] **Step 1: Create Recharts chart components**
- [ ] **Step 2: Implement Patterns page composing all 4 charts**
- [ ] **Step 3: Verify charts render with real data**
- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Patterns.tsx frontend/src/components/patterns/
git commit -m "feat: implement Patterns page — format distribution, engagement, calendar, audio"
```

---

### Task 18: Settings Page

**Files:**
- Modify: `frontend/src/pages/Settings.tsx` — Replace placeholder

**Context:** Pipeline status (from `/health` endpoint + Supabase counts). Manual trigger buttons (POST /scrape). Recent feedback log from Supabase. PIN change form (future — placeholder for now).

- [ ] **Step 1: Implement Settings page with pipeline status and manual triggers**
- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Settings.tsx
git commit -m "feat: implement Settings page — pipeline status, manual triggers, feedback log"
```

---

## Chunk 5: Polish + Mobile + Deploy

### Task 19: Keyboard Shortcuts

**Files:**
- Modify: `frontend/src/hooks/use-keyboard.ts` — Full implementation
- Modify: `frontend/src/components/layout/AppShell.tsx` — Mount keyboard hook

**Context:** Global shortcuts (G, E, F, S, P for navigation, arrows for panel, Esc to close, / for search, B for bookmark). Suppressed when input/textarea focused.

- [ ] **Step 1: Implement keyboard hook with input suppression**
- [ ] **Step 2: Mount in AppShell**
- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-keyboard.ts frontend/src/components/layout/AppShell.tsx
git commit -m "feat: add global keyboard shortcuts with input suppression"
```

---

### Task 20: Mobile Bottom Navigation

**Files:**
- Modify: `frontend/src/components/layout/MobileNav.tsx` — Replace placeholder
- Modify: `frontend/src/components/layout/AppShell.tsx` — Conditionally show MobileNav

**Context:** 5-tab bottom bar (Pulse, Explore, For You, Brands, More). "More" opens a Radix Dialog sheet with Saved, Patterns, Settings. Shown on screens < 768px via media query.

- [ ] **Step 1: Implement MobileNav with bottom tabs + More sheet**
- [ ] **Step 2: Add responsive visibility in AppShell**
- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/
git commit -m "feat: add mobile bottom navigation with More sheet"
```

---

### Task 21: Loading States + Empty States

**Files:**
- Modify: All page files — Add skeleton loading and empty state messages

**Context:** Each page shows Skeleton components while `isLoading` is true. Each page shows appropriate empty state message when data is empty (per spec). Error states show inline message with retry button.

- [ ] **Step 1: Add loading/empty/error states to all pages**
- [ ] **Step 2: Verify each empty state message matches spec**
- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ frontend/src/components/shared/Skeleton.tsx
git commit -m "feat: add loading skeletons, empty states, and error handling to all pages"
```

---

### Task 22: Build + Deploy

**Files:**
- Modify: `frontend/package.json` — Verify build script

- [ ] **Step 1: Build production bundle**

```bash
cd /Users/abimangkuagent/EPILOG-TREND-ANALYZER/frontend
npm run build
```

- [ ] **Step 2: Test production serving**

```bash
cd /Users/abimangkuagent/EPILOG-TREND-ANALYZER
node src/server.js
```

Open `http://localhost:3001` — should serve the built frontend. Verify PIN entry → Pulse → Explore → detail panel all work.

- [ ] **Step 3: Add `.superpowers/` to `.gitignore`**

```bash
echo ".superpowers/" >> .gitignore
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: production build and deployment configuration"
```

---

## Dependency Graph

```
Task 1 (DB migrations) ─────────────────────────────────────┐
Task 2 (Auth API) ──────────────────────────────────────────┤
Task 3 (Saved/Collections API) ─── depends on Task 1, 2 ───┤
Task 4 (Patterns/ForYou API) ─── depends on Task 2 ────────┤
Task 5 (Static serving) ───────────────────────────────────┤
                                                            │
Task 6 (Frontend scaffold) ─── independent ─────────────────┤
                                                            │
Task 7 (Data hooks) ─── depends on Task 6 ─────────────────┤
Task 8 (Shared components) ─── depends on Task 6 ──────────┤
Task 9 (Card components) ─── depends on Task 7, 8 ─────────┤
Task 10 (Detail panel) ─── depends on Task 7, 8 ───────────┤
Task 11 (Filter components) ─── depends on Task 8 ─────────┤
                                                            │
Task 12 (Pulse) ─── depends on Task 7, 9 ──────────────────┤
Task 13 (Explore) ─── depends on Task 9, 10, 11 ───────────┤
Task 14 (For You) ─── depends on Task 4, 9 ────────────────┤
Task 15 (Brand) ─── depends on Task 9, 10 ─────────────────┤
Task 16 (Saved) ─── depends on Task 3, 7, 9 ───────────────┤
Task 17 (Patterns) ─── depends on Task 4, 7 ───────────────┤
Task 18 (Settings) ─── depends on Task 7 ──────────────────┤
                                                            │
Task 19 (Keyboard) ─── depends on Task 10 ─────────────────┤
Task 20 (Mobile nav) ─── depends on Task 6 ────────────────┤
Task 21 (Loading/empty) ─── depends on Tasks 12-18 ────────┤
Task 22 (Build/deploy) ─── depends on all ─────────────────┘
```

**Parallelizable groups:**
- Tasks 1-5 (backend) can all run in parallel (except Task 3 needs Task 1)
- Task 6 (scaffold) is independent of backend tasks
- Tasks 7, 8, 11 can run in parallel after Task 6
- Tasks 9, 10 can run in parallel after Tasks 7, 8
- Tasks 12-18 (pages) can mostly run in parallel after their component dependencies
- Tasks 19-21 (polish) after pages
- Task 22 (deploy) last
