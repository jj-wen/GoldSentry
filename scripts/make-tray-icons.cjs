#!/usr/bin/env node
// 生成菜单栏方向图标（红▲/绿▼）。没有第三方依赖，按 16 倍超采样画三角形再箱式降采样。
const { deflateSync } = require('node:zlib');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'apps', 'menubar', 'assets');
const COLORS = { up: [0xef, 0x53, 0x50], down: [0x26, 0xa2, 0x69] };

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 单位坐标下判断点是否在三角形内，用来算覆盖率 */
function inside(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function draw(size, rgb, direction) {
  const sub = 16;
  const [r, g, b] = rgb;
  const apex = direction === 'up' ? [0.5, 0.16] : [0.5, 0.84];
  const left = direction === 'up' ? [0.1, 0.84] : [0.1, 0.16];
  const right = direction === 'up' ? [0.9, 0.84] : [0.9, 0.16];
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < sub; sy += 1) {
        for (let sx = 0; sx < sub; sx += 1) {
          if (inside((x + (sx + 0.5) / sub) / size, (y + (sy + 0.5) / sub) / size, apex, left, right)) {
            hits += 1;
          }
        }
      }
      const offset = (y * size + x) * 4;
      out[offset] = r;
      out[offset + 1] = g;
      out[offset + 2] = b;
      out[offset + 3] = Math.round((hits / (sub * sub)) * 255);
    }
  }
  return out;
}

for (const [direction, rgb] of Object.entries(COLORS)) {
  for (const size of [16, 32]) {
    const suffix = size === 32 ? '@2x' : '';
    const file = join(OUT, `tray-${direction}${suffix}.png`);
    writeFileSync(file, encodePng(size, draw(size, rgb, direction)));
    console.log(`wrote ${file}`);
  }
}
