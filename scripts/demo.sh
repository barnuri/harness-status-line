#!/bin/bash
# Demo script used by VHS to generate demo.gif
# Shows all status line states with pre-rendered ANSI output

clear
printf "\033[90m# harness-status-line — live demo\033[0m\n\n"

printf "\033[90m# Healthy — all quotas green\033[0m\n"
echo '{"cwd":"/projects/my-app","model":"claude-sonnet-4-6","context_window":{"percentage":22,"tokens":44000,"size":200000},"rate_limits":{"session":{"used":20,"limit":100},"week":{"used":12,"limit":100}}}' | bun run /Users/barnu/sandbox/private/harness-status-line/src/index.ts
sleep 3

printf "\n\033[90m# Warning — session at 42%% remaining\033[0m\n"
echo '{"cwd":"/projects/my-app","model":"claude-sonnet-4-6","context_window":{"percentage":55,"tokens":110000,"size":200000},"rate_limits":{"session":{"used":58,"limit":100},"week":{"used":28,"limit":100}}}' | bun run /Users/barnu/sandbox/private/harness-status-line/src/index.ts
sleep 3

printf "\n\033[90m# Critical — nearly exhausted\033[0m\n"
echo '{"cwd":"/projects/my-app","model":"claude-haiku-4-5-20251001","context_window":{"percentage":94,"tokens":188000,"size":200000},"rate_limits":{"session":{"used":88,"limit":100},"week":{"used":70,"limit":100}}}' | bun run /Users/barnu/sandbox/private/harness-status-line/src/index.ts
sleep 3
