// @ts-check
'use strict';

const fs = require('fs/promises');
const path = require('path');
const { MakeRun } = require('./makeRun');

const RUNS_KEY = 'makeTargets.runs';
const LAST_RUNS_KEY = 'makeTargets.lastRuns';
const LAST_PATH_TARGETS_KEY = 'makeTargets.lastPathTargets';
const MAX_RUNS = 20;

/**
 * @typedef {import('./makeRun').RunRecord} RunRecord
 * @typedef {Pick<RunRecord, 'startedAt' | 'finishedAt' | 'exitCode' | 'state' | 'pathValue'>} LastRun
 * @typedef {Record<string, LastRun>} LastRuns by project root and target name
 */

/**
 * What survives a window reload: the last runs with their log files, the last run of every target and
 * the last target run on a path in every project. Kept in the workspace state.
 */
class RunHistory {
    /** @type {import('vscode').Memento} */
    #memento;
    /** @type {string} */
    #logDirectory;

    /**
     * @param {import('vscode').Memento} memento
     * @param {string} logDirectory
     */
    constructor(memento, logDirectory) {
        this.#memento = memento;
        this.#logDirectory = logDirectory;
    }

    /** @returns {string} */
    get logDirectory() {
        return this.#logDirectory;
    }

    /** @returns {MakeRun[]} */
    loadRuns() {
        return this.#memento.get(RUNS_KEY, /** @type {RunRecord[]} */ ([])).map((record) => MakeRun.fromRecord(record));
    }

    /**
     * @param {MakeRun[]} runs
     * @returns {Promise<MakeRun[]>} the runs kept
     */
    async saveRuns(runs) {
        const kept = runs.slice(0, MAX_RUNS);
        await this.#memento.update(RUNS_KEY, kept.map((run) => run.toRecord()));
        await this.#deleteLogsExcept(new Set(kept.map((run) => path.basename(run.logFile))));
        return kept;
    }

    /**
     * @param {string} projectRoot
     * @param {string} targetName
     * @returns {LastRun | undefined}
     */
    lastRunOf(projectRoot, targetName) {
        return this.#memento.get(LAST_RUNS_KEY, /** @type {LastRuns} */ ({}))[`${projectRoot}\0${targetName}`];
    }

    /**
     * @param {MakeRun} run
     * @returns {Promise<void>}
     */
    async recordLastRun(run) {
        const lastRuns = { ...this.#memento.get(LAST_RUNS_KEY, /** @type {LastRuns} */ ({})) };
        lastRuns[`${run.projectRoot}\0${run.target}`] = {
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            exitCode: run.exitCode,
            state: run.state,
            pathValue: run.pathValue,
        };
        await this.#memento.update(LAST_RUNS_KEY, lastRuns);
    }

    /**
     * @param {string} projectRoot
     * @returns {string | undefined} the target name
     */
    lastPathTarget(projectRoot) {
        return this.#memento.get(LAST_PATH_TARGETS_KEY, /** @type {Record<string, string>} */ ({}))[projectRoot];
    }

    /**
     * @param {string} projectRoot
     * @param {string} targetName
     * @returns {Promise<void>}
     */
    async setLastPathTarget(projectRoot, targetName) {
        await this.#memento.update(LAST_PATH_TARGETS_KEY, {
            ...this.#memento.get(LAST_PATH_TARGETS_KEY, {}),
            [projectRoot]: targetName,
        });
    }

    /**
     * @param {Set<string>} keptNames
     * @returns {Promise<void>}
     */
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

module.exports.RunHistory = RunHistory;
