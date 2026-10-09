'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.activate = activate;
exports.deactivate = deactivate;

const path = require('path');
const vscode = require('vscode');
const { MakeCommands } = require('./makeCommands');
const { MakeDecorationProvider } = require('./makeDecorationProvider');
const { MakeRunner } = require('./makeRunner');
const { MakeWorkspace } = require('./makeWorkspace');
const { RunHistory } = require('./runHistory');
const { RunTreeProvider } = require('./runTreeProvider');
const { TargetTreeProvider } = require('./targetTreeProvider');
const { createLocationTracker } = require('./runText');

const TARGETS_VIEW_ID = 'makeTargets.targets';
const RUNS_VIEW_ID = 'makeTargets.runs';
const MAKE_DIRECTORY_IN_HEADER = /^\$ \S+ (?:--no-print-directory )?-C (\S+|'[^']*')/;

let runner;

async function activate(context) {
    const log = vscode.window.createOutputChannel('Make Targets', { log: true });
    const storage = context.storageUri ?? context.globalStorageUri;
    const history = new RunHistory(context.workspaceState, path.join(storage.fsPath, 'runs'));
    const workspace = new MakeWorkspace(log);
    runner = new MakeRunner(history, log);

    const targetTree = new TargetTreeProvider(workspace, runner);
    const runTree = new RunTreeProvider(runner);
    const targetView = vscode.window.createTreeView(TARGETS_VIEW_ID, {
        treeDataProvider: targetTree,
        showCollapseAll: true,
    });
    const runView = vscode.window.createTreeView(RUNS_VIEW_ID, { treeDataProvider: runTree, showCollapseAll: true });
    const commands = new MakeCommands({ workspace, runner, history, runTree, runView, log });

    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
    status.command = `${RUNS_VIEW_ID}.focus`;
    const updateStatus = () => {
        const count = runner.runningCount;
        status.text = `$(sync~spin) make ×${count}`;
        status.tooltip = runner.runs.filter((run) => run.isRunning)
            .map((run) => `make ${run.target}${run.pathValue === undefined ? '' : ` ${run.pathValue}`}`).join('\n');
        if (count > 0) {
            status.show();
        } else {
            status.hide();
        }
    };

    context.subscriptions.push(
        log,
        workspace,
        targetTree,
        runTree,
        targetView,
        runView,
        status,
        ...commands.register(),
        vscode.window.registerFileDecorationProvider(new MakeDecorationProvider()),
        vscode.languages.registerDocumentLinkProvider(
            { scheme: 'file', pattern: new vscode.RelativePattern(vscode.Uri.file(history.logDirectory), '*.log') },
            { provideDocumentLinks: (document) => logLinks(document, runner) },
        ),
        runner.onDidChangeRuns(updateStatus),
        vscode.workspace.onDidChangeWorkspaceFolders(() => workspace.syncFolders()),
    );
    updateStatus();
    await workspace.syncFolders();
}

function logLinks(document, makeRunner) {
    const run = makeRunner.runs.find((candidate) => candidate.logFile === document.uri.fsPath);
    const header = MAKE_DIRECTORY_IN_HEADER.exec(document.lineAt(0).text);
    const directory = run?.makefileDirectory ?? header?.[1].replace(/^'|'$/g, '');
    if (directory === undefined) {
        return [];
    }
    const locate = createLocationTracker(directory);
    const links = [];
    for (let index = 0; index < document.lineCount; index += 1) {
        const line = document.lineAt(index);
        const location = locate(line.text);
        if (location !== undefined && line.text.trim() !== '') {
            const target = vscode.Uri.file(location.file).with({ fragment: `L${location.line},${location.column}` });
            const start = line.range.start.translate(0, line.firstNonWhitespaceCharacterIndex);
            links.push(new vscode.DocumentLink(line.range.with(start), target));
        }
    }
    return links;
}

function deactivate() {
    runner?.dispose();
}
