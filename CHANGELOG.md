# Changelog

## 1.1.1 — 2026-10-26

- License changed from MIT to BSD 3-Clause.
- The README states that the extension is developed and maintained with the help of AI tools.
- The sources are type-checked in strict mode; no change in behaviour.

## 1.1.0 — 2026-10-23

- New command **Copy name to clipboard** in the context menu of a target in the Make Targets view: copies the target name and confirms it in the status bar.
- Output lines in the Make panel that contain an absolute file path, with no `path:line` reference and outside a PHP_CodeSniffer or ESLint file group, now open that file at its first line.
- Command titles, notification buttons and tree item actions use sentence case: **Create config**, **Open config**, **Run make target…**, **Repeat last make target**, **Run again**, **Open output**, **Copy output**, **Show output**, **Show last run**, **Remove from history**, **Clear finished runs**, **Open location**.

## 1.0.0 — 2026-10-09

- Make Targets view in the Explorer: targets of the open folders grouped by the Makefile's `##@Group Description` comments, with the time and duration of the last run, the description and the outcome; separate color for targets that take a path.
- Run and stop targets from the view; runs are background processes without a TTY.
- **Run Make Target…** and **Repeat Last Make Target** in the context menu of files and folders in the Explorer and the editor: pass the path as the target's path variable, several selected paths run one after another; unsafe paths and duplicate runs on the same path are refused.
- Make panel in the bottom panel: every run with its target, path, start time, duration and exit code, the last 2000 lines of output with stderr highlighted and clickable file references, **Open Output** for the full output; the last 20 runs are kept across reloads.
- Terminal output is flattened: in-place progress redraws reduced to the final line, colors dropped.
- Per-folder configuration in `.vscode/make-targets.json` with a JSON schema: Makefile, path variables, path format, notifications, hidden and confirmed target patterns, per-target overrides and arguments; **Create Config** generates it and hides targets that need a terminal.
- Setting `makeTargets.makeCommand` and theme colors `makeTargets.pathTargetForeground`, `makeTargets.plainTargetForeground`, `makeTargets.errorOutputForeground`.
