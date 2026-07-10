import { ATTRIBUTES, LIMITS } from '../shared/constants.js';

// 制御文字の除去パターン（\u表記で明示）
const CTRL_ALL = new RegExp('[\\u0000-\\u001F\\u007F]', 'g'); // 改行含むすべての制御文字
const CTRL_KEEP_LF = new RegExp('[\\u0000-\\u0009\\u000B-\\u001F\\u007F]', 'g'); // \n だけ残す

/** サロゲートペアを壊さずに文字数でスライス */
function sliceChars(s, max) {
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

/** 1行テキスト: 制御文字・改行を除去して文字数制限 */
export function cleanLine(v, max) {
  if (typeof v !== 'string') return '';
  let s = v.length > 4000 ? v.slice(0, 4000) : v;
  s = s.replace(CTRL_ALL, '').trim();
  return sliceChars(s, max);
}

/** 複数行テキスト: 改行(\n)のみ許可 */
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  let s = v.length > 4000 ? v.slice(0, 4000) : v;
  s = s.replace(/\r\n?/g, '\n').replace(CTRL_KEEP_LF, '').trim();
  return sliceChars(s, max);
}

export function validPlayerName(v) {
  if (typeof v !== 'string' || v.length > 200) return null;
  const s = v.replace(CTRL_ALL, '').trim();
  const len = [...s].length;
  // 文字数超過は切り詰めず拒否する（クライアント側もmaxLengthで制限済み）
  if (len < LIMITS.playerNameMin || len > LIMITS.playerNameMax) return null;
  return s;
}

export function validRoomCode(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return /^[A-Z0-9]{4}$/.test(s) ? s : null;
}

function intIn(v, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** ステータスの厳格検証（手動提出用）。不正があればnull */
export function validStats(v) {
  if (!v || typeof v !== 'object') return null;
  const attribute = ATTRIBUTES.includes(v.attribute) ? v.attribute : null;
  const level = intIn(v.level, LIMITS.levelMin, LIMITS.levelMax);
  const atk = intIn(v.atk, LIMITS.atkMin, LIMITS.atkMax);
  const def = intIn(v.def, LIMITS.atkMin, LIMITS.atkMax);
  if (attribute === null || level === null || atk === null || def === null) return null;
  return { attribute, level, atk, def };
}

/** ステータスの寛容な補完（自動提出用）。不正値は既定値へ */
export function sanitizeStats(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    attribute: ATTRIBUTES.includes(o.attribute) ? o.attribute : '闇',
    level: intIn(o.level, LIMITS.levelMin, LIMITS.levelMax) ?? 4,
    atk: intIn(o.atk, LIMITS.atkMin, LIMITS.atkMax) ?? 0,
    def: intIn(o.def, LIMITS.atkMin, LIMITS.atkMax) ?? 0,
  };
}

/** ステータス下書きの部分保存（有効なフィールドのみ残す） */
export function sanitizeStatsDraft(v) {
  if (!v || typeof v !== 'object') return {};
  const out = {};
  if (ATTRIBUTES.includes(v.attribute)) out.attribute = v.attribute;
  const level = intIn(v.level, LIMITS.levelMin, LIMITS.levelMax);
  const atk = intIn(v.atk, LIMITS.atkMin, LIMITS.atkMax);
  const def = intIn(v.def, LIMITS.atkMin, LIMITS.atkMax);
  if (level !== null) out.level = level;
  if (atk !== null) out.atk = atk;
  if (def !== null) out.def = def;
  return out;
}

/** PNG dataURLの検証: MIMEタイプ・base64形式・サイズ上限 */
export function validImage(v, maxBytes) {
  if (typeof v !== 'string') return null;
  const prefix = 'data:image/png;base64,';
  if (!v.startsWith(prefix)) return null;
  const body = v.slice(prefix.length);
  // base64長からおおよそのバイト数を計算
  const approxBytes = Math.floor(body.length * 0.75);
  if (approxBytes > maxBytes || body.length === 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  return v;
}
