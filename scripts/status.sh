#!/bin/bash
# Show Trend Watcher service status.
# Usage: bash scripts/status.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Trend Watcher — Status ==="
echo ""

# -----------------------------------------------------------------------
# launchd service status
# -----------------------------------------------------------------------
echo "--- launchd Services ---"
if launchctl list 2>/dev/null | grep -q "com.epilog.trendwatcher"; then
  echo "  trendwatcher: LOADED"
  launchctl list com.epilog.trendwatcher 2>/dev/null | grep -E "PID|LastExitStatus" || true
else
  echo "  trendwatcher: NOT LOADED"
fi

if launchctl list 2>/dev/null | grep -q "com.epilog.cloudflare"; then
  echo "  cloudflare:   LOADED"
  launchctl list com.epilog.cloudflare 2>/dev/null | grep -E "PID|LastExitStatus" || true
else
  echo "  cloudflare:   NOT LOADED"
fi

echo ""

# -----------------------------------------------------------------------
# Health check
# -----------------------------------------------------------------------
echo "--- Health Check ---"
HEALTH=$(curl -s -m 5 http://localhost:3001/health 2>/dev/null) || HEALTH=""

if [ -z "$HEALTH" ]; then
  echo "  Server: NOT RESPONDING (localhost:3001)"
else
  # Pretty-print if python3 available, otherwise raw
  if command -v python3 &>/dev/null; then
    echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "  $HEALTH"
  else
    echo "  $HEALTH"
  fi
fi

echo ""

# -----------------------------------------------------------------------
# Pipeline status
# -----------------------------------------------------------------------
echo "--- Pipeline Status ---"
PIPELINE=$(curl -s -m 5 http://localhost:3001/status/pipeline 2>/dev/null) || PIPELINE=""

if [ -z "$PIPELINE" ]; then
  echo "  Pipeline endpoint: NOT RESPONDING"
else
  if command -v python3 &>/dev/null; then
    echo "$PIPELINE" | python3 -m json.tool 2>/dev/null || echo "  $PIPELINE"
  else
    echo "  $PIPELINE"
  fi
fi

echo ""

# -----------------------------------------------------------------------
# Recent logs
# -----------------------------------------------------------------------
echo "--- Last 20 Lines of App Log ---"
LOG_FILE="$PROJECT_DIR/logs/app.log"

if [ -f "$LOG_FILE" ]; then
  tail -20 "$LOG_FILE"
else
  echo "  No log file found at $LOG_FILE"
fi

echo ""
echo "=== End Status ==="
