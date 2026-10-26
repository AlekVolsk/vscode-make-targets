// @ts-check
'use strict';

const fs = require('fs/promises');
const path = require('path');
const { needsTerminal, parseMakefile, pathVariableCandidates, referencedVariables } = require('./makefileParser');
const { normalizeConfig, parseJsonc, resolveTarget } = require('./projectConfig');

const CONFIG_RELATIVE_PATH = path.join('.vscode', 'make-targets.json');
const DEFAULT_MAKEFILES = Object.freeze(['GNUmakefile', 'makefile', 'Makefile']);
const MAX_MAKEFILES = 32;

/**
 * @typedef {import('./makefileParser').ParsedTarget} ParsedTarget
 * @typedef {import('./projectConfig').ProjectConfig} ProjectConfig
 * @typedef {import('./projectConfig').PathFormat} PathFormat
 * @typedef {import('./projectConfig').TargetOptions} TargetOptions
 * @typedef {import('./configTemplate').InitialConfigInput} InitialConfigInput
 * @typedef {ParsedTarget & { file: string, variables: Set<string>, needsTerminal: boolean }} MakefileTarget
 * @typedef {MakefileTarget & TargetOptions} MakeTarget
 * @typedef {{ files: string[], targets: MakefileTarget[] }} MakefileTargets
 */

/**
 * One workspace folder: its .vscode/make-targets.json and the Makefile it points to, with the includes
 * that name a plain file.
 */
class MakeProject {
    /** @type {import('vscode').WorkspaceFolder} */
    folder;
    /** @type {string} */
    configPath;
    hasConfig = false;
    /** @type {PathFormat} */
    pathFormat = 'relative';
    /** @type {string | undefined} */
    makefilePath = undefined;
    /** @type {string[]} the Makefile and the files it includes */
    makefileFiles = [];
    /** @type {MakeTarget[]} */
    targets = [];
    /** @type {string[]} */
    problems = [];

    /** @param {import('vscode').WorkspaceFolder} folder */
    constructor(folder) {
        this.folder = folder;
        this.configPath = path.join(folder.uri.fsPath, CONFIG_RELATIVE_PATH);
    }

    /** @returns {string} */
    get name() {
        return this.folder.name;
    }

    /** @returns {string} */
    get rootPath() {
        return this.folder.uri.fsPath;
    }

    /** @returns {string} */
    get makefileDirectory() {
        return this.makefilePath === undefined ? this.rootPath : path.dirname(this.makefilePath);
    }

    /** @returns {boolean} */
    get isRelevant() {
        return this.hasConfig || this.makefilePath !== undefined;
    }

    /** @returns {MakeTarget[]} */
    get visibleTargets() {
        return this.targets.filter((target) => !target.isHidden);
    }

    /** @returns {string[]} */
    get watchedFiles() {
        return [this.configPath, ...this.makefileFiles];
    }

    /** @returns {Promise<void>} */
    async load() {
        /** @type {string[]} */
        const problems = [];
        const { config, exists } = await this.#readConfig(problems);
        this.hasConfig = exists;
        this.pathFormat = config.pathFormat;
        this.makefilePath = await this.#findMakefile(config.makefile, problems);
        /** @type {MakefileTargets} */
        let makefile = { targets: [], files: [] };
        if (this.makefilePath !== undefined) {
            try {
                makefile = await readMakefileTargets(this.makefilePath);
            } catch (error) {
                problems.push(`Makefile could not be read: ${/** @type {Error} */ (error).message}`);
            }
        }
        this.makefileFiles = makefile.files;
        this.targets = makefile.targets.map((target) => resolveTarget(target, config));
        this.problems = problems;
    }

    /** @returns {Promise<InitialConfigInput>} */
    async initialConfigInput() {
        const { targets } = this.makefilePath === undefined
            ? { targets: [] }
            : await readMakefileTargets(this.makefilePath);
        return {
            makefile: path.relative(this.rootPath, this.makefilePath ?? path.join(this.rootPath, 'Makefile')),
            candidates: pathVariableCandidates(targets),
            terminalTargets: targets.filter((target) => target.needsTerminal).map((target) => target.name),
        };
    }

    /**
     * @param {string[]} problems
     * @returns {Promise<{ config: ProjectConfig, exists: boolean }>}
     */
    async #readConfig(problems) {
        let text;
        try {
            text = await fs.readFile(this.configPath, 'utf8');
        } catch {
            return { config: normalizeConfig({}).config, exists: false };
        }
        let raw;
        try {
            raw = parseJsonc(text);
        } catch (error) {
            problems.push(`${CONFIG_RELATIVE_PATH} is not valid JSON: ${/** @type {Error} */ (error).message}`);
            return { config: normalizeConfig({}).config, exists: true };
        }
        const normalized = normalizeConfig(raw);
        problems.push(...normalized.problems.map((problem) => `${CONFIG_RELATIVE_PATH}: ${problem}`));
        return { config: normalized.config, exists: true };
    }

    /**
     * @param {string | undefined} configured
     * @param {string[]} problems
     * @returns {Promise<string | undefined>}
     */
    async #findMakefile(configured, problems) {
        const candidates = configured === undefined
            ? DEFAULT_MAKEFILES.map((name) => path.join(this.rootPath, name))
            : [path.resolve(this.rootPath, configured)];
        for (const candidate of candidates) {
            try {
                if ((await fs.stat(candidate)).isFile()) {
                    return candidate;
                }
            } catch {
                continue;
            }
        }
        if (configured !== undefined) {
            problems.push(`Makefile not found: ${configured}`);
        }
        return undefined;
    }
}

/**
 * The targets of a Makefile and of the files it includes by a plain name; includes built from variables
 * or wildcards are not followed.
 *
 * @param {string} makefilePath
 * @returns {Promise<MakefileTargets>}
 */
async function readMakefileTargets(makefilePath) {
    const targets = new Map();
    const files = [];
    const queue = [makefilePath];
    const seen = new Set();
    while (queue.length > 0 && seen.size < MAX_MAKEFILES) {
        const file = queue.shift();
        if (file === undefined || seen.has(file)) {
            continue;
        }
        seen.add(file);
        let text;
        try {
            text = await fs.readFile(file, 'utf8');
        } catch (error) {
            if (file === makefilePath) {
                throw error;
            }
            continue;
        }
        files.push(file);
        const parsed = parseMakefile(text);
        for (const target of parsed.targets) {
            const known = targets.get(target.name);
            if (known === undefined) {
                targets.set(target.name, { ...target, file });
            } else {
                known.recipe.push(...target.recipe);
            }
        }
        for (const include of parsed.includes) {
            if (!/[$*?[]/.test(include)) {
                queue.push(path.resolve(path.dirname(makefilePath), include));
            }
        }
    }
    return {
        files,
        targets: [...targets.values()].map((target) => ({
            ...target,
            variables: referencedVariables(target.recipe),
            needsTerminal: needsTerminal(target.recipe),
        })),
    };
}

module.exports.MakeProject = MakeProject;
module.exports.CONFIG_RELATIVE_PATH = CONFIG_RELATIVE_PATH;
