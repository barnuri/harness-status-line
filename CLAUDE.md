# CLAUDE.md — harness-status-line

## Project Overview

A Bun/TypeScript Claude Code status line. Reads `StatusJSON` from stdin (piped by Claude Code on each refresh) and writes a colored, wrapped status line to stdout.

## Architecture

```
src/
  index.ts          — Application class: entry point, mode detection (setup vs render)
  types.ts          — StatusJSON, Segment, ANSI color constants
  statusParser.ts   — StatusParser: JSON → typed segments with icons and color rules
  statusRenderer.ts — StatusRenderer: segments → ANSI string with terminal-width wrapping
  setupWizard.ts    — SetupWizard: writes statusLine config into ~/.claude/settings.json
scripts/
  preview.ts        — Generates docs/preview.html (static multi-scenario preview)
  animated-preview.ts — Generates docs/animated.html (CSS-animated cycling preview)
  demo.sh           — Shell script used by VHS to record docs/demo.gif
tests/
  statusParser.test.ts
  statusRenderer.test.ts
docs/
  screenshot-all-scenarios.png  — Static screenshot (Playwright)
  demo.gif                      — Animated GIF (VHS)
```

## Key Behaviours

- **Render mode**: stdin is piped → parse JSON → render segments → write to stdout.
- **Setup mode**: `--setup` flag or interactive TTY → run `SetupWizard`.
- **Wrapping**: segments wrap to additional lines when total width exceeds `process.stdout.columns` (or `COLUMNS` env var). Info is never truncated.
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
- `--setup` → writes `statusLine` key into `~/.claude/settings.json`.

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
