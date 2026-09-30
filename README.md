# harness-status-line

A Bun/TypeScript status line for coding-agent harnesses — not Claude Code only. The same parser and segments render in each host: folder, model, context %, git, session slug, and whatever that harness actually sends.

| Harness | How it plugs in |
|---|---|
| **Claude Code** | stdin `statusLine` command (`~/.claude/settings.json`) |
| **Cursor CLI** | stdin `statusLine` command (`~/.cursor/cli-config.json`) |
| **Copilot CLI** | stdin `statusLine.command` (`~/.copilot/settings.json`) |
| **Codex** | same stdin JSON contract; slug via `CODEX_THREAD_ID` (`~/.codex/config.toml` has no command hook) |
| **Pi** | stdin `statusLine` command via [`pi-statusline`](https://pi.dev/packages/pi-statusline) (`~/.pi/agent/settings.json`) |
| **opencode** | TUI plugin (`~/.config/opencode/tui.json`) |

`--setup` installs the stdin command for Claude Code, Cursor, and Copilot CLI. Codex, Pi, and opencode are manual (see below). Session slugs also resolve Grok, Gemini, and DeepSeek session ids when those env vars are set.

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
| **🤖 model** | Purple bg | Current model name (e.g. `claude-sonnet-4-6`, `Sonnet 4.6 (Thinking)`) |
| **ctx: N% · used/total** | Green/Yellow/Red bg | Context window usage % plus the absolute size in tokens (`0.42M/1M`, both scaled to one unit) — turns yellow >60%, red >80% |
| **session: N%** | Cyan/Yellow/Red bg | Remaining session quota % — turns yellow <50%, red <20% |
| **week: N%** | Cyan/Yellow/Red bg | Remaining weekly quota % |

If the content doesn't fit the terminal width it wraps to additional lines — **no info is ever truncated**.

## Setup (one command)

```bash
bunx barnuri/harness-status-line --setup
```

This writes the `statusLine` configuration into:

- `~/.claude/settings.json` (or `.claude/settings.json` if it exists in the current project)
- `~/.cursor/cli-config.json` (created if missing; other Cursor keys are preserved)
- `~/.copilot/settings.json` (created if missing; other Copilot CLI keys are preserved)

Restart the harness to activate.

Running `bunx barnuri/harness-status-line` interactively (without piped stdin) automatically launches the setup wizard.

## Claude Code

Add this to `~/.claude/settings.json` (or project `.claude/settings.json`):

```json
{
  "statusLine": {
    "type": "command",
    "command": "bunx barnuri/harness-status-line",
    "refreshInterval": 2000
  }
}
```

Claude Code pipes `StatusJSON` on each refresh. Rate-limit and auth segments come from that payload (and `ANTHROPIC_*` env).

## Cursor

Cursor CLI is the same stdin contract: it spawns `statusLine.command` on each refresh, pipes JSON, and displays ANSI stdout (multi-line wrapping is supported). `--setup` writes this file automatically.

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
| on-demand | `cursor.com/api/usage-summary` (cached) | Individual On-Demand Usage budget from the dashboard, e.g. `$182.70 left`. Uses `WorkosCursorSessionToken` (`authId::accessToken` from `~/.cursor/cli-config.json` `authInfo` + keychain token). Overrides the request-pool chip when present. |
| credits / included | Cached usage APIs | Dollar plan spend (`planUsage`), request pool (`/auth/usage`), or included API usage % when on-demand is disabled. |
| daily / weekly | Cursor usage windows when present | Same chips as Claude `rate_limits`. |
| wrap width | `render_width_chars` | Preferred over `COLUMNS` / `stdout.columns` so Cursor's own padding is not double-counted. |

The Claude “Sub” auth chip is omitted on a stock Cursor payload. Hide quota chips with `config set segments.rateLimits false`.

Hide the Cursor-only chips with `config set`:

```bash
bunx barnuri/harness-status-line config set segments.vim false
bunx barnuri/harness-status-line config set segments.worktree false
bunx barnuri/harness-status-line config set segments.autorun false
```

## Copilot CLI

Copilot CLI's `/statusline` (alias `/footer`) feature spawns `statusLine.command` on each refresh, writes JSON to its stdin, and prints the trimmed stdout as the footer. `--setup` configures this automatically.

### Manual configuration

Add this to `~/.copilot/settings.json`:

```json
{
  "statusLine": {
    "command": "bunx barnuri/harness-status-line",
    "refreshInterval": 2
  }
}
```

Note `refreshInterval` is in **seconds** here (Copilot CLI's own convention), unlike Claude Code's/Cursor's millisecond fields.

### Field mapping

| Segment | Copilot CLI field | Notes |
|---|---|---|
| folder | `cwd` / `workspace.current_dir` | Basename only. |
| model | `model.display_name` | Falls back to `model.id`. |
| ctx | `context_window.current_context_used_percentage` | Shows the current fill percentage only. Values above 100 are interpreted as tenths of a percent (`813` → `81%`). Copilot's `current_context_tokens` is cumulative session usage, so it is not shown against the context limit. |
| cost | `ai_used.total_nano_aiu` | AI credits converted to USD (1 credit = $0.01) and shown as `$X.XX session`, like Claude Code. Omitted when `ai_used` is absent. |
| lines | `cost.total_lines_added` / `total_lines_removed` | Off by default; when enabled, shown as `+12/-3` unless both are 0. |
| yolo | `allow_all_enabled` | Shows `yolo: on` when Copilot CLI's allow-all mode is enabled. |

Copilot CLI doesn't send `api`/`rate_limits` or a remaining-credit balance, so auth and quota chips are omitted rather than showing a misleading default. The payload provides session premium-request usage, not the account's remaining allowance.
Hide the YOLO chip with `bun run src/index.ts config set segments.yolo false`. Enable the lines chip with `bun run src/index.ts config set segments.lines true`.

## Codex

The parser accepts the same Claude-shaped stdin JSON Codex would send, and the slug segment reads `CODEX_THREAD_ID` (then `~/.claude/session-slugs/<id>`).

Native Codex TUI `/statusline` is a picker of **built-in item ids**, not an external command. `~/.codex/config.toml` `tui.status_line` is an ordered list such as `["model", "context-used", "git-branch"]` — you cannot point it at `bunx`. If you wrap Codex or otherwise pipe StatusJSON into this binary, it renders the same segments as Claude Code.

## Pi

Pi does not spawn a status-line command on its own. Install [`pi-statusline`](https://pi.dev/packages/pi-statusline), which pipes a Claude Code–compatible JSON payload to an external command:

```bash
pi install npm:pi-statusline
```

Then add this to `~/.pi/agent/settings.json` (or project `.pi/settings.json`):

```json
{
  "statusLine": {
    "type": "command",
    "command": "bunx barnuri/harness-status-line"
  }
}
```

The payload includes `cwd`, `session_id`, `model`, `workspace`, and `context_window`. Stubbed/null fields (`rate_limits`, `vim`, `worktree`, …) are omitted the same way as on a stock Cursor payload. Restart pi after installing the package.

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

Stdin harnesses (Claude Code, Cursor CLI, Copilot CLI, Pi via `pi-statusline`) pipe a `StatusJSON` blob on every refresh. The tool parses it, extracts the relevant fields, and writes a colored, bold status line to stdout. opencode reuses the same `buildSegments` pipeline inside a TUI slot instead of stdin. Codex uses the same parser when JSON is piped in; its native TUI status line is separate.

```
harness (Claude Code / Cursor / Pi / Codex / opencode)
    ↓  StatusJSON (stdin) or TUI state (opencode plugin)
harness-status-line
    ↓  parse + extract metrics (StatusParser)
    ↓  render ANSI segments (stdin) or TUI boxes (opencode)
    ↓  wrap to terminal width (or Cursor render_width_chars) — never truncate
status bar
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
| slug | `~/.claude/session-slugs/<session id>` — the same file every stdin harness reads |
| git branch | derived from the folder by the shared parser |
| model | `api.state.provider[…].models[modelID].name` for the newest assistant message |
| context % / size | that message's `tokens` (`total`, else input + output + reasoning + cache) against the model's `limit.context` |
| auth, rate limits | `~/.claude/usage-snapshot.json` |

Rate limits are Claude-specific and never reach opencode, so they are read from the snapshot that
the Claude status-line wrapper already writes. **If that snapshot is missing or older than 15
minutes, the rate-limit and auth segments are omitted** rather than shown stale — everything else
still renders.

### Known differences from the stdin status line

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
- A supported harness: Claude Code, Cursor CLI, Copilot CLI, Codex, Pi, and/or opencode

## License

MIT
