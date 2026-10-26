// @ts-check
'use strict';

const path = require('path');

const FORBIDDEN_IN_PATH = /["`$\\\r\n]/;
const FILE_LINE = /(?:^|[\s'"(\[=])((?:\/|\.{1,2}\/)?[\w.@+-]+(?:\/[\w.@+-]+)*\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/;
const FILE_HEADER = /^FILE:\s+(.+?)\s*$/;
const ABSOLUTE_PATH_LINE = /^(\/\S+\.[A-Za-z0-9]+)$/;
const ROW_WITH_LINE = /^\s*(\d+)(?::(\d+))?\s+(?:\|\s+)?(?:ERROR|WARNING|error|warning)\b/;
const ABSOLUTE_PATH_IN_TEXT = /(?:^|[\s'"(\[=])(\/[\w.@+-]+(?:\/[\w.@+-]+)*\.[A-Za-z0-9]+)(?=$|[\s'")\],;])/;

/**
 * @typedef {{ file: string, line: number, column: number }} FileLocation
 * @typedef {{ value: string, problem?: undefined } | { problem: string, value?: undefined }} PathArgument
 * @typedef {{ name: string, args: Record<string, string>, pathVariable: string | undefined }} MakeArgumentsTarget
 */

/**
 * @param {number} value
 * @returns {string}
 */
function pad(value) {
    return String(value).padStart(2, '0');
}

/**
 * @param {number} timestamp
 * @param {number} [now]
 * @returns {string}
 */
function formatClock(timestamp, now = Date.now()) {
    const date = new Date(timestamp);
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (date.toDateString() === new Date(now).toDateString()) {
        return time;
    }
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

/**
 * @param {number} milliseconds
 * @returns {string}
 */
function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1_000);
    if (seconds < 1) {
        return '<1s';
    }
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m ${pad(seconds % 60)}s`;
    }
    return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

/**
 * The value a path variable gets for a file or folder. make expands it inside a bash recipe, so characters
 * that bash would interpret inside double quotes are refused rather than escaped.
 *
 * @param {string} makefileDirectory
 * @param {string} fsPath
 * @param {import('./projectConfig').PathFormat} pathFormat
 * @returns {PathArgument}
 */
function pathArgument(makefileDirectory, fsPath, pathFormat) {
    const relative = path.relative(makefileDirectory, fsPath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return { problem: `${fsPath} is outside ${makefileDirectory}` };
    }
    const value = pathFormat === 'absolute'
        ? fsPath
        : relative === '' ? '.' : `./${relative.split(path.sep).join('/')}`;
    if (FORBIDDEN_IN_PATH.test(value)) {
        return { problem: `${value} contains " \` $ \\ or a line break, which the shell inside make would interpret` };
    }
    return { value };
}

/**
 * @param {string} makefileDirectory
 * @param {MakeArgumentsTarget} target
 * @param {string | undefined} pathValue
 * @returns {string[]}
 */
function makeArguments(makefileDirectory, target, pathValue) {
    const args = ['--no-print-directory', '-C', makefileDirectory, target.name];
    for (const [name, value] of Object.entries(target.args)) {
        args.push(`${name}=${value}`);
    }
    if (pathValue !== undefined) {
        args.push(`${target.pathVariable}=${pathValue}`);
    }
    return args;
}

/**
 * @param {string} makeCommand
 * @param {string[]} args
 * @returns {string}
 */
function displayCommand(makeCommand, args) {
    return [makeCommand, ...args].map((part) => (/^[\w./:=@%+,-]+$/.test(part) ? part : `'${part}'`)).join(' ');
}

/**
 * Finds the file a line of output points at: `path:line[:column]` anywhere in the line, or a bare line number
 * under a file header, the way PHP_CodeSniffer (`FILE: …`) and ESLint (a path alone on its line) group reports,
 * or else an absolute file path anywhere in the line, opened at its start.
 *
 * @param {string} baseDirectory
 * @returns {(text: string) => FileLocation | undefined}
 */
function createLocationTracker(baseDirectory) {
    /** @type {string | undefined} */
    let currentFile;
    /** @type {(file: string) => string} */
    const resolve = (file) => (path.isAbsolute(file) ? file : path.resolve(baseDirectory, file));
    return (text) => {
        const header = FILE_HEADER.exec(text) ?? ABSOLUTE_PATH_LINE.exec(text);
        if (header !== null) {
            currentFile = resolve(header[1]);
            return { file: currentFile, line: 1, column: 1 };
        }
        const fileLine = FILE_LINE.exec(text);
        if (fileLine !== null) {
            return { file: resolve(fileLine[1]), line: Number(fileLine[2]), column: Number(fileLine[3] ?? 1) };
        }
        const row = ROW_WITH_LINE.exec(text);
        if (row !== null && currentFile !== undefined) {
            return { file: currentFile, line: Number(row[1]), column: Number(row[2] ?? 1) };
        }
        const absolutePath = ABSOLUTE_PATH_IN_TEXT.exec(text);
        if (absolutePath !== null) {
            return { file: absolutePath[1], line: 1, column: 1 };
        }
        return undefined;
    };
}

module.exports.formatClock = formatClock;
module.exports.formatDuration = formatDuration;
module.exports.pathArgument = pathArgument;
module.exports.makeArguments = makeArguments;
module.exports.displayCommand = displayCommand;
module.exports.createLocationTracker = createLocationTracker;
