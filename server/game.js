// ゲームエンジン: ラウンド進行・タイマー・提出・自動提出・結果発表。
// すべての状態遷移はサーバー(このモジュール)を正とする。

import { S2C, TOTAL_ROUNDS, MODES, SPELL_KINDS, TRAP_KINDS } from '../shared/constants.js';
import { config } from './config.js';
import {
  buildCard, roundDurationSeconds, roundSpecFor, visibleFor,
  assembleCard, roleName, fullName,
} from './gameSpec.js';
import {
  cleanLine, cleanText, validStats, sanitizeStats, sanitizeStatsDraft, validImage,
} from './validate.js';
import { getRoom, touchRoom, persistNow } from './store.js';
import { whitePngDataUrl, botDoodleDataUrl, pick } from './util.js';

// setTimeoutハンドルはJSON化できないため、ルーム本体とは分離して保持する
const timers = new Map(); // code -> { round: Timeout, bots: Timeout[] }

export function clearRoomTimers(code) {
  const t = timers.get(code);
  if (t) {
    clearTimeout(t.round);
    for (const b of t.bots) clearTimeout(b);
    timers.delete(code);
  }
}

// ---- 担当割り当て（仕様§5: 担当プレイヤー = (i + r - 1) % N） ----
export const playerIndexForCard = (i, r, n) => (i + r - 1) % n;
export const cardIndexForPlayer = (p, r, n) => (((p - (r - 1)) % n) + n) % n;

class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ================= 状態送信ヘルパー =================

export function roomStatePayload(room) {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    devMode: !config.isProd,
    minPlayers: config.minPlayers,
    maxPlayers: config.maxPlayers,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isHost: p.id === room.hostId,
      isBot: !!p.isBot,
    })),
  };
}

export function sendRoomState(io, room) {
  io.to(room.code).emit(S2C.ROOM_STATE, roomStatePayload(room));
}

/** round:state は担当カードごとに内容が違うため、プレイヤー個別に送信する */
function roundStatePayload(room, playerIdx) {
  const g = room.game;
  const n = room.players.length;
  const ci = cardIndexForPlayer(playerIdx, g.round, n);
  const card = g.cards[ci];
  return {
    round: g.round,
    totalRounds: TOTAL_ROUNDS,
    startAt: g.startAt,
    endAt: g.endAt,
    serverNow: Date.now(),
    cardIndex: ci,
    cardNo: ci + 1,
    cardType: card.cardType,
    species: card.species,
    spellKind: card.spellKind ?? null, // 魔法カード: R3確定後は常時表示するシステム情報
    trapKind: card.trapKind ?? null, // 罠カード: 同上
    spec: roundSpecFor(card, g.round),
    visible: visibleFor(card, g.round),
    draft: g.drafts[g.round]?.[ci] ?? null,
    submitted: !!g.submissions[g.round]?.[ci],
  };
}

function sendRoundStateTo(io, room, player) {
  if (!player.socketId) return;
  const idx = room.players.indexOf(player);
  if (idx < 0) return;
  io.to(player.socketId).emit(S2C.ROUND_STATE, roundStatePayload(room, idx));
}

function sendRoundStateAll(io, room) {
  for (const p of room.players) sendRoundStateTo(io, room, p);
}

function progressPayload(room) {
  const g = room.game;
  const n = room.players.length;
  const players = room.players.map((p, idx) => {
    const ci = cardIndexForPlayer(idx, g.round, n);
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      isBot: !!p.isBot,
      submitted: !!g.submissions[g.round]?.[ci],
    };
  });
  return {
    round: g.round,
    submittedCount: players.filter((p) => p.submitted).length,
    total: n,
    players,
  };
}

export function sendProgress(io, room) {
  io.to(room.code).emit(S2C.PROGRESS, progressPayload(room));
}

function resultsPayload(room) {
  return { cards: room.finalCards, credits: room.credits };
}

/** 再接続・スリープ復帰時に、その時点のphaseへ必要な状態一式を個別送信する */
export function sendFullStateTo(io, room, player, socket) {
  socket.emit(S2C.ROOM_STATE, roomStatePayload(room));
  if (room.phase === 'playing' && room.game) {
    const idx = room.players.indexOf(player);
    socket.emit(S2C.ROUND_STATE, roundStatePayload(room, idx));
    socket.emit(S2C.PROGRESS, progressPayload(room));
  } else if (room.phase === 'results') {
    socket.emit(S2C.RESULTS, resultsPayload(room));
    socket.emit(S2C.RESULTS_STATE, room.results);
  }
}

// ================= ゲーム開始 =================

export function startGame(io, room, requesterId) {
  if (room.phase !== 'lobby') throw new GameError('IN_PROGRESS', 'ゲームはすでに開始されています');
  if (requesterId !== room.hostId) throw new GameError('NOT_HOST', 'ホストのみ開始できます');
  const n = room.players.length;
  if (n < config.minPlayers) throw new GameError('NOT_ENOUGH', `${config.minPlayers}人以上で開始できます`);
  if (n > config.maxPlayers) throw new GameError('FULL', '人数が多すぎます');

  room.phase = 'playing';
  room.game = {
    round: 0,
    startAt: 0,
    endAt: 0,
    cards: room.players.map((_, i) => buildCard(i)), // カードiの最初の担当はプレイヤーi
    drafts: {},
    submissions: {},
    finalized: {},
  };

  io.to(room.code).emit(S2C.GAME_STARTED, { playerCount: n });
  sendRoomState(io, room);
  beginRound(io, room, 1);
}

// ================= ラウンド進行 =================

function armRoundTimer(io, room, round, delayMs) {
  clearRoomTimers(room.code);
  const handle = setTimeout(() => {
    const r = getRoom(room.code);
    if (r) finalizeRound(io, r, round);
  }, delayMs);
  handle.unref?.();
  timers.set(room.code, { round: handle, bots: scheduleBots(io, room, round) });
}

function beginRound(io, room, round) {
  const g = room.game;
  g.round = round;
  g.startAt = Date.now();
  g.endAt = g.startAt + roundDurationSeconds(round) * 1000;
  g.submissions[round] = {};
  g.drafts[round] = g.drafts[round] || {};

  // 猶予(graceMs)を足して確定: 時間切れ直前に送られた下書きを取りこぼしにくくする
  armRoundTimer(io, room, round, g.endAt - Date.now() + config.graceMs);

  if (round > 1) io.to(room.code).emit(S2C.ADVANCED, { round });
  sendRoundStateAll(io, room);
  sendProgress(io, room);
  persistNow(room);
  touchRoom(room);
}

/**
 * ラウンド確定処理。
 * 「全員提出による早期進行」と「サーバータイマーによる時間切れ」の両方から
 * 呼ばれるため、finalizedフラグで二重実行を排他する。
 */
export function finalizeRound(io, room, round) {
  const g = room.game;
  if (!g || room.phase !== 'playing' || g.round !== round || g.finalized[round]) return;
  g.finalized[round] = true;
  clearRoomTimers(room.code);

  const n = room.players.length;
  for (let ci = 0; ci < n; ci++) {
    if (g.submissions[round][ci]) continue;
    // 未提出カード: 最新の下書きを正式提出として確定（無ければ空/白紙/既定値）
    const card = g.cards[ci];
    const kind = roundSpecFor(card, round).kind;
    const value = autoValue(kind, g.drafts[round]?.[ci]);
    const p = room.players[playerIndexForCard(ci, round, n)];
    g.submissions[round][ci] = { playerId: p.id, auto: true };
    applySubmission(card, round, kind, value);
    if (p.socketId) io.to(p.socketId).emit(S2C.AUTO_SUBMITTED, { round, cardIndex: ci });
  }

  delete g.drafts[round]; // 下書き（特にCanvas画像）を解放

  if (round < TOTAL_ROUNDS) {
    beginRound(io, room, round + 1);
  } else {
    finishGame(io, room);
  }
}

function finishGame(io, room) {
  const g = room.game;
  room.finalCards = g.cards.map((c) => assembleCard(c));
  room.credits = g.cards.map((card) =>
    Array.from({ length: TOTAL_ROUNDS }, (_, k) => {
      const r = k + 1;
      const p = room.players[playerIndexForCard(card.index, r, room.players.length)];
      return { round: r, role: roleName(card.cardType, r), playerId: p.id, playerName: p.name };
    })
  );
  room.results = { index: 0, revealed: false, finished: false };
  room.phase = 'results';
  room.game = null; // 進行用の作業データは破棄

  sendRoomState(io, room);
  io.to(room.code).emit(S2C.RESULTS, resultsPayload(room));
  io.to(room.code).emit(S2C.RESULTS_STATE, room.results);
  persistNow(room);
  touchRoom(room);
}

/** Redis復元後などタイマーが失われている場合に再武装。期限切れなら即確定 */
export function resumeIfNeeded(io, room) {
  if (room.phase !== 'playing' || !room.game) return;
  if (timers.has(room.code)) return;
  const g = room.game;
  const remain = g.endAt + config.graceMs - Date.now();
  if (remain <= 0) {
    finalizeRound(io, room, g.round);
  } else {
    armRoundTimer(io, room, g.round, remain);
  }
}

// ================= 提出・下書き =================

/** 提出/下書きに共通の担当検証: ルーム所属・ラウンド一致・担当カード一致 */
function assertAssignment(room, player, payload) {
  const g = room.game;
  if (room.phase !== 'playing' || !g || g.round < 1) {
    throw new GameError('NOT_PLAYING', 'ゲームが進行中ではありません');
  }
  if (!payload || payload.round !== g.round) {
    throw new GameError('BAD_ROUND', '対象のラウンドはすでに終了しています');
  }
  const idx = room.players.indexOf(player);
  const ci = cardIndexForPlayer(idx, g.round, room.players.length);
  if (payload.cardIndex !== ci) {
    throw new GameError('BAD_CARD', '担当していないカードへは提出できません');
  }
  return ci;
}

export function handleDraft(io, room, player, payload) {
  let ci;
  try {
    ci = assertAssignment(room, player, payload);
  } catch {
    return; // 下書きは黙って無視（ラウンド切替直後の残送信などがあり得るため）
  }
  const g = room.game;
  if (g.submissions[g.round][ci]) return; // 提出済みは再編集不可

  const kind = roundSpecFor(g.cards[ci], g.round).kind;
  const value = draftValue(kind, payload.value);
  if (value === undefined) return;
  g.drafts[g.round][ci] = value;
  touchRoom(room);
}

export function handleSubmit(io, room, player, payload, socket) {
  const ci = assertAssignment(room, player, payload); // 失敗時はGameErrorが上位でroom:error化
  const g = room.game;
  const round = g.round;

  // 二重提出・イベント再送: 同一プレイヤーからの再送は冪等に成功応答のみ返す
  const existing = g.submissions[round][ci];
  if (existing) {
    if (existing.playerId === player.id && socket) {
      socket.emit(S2C.SUBMITTED, { round, cardIndex: ci });
    }
    return;
  }

  const card = g.cards[ci];
  const kind = roundSpecFor(card, round).kind;
  const value = strictValue(kind, payload.value);
  if (value === null) throw new GameError('BAD_SUBMIT', '入力内容の形式が正しくありません');

  g.submissions[round][ci] = { playerId: player.id, auto: false };
  applySubmission(card, round, kind, value);

  if (socket) socket.emit(S2C.SUBMITTED, { round, cardIndex: ci });
  sendProgress(io, room);
  touchRoom(room);

  // 全員提出なら残り時間を待たず早期進行（排他はfinalizeRound側）
  if (Object.keys(g.submissions[round]).length >= room.players.length) {
    finalizeRound(io, room, round);
  }
}

/** 手動提出の厳格検証。null = 拒否 */
function strictValue(kind, v) {
  switch (kind) {
    case 'nameFirst':
    case 'nameSecond':
      return typeof v === 'string' ? cleanLine(v, 16) : null;
    case 'material':
      return typeof v === 'string' ? cleanLine(v, 24) : null;
    case 'flavor':
    case 'effect':
    case 'fusionEffect':
      return typeof v === 'string' ? cleanText(v, 120) : null;
    case 'stats':
      return validStats(v);
    case 'spellKind':
      return SPELL_KINDS.includes(v) ? v : null;
    case 'trapKind':
      return TRAP_KINDS.includes(v) ? v : null;
    case 'drawing':
      return validImage(v, config.maxImageBytes);
    default:
      return null;
  }
}

/** 下書きの寛容なサニタイズ。undefined = 無視 */
function draftValue(kind, v) {
  switch (kind) {
    case 'nameFirst':
    case 'nameSecond':
      return typeof v === 'string' ? cleanLine(v, 16) : undefined;
    case 'material':
      return typeof v === 'string' ? cleanLine(v, 24) : undefined;
    case 'flavor':
    case 'effect':
    case 'fusionEffect':
      return typeof v === 'string' ? cleanText(v, 120) : undefined;
    case 'stats':
      return sanitizeStatsDraft(v);
    case 'spellKind':
      return SPELL_KINDS.includes(v) ? v : undefined;
    case 'trapKind':
      return TRAP_KINDS.includes(v) ? v : undefined;
    case 'drawing':
      return validImage(v, config.maxImageBytes) ?? undefined;
    default:
      return undefined;
  }
}

/** 自動提出時の値: 下書きがあればそれを、無ければ空/白紙/既定値 */
function autoValue(kind, draft) {
  switch (kind) {
    case 'nameFirst':
    case 'nameSecond':
      return cleanLine(draft ?? '', 16);
    case 'material':
      return cleanLine(draft ?? '', 24);
    case 'flavor':
    case 'effect':
    case 'fusionEffect':
      return cleanText(draft ?? '', 120);
    case 'stats':
      return sanitizeStats(draft);
    case 'spellKind':
      return SPELL_KINDS.includes(draft) ? draft : '通常';
    case 'trapKind':
      return TRAP_KINDS.includes(draft) ? draft : '通常';
    case 'drawing':
      return validImage(draft, config.maxImageBytes) || whitePngDataUrl();
    default:
      return '';
  }
}

function applySubmission(card, round, kind, value) {
  switch (kind) {
    case 'nameFirst': card.nameFirst = value; break;
    case 'nameSecond': card.nameSecond = value; break;
    case 'spellKind': card.spellKind = value; break;
    case 'trapKind': card.trapKind = value; break;
    case 'stats':
      card.attribute = value.attribute;
      card.level = value.level;
      card.atk = value.atk;
      card.def = value.def;
      break;
    case 'drawing': card.image = value; break;
    default: card.texts[round] = value; break; // flavor / effect / material / fusionEffect
  }
}

// ================= 結果発表の進行 =================

export function handleReveal(io, room, payload) {
  const rs = room.results;
  if (room.phase !== 'results' || !rs || rs.finished || rs.revealed) return;
  if (!payload || payload.cardIndex !== rs.index) return;
  rs.revealed = true;
  io.to(room.code).emit(S2C.RESULTS_STATE, rs);
  touchRoom(room);
}

export function handleNext(io, room, payload) {
  const rs = room.results;
  if (room.phase !== 'results' || !rs || rs.finished || !rs.revealed) return;
  if (!payload || payload.fromIndex !== rs.index) return; // 二重送信で飛ばさない
  if (rs.index >= room.finalCards.length - 1) {
    rs.finished = true;
  } else {
    rs.index += 1;
    rs.revealed = false;
  }
  io.to(room.code).emit(S2C.RESULTS_STATE, rs);
  touchRoom(room);
}

export function handleRestart(io, room) {
  if (room.phase !== 'results' || !room.results) return;
  room.results = { index: 0, revealed: false, finished: false };
  io.to(room.code).emit(S2C.RESULTS_STATE, room.results);
  touchRoom(room);
}

// ================= 開発専用: CPUプレイヤー =================

const BOT_POOL = {
  nameFirst: ['暗黒の', '煌めく', 'さまよえる', '蒼炎の', '忘却の', '鋼鉄'],
  nameSecond: ['竜王', '魔導士', 'ゴーレム', '守護者', '幻獣', '錬金術師'],
  material: ['スモールドラゴン', '見習い魔術師', '岩石の巨兵', '銀翼のグリフォン'],
  text: [
    'このカードが召喚に成功した時、デッキから1枚ドローする。',
    '遥か昔、深い森の奥に封印されていたと伝えられる。',
    'その瞳を見た者は、二度と同じ夢を見られなくなるという。',
    '1ターンに1度、相手モンスター1体の攻撃力を半分にできる。',
  ],
};

function scheduleBots(io, room, round) {
  if (config.isProd) return [];
  const handles = [];
  for (const bot of room.players.filter((p) => p.isBot)) {
    const h = setTimeout(() => {
      const r = getRoom(room.code);
      if (!r || r.phase !== 'playing' || r.game?.round !== round) return;
      try {
        const idx = r.players.indexOf(r.players.find((p) => p.id === bot.id));
        const ci = cardIndexForPlayer(idx, round, r.players.length);
        const kind = roundSpecFor(r.game.cards[ci], round).kind;
        handleSubmit(io, r, r.players[idx], { round, cardIndex: ci, value: botValue(kind) }, null);
      } catch {
        /* CPUの提出失敗は無視 */
      }
    }, 800 + Math.random() * 1700);
    h.unref?.();
    handles.push(h);
  }
  return handles;
}

function botValue(kind) {
  switch (kind) {
    case 'nameFirst': return pick(BOT_POOL.nameFirst);
    case 'nameSecond': return pick(BOT_POOL.nameSecond);
    case 'material': return pick(BOT_POOL.material);
    case 'stats':
      return sanitizeStats({
        attribute: pick(['闇', '光', '地', '水', '炎', '風']),
        level: 1 + Math.floor(Math.random() * 12),
        atk: Math.floor(Math.random() * 31) * 100,
        def: Math.floor(Math.random() * 31) * 100,
      });
    case 'spellKind': return pick(SPELL_KINDS);
    case 'trapKind': return pick(TRAP_KINDS);
    case 'drawing': return botDoodleDataUrl();
    default: return pick(BOT_POOL.text);
  }
}

export { GameError };
