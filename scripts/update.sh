#!/bin/bash
# Pull latest code, install deps, and restart Trend Watcher.
# Usage: bash scripts/update.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Trend Watcher — Update ==="
echo "Project: $PROJECT_DIR"
echo ""

# -----------------------------------------------------------------------
# Step 1 — Pull latest code
# -----------------------------------------------------------------------
echo "--- Step 1: git pull ---"
cd "$PROJECT_DIR"
git pull || { echo "ERROR: git pull failed"; exit 1; }

echo ""

# -----------------------------------------------------------------------
# Step 2 — Install / update dependencies
# -----------------------------------------------------------------------
echo "--- Step 2: npm install ---"
npm install --production || { echo "ERROR: npm install failed"; exit 1; }

echo ""

# -----------------------------------------------------------------------
# Step 3 — Restart trendwatcher service via launchctl
# -----------------------------------------------------------------------
echo "--- Step 3: Restart trendwatcher ---"
UID_NUM=$(id -u)

# kickstart -k kills the existing process and starts a fresh one
launchctl kickstart -k "gui/${UID_NUM}/com.epilog.trendwatcher" 2>/dev/null || \
  echo "  WARNING: kickstart failed — service may not be loaded (run install-launchd.sh first)"

echo ""

# -----------------------------------------------------------------------
# Step 4 — Wait and verify
# -----------------------------------------------------------------------
echo "--- Step 4: Health check (waiting 3s for startup) ---"
sleep 3

HEALTH=$(curl -s -m 5 http://localhost:3001/health 2>/dev/null) || HEALTH=""

if [ -z "$HEALTH" ]; then
  echo "  WARNING: Server not responding on localhost:3001"
  echo "  Check logs: tail -f $PROJECT_DIR/logs/stderr.log"
else
  if command -v python3 &>/dev/null; then
    echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "  $HEALTH"
  else
    echo "  $HEALTH"
  fi
fi

echo ""
echo "=== Update complete ==="
