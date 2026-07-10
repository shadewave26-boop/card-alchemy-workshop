// Socket.ioイベントの配線。入力検証・レート制限・エラー応答はここで一元化する。

import { C2S, S2C } from '../shared/constants.js';
import { config } from './config.js';
import { validPlayerName, validRoomCode } from './validate.js';
import { createRoom, joinRoom, addBot, removeFromLobby } from './rooms.js';
import { getRoom, findRoom, touchRoom } from './store.js';
import {
  GameError, startGame, handleDraft, handleSubmit,
  handleReveal, handleNext, handleRestart,
  sendRoomState, sendProgress, sendFullStateTo, resumeIfNeeded,
} from './game.js';

// ロビーで切断したまま戻らないプレイヤーの自動退出タイマー
const afkTimers = new Map(); // `${code}:${playerId}` -> Timeout
const AFK_REMOVE_MS = 90 * 1000;

function cancelAfk(code, playerId) {
  const k = `${code}:${playerId}`;
  const h = afkTimers.get(k);
  if (h) {
    clearTimeout(h);
    afkTimers.delete(k);
  }
}

export function setupSockets(io) {
  io.on('connection', (socket) => {
    // ---- 簡易レート制限 ----
    const rate = { windowStart: Date.now(), count: 0, lastDraft: 0 };
    const limited = (isDraft = false) => {
      const now = Date.now();
      if (isDraft) {
        // 下書きは最小間隔150ms（超過分は黙って捨てる。次の送信で最新化される）
        if (now - rate.lastDraft < 150) return true;
        rate.lastDraft = now;
        return false;
      }
      if (now - rate.windowStart > 5000) {
        rate.windowStart = now;
        rate.count = 0;
      }
      return ++rate.count > 40;
    };

    const fail = (code, message) => socket.emit(S2C.ROOM_ERROR, { code, message });

    // socket.data に紐づくルーム/プレイヤーを取得（メモリ上のもののみ）
    const ctx = () => {
      const room = socket.data.code ? getRoom(socket.data.code) : null;
      const player = room?.players.find((p) => p.id === socket.data.playerId) || null;
      return room && player ? { room, player } : null;
    };

    const bind = (room, player) => {
      socket.data.code = room.code;
      socket.data.playerId = player.id;
      player.socketId = socket.id;
      player.connected = true;
      socket.join(room.code);
      cancelAfk(room.code, player.id);
    };

    /** ハンドラ共通ラッパ: GameErrorはユーザー向けメッセージ、その他は内部情報を漏らさない */
    const guard = (fn) => async (payload) => {
      try {
        await fn(payload);
      } catch (err) {
        if (err instanceof GameError) {
          fail(err.code, err.message);
        } else {
          console.error('[socket]', err);
          fail('SERVER', 'サーバーでエラーが発生しました');
        }
      }
    };

    // ================= ルーム =================

    socket.on(C2S.CREATE, guard(async (payload) => {
      if (limited()) return;
      const name = validPlayerName(payload?.name);
      if (!name) return fail('BAD_NAME', '名前は1〜12文字で入力してください');
      const { room, player } = await createRoom(name);
      bind(room, player);
      socket.emit(S2C.CREATED, {
        code: room.code,
        playerId: player.id,
        token: player.token,
        joinUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/join/${room.code}` : null,
      });
      sendRoomState(io, room);
      touchRoom(room);
    }));

    socket.on(C2S.JOIN, guard(async (payload) => {
      if (limited()) return;
      const code = validRoomCode(payload?.code);
      if (!code) return fail('NOT_FOUND', 'ルームコードは4文字で入力してください');
      const name = validPlayerName(payload?.name);
      if (!name) return fail('BAD_NAME', '名前は1〜12文字で入力してください');
      const room = await findRoom(code);
      if (!room) return fail('NOT_FOUND', 'ルームが見つかりません。コードを確認してください');
      resumeIfNeeded(io, room);
      const player = joinRoom(room, name); // FULL / IN_PROGRESS はGameErrorで通知
      bind(room, player);
      socket.emit(S2C.JOINED, { code: room.code, playerId: player.id, token: player.token });
      sendRoomState(io, room);
      touchRoom(room);
    }));

    socket.on(C2S.RECONNECT, guard(async (payload) => {
      if (limited()) return;
      const code = validRoomCode(payload?.code);
      const token = typeof payload?.token === 'string' ? payload.token : '';
      if (!code || !token) return socket.emit(S2C.SESSION_INVALID);
      const room = await findRoom(code);
      if (!room) return socket.emit(S2C.SESSION_INVALID);
      resumeIfNeeded(io, room);
      const player = room.players.find((p) => p.token === token);
      if (!player) return socket.emit(S2C.SESSION_INVALID);

      // 古いSocket接続が残っていても、新しい接続を有効とする（仕様§22）
      const oldId = player.socketId;
      if (oldId && oldId !== socket.id) {
        io.sockets.sockets.get(oldId)?.disconnect(true);
      }
      bind(room, player);
      socket.emit(S2C.JOINED, { code: room.code, playerId: player.id, token: player.token, reconnected: true });
      sendFullStateTo(io, room, player, socket);
      sendRoomState(io, room);
      if (room.phase === 'playing') sendProgress(io, room);
      touchRoom(room);
    }));

    // スリープ復帰などの再同期（トークン再検証不要: 接続済みソケットのみ）
    socket.on(C2S.SYNC, guard(async () => {
      if (limited()) return;
      const c = ctx();
      if (!c) return;
      sendFullStateTo(io, c.room, c.player, socket);
      touchRoom(c.room);
    }));

    socket.on(C2S.LEAVE, guard(async () => {
      const c = ctx();
      if (!c) return;
      const { room, player } = c;
      if (room.phase !== 'lobby') return; // ゲーム中は退出扱いにしない
      removeFromLobby(room, player);
      socket.leave(room.code);
      socket.data.code = null;
      socket.data.playerId = null;
      if (getRoom(room.code)) sendRoomState(io, room);
    }));

    // ================= ゲーム進行 =================

    socket.on(C2S.START, guard(async () => {
      if (limited()) return;
      const c = ctx();
      if (!c) return;
      startGame(io, c.room, c.player.id);
    }));

    socket.on(C2S.DRAFT, guard(async (payload) => {
      if (limited(true)) return;
      const c = ctx();
      if (!c) return;
      handleDraft(io, c.room, c.player, payload);
    }));

    socket.on(C2S.SUBMIT, guard(async (payload) => {
      if (limited()) return;
      const c = ctx();
      if (!c) return;
      handleSubmit(io, c.room, c.player, payload, socket);
    }));

    // ================= 結果発表 =================

    socket.on(C2S.REVEAL, guard(async (payload) => {
      if (limited()) return;
      const c = ctx();
      if (c) handleReveal(io, c.room, payload);
    }));

    socket.on(C2S.NEXT, guard(async (payload) => {
      if (limited()) return;
      const c = ctx();
      if (c) handleNext(io, c.room, payload);
    }));

    socket.on(C2S.RESTART, guard(async () => {
      if (limited()) return;
      const c = ctx();
      if (c) handleRestart(io, c.room);
    }));

    // ================= 開発専用 =================

    socket.on(C2S.ADD_BOT, guard(async () => {
      if (config.isProd) return fail('FORBIDDEN', 'この機能は利用できません');
      const c = ctx();
      if (!c) return;
      if (c.player.id !== c.room.hostId) return fail('NOT_HOST', 'ホストのみ操作できます');
      addBot(c.room);
      sendRoomState(io, c.room);
      touchRoom(c.room);
    }));

    // ================= 切断 =================

    socket.on('disconnect', () => {
      const c = ctx();
      if (!c) return;
      const { room, player } = c;
      // 新しい接続に差し替え済みの場合は何もしない
      if (player.socketId !== socket.id) return;
      player.connected = false;
      player.socketId = null;
      sendRoomState(io, room);
      if (room.phase === 'playing' && room.game) sendProgress(io, room);
      touchRoom(room);

      // ロビーでのみ、一定時間戻らなければ自動退出
      if (room.phase === 'lobby') {
        const k = `${room.code}:${player.id}`;
        cancelAfk(room.code, player.id);
        const h = setTimeout(() => {
          afkTimers.delete(k);
          const r = getRoom(room.code);
          if (!r || r.phase !== 'lobby') return;
          const p = r.players.find((x) => x.id === player.id);
          if (p && !p.connected) {
            removeFromLobby(r, p);
            if (getRoom(r.code)) sendRoomState(io, r);
          }
        }, AFK_REMOVE_MS);
        h.unref?.();
        afkTimers.set(k, h);
      }
    });
  });
}
