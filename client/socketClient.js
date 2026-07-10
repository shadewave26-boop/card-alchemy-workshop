import { io } from 'socket.io-client';

// 同一オリジンへ接続（開発時はViteのプロキシ経由）。
// WebSocket不可の環境ではSocket.io標準のポーリングへ自動フォールバックする。
export const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 800,
  reconnectionDelayMax: 4000,
});
