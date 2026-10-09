'use strict';

const ASSIGNMENT = /^\s*(?:(?:override|export|private)\s+)*[A-Za-z_][A-Za-z0-9_.-]*\s*(?:\?|::|:|\+|!)?=/;
const TARGET_LINE = /^([^\s#:=][^#:=]*?)\s*::?(?!=)(.*)$/;
const DEFINE_START = /^\s*(?:(?:override|export)\s+)*define(?:\s|$)/;
const DEFINE_END = /^\s*endef\b/;
const INCLUDE = /^\s*(?:-include|sinclude|include)\s+(.+)$/;
const TARGET_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
const VARIABLE_REFERENCE = /\$[({]([A-Za-z_][A-Za-z0-9_]*)[)}:]/g;
const TTY_FLAGS = /(?:^|\s)-(?:it|ti)(?=\s|$)/;
const PATH_LIKE_NAME = /PATH|FILE|DIR|SRC/i;
const NOT_PATH_VARIABLES = new Set(['PATH', 'SHELL', 'CURDIR', 'MAKEFILES', 'MAKEFILE_LIST']);

function endsWithContinuation(line) {
    const trailing = /\\+$/.exec(line);
    return trailing !== null && trailing[0].length % 2 === 1;
}

function joinContinuations(text) {
    const physical = text.split(/\r?\n/);
    const logical = [];
    for (let index = 0; index < physical.length; index += 1) {
        const lineNumber = index + 1;
        let line = physical[index];
        while (endsWithContinuation(line) && index + 1 < physical.length) {
            index += 1;
            line = `${line.slice(0, -1)} ${physical[index].replace(/^\s+/, '')}`;
        }
        logical.push({ text: line, lineNumber });
    }
    return logical;
}

function parseHelpComment(rest) {
    const index = rest.indexOf('##');
    if (index === -1) {
        return { group: undefined, description: '' };
    }
    const comment = rest.slice(index + 2).trim();
    const grouped = /^@(\S+)\s*(.*)$/.exec(comment);
    if (grouped === null) {
        return { group: undefined, description: comment };
    }
    return { group: grouped[1], description: grouped[2] };
}

/**
 * Text-level Makefile reader: targets with their help comments (`## text`, `##@Group text`) and recipes,
 * and the include directives. Conditionals are not evaluated; define…endef blocks are skipped.
 */
function parseMakefile(text) {
    const targets = new Map();
    const includes = [];
    let recipients = [];
    let isInsideDefine = false;

    for (const { text: line, lineNumber } of joinContinuations(text)) {
        if (isInsideDefine) {
            isInsideDefine = !DEFINE_END.test(line);
            continue;
        }
        if (line.startsWith('\t')) {
            for (const target of recipients) {
                target.recipe.push(line.slice(1));
            }
            continue;
        }
        if (/^\s*(?:#.*)?$/.test(line)) {
            continue;
        }
        recipients = [];
        if (DEFINE_START.test(line)) {
            isInsideDefine = true;
            continue;
        }
        const include = INCLUDE.exec(line);
        if (include !== null) {
            includes.push(...include[1].split(/\s+/).filter((file) => file !== ''));
            continue;
        }
        if (ASSIGNMENT.test(line)) {
            continue;
        }
        const targetLine = TARGET_LINE.exec(line);
        if (targetLine === null) {
            continue;
        }
        const help = parseHelpComment(targetLine[2]);
        for (const name of targetLine[1].split(/\s+/).filter((candidate) => TARGET_NAME.test(candidate))) {
            let target = targets.get(name);
            if (target === undefined) {
                target = { name, group: undefined, description: '', line: lineNumber, recipe: [] };
                targets.set(name, target);
            }
            if (target.description === '' && help.description !== '') {
                target.group = help.group;
                target.description = help.description;
                target.line = lineNumber;
            }
            recipients.push(target);
        }
    }

    return { targets: [...targets.values()], includes };
}

function referencedVariables(recipe) {
    const names = new Set();
    for (const line of recipe) {
        for (const reference of line.replaceAll('$$', '').matchAll(VARIABLE_REFERENCE)) {
            names.add(reference[1]);
        }
    }
    return names;
}

function needsTerminal(recipe) {
    const text = recipe.join('\n');
    return TTY_FLAGS.test(text) || (/--interactive\b/.test(text) && /--tty\b/.test(text));
}

function pathVariableCandidates(targets) {
    const counts = new Map();
    for (const target of targets) {
        for (const name of target.variables) {
            if (PATH_LIKE_NAME.test(name) && !NOT_PATH_VARIABLES.has(name)) {
                counts.set(name, (counts.get(name) ?? 0) + 1);
            }
        }
    }
    return [...counts].map(([name, targetCount]) => ({ name, targetCount }))
        .sort((left, right) => right.targetCount - left.targetCount || left.name.localeCompare(right.name));
}

module.exports = { parseMakefile, referencedVariables, needsTerminal, pathVariableCandidates };
