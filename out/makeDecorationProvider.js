'use strict';

const vscode = require('vscode');

const DECORATION_SCHEME = 'make-targets';
const COLOR_ID_BY_KIND = new Map([
    ['pathTarget', 'makeTargets.pathTargetForeground'],
    ['plainTarget', 'makeTargets.plainTargetForeground'],
    ['errorOutput', 'makeTargets.errorOutputForeground'],
]);

/**
 * Tree item labels get a color only through a file decoration, so colored items carry a make-targets://
 * resource URI whose authority names the color.
 */
class MakeDecorationProvider {
    static colorIdFor(kind) {
        return COLOR_ID_BY_KIND.get(kind);
    }

    static uriFor(kind, nodeId) {
        return vscode.Uri.from({ scheme: DECORATION_SCHEME, authority: kind, path: `/${encodeURIComponent(nodeId)}` });
    }

    provideFileDecoration(uri) {
        if (uri.scheme !== DECORATION_SCHEME) {
            return undefined;
        }
        const colorId = COLOR_ID_BY_KIND.get(uri.authority);
        if (colorId === undefined) {
            return undefined;
        }
        return new vscode.FileDecoration(undefined, undefined, new vscode.ThemeColor(colorId));
    }
}

module.exports = { MakeDecorationProvider };
