# Phase 3: Observability & Control — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the team real-time visibility into backend health, pipeline status, and alert history from the frontend — no SSH required. Add structured logging, enhanced health checks, and a manual trigger button.

**Architecture:** Frontend reads from `pipeline_runs` and `pipeline_events` tables (created in Phase 2) via Supabase Realtime. Backend logger upgraded to structured JSON with file rotation. Health endpoint enriched with diagnostics. Schedule config moved to DB for UI control.

**Tech Stack:** Node.js (CommonJS), Supabase Realtime, React 18, @tanstack/react-query, Vite

**Spec:** `docs/superpowers/specs/2026-03-14-enterprise-hardening-design.md` — Phase 3 sections 3.1–3.6

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/logger.js` | Modify | Structured JSON output, file rotation, backward-compatible API, runId correlation |
| `src/server.js` | Modify | Enhanced /health endpoint, mount schedule routes |
| `src/api/schedules.js` | Create | CRUD endpoints for schedule_config |
| `src/database/supabase.js` | Modify | Add `acknowledgePipelineEvents`, `getScheduleConfig`, `updateScheduleConfig` |
| `frontend/src/pages/SystemStatus.tsx` | Create | Pipeline status dashboard page |
| `frontend/src/hooks/use-pipeline-status.ts` | Create | Query + realtime for pipeline_runs |
| `frontend/src/hooks/use-pipeline-events.ts` | Create | Query + realtime for pipeline_events |
| `frontend/src/hooks/use-schedules.ts` | Create | Query schedule_config |
| `frontend/src/components/layout/Sidebar.tsx` | Modify | Add System Status nav + alert badge |
| `frontend/src/router.tsx` | Modify | Add /system route |

---

## Chunk 1: Structured Logging

### Task 1: Upgrade Logger to Structured JSON

**Files:**
- Modify: `src/logger.js`

- [ ] **Step 1: Rewrite logger with structured output and file rotation**

Rewrite `src/logger.js` preserving the existing backward-compatible API (`log(mod, msg, data)`, `error(mod, msg, err)`, `warn(mod, msg, data)`) but outputting structured JSON in production and human-readable colored output in dev.

```javascript
const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const MAX_LOG_AGE_DAYS = 7;

// Ensure logs/ directory exists
let logsReady = fs.promises.mkdir(LOGS_DIR, { recursive: true }).catch(() => {});

// Correlation ID for pipeline runs
let currentRunId = null;

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

/**
 * Returns today's log file path: logs/app-YYYY-MM-DD.log
 * @returns {string}
 */
function getLogFilePath() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(LOGS_DIR, `app-${date}.log`);
}

/**
 * Builds a structured log entry.
 * @param {string} level - info, error, warn
 * @param {string} mod - Module name
 * @param {string} message
 * @param {*} [extra]
 * @returns {object}
 */
function buildEntry(level, mod, message, extra) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    module: mod,
    message,
  };

  if (currentRunId) {
    entry.runId = currentRunId;
  }

  if (extra !== null && extra !== undefined) {
    if (extra instanceof Error) {
      entry.error = { message: extra.message, stack: extra.stack };
    } else if (typeof extra === 'object') {
      entry.data = extra;
    } else {
      entry.data = extra;
    }
  }

  return entry;
}

/**
 * Formats a human-readable line for dev console.
 * @param {object} entry
 * @returns {string}
 */
function formatDev(entry) {
  const ts = entry.timestamp.replace('T', ' ').slice(0, 19);
  let line = `[${ts}] [${entry.module}] ${entry.message}`;
  if (entry.error) {
    line += ` | ${entry.error.message}`;
    if (entry.error.stack) line += `\n${entry.error.stack}`;
  } else if (entry.data !== undefined) {
    line += ` | ${typeof entry.data === 'object' ? JSON.stringify(entry.data) : entry.data}`;
  }
  return line;
}

/**
 * Appends a structured JSON line to today's log file.
 * @param {object} entry
 */
async function appendToFile(entry) {
  try {
    await logsReady;
    await fs.promises.appendFile(getLogFilePath(), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(`[LOGGER] Failed to write to log file: ${err.message}\n`);
  }
}

/**
 * Deletes log files older than MAX_LOG_AGE_DAYS.
 */
async function rotateLogs() {
  try {
    await logsReady;
    const files = await fs.promises.readdir(LOGS_DIR);
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith('app-') || !file.endsWith('.log')) continue;
      const dateStr = file.replace('app-', '').replace('.log', '');
      const fileDate = new Date(dateStr);
      if (isNaN(fileDate.getTime())) continue;
      if (fileDate.getTime() < cutoff) {
        await fs.promises.unlink(path.join(LOGS_DIR, file));
      }
    }
  } catch {
    // Non-critical — skip silently
  }
}

// Rotate on startup and daily
rotateLogs();
setInterval(rotateLogs, 24 * 60 * 60 * 1000).unref();

/**
 * Sets the pipeline run correlation ID. All subsequent log entries
 * include this ID until cleared.
 * @param {string|null} runId
 */
function setRunId(runId) {
  currentRunId = runId;
}

/**
 * Log an informational message.
 * @param {string} mod - Module identifier
 * @param {string} message - Human-readable message
 * @param {*} [data=null] - Optional data payload
 */
function log(mod, message, data = null) {
  const entry = buildEntry('info', mod, message, data);
  if (process.env.NODE_ENV === 'production') {
    appendToFile(entry);
  } else {
    process.stdout.write(`${COLORS.green}${formatDev(entry)}${COLORS.reset}\n`);
  }
}

/**
 * Log an error.
 * @param {string} mod - Module identifier
 * @param {string} message - Human-readable message
 * @param {Error|*} [err=null] - Error object or extra data
 */
function error(mod, message, err = null) {
  const entry = buildEntry('error', mod, message, err);
  if (process.env.NODE_ENV === 'production') {
    appendToFile(entry);
  } else {
    process.stderr.write(`${COLORS.red}${formatDev(entry)}${COLORS.reset}\n`);
  }
}

/**
 * Log a warning.
 * @param {string} mod - Module identifier
 * @param {string} message - Human-readable message
 * @param {*} [data=null] - Optional data payload
 */
function warn(mod, message, data = null) {
  const entry = buildEntry('warn', mod, message, data);
  if (process.env.NODE_ENV === 'production') {
    appendToFile(entry);
  } else {
    process.stderr.write(`${COLORS.yellow}${formatDev(entry)}${COLORS.reset}\n`);
  }
}

module.exports = { log, error, warn, setRunId };
```

Key changes:
- Production: writes one JSON object per line to `logs/app-YYYY-MM-DD.log` (daily rotation)
- Dev: unchanged colored human-readable output
- `setRunId(id)` for pipeline correlation
- `rotateLogs()` deletes files older than 7 days
- Backward-compatible: `log(mod, msg, data)`, `error(mod, msg, err)`, `warn(mod, msg, data)` signatures unchanged

- [ ] **Step 2: Add setRunId call in pipeline.js**

In `src/pipeline.js`, after `const runId = await createPipelineRun();`, add:
```javascript
  logger.setRunId(runId);
```

At the end of `runPipeline()` (in the finally-equivalent spot before `return stats`), add:
```javascript
  logger.setRunId(null);
```

Also add `logger.setRunId(null)` in the catch block after the `createPipelineEvent` call.

- [ ] **Step 3: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/logger.js src/pipeline.js
git commit -m "feat: structured JSON logging with daily rotation and run correlation"
```

---

## Chunk 2: Enhanced Health Endpoint

### Task 2: Enhance /health with Diagnostics

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Read current server.js**

Read `src/server.js` to see the current /health handler.

- [ ] **Step 2: Enhance /health endpoint**

Replace the existing `/health` handler with an enhanced version that returns:

```javascript
app.get('/health', async (req, res) => {
  const supabaseOk = await testConnection();

  // Get trends count
  let trendsCount = 0;
  try {
    const { count } = await supabase
      .from('trends')
      .select('*', { count: 'exact', head: true });
    trendsCount = count || 0;
  } catch {
    // Non-critical
  }

  // Get last pipeline run
  let lastPipelineRun = null;
  try {
    const { data } = await supabase
      .from('pipeline_runs')
      .select('started_at, completed_at, status, videos_scraped, videos_analyzed')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastPipelineRun = data;
  } catch {
    // Non-critical
  }

  // Determine health status
  const lastRunAge = lastPipelineRun?.completed_at
    ? (Date.now() - new Date(lastPipelineRun.completed_at).getTime()) / 1000
    : null;

  let status = 'healthy';
  if (!supabaseOk) status = 'unhealthy';
  else if (!lastPipelineRun || lastRunAge > 6 * 3600) status = 'degraded';
  else if (lastPipelineRun.status === 'failed') status = 'degraded';

  const statusCode = status === 'unhealthy' ? 503 : 200;
  const mem = process.memoryUsage();

  res.status(statusCode).json({
    status,
    supabase: supabaseOk,
    lastPipelineRun: lastPipelineRun ? {
      startedAt: lastPipelineRun.started_at,
      completedAt: lastPipelineRun.completed_at,
      status: lastPipelineRun.status,
      videosScraped: lastPipelineRun.videos_scraped,
      videosAnalyzed: lastPipelineRun.videos_analyzed,
    } : null,
    pipelineRunning,
    trendsCount,
    uptime: Math.round(process.uptime()),
    memory_mb: Math.round(mem.heapUsed / 1024 / 1024),
    version: '1.1.0',
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx jest --verbose`

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat: enhance /health with pipeline run info, memory usage, and 3-tier status"
```

---

## Chunk 3: Schedule Config DB + API

### Task 3: Create schedule_config Table

**Files:**
- Supabase SQL migration (via MCP)

- [ ] **Step 1: Create schedule_config table**

```sql
CREATE TABLE IF NOT EXISTS schedule_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  cron_expression text NOT NULL,
  enabled boolean DEFAULT true,
  ai_analysis_enabled boolean DEFAULT true,
  interval_minutes int DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Seed with current schedule windows**

```sql
INSERT INTO schedule_config (label, cron_expression, enabled, ai_analysis_enabled, interval_minutes) VALUES
  ('Morning', '0 5 * * *', true, true, 60),
  ('Work', '0 8 * * *', true, false, 90),
  ('Lunch', '0 11 * * *', true, true, 45),
  ('Afternoon', '0 14 * * *', true, false, 60),
  ('Primetime', '0 18 * * *', true, true, 60),
  ('Late Night', '0 22 * * *', true, true, 90);
```

---

### Task 4: Schedule API + DB Functions

**Files:**
- Create: `src/api/schedules.js`
- Modify: `src/database/supabase.js`
- Modify: `src/server.js`

- [ ] **Step 1: Add DB functions for schedule_config**

In `src/database/supabase.js`, add:

```javascript
/**
 * Gets all schedule config rows, ordered by label.
 * @returns {Promise<object[]>}
 */
async function getScheduleConfig() {
  const { data, error } = await supabase
    .from('schedule_config')
    .select('*')
    .order('label');

  if (error) {
    logger.error(MOD, 'Failed to get schedule config', error);
    return [];
  }
  return data || [];
}

/**
 * Updates a single schedule config row.
 * @param {string} id - Row UUID
 * @param {object} update - Fields to update
 */
async function updateScheduleConfig(id, update) {
  const { error } = await supabase
    .from('schedule_config')
    .update(update)
    .eq('id', id);

  if (error) {
    logger.error(MOD, `Failed to update schedule config ${id}`, error);
    throw error;
  }
}

/**
 * Marks pipeline events as acknowledged.
 * @param {string[]} [eventIds] - Specific event IDs, or null to acknowledge all unacknowledged
 */
async function acknowledgePipelineEvents(eventIds) {
  let query = supabase
    .from('pipeline_events')
    .update({ acknowledged: true });

  if (eventIds && eventIds.length > 0) {
    query = query.in('id', eventIds);
  } else {
    query = query.eq('acknowledged', false);
  }

  const { error } = await query;
  if (error) {
    logger.error(MOD, 'Failed to acknowledge pipeline events', error);
  }
}
```

Export all three.

- [ ] **Step 2: Create schedule API routes**

Create `src/api/schedules.js`:

```javascript
const express = require('express');
const logger = require('../logger');
const { getScheduleConfig, updateScheduleConfig } = require('../database/supabase');

const MOD = 'API_SCHEDULES';
const router = express.Router();

/**
 * GET /api/schedules — List all schedule configs
 */
router.get('/', async (req, res) => {
  try {
    const schedules = await getScheduleConfig();
    res.json(schedules);
  } catch (err) {
    logger.error(MOD, 'Failed to list schedules', err);
    res.status(500).json({ error: 'Failed to load schedules' });
  }
});

/**
 * PATCH /api/schedules/:id — Update a schedule config
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled, ai_analysis_enabled, interval_minutes } = req.body;

    const update = {};
    if (typeof enabled === 'boolean') update.enabled = enabled;
    if (typeof ai_analysis_enabled === 'boolean') update.ai_analysis_enabled = ai_analysis_enabled;
    if (typeof interval_minutes === 'number' && interval_minutes > 0 && interval_minutes <= 180) {
      update.interval_minutes = interval_minutes;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await updateScheduleConfig(id, update);
    res.json({ ok: true });
  } catch (err) {
    logger.error(MOD, 'Failed to update schedule', err);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

module.exports = router;
```

- [ ] **Step 3: Mount schedule routes in server.js**

After the existing `/api/for-you` mount, add:
```javascript
const schedulesRouter = require('./api/schedules');
app.use('/api/schedules', schedulesRouter);
```

Also add event acknowledgment endpoint:
```javascript
const { acknowledgePipelineEvents } = require('./database/supabase');

app.post('/api/events/acknowledge', async (req, res) => {
  try {
    await acknowledgePipelineEvents(req.body.eventIds || null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to acknowledge events' });
  }
});
```

- [ ] **Step 4: Run tests**

Run: `npx jest --verbose`

- [ ] **Step 5: Commit**

```bash
git add src/api/schedules.js src/database/supabase.js src/server.js
git commit -m "feat: add schedule config API and event acknowledgment endpoint"
```

---

## Chunk 4: Frontend — Pipeline Status Hooks

### Task 5: Create Pipeline Status & Events Hooks

**Files:**
- Create: `frontend/src/hooks/use-pipeline-status.ts`
- Create: `frontend/src/hooks/use-pipeline-events.ts`
- Create: `frontend/src/hooks/use-schedules.ts`

- [ ] **Step 1: Create use-pipeline-status hook**

```typescript
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface PipelineRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'success' | 'partial' | 'failed';
  videos_scraped: number;
  videos_passed_gate: number;
  videos_analyzed: number;
  videos_failed: number;
  errors: Array<{ stage: string; message?: string; error?: string }>;
  created_at: string;
}

export function usePipelineRuns(limit = 10) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery({
    queryKey: ['pipeline-runs', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []) as PipelineRun[];
    },
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('pipeline-runs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_runs' }, () => {
        queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [queryClient]);

  return query;
}

export function useLatestRun() {
  return useQuery({
    queryKey: ['pipeline-runs', 'latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as PipelineRun | null;
    },
    refetchInterval: 30000, // poll every 30s
  });
}

export type { PipelineRun };
```

- [ ] **Step 2: Create use-pipeline-events hook**

```typescript
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface PipelineEvent {
  id: string;
  run_id: string | null;
  stage: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data: Record<string, unknown>;
  acknowledged: boolean;
  created_at: string;
}

export function usePipelineEvents(runId?: string | null, limit = 50) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery({
    queryKey: ['pipeline-events', runId, limit],
    queryFn: async () => {
      let q = supabase
        .from('pipeline_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (runId) {
        q = q.eq('run_id', runId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PipelineEvent[];
    },
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('pipeline-events-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pipeline_events' }, () => {
        queryClient.invalidateQueries({ queryKey: ['pipeline-events'] });
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [queryClient]);

  return query;
}

export function useUnacknowledgedCriticalCount() {
  return useQuery({
    queryKey: ['pipeline-events', 'unacknowledged-critical'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('pipeline_events')
        .select('*', { count: 'exact', head: true })
        .eq('severity', 'critical')
        .eq('acknowledged', false);

      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 60000, // poll every minute
  });
}

export type { PipelineEvent };
```

- [ ] **Step 3: Create use-schedules hook**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface ScheduleConfig {
  id: string;
  label: string;
  cron_expression: string;
  enabled: boolean;
  ai_analysis_enabled: boolean;
  interval_minutes: number;
  created_at: string;
}

export function useSchedules() {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_config')
        .select('*')
        .order('label');

      if (error) throw error;
      return (data || []) as ScheduleConfig[];
    },
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, update }: { id: string; update: Partial<ScheduleConfig> }) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error('Failed to update schedule');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export type { ScheduleConfig };
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/use-pipeline-status.ts frontend/src/hooks/use-pipeline-events.ts frontend/src/hooks/use-schedules.ts
git commit -m "feat: add pipeline status, events, and schedule hooks with realtime"
```

---

## Chunk 5: Frontend — System Status Page

### Task 6: Create System Status Page

**Files:**
- Create: `frontend/src/pages/SystemStatus.tsx`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Create SystemStatus page**

Create `frontend/src/pages/SystemStatus.tsx`. The page should have these sections:

1. **Status Header** — Current pipeline status (running/idle), last run time + result, trends count
2. **Run Now Button** — Calls `/trigger/scrape` with auth, shows spinner while running, disabled during run
3. **Recent Runs** — Table/list of last 10 pipeline runs from `usePipelineRuns()`
4. **Activity Feed** — Recent pipeline events from `usePipelineEvents()`, color-coded by severity
5. **Schedule Config** — List of schedule windows with enable/disable toggles from `useSchedules()`

Use existing CSS custom properties (`var(--bg-card)`, `var(--text-primary)`, etc.) to match the app's dark theme.

The page component should:
- Use `usePipelineRuns()` for run history
- Use `usePipelineEvents(null, 30)` for recent events (all runs)
- Use `useSchedules()` and `useUpdateSchedule()` for schedule management
- Use `useLatestRun()` for the header status
- Call `POST /trigger/scrape` via fetch with JWT auth header for Run Now
- Acknowledge events when the page loads (mark critical events as seen)

Detailed implementation is left to the implementer — use the hooks, design a clean dashboard that fits the existing app aesthetic.

- [ ] **Step 2: Add route in router.tsx**

Add to the imports:
```typescript
import { SystemStatus } from './pages/SystemStatus';
```

Add route in the children array:
```typescript
{ path: 'system', element: <ErrorBoundary><SystemStatus /></ErrorBoundary> },
```

- [ ] **Step 3: Verify TypeScript + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SystemStatus.tsx frontend/src/router.tsx
git commit -m "feat: add System Status dashboard page with run history, events, and schedules"
```

---

## Chunk 6: Sidebar Alert Badge + Navigation

### Task 7: Add System Status to Sidebar with Alert Badge

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Read current Sidebar.tsx**

- [ ] **Step 2: Add System Status link with critical event badge**

Import the unacknowledged critical count hook:
```typescript
import { useUnacknowledgedCriticalCount } from '../../hooks/use-pipeline-events';
import { useLatestRun } from '../../hooks/use-pipeline-status';
```

Add a new "System" section at the bottom of the sidebar (before Settings). Include:

1. A nav link to `/system` labeled "System Status"
2. A small dot/badge that shows when there are unacknowledged critical events (count > 0)
3. A colored status dot (green/yellow/red) based on latest run status:
   - Green: latest run exists, completed <2h ago, status is 'success'
   - Yellow: latest run >2h ago or status is 'partial'
   - Red: latest run is 'failed' or >6h since last run

The badge should be a small red circle with count, positioned next to the "System Status" text.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "feat: add System Status nav link with alert badge and health indicator"
```

---

## Chunk 7: Final Verification

### Task 8: Run All Tests + Build

- [ ] **Step 1: Run all backend tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Verify all changes committed**

Run: `git status` and `git diff --stat`
Everything should be clean.

- [ ] **Step 4: Final commit if any cleanup needed**
