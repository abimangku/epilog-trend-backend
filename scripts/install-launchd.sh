#!/bin/bash
# Install Trend Watcher launchd services for auto-start and crash recovery.
# Usage: bash scripts/install-launchd.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_DIR="$PROJECT_DIR/launchd"

echo "=== Trend Watcher — launchd Install ==="
echo "Project: $PROJECT_DIR"
echo ""

# Ensure logs directory exists
mkdir -p "$PROJECT_DIR/logs"

# Ensure LaunchAgents directory exists
mkdir -p "$LAUNCH_AGENTS"

# Copy plist files
echo "Copying plist files to $LAUNCH_AGENTS..."
cp "$PLIST_DIR/com.epilog.trendwatcher.plist" "$LAUNCH_AGENTS/"
cp "$PLIST_DIR/com.epilog.cloudflare.plist" "$LAUNCH_AGENTS/"

# Load services
echo "Loading services..."
launchctl load "$LAUNCH_AGENTS/com.epilog.trendwatcher.plist" 2>/dev/null || \
  echo "  trendwatcher: already loaded (unload first to reload)"
launchctl load "$LAUNCH_AGENTS/com.epilog.cloudflare.plist" 2>/dev/null || \
  echo "  cloudflare: already loaded (unload first to reload)"

echo ""

# Verify
echo "Verifying..."
launchctl list | grep epilog || echo "  WARNING: No epilog services found in launchctl"

echo ""
echo "Done! Services will auto-start on login and restart on crash."
echo "Check status: bash scripts/status.sh"
