# CLAUDE.md — harness-status-line

## Project Overview

A Bun/TypeScript Claude Code status line. Reads `StatusJSON` from stdin (piped by Claude Code or Cursor CLI on each refresh) and writes a colored, wrapped status line to stdout.

## Architecture

```
src/
  index.ts          — Application class: entry point, mode detection (setup vs render)
  types.ts          — StatusJSON, Segment, ANSI color constants
  statusParser.ts   — StatusParser: JSON → typed segments with icons and color rules
  statusRenderer.ts — StatusRenderer: segments → ANSI string with terminal-width wrapping
  setupWizard.ts    — SetupWizard: writes statusLine into ~/.claude/settings.json, ~/.cursor/cli-config.json, and ~/.copilot/settings.json
scripts/
  preview.ts        — Generates docs/preview.html (static multi-scenario preview)
  animated-preview.ts — Generates docs/animated.html (CSS-animated cycling preview)
  demo.sh           — Shell script used by VHS to record docs/demo.gif
tests/
  statusParser.test.ts
  statusRenderer.test.ts
  setupWizard.test.ts
docs/
  screenshot-all-scenarios.png  — Static screenshot (Playwright)
  demo.gif                      — Animated GIF (VHS)
```

## Key Behaviours

- **Render mode**: stdin is piped → parse JSON → render segments → write to stdout.
- **Setup mode**: `--setup` flag or interactive TTY → run `SetupWizard` (writes Claude settings, Cursor `cli-config.json`, and Copilot CLI `settings.json`).
- **Wrapping**: segments wrap to additional lines when total width exceeds `render_width_chars` (Cursor) or else `process.stdout.columns` / `COLUMNS`. Info is never truncated.
- **Color coding**: context turns yellow >60%, red >80%; rate limits turn yellow <50% remaining, red <20%.

## Running

```bash
# Render with test data
echo '{"cwd":"/my/project","model":"claude-sonnet-4-6","context_window":{"percentage":42}}' | bun run src/index.ts

# Setup wizard
bun run src/index.ts --setup

# Simulate narrow terminal
echo '{...}' | COLUMNS=40 bun run src/index.ts

# Run tests
bun test

# Regenerate preview screenshots
bun run scripts/preview.ts
bun run scripts/animated-preview.ts
vhs demo.tape
```

## Coding Standards

- One class per file; all constants and helpers inside the class body as `private static readonly`.
- No module-level code outside the entry `index.ts` (which uses a top-level `new Application().run()` call).
- All types explicit — no `any`, use `unknown` for truly dynamic shapes.
- Guard clauses: return early, max 2 levels of nesting.
- `async/await` throughout.

## Verification

Run the full verification suite before committing:

```bash
bun test --coverage        # unit tests + coverage report
bun run scripts/preview.ts # ensure preview renders without errors
echo '{}' | bun run src/index.ts  # empty JSON should produce empty output, no crash
bun run src/index.ts --setup 2>&1 | grep -q "Status line configured" && echo "setup ok"
```

Expected outcomes:
- `bun test` passes with ≥ 90% line coverage on `statusParser.ts` and `statusRenderer.ts`.
- Empty JSON → no output, exit 0.
- `--setup` → writes `statusLine` into `~/.claude/settings.json`, `~/.cursor/cli-config.json`, and `~/.copilot/settings.json`.

## Claude Code Integration

Claude Code reads `statusLine` from `~/.claude/settings.json` or `.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bunx barnuri/harness-status-line",
    "refreshInterval": 2000
  }
}
```

The `StatusJSON` schema Claude Code pipes is documented in `src/types.ts`.

## Cursor CLI Integration

Cursor CLI reads `statusLine` from `~/.cursor/cli-config.json`. `--setup` writes both this file and the Claude settings above.

```json
{
  "statusLine": {
    "type": "command",
    "command": "bunx barnuri/harness-status-line",
    "updateIntervalMs": 2000,
    "timeoutMs": 2000
  }
}
```

Cursor's payload uses `model.display_name`, `context_window.used_percentage`, and `render_width_chars` (preferred wrap width). Optional `vim`, `worktree`, and `autorun` segments omit when absent. Quota chips come from background Cursor usage fetches (`cursor.com/api/usage-summary` for On-Demand Usage, plus `api2.cursor.sh` plan/request endpoints), not from stdin.

## Copilot CLI Integration

Copilot CLI reads `statusLine.command`/`statusLine.refreshInterval` from `~/.copilot/settings.json` (`refreshInterval` is in **seconds**, unlike Claude/Cursor's milliseconds). `--setup` writes this file alongside the Claude and Cursor settings above.

```json
{
  "statusLine": {
    "command": "bunx barnuri/harness-status-line",
    "refreshInterval": 2
  }
}
```

Copilot CLI spawns the command and pipes a JSON object shaped like `{ cwd, model: { id, display_name }, workspace: { current_dir }, context_window: { current_context_used_percentage, current_context_tokens, displayed_context_limit, used_percentage, total_input_tokens, context_window_size }, cost: { total_premium_requests }, username, allow_all_enabled, ai_used }` — no `api`/`rate_limits`/`render_width_chars`. `extractContextPercent` prefers `current_context_used_percentage` (the live context fill), then computes it from `current_context_tokens`/`displayed_context_limit`, before falling back to the cumulative `used_percentage`; the auth segment is suppressed since there's no `api` field; `ai_used.total_nano_aiu` is converted to USD (1 AI credit = $0.01) and renders as the `$X.XX session` cost segment (premium requests are not shown); `cost.total_lines_added/removed` renders a `+N/-M` lines chip (Copilot payloads only, `segments.lines`); `allow_all_enabled` displays a `yolo: on` chip when true.
