# summarize mod

Deterministic iteration recap pane for Claude Code. It makes no model calls, ever.

## UI rules

- **One style for everything clickable.** Every link and every button that does something renders
  through `RecapView.action`: underlined text in `COLORS.action`, dimmed when it does nothing right
  now. Never render a bare `<Button label=…>` or `<Link>`.
- **Links are buttons that open.** A URL or file opens through `handlers.onOpenFile` (the OS
  opener). Show a short label only, never the raw URL or path: a repo shows its name, a PR shows
  `#<number>`.
- **Empty means hidden.** A section with nothing to show renders nothing, with no placeholder text.
- **Answers before questions.** The Q&A section shows only `overview.md`: each answer the session
  gave to a user prompt with a `?`, with that question dimmed below. AskUserQuestion replies are
  not Answers. It is open by default; `q` collapses it.
- **Session overview.** On every completed turn the mod writes `overview-facts.json` into the
  session's `agent-spec/<slug>/` folder (`OverviewFacts`, no model call). `/summarize overview`
  writes it, runs `~/.agents/skills/session-overview/scripts/render_overview.py <folder>`, and opens
  `session-overview.html`. The page reads the facts plus `tasks.md`, `plan.md` and `overview.md`.
  The slug folder is the one session-slug published, else the `agent-spec/<slug>/` folder of a file
  the session wrote. Every turn end also renders the page. The `slug` row in "This session" always
  shows: the slug and a `session overview` action (`o`), or `none`. Inside herdr the action opens
  the page in a `terminal-browser` split below the pane, else the OS opener. The herdr-mods pane
  (`opencode-summarize/view.ts`) instead hands its own terminal to `terminal-browser` through
  `ui.takeover`. The `overviewBack.js` preload adds a "◀ Back" button, and Esc also quits, so the
  recap draws again. If that fails, the pane falls back to the split.
- **Skills can be missed.** The host may skip this mod's `skill.prompt` hook when another plugin
  ahead of it does not pass the event on. `Skill` tool calls and typed slash commands still count,
  so a skill loaded only through that hook can be absent from the Skills list.
- **Session work rows.** `PRs` lists the open PR of the current branch for every repo the session
  touched, plus PRs it created. `commits` lists commits made on a default branch (`main`,
  `master`, `develop`) during each turn, as `sha6 message` (message cut to 40 characters), each
  opening its commit page. `last` shows each touched repo's current HEAD commit, whoever made it, in
  the same format, one line per repo with the repo name dimmed before it when there are several.
- **Counts over lists.** The files row shows a count. The `showFilePaths` option lists paths.

## Errors

Never print errors into the transcript (`$.ui.log`). Call `logError`, which appends a JSON line
(`ts`, `plugin`, `error`) to `~/.claude/mod-errors/summarize.jsonl` and keeps the newest 500. The
`optimize-workspace` skill reads that file in its audits.

## Checks

```sh
claude plugin test .
bunx tsc --noEmit -p .
claude plugin validate .
```
