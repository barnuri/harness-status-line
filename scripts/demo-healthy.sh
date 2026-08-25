#!/bin/bash
export PATH="/Users/barnu/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
clear
printf '\033[90m# Healthy — all quotas green\033[0m\n'
echo '{"cwd":"/Users/barnu/sandbox/private/harness-status-line","model":{"id":"claude-sonnet-4-6","display_name":"Sonnet 4.6"},"context_window":{"used_percentage":22,"total_input_tokens":44000,"context_window_size":200000},"rate_limits":{"five_hour":{"used_percentage":20,"resets_at":1782003532},"seven_day":{"used_percentage":12,"resets_at":1782291532}}}' | bun run "$REPO/src/index.ts"
