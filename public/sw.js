// 最小限のService Worker: 静的ファイルのみキャッシュする。
// ルーム状態・ラウンド・提出状況・タイマーなどの動的情報は一切キャッシュしない
// （Socket.io通信のみで扱う。オフライン時はアプリ側が「再接続中」を表示する）。

const CACHE = 'cw-static-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/']).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Socket.io（ポーリング含む）は絶対にキャッシュしない
  if (url.pathname.startsWith('/socket.io')) return;

  // ハッシュ付きビルドアセット: キャッシュ優先
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
      )
    );
    return;
  }

  // ナビゲーション: ネットワーク優先（最新のindex.htmlを取得）、失敗時のみキャッシュ
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/'))
    );
  }
});
