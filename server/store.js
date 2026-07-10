// ルームストア。
// - 権威状態は常にメモリ上の Map（タイマー等の都合上、単一プロセス前提）
// - REDIS_URL があれば変更のたびにスナップショットを Redis へ保存（TTL付き）。
//   サーバー再起動・インスタンス入替時は join/reconnect を契機に復元する。
// - REDIS_URL が無ければメモリのみ + 定期クリーンアップ（README注意書きあり）。

import { Redis } from 'ioredis';
import { config } from './config.js';

const rooms = new Map(); // code -> room
const persistTimers = new Map(); // code -> {last, handle}

let redis = null;
let redisWarned = false;
let expiryHandler = null; // ルーム破棄時にタイマー等を掃除するコールバック

const key = (code) => `cwroom:${code}`;

export function initStore() {
  if (config.redisUrl) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    redis.on('error', (err) => {
      if (!redisWarned) {
        redisWarned = true;
        console.warn('[store] Redis接続エラー（メモリ管理は継続します）:', err.message);
      }
    });
    redis.on('ready', () => {
      redisWarned = false;
      console.log('[store] Redisへ接続しました');
    });
  } else {
    console.log('[store] REDIS_URL未設定: メモリ管理モード（再起動で進行中ゲームは消えます）');
  }

  // メモリ側のTTL掃除（Redis利用時もメモリ解放のため実行）
  const iv = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (now - room.lastActiveAt > config.roomTtlSeconds * 1000) {
        expiryHandler?.(code);
        rooms.delete(code);
        persistTimers.delete(code);
      }
    }
  }, 5 * 60 * 1000);
  iv.unref?.();
}

export function setExpiryHandler(fn) {
  expiryHandler = fn;
}

export function getRoom(code) {
  return rooms.get(code) || null;
}

/** メモリ→Redisの順で探す。Redisから復元した場合は呼び出し側でタイマー再開が必要 */
export async function findRoom(code) {
  const mem = rooms.get(code);
  if (mem) return mem;
  if (!redis) return null;
  try {
    const json = await redis.get(key(code));
    if (!json) return null;
    const room = JSON.parse(json);
    rooms.set(code, room);
    console.log(`[store] ルーム ${code} をRedisから復元しました`);
    return room;
  } catch {
    return null;
  }
}

export function addRoom(room) {
  rooms.set(room.code, room);
  persistNow(room);
}

export async function roomCodeExists(code) {
  if (rooms.has(code)) return true;
  if (!redis) return false;
  try {
    return (await redis.exists(key(code))) === 1;
  } catch {
    return false;
  }
}

export function removeRoom(code) {
  expiryHandler?.(code);
  rooms.delete(code);
  persistTimers.delete(code);
  if (redis) redis.del(key(code)).catch(() => {});
}

/** 最終アクセスを更新し、スナップショットを保存（2秒スロットル） */
export function touchRoom(room) {
  room.lastActiveAt = Date.now();
  if (!redis) return;
  const t = persistTimers.get(room.code) || { last: 0, handle: null };
  const since = Date.now() - t.last;
  if (since >= 2000) {
    persistNow(room);
  } else if (!t.handle) {
    t.handle = setTimeout(() => {
      t.handle = null;
      persistNow(room);
    }, 2000 - since);
    t.handle.unref?.();
    persistTimers.set(room.code, t);
  }
}

export function persistNow(room) {
  if (!redis) return;
  const t = persistTimers.get(room.code) || { last: 0, handle: null };
  t.last = Date.now();
  if (t.handle) {
    clearTimeout(t.handle);
    t.handle = null;
  }
  persistTimers.set(room.code, t);
  try {
    // タイマーハンドル等は room に持たせない設計なのでそのままJSON化できる
    redis.set(key(room.code), JSON.stringify(room), 'EX', config.roomTtlSeconds).catch(() => {});
  } catch {
    /* 保存失敗してもゲーム進行は継続 */
  }
}
