'use strict';

const ESC = '\x1b';
const MAX_PENDING_LENGTH = 4_096;

function escapeSequenceEnd(input, start) {
    const kind = input[start + 1];
    if (kind === undefined) {
        return -1;
    }
    if (kind === '[') {
        for (let index = start + 2; index < input.length; index += 1) {
            const code = input.charCodeAt(index);
            if (code >= 0x40 && code <= 0x7e) {
                return index + 1;
            }
        }
        return -1;
    }
    if (kind === ']') {
        for (let index = start + 2; index < input.length; index += 1) {
            if (input[index] === '\x07') {
                return index + 1;
            }
            if (input[index] === ESC && input[index + 1] === '\\') {
                return index + 2;
            }
        }
        return -1;
    }
    if ('()*+'.includes(kind)) {
        return start + 3 <= input.length ? start + 3 : -1;
    }
    return start + 2;
}

/**
 * Turns output meant for a terminal into finished lines: carriage return and cursor-to-column moves overwrite
 * the current line, erase-line clears it, colors and every other escape sequence are dropped.
 */
class TerminalLineBuffer {
    #cells = [];
    #cursor = 0;
    #pending = '';

    get currentLine() {
        return this.#render();
    }

    write(text) {
        const input = this.#pending + text;
        this.#pending = '';
        const lines = [];
        let index = 0;
        while (index < input.length) {
            const char = input[index];
            if (char === ESC) {
                const end = escapeSequenceEnd(input, index);
                if (end === -1) {
                    const rest = input.slice(index);
                    this.#pending = rest.length <= MAX_PENDING_LENGTH ? rest : '';
                    break;
                }
                this.#applyEscape(input.slice(index, end));
                index = end;
                continue;
            }
            if (char === '\n') {
                lines.push(this.#takeLine());
            } else if (char === '\r') {
                this.#cursor = 0;
            } else if (char === '\b') {
                this.#cursor = Math.max(0, this.#cursor - 1);
            } else if (char === '\t' || char >= ' ') {
                this.#cells[this.#cursor] = char;
                this.#cursor += 1;
            }
            index += 1;
        }
        return lines;
    }

    flush() {
        this.#pending = '';
        return this.#cells.length === 0 ? undefined : this.#takeLine();
    }

    #applyEscape(sequence) {
        if (sequence[1] !== '[') {
            return;
        }
        const final = sequence[sequence.length - 1];
        const parameter = Number.parseInt(sequence.slice(2, -1), 10);
        const count = Number.isNaN(parameter) ? 0 : parameter;
        if (final === 'G' || final === '`') {
            this.#cursor = Math.max(count, 1) - 1;
        } else if (final === 'K') {
            if (count === 2) {
                this.#cells = [];
            } else if (count === 1) {
                this.#cells.fill(' ', 0, this.#cursor + 1);
            } else {
                this.#cells.length = Math.min(this.#cells.length, this.#cursor);
            }
        } else if (final === 'C') {
            this.#cursor += Math.max(count, 1);
        } else if (final === 'D') {
            this.#cursor = Math.max(0, this.#cursor - Math.max(count, 1));
        }
    }

    #render() {
        return Array.from({ length: this.#cells.length }, (_, index) => this.#cells[index] ?? ' ').join('').trimEnd();
    }

    #takeLine() {
        const line = this.#render();
        this.#cells = [];
        this.#cursor = 0;
        return line;
    }
}

module.exports = { TerminalLineBuffer };
