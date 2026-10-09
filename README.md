# Make Targets

Make targets of the open folders in the Explorer, run in the background — as they are, or on the file or folder you right-click — with every run's output and history in a **Make** tab of the bottom panel.

## Installation

```bash
code --install-extension make-targets.vsix
```

Or in VS Code: **Extensions** panel → `...` menu → **Install from VSIX…**. After installing, reload the window (**Developer: Reload Window**).

## Make Targets view

- Targets are grouped by the `##@Group Description` help comments of the Makefile, in Makefile order; targets without a group are under **Other**.
- Targets that take a path have their own color.
- A target shows when it last ran and how long it took, then its description from the Makefile, with a check or a cross for the outcome; a spinner while it runs. The time is kept across reloads and comes first, so a narrow panel cuts the description, not the time.
- **Run** runs a target as it is, without a path. **Stop** stops every run of it. Clicking a target shows its latest run in the Make panel.
- **Create Config** in the view title writes `.vscode/make-targets.json` when a folder has none; **Open Config** opens it.

## Running on a path

**Run Make Target…** in the context menu of a file or folder, in the Explorer and in the editor, lists the targets that take a path, the recently used first. **Repeat Last Make Target** runs the last one picked in that folder again. The path is passed as the target's path variable, e.g. `make lint SRC=./src/app`.

- Several selected paths run one after another, because a recipe usually quotes the variable (`"$(SRC)"`) and a list would not split.
- A path outside the Makefile's folder, or one with `"`, `` ` ``, `$`, `\` or a line break in it, is refused: make expands the variable inside a bash recipe, where those characters would be interpreted.
- A run is refused while the same target is already running on the same path.

## Make panel

A started run opens the Make panel and selects itself there. Every run is a node: the target, the path, when it started, how long it ran and, for a failure, the exit code. Under it are the last 2000 lines of its output, one line per item; stderr lines have their own color, and lines that point at a file (`path:line`, or a line number under PHP_CodeSniffer's `FILE:` header or ESLint's file line) open it. **Open Output** opens the whole output as a document. The last 20 runs are kept across reloads.

Runs are background processes, not terminals, so tools see no TTY. Output meant for a terminal is flattened: a progress bar redrawn in place with `\r` or cursor moves becomes its final line, colors are dropped. Targets that need a terminal (`docker exec -it`) fail; **Create Config** lists them under `hidden`.

## Configuration: `.vscode/make-targets.json`

```jsonc
{
    "makefile": "Makefile",
    "pathVariables": ["SRC", "FILE"],
    "pathFormat": "relative",
    "notifications": "failures",
    "hidden": ["deploy", "release-*", "*-ci"],
    "confirm": ["clean*", "migrate*", "*-fix"],
    "targets": {
        "format": { "pathVariable": "FILE" },
        "test": { "args": { "JOBS": "4" } },
        "build": { "notifications": "always" }
    }
}
```

- `pathVariables` — variables that take a path. Which target takes which is detected from the recipes; the first match in this list wins. Not `PATH`: a variable given on make's command line replaces the environment variable of the same name in the recipes, and they would lose the shell's search path.
- `pathFormat` — `relative` (`./path/from/the/Makefile/folder`) or `absolute`.
- `notifications` — when a finished run shows a notification: `always` (default), `failures` or `never`.
- `hidden`, `confirm` — target name patterns, `*` and `?` as wildcards.
- `targets` — per target: `pathVariable` (a name, or `null` for none), `hidden`, `confirm`, `notifications`, and `args` always passed as `VAR=value`.

The file has a schema, so the editor completes and checks it. Changes apply as soon as it is saved.

## Settings

- `makeTargets.makeCommand` — the make executable, `make` by default.

## Colors

- `makeTargets.pathTargetForeground` — targets that take a path
- `makeTargets.plainTargetForeground` — other targets
- `makeTargets.errorOutputForeground` — stderr lines in the Make panel

## License

MIT.
