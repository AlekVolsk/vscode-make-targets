'use strict';

const vscode = require('vscode');
const { MakeDecorationProvider } = require('./makeDecorationProvider');
const { formatClock, formatDuration } = require('./runText');

const STATE_ICONS = Object.freeze({
    running: ['loading~spin', undefined],
    passed: ['pass', 'testing.iconPassed'],
    failed: ['error', 'testing.iconFailed'],
    stopped: ['circle-slash', 'testing.iconSkipped'],
    interrupted: ['debug-disconnect', 'testing.iconSkipped'],
});

/**
 * Runs view in the Make panel: the runs, newest first, and under each the tail of its output, one line per
 * item; lines that point at a file open it.
 */
class RunTreeProvider {
    #runner;
    #runNodes = new Map();
    #onDidChangeTreeData = new vscode.EventEmitter();
    #subscriptions = [];

    constructor(runner) {
        this.#runner = runner;
        this.#subscriptions.push(
            runner.onDidChangeRuns(() => this.#onDidChangeTreeData.fire(undefined)),
            runner.onDidChangeRun((run) => {
                const node = this.#runNodes.get(run.id);
                if (node !== undefined) {
                    this.#onDidChangeTreeData.fire(node);
                }
            }),
        );
    }

    get onDidChangeTreeData() {
        return this.#onDidChangeTreeData.event;
    }

    runNodeOf(run) {
        return this.#runNode(run);
    }

    async getChildren(node) {
        if (node === undefined) {
            const runs = this.#runner.runs;
            for (const id of [...this.#runNodes.keys()]) {
                if (!runs.some((run) => run.id === id)) {
                    this.#runNodes.delete(id);
                }
            }
            return runs.map((run) => this.#runNode(run));
        }
        if (node.type !== 'run') {
            return [];
        }
        const { run } = node;
        await this.#runner.loadLines(run);
        const visible = run.visibleLines;
        const firstIndex = run.lineCount - visible.length;
        const children = [];
        if (firstIndex > 0) {
            children.push({ type: 'earlier', id: `${run.id}:earlier`, run, count: firstIndex });
        }
        visible.forEach((line, offset) => {
            children.push({ type: 'line', id: `${run.id}:${firstIndex + offset}`, run, line });
        });
        if (run.isRunning && run.currentLine !== '') {
            const line = { text: run.currentLine, isError: false };
            children.push({ type: 'line', id: `${run.id}:current`, run, line, isLive: true });
        }
        return children;
    }

    getParent(node) {
        return node.type === 'run' ? undefined : this.#runNode(node.run);
    }

    getTreeItem(node) {
        if (node.type === 'run') {
            return this.#runItem(node.run);
        }
        if (node.type === 'earlier') {
            const item = new vscode.TreeItem(`… ${node.count} earlier lines — open the full output`);
            item.id = node.id;
            item.iconPath = new vscode.ThemeIcon('go-to-file');
            item.command = {
                command: 'makeTargets.openRunOutput',
                title: 'Open Output',
                arguments: [this.#runNode(node.run)],
            };
            return item;
        }
        return lineItem(node);
    }

    dispose() {
        for (const subscription of this.#subscriptions) {
            subscription.dispose();
        }
        this.#onDidChangeTreeData.dispose();
    }

    #runNode(run) {
        let node = this.#runNodes.get(run.id);
        if (node === undefined) {
            node = { type: 'run', id: `run:${run.id}`, run };
            this.#runNodes.set(run.id, node);
        }
        return node;
    }

    #runItem(run) {
        const state = run.isRunning
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        const item = new vscode.TreeItem(run.target, state);
        item.id = `run:${run.id}`;
        const [icon, color] = STATE_ICONS[run.state] ?? STATE_ICONS.failed;
        item.iconPath = new vscode.ThemeIcon(icon, color === undefined ? undefined : new vscode.ThemeColor(color));
        const parts = [
            run.pathValue,
            formatClock(run.startedAt),
            run.isRunning ? `running ${formatDuration(run.duration)}` : formatDuration(run.duration),
            run.state === 'failed' ? (run.failure ?? (run.signal ?? `exit ${run.exitCode}`)) : undefined,
        ];
        item.description = parts.filter((part) => part !== undefined).join(' · ');
        const tooltip = new vscode.MarkdownString();
        tooltip.appendCodeblock(run.command, 'shell');
        tooltip.appendText(`${run.projectName} · started ${new Date(run.startedAt).toLocaleString('sv-SE')}`);
        if (run.finishedAt !== undefined) {
            tooltip.appendText(` · ${run.state} after ${formatDuration(run.duration)}`);
        }
        item.tooltip = tooltip;
        item.contextValue = `run.${run.state}`;
        return item;
    }
}

function lineItem(node) {
    const { line } = node;
    const item = new vscode.TreeItem(line.text === '' ? ' ' : line.text);
    item.id = node.id;
    item.tooltip = line.text;
    if (line.isError) {
        item.resourceUri = MakeDecorationProvider.uriFor('errorOutput', node.id);
    }
    if (node.isLive === true) {
        item.description = '…';
    }
    if (line.location !== undefined) {
        item.command = { command: 'makeTargets.openLocation', title: 'Open', arguments: [line.location] };
        item.iconPath = new vscode.ThemeIcon('go-to-file');
    }
    return item;
}

module.exports = { RunTreeProvider };
