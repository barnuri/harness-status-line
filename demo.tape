Output docs/demo.gif
Set FontFamily "JetBrains Mono"
Set FontSize 18
Set Width 1400
Set Height 160
Set Theme "Dracula"
Set Padding 20
Set LoopOffset 0%
Set Shell "bash"

Hide
Type `export PS1='' && export PATH=/Users/barnu/.bun/bin:$PATH && cd /Users/barnu/sandbox/private/harness-status-line`
Enter
Sleep 1s

Type `./scripts/demo-healthy.sh`
Enter
Sleep 800ms
Show
Sleep 3500ms
Hide

Type `./scripts/demo-warning.sh`
Enter
Sleep 800ms
Show
Sleep 3500ms
Hide

Type `./scripts/demo-critical.sh`
Enter
Sleep 800ms
Show
Sleep 3500ms
