// @ts-check
'use strict';

const TREE_LINE_LIMIT = 2_000;
const FINISHED_STATES = new Set(['passed', 'failed', 'stopped', 'interrupted']);

/**
 * @typedef {import('./projectConfig').NotificationMode} NotificationMode
 * @typedef {import('./runText').FileLocation} FileLocation
 * @typedef {'running' | 'passed' | 'failed' | 'stopped' | 'interrupted'} RunState
 * @typedef {{ text: string, isError: boolean, location?: FileLocation }} OutputLine
 * @typedef {{
 *     id: string,
 *     projectRoot: string,
 *     projectName: string,
 *     makefileDirectory: string,
 *     target: string,
 *     pathValue: string | undefined,
 *     command: string,
 *     logFile: string,
 *     startedAt: number,
 *     finishedAt: number | undefined,
 *     exitCode: number | undefined,
 *     signal: NodeJS.Signals | undefined,
 *     state: RunState,
 *     failure: string | undefined,
 * }} RunRecord
 * @typedef {Pick<RunRecord, 'id' | 'projectRoot' | 'projectName' | 'makefileDirectory' | 'target' | 'pathValue'
 *     | 'command' | 'logFile' | 'startedAt'>
 *     & Partial<Pick<RunRecord, 'finishedAt' | 'exitCode' | 'signal' | 'state' | 'failure'>>
 *     & { notifications?: NotificationMode, hasLoadedLines?: boolean }} RunFields
 */

/**
 * One make invocation: what was run, its state and the tail of its output. The full output is in logFile.
 */
class MakeRun {
    /** @type {string} */
    id = '';
    /** @type {string} */
    projectRoot = '';
    /** @type {string} */
    projectName = '';
    /** @type {string} */
    makefileDirectory = '';
    /** @type {string} the target name */
    target = '';
    /** @type {string | undefined} */
    pathValue;
    /** @type {NotificationMode} */
    notifications = 'always';
    /** @type {string} */
    command = '';
    /** @type {string} */
    logFile = '';
    /** @type {number} */
    startedAt = 0;
    /** @type {number | undefined} */
    finishedAt = undefined;
    /** @type {number | undefined} */
    exitCode = undefined;
    /** @type {NodeJS.Signals | undefined} */
    signal = undefined;
    /** @type {RunState} */
    state = 'running';
    /** @type {string | undefined} */
    failure = undefined;
    isStopRequested = false;
    /** @type {OutputLine[]} */
    lines = [];
    lineCount = 0;
    currentLine = '';
    hasLoadedLines = true;
    /** @type {Promise<MakeRun>} */
    completion;
    /** @type {(run: MakeRun) => void} */
    #resolveCompletion = () => {};

    /** @param {RunFields} fields */
    constructor(fields) {
        Object.assign(this, fields);
        this.completion = new Promise((resolve) => {
            this.#resolveCompletion = resolve;
        });
        if (FINISHED_STATES.has(this.state)) {
            this.#resolveCompletion(this);
        }
    }

    /**
     * @param {RunRecord} record
     * @returns {MakeRun}
     */
    static fromRecord(record) {
        return new MakeRun({
            ...record,
            state: record.state === 'running' ? 'interrupted' : record.state,
            hasLoadedLines: false,
        });
    }

    /**
     * @param {string} projectRoot
     * @param {string} targetName
     * @param {string | undefined} pathValue
     * @returns {string}
     */
    static lockKey(projectRoot, targetName, pathValue) {
        return [projectRoot, targetName, pathValue ?? ''].join('\0');
    }

    /** @returns {string} */
    get key() {
        return MakeRun.lockKey(this.projectRoot, this.target, this.pathValue);
    }

    /** @returns {boolean} */
    get isRunning() {
        return this.state === 'running';
    }

    /** @returns {number} */
    get duration() {
        return (this.finishedAt ?? Date.now()) - this.startedAt;
    }

    /**
     * @param {string} text
     * @param {boolean} isError
     * @param {FileLocation | undefined} location
     */
    appendLine(text, isError, location) {
        this.lines.push({ text, isError, location });
        this.lineCount += 1;
        if (this.lines.length > TREE_LINE_LIMIT * 1.5) {
            this.lines.splice(0, this.lines.length - TREE_LINE_LIMIT);
        }
    }

    /**
     * @param {OutputLine[]} lines
     * @param {number} lineCount
     */
    setLoadedLines(lines, lineCount) {
        this.lines = lines.slice(-TREE_LINE_LIMIT);
        this.lineCount = lineCount;
        this.hasLoadedLines = true;
    }

    /** @returns {OutputLine[]} */
    get visibleLines() {
        return this.lines.slice(-TREE_LINE_LIMIT);
    }

    /**
     * @param {number | null} exitCode
     * @param {NodeJS.Signals | null} signal
     * @param {string | undefined} failure
     * @returns {asserts this is MakeRun & { finishedAt: number }}
     */
    finish(exitCode, signal, failure) {
        this.finishedAt = Date.now();
        this.exitCode = exitCode ?? undefined;
        this.signal = signal ?? undefined;
        this.failure = failure;
        this.currentLine = '';
        if (this.isStopRequested) {
            this.state = 'stopped';
        } else {
            this.state = exitCode === 0 && failure === undefined ? 'passed' : 'failed';
        }
        this.#resolveCompletion(this);
    }

    /** @returns {RunRecord} */
    toRecord() {
        return {
            id: this.id,
            projectRoot: this.projectRoot,
            projectName: this.projectName,
            makefileDirectory: this.makefileDirectory,
            target: this.target,
            pathValue: this.pathValue,
            command: this.command,
            logFile: this.logFile,
            startedAt: this.startedAt,
            finishedAt: this.finishedAt,
            exitCode: this.exitCode,
            signal: this.signal,
            state: this.state,
            failure: this.failure,
        };
    }
}

module.exports.MakeRun = MakeRun;
module.exports.TREE_LINE_LIMIT = TREE_LINE_LIMIT;
