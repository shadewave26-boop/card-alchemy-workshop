// PWA用アイコンPNGの生成スクリプト（依存ライブラリなし）。
// 濃紺の背景 + 金のリングと星 = 錬成紋モチーフのオリジナルアイコン。
// 使い方: npm run icons （生成物は public/icons/ にコミット済み）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../server/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../public/icons');
fs.mkdirSync(outDir, { recursive: true });

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const bg = [16, 15, 38];
  const bg2 = [40, 32, 84];
  const gold = [216, 180, 90];
  const goldBright = [240, 212, 137];

  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };

  // 背景: 中心が少し明るいラジアルグラデーション
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.hypot(x - cx, y - cy) / maxD;
      const mix = (a, b) => Math.round(a + (b - a) * t);
      set(x, y, [mix(bg2[0], bg[0]), mix(bg2[1], bg[1]), mix(bg2[2], bg[2])]);
    }
  }

  // 金のリング
  const rOuter = size * 0.42;
  const rInner = size * 0.36;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rOuter && d >= rInner) set(x, y, gold);
    }
  }

  // 中央の四芒星（ダイヤ型）
  const s = size * 0.26;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      // |x|^0.6 + |y|^0.6 で尖った星形にする
      if (Math.pow(dx / s, 0.6) + Math.pow(dy / s, 0.6) <= 1) {
        set(x, y, goldBright);
      }
    }
  }

  // リング上の4点の飾り
  const dotR = size * 0.035;
  for (const [ang] of [[0], [Math.PI / 2], [Math.PI], [(Math.PI * 3) / 2]]) {
    const px = cx + Math.cos(ang) * (rOuter + rInner) / 2;
    const py = cy + Math.sin(ang) * (rOuter + rInner) / 2;
    for (let y = Math.floor(py - dotR); y <= py + dotR; y++) {
      for (let x = Math.floor(px - dotR); x <= px + dotR; x++) {
        if (Math.hypot(x - px, y - py) <= dotR) set(x, y, bg);
      }
    }
  }

  return encodePng(size, size, buf);
}

for (const size of [180, 192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, drawIcon(size));
  console.log('generated:', file);
}
