// エントリポイント: Express(静的配信+SPA fallback) と Socket.io を
// 同一HTTPサーバー・同一ポートで起動する。

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

import { config } from './config.js';
import { initStore, setExpiryHandler } from './store.js';
import { clearRoomTimers } from './game.js';
import { setupSockets } from './sockets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');

initStore();
setExpiryHandler(clearRoomTimers); // ルーム自動破棄時にタイマーも掃除

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => res.json({ ok: true }));

if (fs.existsSync(distDir)) {
  // ビルド済みReactアプリを配信（アセットはハッシュ付きファイル名なので長めにキャッシュ）
  app.use(express.static(distDir, { index: false, maxAge: '1d' }));
  // SPA fallback: /join/XXXX への直接アクセスにもindex.htmlを返す
  app.get('*', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('*', (_req, res) => {
    res
      .status(503)
      .type('text/plain; charset=utf-8')
      .send('クライアントが未ビルドです。`npm run build` を実行してください。\n（開発時のフロントエンドは Vite: http://localhost:5173 ）');
  });
}

const server = http.createServer(app);

// Socket.io: WebSocket + HTTPロングポーリングのフォールバックを既定のまま有効化
const io = new Server(server, {
  // イラストのdataURLを受けるためバッファ上限を拡張（それ以上は接続レベルで拒否）
  maxHttpBufferSize: Math.ceil(config.maxImageBytes * 1.5) + 64 * 1024,
  pingInterval: 25000,
  pingTimeout: 20000,
});

setupSockets(io);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] カード錬成工房 起動: http://localhost:${config.port} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  if (!fs.existsSync(distDir)) {
    console.log('[server] dist/ が見つかりません。開発時は `npm run dev`、本番は `npm run build` 後に `npm start` を使ってください。');
  }
});
