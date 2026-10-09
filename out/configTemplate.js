'use strict';

const INDENT = '    ';

function jsonList(items, depth) {
    if (items.length === 0) {
        return '[]';
    }
    const inner = INDENT.repeat(depth + 1);
    return `[\n${items.map((item) => `${inner}${JSON.stringify(item)}`).join(',\n')}\n${INDENT.repeat(depth)}]`;
}

/**
 * The first configuration of a project. Targets whose recipe asks for a terminal go to "hidden", because
 * a background run has no TTY; path variables are left for the user to pick from the listed candidates.
 */
function buildInitialConfig({ makefile, candidates, terminalTargets }) {
    const candidateLine = candidates.length === 0
        ? `${INDENT}// No candidates found in the recipes.`
        : `${INDENT}// Candidates found in the recipes (variable: targets using it): `
            + candidates.map(({ name, targetCount }) => `${name}: ${targetCount}`).join(', ');
    return [
        '{',
        `${INDENT}// The Makefile, relative to the workspace folder.`,
        `${INDENT}"makefile": ${JSON.stringify(makefile)},`,
        '',
        `${INDENT}// Variables that take a file or folder path.`,
        `${INDENT}// A target takes a path when its recipe uses one of them.`,
        candidateLine,
        `${INDENT}"pathVariables": [],`,
        '',
        `${INDENT}// "relative" passes ./path/from/the/Makefile/folder, "absolute" passes the full path.`,
        `${INDENT}"pathFormat": "relative",`,
        '',
        `${INDENT}// When a finished run shows a notification: "always", "failures" or "never".`,
        `${INDENT}"notifications": "always",`,
        '',
        `${INDENT}// Targets never shown or run from the editor; * and ? are wildcards.`,
        `${INDENT}// Listed: targets whose recipe asks for a terminal (-it, --interactive --tty);`,
        `${INDENT}// a background run has no TTY, so they would fail.`,
        `${INDENT}"hidden": ${jsonList(terminalTargets, 1)},`,
        '',
        `${INDENT}// Targets that ask for confirmation before they run; * and ? are wildcards.`,
        `${INDENT}"confirm": [],`,
        '',
        `${INDENT}// Per-target settings, for example:`,
        `${INDENT}// "lint-fix": { "pathVariable": "SRC", "confirm": true, "args": { "JOBS": "4" } }`,
        `${INDENT}"targets": {}`,
        '}',
        '',
    ].join('\n');
}

module.exports = { buildInitialConfig };
