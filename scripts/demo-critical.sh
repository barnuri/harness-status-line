#!/bin/bash
export PATH="/Users/barnu/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
clear
printf '\033[90m# Critical — nearly exhausted\033[0m\n'
echo '{"cwd":"/Users/barnu/sandbox/private/harness-status-line","model":{"id":"claude-haiku-4-5-20251001","display_name":"Haiku 4.5"},"context_window":{"used_percentage":94,"total_input_tokens":188000,"context_window_size":200000},"rate_limits":{"five_hour":{"used_percentage":88,"resets_at":1782003532},"seven_day":{"used_percentage":70,"resets_at":1782291532}}}' | bun run "$REPO/src/index.ts"
