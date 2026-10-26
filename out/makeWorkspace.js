// @ts-check
'use strict';

const path = require('path');
const vscode = require('vscode');
const { MakeProject } = require('./makeProject');

const RELOAD_DELAY_MS = 300;
const FOLDER_WATCHED_FILES = Object.freeze([
    'GNUmakefile',
    'makefile',
    'Makefile',
    path.join('.vscode', 'make-targets.json'),
]);
const FOLDER_WATCH_PATTERN = '{GNUmakefile,makefile,Makefile,.vscode/make-targets.json}';

/** @typedef {import('vscode').FileSystemWatcher} FileSystemWatcher */

/**
 * The make projects of the open workspace folders. Reloads a project when its config, its Makefile or an
 * included file changes, and keeps the context keys of the view title buttons in step.
 */
class MakeWorkspace {
    /** @type {import('vscode').LogOutputChannel} */
    #log;
    /** @type {Map<string, MakeProject>} by workspace folder URI */
    #projects = new Map();
    /** @type {Map<string, FileSystemWatcher>} by workspace folder URI */
    #folderWatchers = new Map();
    /** @type {Map<string, FileSystemWatcher[]>} by workspace folder URI */
    #fileWatchers = new Map();
    /** @type {Map<MakeProject, NodeJS.Timeout>} */
    #reloadTimers = new Map();
    /** @type {import('vscode').EventEmitter<void>} */
    #onDidChange = new vscode.EventEmitter();

    /** @param {import('vscode').LogOutputChannel} log */
    constructor(log) {
        this.#log = log;
    }

    /** @returns {import('vscode').Event<void>} */
    get onDidChange() {
        return this.#onDidChange.event;
    }

    /** @returns {MakeProject[]} the projects that have a Makefile or a config */
    get projects() {
        return [...this.#projects.values()].filter((project) => project.isRelevant);
    }

    /** @returns {Promise<void>} */
    async syncFolders() {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const folderKeys = new Set(folders.map((folder) => folder.uri.toString()));
        for (const key of [...this.#projects.keys()]) {
            if (!folderKeys.has(key)) {
                this.#dropProject(key);
            }
        }
        await Promise.all(folders.map(async (folder) => {
            const key = folder.uri.toString();
            if (this.#projects.has(key)) {
                return;
            }
            const project = new MakeProject(folder);
            this.#projects.set(key, project);
            const pattern = new vscode.RelativePattern(folder, FOLDER_WATCH_PATTERN);
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            const schedule = () => this.#scheduleReload(project);
            watcher.onDidCreate(schedule);
            watcher.onDidChange(schedule);
            watcher.onDidDelete(schedule);
            this.#folderWatchers.set(key, watcher);
            await this.#load(project);
        }));
        this.#publish();
    }

    /** @returns {Promise<void>} */
    async reloadAll() {
        await Promise.all([...this.#projects.values()].map((project) => this.#load(project)));
        this.#publish();
    }

    /**
     * @param {MakeProject} project
     * @returns {Promise<void>}
     */
    async reload(project) {
        await this.#load(project);
        this.#publish();
    }

    dispose() {
        for (const key of [...this.#projects.keys()]) {
            this.#dropProject(key);
        }
        this.#onDidChange.dispose();
    }

    /**
     * @param {MakeProject} project
     * @returns {Promise<void>}
     */
    async #load(project) {
        try {
            await project.load();
        } catch (error) {
            this.#log.error(`Loading ${project.rootPath}: ${/** @type {Error} */ (error).message}`);
        }
        this.#watchFiles(project);
        for (const problem of project.problems) {
            this.#log.warn(`${project.name}: ${problem}`);
        }
    }

    /** @param {MakeProject} project */
    #watchFiles(project) {
        const key = project.folder.uri.toString();
        for (const watcher of this.#fileWatchers.get(key) ?? []) {
            watcher.dispose();
        }
        const folderPath = project.rootPath;
        const outsideFolderWatch = project.watchedFiles.filter((file) => {
            const relative = path.relative(folderPath, file);
            return !FOLDER_WATCHED_FILES.includes(relative);
        });
        const watchers = outsideFolderWatch.map((file) => {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)),
            );
            const schedule = () => this.#scheduleReload(project);
            watcher.onDidCreate(schedule);
            watcher.onDidChange(schedule);
            watcher.onDidDelete(schedule);
            return watcher;
        });
        this.#fileWatchers.set(key, watchers);
    }

    /** @param {MakeProject} project */
    #scheduleReload(project) {
        clearTimeout(this.#reloadTimers.get(project));
        this.#reloadTimers.set(project, setTimeout(() => {
            this.#reloadTimers.delete(project);
            void this.reload(project);
        }, RELOAD_DELAY_MS));
    }

    /** @param {string} key the workspace folder URI */
    #dropProject(key) {
        const project = this.#projects.get(key);
        if (project !== undefined) {
            clearTimeout(this.#reloadTimers.get(project));
            this.#reloadTimers.delete(project);
        }
        this.#folderWatchers.get(key)?.dispose();
        this.#folderWatchers.delete(key);
        for (const watcher of this.#fileWatchers.get(key) ?? []) {
            watcher.dispose();
        }
        this.#fileWatchers.delete(key);
        this.#projects.delete(key);
    }

    #publish() {
        const projects = this.projects;
        void vscode.commands.executeCommand(
            'setContext',
            'makeTargets.canCreateConfig',
            projects.some((project) => !project.hasConfig && project.makefilePath !== undefined),
        );
        void vscode.commands.executeCommand(
            'setContext',
            'makeTargets.hasConfig',
            projects.some((project) => project.hasConfig),
        );
        void vscode.commands.executeCommand(
            'setContext',
            'makeTargets.hasPathTargets',
            projects.some((project) => project.visibleTargets.some((target) => target.pathVariable !== undefined)),
        );
        this.#onDidChange.fire();
    }
}

module.exports.MakeWorkspace = MakeWorkspace;
