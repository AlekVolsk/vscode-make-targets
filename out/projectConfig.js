'use strict';

const PATH_FORMATS = new Set(['relative', 'absolute']);
const NOTIFICATION_MODES = new Set(['always', 'failures', 'never']);
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * JSON with // and /* *\/ comments and trailing commas, as VS Code writes files in .vscode.
 */
function parseJsonc(text) {
    let json = '';
    let index = 0;
    while (index < text.length) {
        const char = text[index];
        if (char === '"') {
            let end = index + 1;
            while (end < text.length && text[end] !== '"') {
                end += text[end] === '\\' ? 2 : 1;
            }
            json += text.slice(index, end + 1);
            index = end + 1;
        } else if (char === '/' && text[index + 1] === '/') {
            const end = text.indexOf('\n', index);
            index = end === -1 ? text.length : end;
        } else if (char === '/' && text[index + 1] === '*') {
            const end = text.indexOf('*/', index + 2);
            index = end === -1 ? text.length : end + 2;
        } else {
            json += char;
            index += 1;
        }
    }
    return JSON.parse(json.replace(/,(\s*[}\]])/g, '$1'));
}

function globToRegExp(pattern) {
    const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.');
    return new RegExp(`^${source}$`);
}

function stringList(raw, key, problems) {
    const value = raw[key];
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        problems.push(`"${key}" must be a list of strings`);
        return [];
    }
    return value;
}

function targetSettings(name, raw, problems) {
    const settings = {};
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        problems.push(`"targets.${name}" must be an object`);
        return settings;
    }
    if ('pathVariable' in raw) {
        const isName = typeof raw.pathVariable === 'string' && VARIABLE_NAME.test(raw.pathVariable);
        if (raw.pathVariable === null || isName) {
            settings.pathVariable = raw.pathVariable;
        } else {
            problems.push(`"targets.${name}.pathVariable" must be a variable name or null`);
        }
    }
    for (const flag of ['hidden', 'confirm']) {
        if (raw[flag] === undefined) {
            continue;
        }
        if (typeof raw[flag] === 'boolean') {
            settings[flag] = raw[flag];
        } else {
            problems.push(`"targets.${name}.${flag}" must be true or false`);
        }
    }
    if (raw.notifications !== undefined) {
        if (NOTIFICATION_MODES.has(raw.notifications)) {
            settings.notifications = raw.notifications;
        } else {
            problems.push(`"targets.${name}.notifications" must be "always", "failures" or "never"`);
        }
    }
    if (raw.args !== undefined) {
        const isArgsValid = raw.args !== null && typeof raw.args === 'object' && !Array.isArray(raw.args)
            && Object.entries(raw.args).every(([key, value]) => VARIABLE_NAME.test(key) && typeof value === 'string');
        if (isArgsValid) {
            settings.args = raw.args;
        } else {
            problems.push(`"targets.${name}.args" must map variable names to strings`);
        }
    }
    return settings;
}

function normalizeConfig(raw) {
    const problems = [];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { config: normalizeConfig({}).config, problems: ['the configuration must be an object'] };
    }
    const pathVariables = stringList(raw, 'pathVariables', problems).filter((name) => {
        const isValid = VARIABLE_NAME.test(name);
        if (!isValid) {
            problems.push(`"${name}" in "pathVariables" is not a variable name`);
        }
        return isValid;
    });
    let pathFormat = 'relative';
    if (raw.pathFormat !== undefined) {
        if (PATH_FORMATS.has(raw.pathFormat)) {
            pathFormat = raw.pathFormat;
        } else {
            problems.push('"pathFormat" must be "relative" or "absolute"');
        }
    }
    let notifications = 'always';
    if (raw.notifications !== undefined) {
        if (NOTIFICATION_MODES.has(raw.notifications)) {
            notifications = raw.notifications;
        } else {
            problems.push('"notifications" must be "always", "failures" or "never"');
        }
    }
    let makefile;
    if (raw.makefile !== undefined) {
        if (typeof raw.makefile === 'string' && raw.makefile.trim() !== '') {
            makefile = raw.makefile;
        } else {
            problems.push('"makefile" must be a path');
        }
    }
    const targets = new Map();
    if (raw.targets !== undefined) {
        if (raw.targets !== null && typeof raw.targets === 'object' && !Array.isArray(raw.targets)) {
            for (const [name, settings] of Object.entries(raw.targets)) {
                targets.set(name, targetSettings(name, settings, problems));
            }
        } else {
            problems.push('"targets" must be an object');
        }
    }
    return {
        config: {
            makefile,
            pathVariables,
            pathFormat,
            notifications,
            hidden: stringList(raw, 'hidden', problems).map(globToRegExp),
            confirm: stringList(raw, 'confirm', problems).map(globToRegExp),
            targets,
        },
        problems,
    };
}

function resolveTarget(target, config) {
    const own = config.targets.get(target.name) ?? {};
    const matches = (patterns) => patterns.some((pattern) => pattern.test(target.name));
    const pathVariable = 'pathVariable' in own
        ? own.pathVariable ?? undefined
        : config.pathVariables.find((name) => target.variables.has(name));
    return {
        ...target,
        isHidden: own.hidden ?? matches(config.hidden),
        needsConfirmation: own.confirm ?? matches(config.confirm),
        pathVariable,
        notifications: own.notifications ?? config.notifications,
        args: own.args ?? {},
    };
}

module.exports = { parseJsonc, normalizeConfig, resolveTarget, globToRegExp };
