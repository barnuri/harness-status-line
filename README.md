# harness-status-line

A Claude Code status line built with Bun/TypeScript. Shows real-time session info directly in your terminal status area.

## Demo

### Animated — all states cycling

![Animated demo](docs/demo.gif)

### All scenarios at a glance

![All scenarios](docs/screenshot-all-scenarios.png)

### Individual states

| Healthy | Warning |
|---|---|
| ![Healthy](docs/frame-0-healthy.png) | ![Warning](docs/frame-1-warning.png) |

| Critical | Narrow — wraps instead of truncating |
|---|---|
| ![Critical](docs/frame-2-critical.png) | ![Wrapped](docs/frame-3-wrapped.png) |

## What it shows

| Segment | Color | Description |
|---|---|---|
| **📁 folder** | Blue bg | Current working directory basename |
| **🤖 model** | Purple bg | Claude model name (e.g. `claude-sonnet-4-6`) |
| **ctx: N% · used/total** | Green/Yellow/Red bg | Context window usage % plus the absolute size in tokens (`0.42M/1M`, both scaled to one unit) — turns yellow >60%, red >80% |
| **session: N%** | Cyan/Yellow/Red bg | Remaining session quota % — turns yellow <50%, red <20% |
| **week: N%** | Cyan/Yellow/Red bg | Remaining weekly quota % |

If the content doesn't fit the terminal width it wraps to additional lines — **no info is ever truncated**.

## Setup (one command)

```bash
bunx barnuri/harness-status-line --setup
```

This writes the `statusLine` configuration into both:

- `~/.claude/settings.json` (or `.claude/settings.json` if it exists in the current project)
- `~/.cursor/cli-config.json` (created if missing; other Cursor keys are preserved)

Restart Claude Code or Cursor to activate.

Running `bunx barnuri/harness-status-line` interactively (without piped stdin) automatically launches the setup wizard.

## Manual configuration

Add this to your `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bunx barnuri/harness-status-line",
    "refreshInterval": 2000
  }
}
```

Cursor CLI uses `~/.cursor/cli-config.json` instead (see **Cursor** below).

## Cursor

Cursor CLI is the same stdin command as Claude Code: it spawns `statusLine.command` on each refresh, pipes JSON, and displays ANSI stdout (multi-line wrapping is supported). `--setup` writes this file automatically.

### Manual configuration

Add this to `~/.cursor/cli-config.json`:

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

`updateIntervalMs` is 2000 (not Cursor's 300 ms default) so the parser's git spawn does not run on every debounce tick. `padding` is omitted (Cursor default 0).

### Field mapping

| Segment | Cursor field | Notes |
|---|---|---|
| folder | `cwd` / `workspace.current_dir` | Basename only. `workspace.project_dir` is the transcript store and is not shown. |
| worktree | `worktree.name` | Omitted when absent, or when the name equals the folder basename. |
| slug | `session_id` → `~/.claude/session-slugs/<id>` | Falls back to `session_name` when no slug file exists. |
| model | `model.display_name` | Appends `param_summary` and ` · max` when `max_mode` is true. |
| vim | `vim.mode` | `NORMAL` / `INSERT`. Omitted when vim mode is off. |
| ctx | `context_window.used_percentage` | Falls back to `remaining_percentage` when used is null. Turns yellow >60%, red >80%. |
| autorun | `autorun` | Shown as `autorun: on` only when `true`. |
| wrap width | `render_width_chars` | Preferred over `COLUMNS` / `stdout.columns` so Cursor's own padding is not double-counted. |

Rate limits and the Claude “Sub” auth chip come from Claude-shaped `api` / `rate_limits` (or `ANTHROPIC_*` env). A stock Cursor payload has neither, so those segments are omitted.

Hide the Cursor-only chips with `config set`:

```bash
bunx barnuri/harness-status-line config set segments.vim false
bunx barnuri/harness-status-line config set segments.worktree false
bunx barnuri/harness-status-line config set segments.autorun false
```

## Regenerate preview screenshots

```bash
# Regenerate everything in one command (requires ffmpeg + Playwright Chromium)
bun run update-all

# Or step by step:
bun run scripts/preview.ts              # → docs/preview.html
bun run scripts/animated-preview.ts    # → docs/animated.html
bun run scripts/capture-screenshots.ts # → docs/frame-*.png + docs/screenshot-all-scenarios.png
bun run scripts/make-gif.ts            # → docs/demo.gif
```

First-time setup for Playwright:

```bash
bunx playwright install chromium
```

## How it works

Claude Code (and Cursor CLI) pipe a `StatusJSON` blob to the command's stdin on every refresh. The tool parses it, extracts the relevant fields, and writes a colored, bold status line to stdout.

```
Claude Code / Cursor CLI
    ↓  StatusJSON (stdin)
harness-status-line
    ↓  parse + extract metrics (StatusParser)
    ↓  render ANSI-colored segments with bold backgrounds (StatusRenderer)
    ↓  wrap to terminal width (or Cursor render_width_chars) — never truncate
stdout → status bar
```

## opencode

The same status line renders inside [opencode](https://opencode.ai) as a TUI plugin, reusing the
exact same `buildSegments` pipeline — so the segments, colours, and thresholds are identical.

### Enabling it

Add the plugin's **absolute path** to `~/.config/opencode/tui.json`:

```json
{
  "plugin": ["/absolute/path/to/harness-status-line/src/opencode/plugin.ts"]
}
```

Then restart opencode — config is read once at startup.

> **Use `tui.json`, not `opencode.jsonc`.** The `plugin` array in `opencode.jsonc` is the *server*
> plugin loader; it will load this module and call its `tui` export with a server `PluginInput`,
> which has no `slots` and therefore fails.

### Where the data comes from

| Segment | Source |
|---|---|
| folder | `api.state.path.directory` (falls back to `worktree`) |
| slug | `~/.claude/session-slugs/<session id>` — the same file the Claude status line reads |
| git branch | derived from the folder by the shared parser |
| model | `api.state.provider[…].models[modelID].name` for the newest assistant message |
| context % / size | that message's `tokens` (`total`, else input + output + reasoning + cache) against the model's `limit.context` |
| auth, rate limits | `~/.claude/usage-snapshot.json` |

Rate limits are Claude-specific and never reach opencode, so they are read from the snapshot that
the Claude status-line wrapper already writes. **If that snapshot is missing or older than 15
minutes, the rate-limit and auth segments are omitted** rather than shown stale — everything else
still renders.

### Known differences from the Claude status line

- **No powerline separators.** An opencode slot is a component tree, not a character stream, so
  segments render as padded coloured boxes instead of `` glyph joins. Wrapping is handled by
  the TUI's own flex layout rather than this repo's width calculation.
- Model and context segments only appear once a session has an assistant message; on the
  opencode home screen there is nothing to report yet.

## Development

```bash
# Run with test data
echo '{"model":"claude-sonnet-4-6","cwd":"/tmp","context_window":{"percentage":42,"tokens":85000},"rate_limits":{"session":{"used":50,"limit":100}}}' \
  | bun run src/index.ts

# Simulate narrow terminal (wrap behavior)
echo '{...}' | COLUMNS=40 bun run src/index.ts

# Run tests
bun test

# Run tests with coverage
bun test --coverage
```

## Verification

```bash
# All 52 tests pass with 100% line coverage
bun test --coverage

# Empty JSON → no output, exit 0
echo '{}' | bun run src/index.ts

# Setup wizard writes config
bun run src/index.ts --setup 2>&1 | grep "Status line configured"
```

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- Claude Code CLI and/or Cursor CLI

## License

MIT
