-- Phase A: Backend Reliability Migrations
-- Run date: 2026-03-14

-- Cost tracking on pipeline_runs
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(8,4) DEFAULT 0;

-- Detected formats on trends
ALTER TABLE trends
  ADD COLUMN IF NOT EXISTS detected_formats TEXT[] DEFAULT '{}';
