// ルームのライフサイクル: 作成・参加・退出・CPU追加

import { config } from './config.js';
import { newId, newToken, newRoomCode } from './util.js';
import { addRoom, roomCodeExists, removeRoom } from './store.js';
import { GameError } from './game.js';

function newPlayer(name, isBot = false) {
  return {
    id: newId(),
    token: newToken(),
    name,
    connected: !isBot ? true : true,
    socketId: null,
    isBot,
  };
}

export async function createRoom(hostName) {
  // 既存ルーム（メモリ/Redis）と重複しないコードを発行
  let code = newRoomCode();
  for (let i = 0; i < 20 && (await roomCodeExists(code)); i++) code = newRoomCode();

  const host = newPlayer(hostName);
  const room = {
    code,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    phase: 'lobby',
    hostId: host.id,
    players: [host],
    game: null,
    finalCards: null,
    credits: null,
    results: null,
  };
  addRoom(room);
  return { room, player: host };
}

export function joinRoom(room, name) {
  if (room.phase !== 'lobby') throw new GameError('IN_PROGRESS', 'このルームはすでにゲームを開始しています');
  if (room.players.length >= config.maxPlayers) throw new GameError('FULL', 'このルームは満員です');
  const player = newPlayer(name);
  room.players.push(player);
  return player;
}

export function addBot(room) {
  if (room.phase !== 'lobby') throw new GameError('IN_PROGRESS', 'ゲーム開始後は追加できません');
  if (room.players.length >= config.maxPlayers) throw new GameError('FULL', 'このルームは満員です');
  const n = room.players.filter((p) => p.isBot).length + 1;
  const bot = newPlayer(`CPU-${n}`, true);
  room.players.push(bot);
  return bot;
}

/** ロビーでの退出（ゲーム開始後はプレイヤーを削除しない） */
export function removeFromLobby(room, player) {
  if (room.phase !== 'lobby') return false;
  const idx = room.players.indexOf(player);
  if (idx < 0) return false;
  room.players.splice(idx, 1);
  if (room.players.filter((p) => !p.isBot).length === 0) {
    removeRoom(room.code); // 人間が誰もいなくなったら破棄
    return true;
  }
  if (room.hostId === player.id) {
    // ホスト移譲（人間を優先）
    const next = room.players.find((p) => !p.isBot) || room.players[0];
    room.hostId = next.id;
  }
  return true;
}
