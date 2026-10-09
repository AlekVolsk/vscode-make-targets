# Development

## Layout

- `out/extension.js` — activation: views, status bar item, decoration and log link providers, commands.
- `out/makeWorkspace.js` — the projects of the workspace folders, file watching, the context keys of the view title and of the context menus.
- `out/makeProject.js` — one folder: its config and its Makefile with plain-name includes, resolved into targets.
- `out/makefileParser.js` — Makefile text: targets, help comments, recipes, includes; variables a recipe uses; TTY detection; path variable candidates. No `vscode` import.
- `out/projectConfig.js` — JSONC parsing, validation of the config, applying it to a target. No `vscode` import.
- `out/configTemplate.js` — the text of a new config. No `vscode` import.
- `out/makeRunner.js` — starting, stopping and finishing runs, the log files, notifications.
- `out/makeRun.js` — one run: state and the tail of its output.
- `out/runHistory.js` — what survives a reload, in the workspace state.
- `out/terminalLineBuffer.js` — terminal output to plain lines. No `vscode` import.
- `out/runText.js` — times, durations, the path argument, the make arguments, file locations in output lines. No `vscode` import.
- `out/targetTreeProvider.js`, `out/runTreeProvider.js` — the two views; `out/makeDecorationProvider.js` — their label colors.
- `out/makeCommands.js` — commands.
- `schemas/make-targets.schema.json` — the config schema.
- `tools/render-icon.js` — draws `images/icon.png`; vsce refuses an SVG extension icon. `node tools/render-icon.js`.

No build step: the sources in `out/` are what ships.

## Build and install

```bash
npm run build
code --install-extension make-targets.vsix --force
```

## Invariants — do not break these

- **make runs without a shell**: `spawn(makeCommand, ['--no-print-directory', '-C', dir, target, 'VAR=value'…])`; `--no-print-directory` keeps the `Entering directory` lines that `-C` adds out of every run, sub-makes included. The path still reaches a shell, because make expands `$(SRC)` inside a bash recipe; that is why `pathArgument` refuses `"`, `` ` ``, `$`, `\` and line breaks instead of escaping them — escaping would have to match how each recipe quotes the variable.
- **One process group per run.** The child is spawned detached and stopped with `kill(-pid)`, so Stop and deactivation reach phpstan workers and sub-makes. SIGKILL follows after five seconds. Runs still going when the window closes are stopped on deactivation and come back as interrupted.
- **stdin is closed** (`ignore`), so a recipe that reads input gets end of file instead of hanging.
- **Output is flattened by `TerminalLineBuffer`**: `\r` and cursor-to-column (`ESC[G`) move to the line start, `ESC[K` erases, other escape sequences are dropped, an escape split across chunks is kept until the next one. Checked against PHPStan, which redraws its progress bar with `ESC[1G ESC[2K` even when its output is a pipe.
- **The lock key is project, target and path.** Two runs of the same target on different paths run side by side; several paths from one context-menu action run one after another.
- **Path variables are listed, not guessed.** `ROOT_DIR` or `BUILD_DIR` look like path variables and usually are not; `PATH` is never offered, because on make's command line it would replace the search path of the recipes; the config names them, and the recipes tell which target uses which. Create Config lists the candidates in a comment.
- **Create Config is the only place that hides targets automatically** (recipes with `-it`, `-ti`, `--interactive` and `--tty`). An existing config is never rewritten.
- **A run's log file is `$ command`, `# started …`, a blank line, the output, a blank line and `# outcome · duration · finished …`.** `MakeRunner#loadLines` strips that frame when a run from history is expanded, and the log link provider reads the Makefile folder from the first line when the run is gone from the list.
- **Tree nodes are stable objects per id**, so a run's node can be refreshed alone while its output grows; refreshes are throttled to one per 300 ms per run.
