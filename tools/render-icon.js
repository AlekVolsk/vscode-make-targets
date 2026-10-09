'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const SAMPLES_PER_AXIS = 4;
const BACKGROUND = Object.freeze([0x1f, 0x7a, 0x6c]);
const FOREGROUND = Object.freeze([0xff, 0xff, 0xff]);
const CORNER_RADIUS = 26;
const CENTER = 64;
const RING_HALF_WIDTH = 5.5;
const RING_RADII = Object.freeze([40, 24]);
const BULLSEYE_RADIUS = 9;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isInsideRoundedSquare(x, y) {
    const cornerX = Math.min(Math.max(x, CORNER_RADIUS), SIZE - CORNER_RADIUS);
    const cornerY = Math.min(Math.max(y, CORNER_RADIUS), SIZE - CORNER_RADIUS);
    return Math.hypot(x - cornerX, y - cornerY) <= CORNER_RADIUS;
}

function colorAt(x, y) {
    if (!isInsideRoundedSquare(x, y)) {
        return undefined;
    }
    const distance = Math.hypot(x - CENTER, y - CENTER);
    const isOnRing = RING_RADII.some((radius) => Math.abs(distance - radius) <= RING_HALF_WIDTH);
    return isOnRing || distance <= BULLSEYE_RADIUS ? FOREGROUND : BACKGROUND;
}

function renderPixels() {
    const rows = [];
    for (let y = 0; y < SIZE; y += 1) {
        const row = Buffer.alloc(1 + SIZE * 4);
        for (let x = 0; x < SIZE; x += 1) {
            const sum = [0, 0, 0, 0];
            for (let sy = 0; sy < SAMPLES_PER_AXIS; sy += 1) {
                for (let sx = 0; sx < SAMPLES_PER_AXIS; sx += 1) {
                    const color = colorAt(x + (sx + 0.5) / SAMPLES_PER_AXIS, y + (sy + 0.5) / SAMPLES_PER_AXIS);
                    if (color === undefined) {
                        continue;
                    }
                    sum[0] += color[0];
                    sum[1] += color[1];
                    sum[2] += color[2];
                    sum[3] += 1;
                }
            }
            const offset = 1 + x * 4;
            if (sum[3] > 0) {
                row[offset] = Math.round(sum[0] / sum[3]);
                row[offset + 1] = Math.round(sum[1] / sum[3]);
                row[offset + 2] = Math.round(sum[2] / sum[3]);
                row[offset + 3] = Math.round((sum[3] / (SAMPLES_PER_AXIS * SAMPLES_PER_AXIS)) * 255);
            }
        }
        rows.push(row);
    }
    return Buffer.concat(rows);
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
}

function encodePng(pixels) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(SIZE, 0);
    header.writeUInt32BE(SIZE, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        PNG_SIGNATURE,
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

const target = path.join(__dirname, '..', 'images', 'icon.png');
fs.writeFileSync(target, encodePng(renderPixels()));
console.log(`Written ${target}`);
