'use strict';

const TREE_LINE_LIMIT = 2_000;
const FINISHED_STATES = new Set(['passed', 'failed', 'stopped', 'interrupted']);

/**
 * One make invocation: what was run, its state and the tail of its output. The full output is in logFile.
 */
class MakeRun {
    id;
    projectRoot;
    projectName;
    makefileDirectory;
    target;
    pathValue;
    notifications = 'always';
    command;
    logFile;
    startedAt;
    finishedAt = undefined;
    exitCode = undefined;
    signal = undefined;
    state = 'running';
    failure = undefined;
    isStopRequested = false;
    lines = [];
    lineCount = 0;
    currentLine = '';
    hasLoadedLines = true;
    completion;
    #resolveCompletion;

    constructor(fields) {
        Object.assign(this, fields);
        this.completion = new Promise((resolve) => {
            this.#resolveCompletion = resolve;
        });
        if (FINISHED_STATES.has(this.state)) {
            this.#resolveCompletion(this);
        }
    }

    static fromRecord(record) {
        return new MakeRun({
            ...record,
            state: record.state === 'running' ? 'interrupted' : record.state,
            hasLoadedLines: false,
        });
    }

    static lockKey(projectRoot, targetName, pathValue) {
        return [projectRoot, targetName, pathValue ?? ''].join('\0');
    }

    get key() {
        return MakeRun.lockKey(this.projectRoot, this.target, this.pathValue);
    }

    get isRunning() {
        return this.state === 'running';
    }

    get duration() {
        return (this.finishedAt ?? Date.now()) - this.startedAt;
    }

    appendLine(text, isError, location) {
        this.lines.push({ text, isError, location });
        this.lineCount += 1;
        if (this.lines.length > TREE_LINE_LIMIT * 1.5) {
            this.lines.splice(0, this.lines.length - TREE_LINE_LIMIT);
        }
    }

    setLoadedLines(lines, lineCount) {
        this.lines = lines.slice(-TREE_LINE_LIMIT);
        this.lineCount = lineCount;
        this.hasLoadedLines = true;
    }

    get visibleLines() {
        return this.lines.slice(-TREE_LINE_LIMIT);
    }

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

module.exports = { MakeRun, TREE_LINE_LIMIT };
