'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { MakeRun } = require('./makeRun');
const { TerminalLineBuffer } = require('./terminalLineBuffer');
const { createLocationTracker, displayCommand, formatClock, formatDuration, makeArguments } = require('./runText');

const CHANGE_THROTTLE_MS = 300;
const KILL_GRACE_MS = 5_000;
const LOG_HEADER_LINES = 3;

function timestampText(timestamp) {
    return new Date(timestamp).toLocaleString('sv-SE');
}

function outcomeText(run) {
    if (run.state === 'stopped') {
        return 'stopped';
    }
    if (run.failure !== undefined) {
        return `failed to start: ${run.failure}`;
    }
    return run.signal === undefined ? `exit ${run.exitCode}` : `killed by ${run.signal}`;
}

/**
 * Runs make targets as background processes, one process group per run, so Stop reaches everything make
 * started. A run is refused while one with the same project, target and path is still going.
 */
class MakeRunner {
    #history;
    #log;
    #runs;
    #processes = new Map();
    #changeTimers = new Map();
    #onDidChangeRuns = new vscode.EventEmitter();
    #onDidChangeRun = new vscode.EventEmitter();
    #onDidRequestReveal = new vscode.EventEmitter();

    constructor(history, log) {
        this.#history = history;
        this.#log = log;
        this.#runs = history.loadRuns();
    }

    get onDidChangeRuns() {
        return this.#onDidChangeRuns.event;
    }

    get onDidChangeRun() {
        return this.#onDidChangeRun.event;
    }

    get onDidRequestReveal() {
        return this.#onDidRequestReveal.event;
    }

    get runs() {
        return this.#runs;
    }

    get runningCount() {
        return this.#runs.filter((run) => run.isRunning).length;
    }

    runningRunsOf(projectRoot, targetName) {
        return this.#runs
            .filter((run) => run.isRunning && run.projectRoot === projectRoot && run.target === targetName);
    }

    latestRunOf(projectRoot, targetName) {
        return this.#runs.find((run) => run.projectRoot === projectRoot && run.target === targetName);
    }

    lastRunOf(projectRoot, targetName) {
        return this.#history.lastRunOf(projectRoot, targetName);
    }

    async start({ project, target, pathValue, isConfirmed = false }) {
        const key = MakeRun.lockKey(project.rootPath, target.name, pathValue);
        const active = this.#runs.find((run) => run.isRunning && run.key === key);
        if (active !== undefined) {
            const where = pathValue === undefined ? '' : ` on ${pathValue}`;
            const answer = await vscode.window.showWarningMessage(
                `make ${target.name}${where} is already running since ${formatClock(active.startedAt)}.`,
                'Show Output',
            );
            if (answer === 'Show Output') {
                this.#onDidRequestReveal.fire(active);
            }
            return undefined;
        }

        const makeCommand = vscode.workspace.getConfiguration('makeTargets', project.folder.uri)
            .get('makeCommand', 'make');
        const args = makeArguments(project.makefileDirectory, target, pathValue);
        const command = displayCommand(makeCommand, args);
        if (target.needsConfirmation && !isConfirmed) {
            const answer = await vscode.window.showWarningMessage(
                `Run make ${target.name}${pathValue === undefined ? '' : ` on ${pathValue}`}?`,
                { modal: true, detail: command },
                'Run',
            );
            if (answer !== 'Run') {
                return undefined;
            }
        }

        const startedAt = Date.now();
        const id = `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const run = new MakeRun({
            id,
            projectRoot: project.rootPath,
            projectName: project.name,
            makefileDirectory: project.makefileDirectory,
            target: target.name,
            pathValue,
            notifications: target.notifications,
            command,
            logFile: path.join(this.#history.logDirectory, `${id}.log`),
            startedAt,
        });
        this.#runs.unshift(run);
        this.#runs = await this.#history.saveRuns(this.#runs);
        this.#onDidChangeRuns.fire();
        this.#launch(run, makeCommand, args);
        this.#onDidRequestReveal.fire(run);
        return run;
    }

    stop(run) {
        const child = this.#processes.get(run.id);
        if (child === undefined) {
            return;
        }
        run.isStopRequested = true;
        this.#signal(child, 'SIGTERM');
        setTimeout(() => {
            if (this.#processes.has(run.id)) {
                this.#signal(child, 'SIGKILL');
            }
        }, KILL_GRACE_MS);
    }

    async remove(run) {
        if (run.isRunning) {
            return;
        }
        this.#runs = this.#runs.filter((candidate) => candidate !== run);
        this.#runs = await this.#history.saveRuns(this.#runs);
        this.#onDidChangeRuns.fire();
    }

    async clearFinished() {
        this.#runs = this.#runs.filter((run) => run.isRunning);
        this.#runs = await this.#history.saveRuns(this.#runs);
        this.#onDidChangeRuns.fire();
    }

    async loadLines(run) {
        if (run.hasLoadedLines) {
            return;
        }
        let text = '';
        try {
            text = await fs.promises.readFile(run.logFile, 'utf8');
        } catch {
            run.setLoadedLines([], 0);
            return;
        }
        const physical = text.split('\n').slice(LOG_HEADER_LINES);
        while (physical.length > 0 && physical[physical.length - 1] === '') {
            physical.pop();
        }
        if (physical.length > 0 && physical[physical.length - 1].startsWith('# ')) {
            physical.pop();
            if (physical[physical.length - 1] === '') {
                physical.pop();
            }
        }
        const locate = createLocationTracker(run.makefileDirectory);
        const lines = physical.map((line) => ({ text: line, isError: false, location: locate(line) }));
        run.setLoadedLines(lines, physical.length);
    }

    reveal(run) {
        this.#onDidRequestReveal.fire(run);
    }

    dispose() {
        for (const child of this.#processes.values()) {
            this.#signal(child, 'SIGTERM');
        }
        for (const timer of this.#changeTimers.values()) {
            clearTimeout(timer);
        }
        this.#onDidChangeRuns.dispose();
        this.#onDidChangeRun.dispose();
        this.#onDidRequestReveal.dispose();
    }

    #launch(run, makeCommand, args) {
        fs.mkdirSync(path.dirname(run.logFile), { recursive: true });
        const log = fs.createWriteStream(run.logFile, { flags: 'w' });
        log.write(`$ ${run.command}\n# started ${timestampText(run.startedAt)}\n\n`);
        this.#log.info(`${run.projectName}: ${run.command}`);

        const locate = createLocationTracker(run.makefileDirectory);
        const output = new TerminalLineBuffer();
        const errors = new TerminalLineBuffer();
        const append = (text, isError) => {
            run.appendLine(text, isError, locate(text));
            log.write(`${text}\n`);
        };
        const reader = (buffer, isError) => (chunk) => {
            for (const line of buffer.write(chunk)) {
                append(line, isError);
            }
            run.currentLine = output.currentLine !== '' ? output.currentLine : errors.currentLine;
            this.#scheduleChange(run);
        };

        let child;
        try {
            child = spawn(makeCommand, args, {
                cwd: run.makefileDirectory,
                detached: process.platform !== 'win32',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (error) {
            void this.#finish(run, log, null, null, error.message);
            return;
        }
        this.#processes.set(run.id, child);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', reader(output, false));
        child.stderr.on('data', reader(errors, true));

        let isFinished = false;
        const finish = (exitCode, signal, failure) => {
            if (isFinished) {
                return;
            }
            isFinished = true;
            for (const [buffer, isError] of [[output, false], [errors, true]]) {
                const rest = buffer.flush();
                if (rest !== undefined) {
                    append(rest, isError);
                }
            }
            this.#processes.delete(run.id);
            void this.#finish(run, log, exitCode, signal, failure);
        };
        child.on('error', (error) => finish(null, null, error.message));
        child.on('close', (exitCode, signal) => finish(exitCode, signal, undefined));
    }

    async #finish(run, log, exitCode, signal, failure) {
        run.finish(exitCode, signal, failure);
        const summary = `${outcomeText(run)} · ${formatDuration(run.duration)}`;
        log.end(`\n# ${summary} · finished ${timestampText(run.finishedAt)}\n`);
        clearTimeout(this.#changeTimers.get(run.id));
        this.#changeTimers.delete(run.id);
        this.#log.info(`${run.projectName}: make ${run.target} — ${summary}`);
        await this.#history.recordLastRun(run);
        this.#runs = await this.#history.saveRuns(this.#runs);
        this.#onDidChangeRun.fire(run);
        this.#onDidChangeRuns.fire();
        this.#notify(run);
    }

    #notify(run) {
        if (run.notifications === 'never' || (run.notifications === 'failures' && run.state !== 'failed')) {
            return;
        }
        const what = `make ${run.target}${run.pathValue === undefined ? '' : ` on ${run.pathValue}`}`;
        const message = run.state === 'passed'
            ? `${what} finished in ${formatDuration(run.duration)}.`
            : `${what}: ${outcomeText(run)} after ${formatDuration(run.duration)}.`;
        const shown = run.state === 'passed'
            ? vscode.window.showInformationMessage(message, 'Show Output')
            : vscode.window.showErrorMessage(message, 'Show Output');
        shown.then((answer) => {
            if (answer === 'Show Output') {
                this.#onDidRequestReveal.fire(run);
            }
        });
    }

    #scheduleChange(run) {
        if (this.#changeTimers.has(run.id)) {
            return;
        }
        this.#changeTimers.set(run.id, setTimeout(() => {
            this.#changeTimers.delete(run.id);
            this.#onDidChangeRun.fire(run);
        }, CHANGE_THROTTLE_MS));
    }

    #signal(child, signal) {
        try {
            if (process.platform === 'win32') {
                child.kill(signal);
            } else {
                process.kill(-child.pid, signal);
            }
        } catch (error) {
            this.#log.warn(`Could not send ${signal} to make (pid ${child.pid}): ${error.message}`);
        }
    }
}

module.exports = { MakeRunner };
