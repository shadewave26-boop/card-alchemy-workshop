import crypto from 'node:crypto';
import zlib from 'node:zlib';

/** 推測されにくいセッショントークン（192bit） */
export function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/** プレイヤーID */
export function newId() {
  return crypto.randomBytes(8).toString('hex');
}

// 読み間違えやすい文字（0/O, 1/I, 8/B）を除いたルームコード用文字集合
const CODE_CHARS = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679';

export function newRoomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  }
  return s;
}

/** 重み付き抽選 { key: weight } → key */
export function weightedPick(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r < 0) return key;
  }
  return entries[entries.length - 1][0];
}

export function pick(arr) {
  return arr[crypto.randomInt(arr.length)];
}

// ---------------------------------------------------------------
// 依存ライブラリなしの最小PNGエンコーダ。
// 白紙画像（時間切れ時の既定提出物）とCPUプレイヤーの落書き生成に使う。
// ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

/** RGBAバッファ(w*h*4)をPNGバイナリへ */
export function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

export function pngToDataUrl(buf) {
  return 'data:image/png;base64,' + buf.toString('base64');
}

let cachedWhite = null;

/** 白紙のPNG dataURL（下書きが無いまま時間切れになった場合の提出物） */
export function whitePngDataUrl() {
  if (!cachedWhite) {
    const size = 32;
    cachedWhite = pngToDataUrl(encodePng(size, size, Buffer.alloc(size * size * 4, 0xff)));
  }
  return cachedWhite;
}

/** CPUプレイヤー用: 白地にランダムな円を描いた簡単な落書きPNG */
export function botDoodleDataUrl() {
  const size = 160;
  const buf = Buffer.alloc(size * size * 4, 0xff);
  const colors = [
    [0x1a, 0x1a, 0x33], [0xe5, 0x48, 0x4d], [0x00, 0x90, 0xff],
    [0x30, 0xa4, 0x6c], [0xf7, 0x6b, 0x15], [0x8e, 0x4e, 0xc6],
  ];
  const circles = 2 + crypto.randomInt(3);
  for (let c = 0; c < circles; c++) {
    const cx = 30 + crypto.randomInt(100);
    const cy = 30 + crypto.randomInt(100);
    const r = 12 + crypto.randomInt(38);
    const [cr, cg, cb] = colors[crypto.randomInt(colors.length)];
    for (let y = Math.max(0, cy - r); y < Math.min(size, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x < Math.min(size, cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) {
          const i = (y * size + x) * 4;
          buf[i] = cr; buf[i + 1] = cg; buf[i + 2] = cb; buf[i + 3] = 255;
        }
      }
    }
  }
  return pngToDataUrl(encodePng(size, size, buf));
}
