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
- **Answers before questions.** The Q&A section shows each answer first and its question dimmed
  below. It is open by default; `q` collapses it.
- **Session work rows.** `PRs` lists the open PR of the current branch for every repo the session
  touched, plus PRs it created. `commits` lists commits made on a default branch (`main`,
  `master`, `develop`) during each turn, as `sha6 message` (message cut to 40 characters), each
  opening its commit page. `last` shows each touched repo's current HEAD commit, whoever made it, in
  the same format.
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
