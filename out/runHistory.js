'use strict';

const fs = require('fs/promises');
const path = require('path');
const { MakeRun } = require('./makeRun');

const RUNS_KEY = 'makeTargets.runs';
const LAST_RUNS_KEY = 'makeTargets.lastRuns';
const LAST_PATH_TARGETS_KEY = 'makeTargets.lastPathTargets';
const MAX_RUNS = 20;

/**
 * What survives a window reload: the last runs with their log files, the last run of every target and
 * the last target run on a path in every project. Kept in the workspace state.
 */
class RunHistory {
    #memento;
    #logDirectory;

    constructor(memento, logDirectory) {
        this.#memento = memento;
        this.#logDirectory = logDirectory;
    }

    get logDirectory() {
        return this.#logDirectory;
    }

    loadRuns() {
        return this.#memento.get(RUNS_KEY, []).map((record) => MakeRun.fromRecord(record));
    }

    async saveRuns(runs) {
        const kept = runs.slice(0, MAX_RUNS);
        await this.#memento.update(RUNS_KEY, kept.map((run) => run.toRecord()));
        await this.#deleteLogsExcept(new Set(kept.map((run) => path.basename(run.logFile))));
        return kept;
    }

    lastRunOf(projectRoot, targetName) {
        return this.#memento.get(LAST_RUNS_KEY, {})[`${projectRoot}\0${targetName}`];
    }

    async recordLastRun(run) {
        const lastRuns = { ...this.#memento.get(LAST_RUNS_KEY, {}) };
        lastRuns[`${run.projectRoot}\0${run.target}`] = {
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            exitCode: run.exitCode,
            state: run.state,
            pathValue: run.pathValue,
        };
        await this.#memento.update(LAST_RUNS_KEY, lastRuns);
    }

    lastPathTarget(projectRoot) {
        return this.#memento.get(LAST_PATH_TARGETS_KEY, {})[projectRoot];
    }

    async setLastPathTarget(projectRoot, targetName) {
        await this.#memento.update(LAST_PATH_TARGETS_KEY, {
            ...this.#memento.get(LAST_PATH_TARGETS_KEY, {}),
            [projectRoot]: targetName,
        });
    }

    async #deleteLogsExcept(keptNames) {
        let names;
        try {
            names = await fs.readdir(this.#logDirectory);
        } catch {
            return;
        }
        await Promise.all(names
            .filter((name) => name.endsWith('.log') && !keptNames.has(name))
            .map((name) => fs.rm(path.join(this.#logDirectory, name), { force: true })));
    }
}

module.exports = { RunHistory };
