// @ts-check
'use strict';

const fs = require('fs/promises');
const path = require('path');
const vscode = require('vscode');
const { buildInitialConfig } = require('./configTemplate');
const { formatClock, pathArgument } = require('./runText');

const RUNS_VIEW_ID = 'makeTargets.runs';

/**
 * @typedef {import('vscode').Uri} Uri
 * @typedef {import('./makeProject').MakeProject} MakeProject
 * @typedef {import('./makeProject').MakeTarget} MakeTarget
 * @typedef {import('./makeRun').MakeRun} MakeRun
 * @typedef {import('./makeRunner').MakeRunner} MakeRunner
 * @typedef {import('./makeWorkspace').MakeWorkspace} MakeWorkspace
 * @typedef {import('./runHistory').RunHistory} RunHistory
 * @typedef {import('./runText').FileLocation} FileLocation
 * @typedef {import('./runTreeProvider').RunTreeProvider} RunTreeProvider
 * @typedef {import('./runTreeProvider').RunTreeNode} RunTreeNode
 * @typedef {import('./runTreeProvider').RunNode} RunNode
 * @typedef {import('./targetTreeProvider').TargetNode} TargetNode
 * @typedef {{
 *     workspace: MakeWorkspace,
 *     runner: MakeRunner,
 *     history: RunHistory,
 *     runTree: RunTreeProvider,
 *     runView: import('vscode').TreeView<RunTreeNode>,
 *     log: import('vscode').LogOutputChannel,
 * }} CommandServices
 * @typedef {Partial<Error> | null | undefined} ThrownValue what a command handler may throw, Error or not
 */

/**
 * The commands of both views and of the file context menus.
 */
class MakeCommands {
    /** @type {MakeWorkspace} */
    #workspace;
    /** @type {MakeRunner} */
    #runner;
    /** @type {RunHistory} */
    #history;
    /** @type {RunTreeProvider} */
    #runTree;
    /** @type {import('vscode').TreeView<RunTreeNode>} */
    #runView;
    /** @type {import('vscode').LogOutputChannel} */
    #log;

    /** @param {CommandServices} services */
    constructor({ workspace, runner, history, runTree, runView, log }) {
        this.#workspace = workspace;
        this.#runner = runner;
        this.#history = history;
        this.#runTree = runTree;
        this.#runView = runView;
        this.#log = log;
    }

    /** @returns {import('vscode').Disposable[]} */
    register() {
        const handlers = {
            'makeTargets.refresh': () => this.#workspace.reloadAll(),
            'makeTargets.createConfig': () => this.#createConfig(),
            'makeTargets.openConfig': (/** @type {MakeProject | undefined} */ project) => this.#openConfig(project),
            'makeTargets.runTarget': (/** @type {TargetNode} */ node) => this.#runner.start({
                project: node.project,
                target: node.target,
            }),
            'makeTargets.stopTarget': (/** @type {TargetNode} */ node) => this.#stopTarget(node),
            'makeTargets.openInMakefile': (/** @type {TargetNode} */ node) => this.#openInMakefile(node),
            'makeTargets.showLastRun': (/** @type {TargetNode} */ node) => this.#showLastRun(node),
            'makeTargets.copyTargetName': (/** @type {TargetNode} */ node) => this.#copyTargetName(node),
            'makeTargets.runOnPath': (/** @type {Uri | undefined} */ uri, /** @type {Uri[] | undefined} */ uris) =>
                this.#runOnPaths(uri, uris, false),
            'makeTargets.repeatOnPath': (/** @type {Uri | undefined} */ uri, /** @type {Uri[] | undefined} */ uris) =>
                this.#runOnPaths(uri, uris, true),
            'makeTargets.stopRun': (/** @type {RunNode} */ node) => this.#runner.stop(node.run),
            'makeTargets.rerun': (/** @type {RunNode} */ node) => this.#rerun(node.run),
            'makeTargets.openRunOutput': (/** @type {RunNode} */ node) => this.#openRunOutput(node.run),
            'makeTargets.copyRunOutput': (/** @type {RunNode} */ node) => this.#copyRunOutput(node.run),
            'makeTargets.removeRun': (/** @type {RunNode} */ node) => this.#runner.remove(node.run),
            'makeTargets.clearRuns': () => this.#runner.clearFinished(),
            'makeTargets.openLocation': (/** @type {FileLocation} */ location) => this.#openLocation(location),
        };
        const disposables = Object.entries(handlers).map(([command, handler]) => vscode.commands.registerCommand(
            command,
            async (...args) => {
                try {
                    await handler(...args);
                } catch (error) {
                    this.#log.error(`${command}: ${/** @type {ThrownValue} */ (error)?.stack ?? error}`);
                    vscode.window.showErrorMessage(
                        `${command}: ${/** @type {ThrownValue} */ (error)?.message ?? error}`,
                    );
                }
            },
        ));
        disposables.push(this.#runner.onDidRequestReveal((run) => this.#revealRun(run)));
        return disposables;
    }

    /** @returns {Promise<void>} */
    async #createConfig() {
        const candidates = this.#workspace.projects
            .filter((project) => !project.hasConfig && project.makefilePath !== undefined);
        const project = await pickProject(candidates, 'Create the Make Targets config for');
        if (project === undefined) {
            return;
        }
        const text = buildInitialConfig(await project.initialConfigInput());
        await fs.mkdir(path.dirname(project.configPath), { recursive: true });
        try {
            await fs.writeFile(project.configPath, text, { flag: 'wx' });
        } catch (error) {
            if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') {
                throw error;
            }
        }
        await this.#workspace.reload(project);
        await vscode.window.showTextDocument(vscode.Uri.file(project.configPath));
    }

    /**
     * @param {MakeProject | undefined} project the project of the clicked problem, or none from the view title
     * @returns {Promise<void>}
     */
    async #openConfig(project) {
        const configured = this.#workspace.projects.filter((candidate) => candidate.hasConfig);
        const target = project ?? await pickProject(configured, 'Open the config of');
        if (target !== undefined) {
            await vscode.window.showTextDocument(vscode.Uri.file(target.configPath));
        }
    }

    /** @param {TargetNode} node */
    #stopTarget(node) {
        for (const run of this.#runner.runningRunsOf(node.project.rootPath, node.target.name)) {
            this.#runner.stop(run);
        }
    }

    /**
     * @param {TargetNode} node
     * @returns {Promise<void>}
     */
    async #openInMakefile(node) {
        const position = new vscode.Position(Math.max(node.target.line - 1, 0), 0);
        await vscode.window.showTextDocument(vscode.Uri.file(node.target.file), {
            selection: new vscode.Range(position, position),
        });
    }

    /**
     * @param {TargetNode} node
     * @returns {Promise<void>}
     */
    async #showLastRun(node) {
        const run = this.#runner.latestRunOf(node.project.rootPath, node.target.name);
        if (run !== undefined) {
            await this.#revealRun(run);
        }
    }

    /**
     * @param {MakeRun} run
     * @returns {Promise<void>}
     */
    async #revealRun(run) {
        await vscode.commands.executeCommand(`${RUNS_VIEW_ID}.focus`);
        await this.#runView.reveal(this.#runTree.runNodeOf(run), { select: true, focus: false, expand: true });
    }

    /**
     * @param {Uri | undefined} uri the clicked resource
     * @param {Uri[] | undefined} uris the selected resources
     * @param {boolean} isRepeat runs the last target run on a path in the project instead of asking
     * @returns {Promise<void>}
     */
    async #runOnPaths(uri, uris, isRepeat) {
        const selected = Array.isArray(uris) && uris.length > 0
            ? uris
            : [uri ?? vscode.window.activeTextEditor?.document.uri];
        const fileUris = selected.filter(isFileUri);
        if (fileUris.length === 0) {
            vscode.window.showWarningMessage('Select a file or folder on disk.');
            return;
        }
        const projects = new Set(fileUris.map((fileUri) => this.#projectOf(fileUri)));
        const [project] = projects;
        if (project === undefined || projects.size > 1) {
            vscode.window.showWarningMessage('Select paths from one workspace folder that has a Makefile.');
            return;
        }

        const pathTargets = project.visibleTargets.filter((target) => target.pathVariable !== undefined);
        if (pathTargets.length === 0) {
            const action = project.hasConfig ? 'Open config' : 'Create config';
            const answer = await vscode.window.showInformationMessage(
                `No target of ${project.name} takes a path. List the path variables in .vscode/make-targets.json.`,
                action,
            );
            if (answer !== undefined) {
                const command = project.hasConfig ? 'makeTargets.openConfig' : 'makeTargets.createConfig';
                await vscode.commands.executeCommand(command, project);
            }
            return;
        }

        const values = [];
        for (const fileUri of fileUris) {
            const argument = pathArgument(project.makefileDirectory, fileUri.fsPath, project.pathFormat);
            if (argument.problem === undefined) {
                values.push(argument.value);
            } else {
                vscode.window.showWarningMessage(`Skipped: ${argument.problem}.`);
            }
        }
        if (values.length === 0) {
            return;
        }

        const lastName = this.#history.lastPathTarget(project.rootPath);
        const target = isRepeat && pathTargets.some((candidate) => candidate.name === lastName)
            ? pathTargets.find((candidate) => candidate.name === lastName)
            : await this.#pickPathTarget(project, pathTargets, values);
        if (target === undefined) {
            return;
        }
        await this.#history.setLastPathTarget(project.rootPath, target.name);

        if (target.needsConfirmation) {
            const answer = await vscode.window.showWarningMessage(
                values.length === 1
                    ? `Run make ${target.name} on ${values[0]}?`
                    : `Run make ${target.name} on ${values.length} paths, one after another?`,
                { modal: true, detail: values.join('\n') },
                'Run',
            );
            if (answer !== 'Run') {
                return;
            }
        }
        for (const value of values) {
            const run = await this.#runner.start({ project, target, pathValue: value, isConfirmed: true });
            if (run !== undefined) {
                await run.completion;
            }
        }
    }

    /**
     * @param {MakeProject} project
     * @param {MakeTarget[]} targets
     * @param {string[]} values
     * @returns {Promise<MakeTarget | undefined>}
     */
    async #pickPathTarget(project, targets, values) {
        /** @type {(target: MakeTarget) => number} */
        const lastRunAt = (target) => this.#runner.lastRunOf(project.rootPath, target.name)?.startedAt ?? 0;
        const ordered = [...targets].sort((left, right) => lastRunAt(right) - lastRunAt(left));
        const picked = await vscode.window.showQuickPick(ordered.map((target) => {
            const startedAt = lastRunAt(target);
            return {
                label: target.name,
                description: target.pathVariable,
                detail: [target.description, startedAt === 0 ? '' : `last run ${formatClock(startedAt)}`]
                    .filter((part) => part !== '').join(' · '),
                target,
            };
        }), {
            title: values.length === 1
                ? `make … ${values[0]}`
                : `make … on ${values.length} paths, one after another`,
            placeHolder: 'Target to run on the selected path',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        return picked?.target;
    }

    /**
     * @param {MakeRun} run
     * @returns {Promise<void>}
     */
    async #rerun(run) {
        const project = this.#workspace.projects.find((candidate) => candidate.rootPath === run.projectRoot);
        const target = project?.visibleTargets.find((candidate) => candidate.name === run.target);
        if (project === undefined || target === undefined) {
            vscode.window.showWarningMessage(`make ${run.target} is no longer available in ${run.projectName}.`);
            return;
        }
        const pathValue = target.pathVariable === undefined ? undefined : run.pathValue;
        await this.#runner.start({ project, target, pathValue });
    }

    /**
     * @param {MakeRun} run
     * @returns {Promise<void>}
     */
    async #openRunOutput(run) {
        await vscode.window.showTextDocument(vscode.Uri.file(run.logFile), { preview: true });
    }

    /**
     * @param {TargetNode} node
     * @returns {Promise<void>}
     */
    async #copyTargetName(node) {
        await vscode.env.clipboard.writeText(node.target.name);
        vscode.window.setStatusBarMessage(`Name of make ${node.target.name} copied`, 3_000);
    }

    /**
     * @param {MakeRun} run
     * @returns {Promise<void>}
     */
    async #copyRunOutput(run) {
        await vscode.env.clipboard.writeText(await fs.readFile(run.logFile, 'utf8'));
        vscode.window.setStatusBarMessage(`Output of make ${run.target} copied`, 3_000);
    }

    /**
     * @param {FileLocation} location
     * @returns {Promise<void>}
     */
    async #openLocation(location) {
        try {
            await fs.access(location.file);
        } catch {
            vscode.window.showWarningMessage(`${location.file} does not exist.`);
            return;
        }
        const position = new vscode.Position(Math.max(location.line - 1, 0), Math.max(location.column - 1, 0));
        await vscode.window.showTextDocument(vscode.Uri.file(location.file), {
            selection: new vscode.Range(position, position),
            preview: true,
        });
    }

    /**
     * @param {Uri} uri
     * @returns {MakeProject | undefined}
     */
    #projectOf(uri) {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        return folder === undefined
            ? undefined
            : this.#workspace.projects.find((project) => project.folder.uri.toString() === folder.uri.toString());
    }
}

/**
 * @param {Uri | undefined} uri
 * @returns {uri is Uri}
 */
function isFileUri(uri) {
    return uri?.scheme === 'file';
}

/**
 * The only project without asking, or the one picked from several.
 *
 * @param {MakeProject[]} projects
 * @param {string} title
 * @returns {Promise<MakeProject | undefined>}
 */
async function pickProject(projects, title) {
    if (projects.length <= 1) {
        return projects[0];
    }
    const picked = await vscode.window.showQuickPick(
        projects.map((project) => ({ label: project.name, description: project.rootPath, project })),
        { title },
    );
    return picked?.project;
}

module.exports.MakeCommands = MakeCommands;
