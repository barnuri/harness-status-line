# Related projects

Other projects by barnuri. Each install block runs as-is. Source of truth for each command is that repo's README.

## Developer tools

### ghx

Picks the GitHub account from the current folder. Wraps `gh`.
Repo: https://github.com/barnuri/ghx

```sh
curl -fsSL https://raw.githubusercontent.com/barnuri/ghx/master/install.sh | sh
```

### llm-hub

One local endpoint for all LLM providers. Merges their model lists into one `/v1/models`.
Repo: https://github.com/barnuri/llm-hub

```sh
curl -fsSL https://raw.githubusercontent.com/barnuri/llm-hub/master/scripts/install.sh | sh
```

### win-dock (macOS)

Windows-style dock for macOS.
Repo: https://github.com/barnuri/win-dock

```sh
brew tap barnuri/brew
brew install barnuri/brew/windock --no-quarantine
```

## Agent harnesses

### harness-skills

Skills and subagents that run in Claude Code, Copilot CLI, Codex CLI and Cursor. Claude Code install shown; see the repo README for the other harnesses.
Repo: https://github.com/barnuri/harness-skills

```sh
claude plugin marketplace add barnuri/harness-skills
claude plugin install barnuri-dev-skills@harness-skills
```

### harness-bridge

Shares Claude Code plugins, skills, subagents, MCP servers and global instructions with opencode, pi, codex, cursor and Copilot CLI. No installer: clone, then run from the clone.
Repo: https://github.com/barnuri/harness-bridge

```sh
git clone https://github.com/barnuri/harness-bridge.git
cd harness-bridge
bin/harness-bridge.sh --report
```

### orch-skill

Routes work across the coding agents already installed on the machine.
Repo: https://github.com/barnuri/orch-skill

```sh
git clone https://github.com/barnuri/orch-skill.git
cd orch-skill
./install.sh
```

## herdr plugins

Plugins for [herdr](https://herdr.dev). Each installs with `herdr plugin install`.

### herdr-web

The full herdr TUI in the browser.
Repo: https://github.com/barnuri/herdr-web

```sh
herdr plugin install barnuri/herdr-web
```

### herdr-notifications

Telegram, Discord and Slack messages when a coding agent goes idle or blocked.
Repo: https://github.com/barnuri/herdr-notifications

```sh
herdr plugin install barnuri/herdr-notifications
```

### herdr-command-palette

F1-style palette listing every action from every installed plugin.
Repo: https://github.com/barnuri/herdr-command-palette

```sh
herdr plugin install barnuri/herdr-command-palette
```

### herdr-project-manager

VS Code-style project manager for herdr.
Repo: https://github.com/barnuri/herdr-project-manager

```sh
herdr plugin install barnuri/herdr-project-manager
```

### herdr-auto-update

Checks for and applies herdr updates automatically.
Repo: https://github.com/barnuri/herdr-auto-update

```sh
herdr plugin install barnuri/herdr-auto-update
```
