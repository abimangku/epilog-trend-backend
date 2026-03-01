#!/bin/bash
# Uninstall Trend Watcher launchd services.
# Usage: bash scripts/uninstall-launchd.sh

set -euo pipefail

LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

echo "=== Trend Watcher — launchd Uninstall ==="
echo ""

# Unload services (ignore errors if not loaded)
echo "Unloading services..."
launchctl unload "$LAUNCH_AGENTS/com.epilog.trendwatcher.plist" 2>/dev/null || \
  echo "  trendwatcher: not loaded"
launchctl unload "$LAUNCH_AGENTS/com.epilog.cloudflare.plist" 2>/dev/null || \
  echo "  cloudflare: not loaded"

# Remove plist files
echo "Removing plist files..."
rm -f "$LAUNCH_AGENTS/com.epilog.trendwatcher.plist"
rm -f "$LAUNCH_AGENTS/com.epilog.cloudflare.plist"

echo ""

# Verify removal
echo "Verifying..."
if launchctl list 2>/dev/null | grep -q epilog; then
  echo "  WARNING: Some epilog services still appear in launchctl"
  launchctl list | grep epilog
else
  echo "  All epilog services removed"
fi

echo ""
echo "Done! Services will no longer auto-start."
