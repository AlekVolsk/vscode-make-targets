'use strict';

const path = require('path');
const vscode = require('vscode');
const { MakeDecorationProvider } = require('./makeDecorationProvider');
const { formatClock, formatDuration } = require('./runText');

const UNGROUPED = 'Other';
const SHOW_LAST_RUN_COMMAND = 'makeTargets.showLastRun';

/**
 * Make Targets view: per project (when several folders have one) the problems first, then the targets
 * grouped by their `##@Group` help comment, in Makefile order.
 */
class TargetTreeProvider {
    #workspace;
    #runner;
    #nodes = new Map();
    #onDidChangeTreeData = new vscode.EventEmitter();
    #subscriptions = [];

    constructor(workspace, runner) {
        this.#workspace = workspace;
        this.#runner = runner;
        const refresh = () => this.#onDidChangeTreeData.fire(undefined);
        this.#subscriptions.push(workspace.onDidChange(refresh), runner.onDidChangeRuns(refresh));
    }

    get onDidChangeTreeData() {
        return this.#onDidChangeTreeData.event;
    }

    getChildren(node) {
        if (node === undefined) {
            const projects = this.#workspace.projects;
            if (projects.length === 1) {
                return this.#projectChildren(projects[0]);
            }
            return projects.map((project) => this.#node(`project:${project.rootPath}`, { type: 'project', project }));
        }
        if (node.type === 'project') {
            return this.#projectChildren(node.project);
        }
        if (node.type === 'group') {
            return node.project.visibleTargets
                .filter((target) => (target.group ?? UNGROUPED) === node.name)
                .map((target) => this.#targetNode(node.project, target));
        }
        return [];
    }

    getTreeItem(node) {
        switch (node.type) {
            case 'project':
                return this.#projectItem(node);
            case 'problem':
                return this.#problemItem(node);
            case 'group':
                return this.#groupItem(node);
            default:
                return this.#targetItem(node);
        }
    }

    dispose() {
        for (const subscription of this.#subscriptions) {
            subscription.dispose();
        }
        this.#onDidChangeTreeData.dispose();
    }

    #projectChildren(project) {
        const problems = project.problems.map((message, index) => this.#node(
            `problem:${project.rootPath}:${index}`,
            { type: 'problem', project, message },
        ));
        const groupNames = [...new Set(project.visibleTargets.map((target) => target.group ?? UNGROUPED))];
        groupNames.sort((left, right) => Number(left === UNGROUPED) - Number(right === UNGROUPED));
        return [
            ...problems,
            ...groupNames.map((name) => this.#node(
                `group:${project.rootPath}:${name}`,
                { type: 'group', project, name },
            )),
        ];
    }

    #node(id, fields) {
        const node = this.#nodes.get(id) ?? { id };
        Object.assign(node, fields);
        this.#nodes.set(id, node);
        return node;
    }

    #targetNode(project, target) {
        return this.#node(`target:${project.rootPath}:${target.name}`, { type: 'target', project, target });
    }

    #projectItem(node) {
        const item = new vscode.TreeItem(node.project.name, vscode.TreeItemCollapsibleState.Expanded);
        item.id = node.id;
        item.description = node.project.makefilePath === undefined
            ? 'no Makefile'
            : path.relative(node.project.rootPath, node.project.makefilePath);
        item.tooltip = node.project.rootPath;
        item.iconPath = new vscode.ThemeIcon('folder');
        item.contextValue = 'project';
        return item;
    }

    #problemItem(node) {
        const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
        item.id = node.id;
        item.tooltip = node.message;
        item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
        item.command = { command: 'makeTargets.openConfig', title: 'Open Config', arguments: [node.project] };
        return item;
    }

    #groupItem(node) {
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
        item.id = node.id;
        item.description = String(this.getChildren(node).length);
        item.iconPath = new vscode.ThemeIcon('list-tree');
        item.contextValue = 'group';
        return item;
    }

    #targetItem(node) {
        const { project, target } = node;
        const kind = target.pathVariable === undefined ? 'plainTarget' : 'pathTarget';
        const running = this.#runner.runningRunsOf(project.rootPath, target.name);
        const lastRun = this.#runner.lastRunOf(project.rootPath, target.name);
        const item = new vscode.TreeItem(target.name, vscode.TreeItemCollapsibleState.None);
        item.id = node.id;
        item.resourceUri = MakeDecorationProvider.uriFor(kind, node.id);
        item.iconPath = targetIcon(kind, running.length > 0, lastRun);
        const runText = running.length > 0 ? runningText(running) : lastRunText(lastRun);
        item.description = [runText, target.description].filter((part) => part !== '').join(' — ');
        item.tooltip = targetTooltip(target, lastRun, running);
        item.contextValue = `target.${kind}${running.length > 0 ? '.running' : ''}`;
        item.command = { command: SHOW_LAST_RUN_COMMAND, title: 'Show Last Run', arguments: [node] };
        return item;
    }
}

function targetIcon(kind, isRunning, lastRun) {
    if (isRunning) {
        return new vscode.ThemeIcon('loading~spin');
    }
    if (lastRun?.state === 'passed') {
        return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    }
    if (lastRun !== undefined && lastRun.state !== 'stopped') {
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    }
    return new vscode.ThemeIcon('symbol-event', new vscode.ThemeColor(MakeDecorationProvider.colorIdFor(kind)));
}

function runningText(running) {
    return running.length === 1 ? `running since ${formatClock(running[0].startedAt)}` : `${running.length} running`;
}

function lastRunText(lastRun) {
    if (lastRun === undefined) {
        return '';
    }
    if (lastRun.finishedAt === undefined) {
        return formatClock(lastRun.startedAt);
    }
    const duration = ` · ${formatDuration(lastRun.finishedAt - lastRun.startedAt)}`;
    return `${formatClock(lastRun.startedAt)}${duration}`;
}

function targetTooltip(target, lastRun, running) {
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('**');
    tooltip.appendText(target.name);
    tooltip.appendMarkdown('**');
    if (target.group !== undefined) {
        tooltip.appendText(` — ${target.group}`);
    }
    tooltip.appendMarkdown('\n\n');
    if (target.description !== '') {
        tooltip.appendText(target.description);
        tooltip.appendMarkdown('\n\n');
    }
    const lines = [
        target.pathVariable === undefined ? 'Takes no path' : `Takes a path as ${target.pathVariable}`,
        ...(target.needsConfirmation ? ['Asks for confirmation before it runs'] : []),
        ...Object.entries(target.args).map(([name, value]) => `Always passes ${name}=${value}`),
        `${path.basename(target.file)}:${target.line}`,
    ];
    if (running.length > 0) {
        for (const run of running) {
            const where = run.pathValue === undefined ? '' : ` on ${run.pathValue}`;
            lines.push(`Running${where} since ${formatClock(run.startedAt)}`);
        }
    }
    if (lastRun !== undefined) {
        const exitCode = lastRun.exitCode === undefined ? '' : `, exit ${lastRun.exitCode}`;
        const outcome = lastRun.state === 'passed' ? 'passed' : `${lastRun.state}${exitCode}`;
        const where = lastRun.pathValue === undefined ? '' : ` on ${lastRun.pathValue}`;
        lines.push(`Last run${where}: ${new Date(lastRun.startedAt).toLocaleString('sv-SE')}, ${outcome}`
            + (lastRun.finishedAt === undefined ? '' : `, ${formatDuration(lastRun.finishedAt - lastRun.startedAt)}`));
    }
    for (const line of lines) {
        tooltip.appendText(line);
        tooltip.appendMarkdown('  \n');
    }
    return tooltip;
}

module.exports = { TargetTreeProvider };
