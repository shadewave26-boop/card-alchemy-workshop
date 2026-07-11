# カード錬成工房 — 設計ドキュメント

実装前の設計整理（仕様書 §35 対応）。

---

## 1. 全体の仕様整理

- 2〜4人がスマートフォンのブラウザから同一公開URLへアクセスして遊ぶ、Gartic Phone形式のTCG風カード共作ゲーム。
- ホストがルームを作成 → 4文字コード / QRコードで他プレイヤーが参加 → ホストが開始。
- プレイヤー数Nと同じN枚のカードを同時制作。全8ラウンドで毎ラウンド次のプレイヤーへカードが回る。
  - ラウンドr(1〜8)でカードi(0始まり)を担当するのは **プレイヤー (i + r - 1) % N**。
- 各工程では「直前の工程の成果物」だけを閲覧できる（カード種別・種族などのシステム情報は常時表示）。
- R1: 名前前半 / R2: 名前後半 / R3: ステータス / R4〜7: 種別ごとのテキスト工程 / R8: イラスト(全情報公開)。
- テキスト工程30秒・イラスト工程120秒。サーバー側タイマーで自動提出。全員提出で早期進行。
- 終了後、カードを1枚ずつ裏面→フリップ演出付きで発表し、最後に一覧表示。

## 2. システム構成図

```
[スマホA(ホスト)] [スマホB] [スマホC] [スマホD]
      │ HTTPS/WSS │          │          │
      └───────────┴──────────┴──────────┘
                   ▼ 同一オリジン
       ┌───────────────────────────────┐
       │  Node.js プロセス (PORT, 0.0.0.0) │
       │  ├ Express: dist/ 静的配信 + SPA fallback │
       │  └ Socket.io: 同一HTTPサーバーに同居      │
       │      └ ゲームエンジン(状態の正・タイマー)   │
       └───────────────┬───────────────┘
                       ▼ (REDIS_URL があれば)
               [Redis] ルーム状態スナップショット(TTL 2h)
               (なければメモリのみ + 定期クリーンアップ)
```

- 開発時: Vite(5173) が `/socket.io` を Node(3000) へ ws プロキシ。本番は単一プロセス・同一オリジン。
- WebSocket不可の環境では Socket.io の HTTP long-polling へ自動フォールバック（デフォルト設定を維持）。

## 3. ディレクトリとファイル構成

```
card-alchemy-workshop/
├ package.json / vite.config.js / index.html / .env.example / README.md / DESIGN.md
├ shared/constants.js        … イベント名・enum・入力上限（クライアント/サーバー共用）
├ server/
│  ├ index.js                … Express + Socket.io 起動、静的配信、SPA fallback
│  ├ config.js               … 環境変数・確率・定数
│  ├ util.js                 … トークン/コード生成、PNGエンコーダ(白紙画像・CPU用ドゥードル)
│  ├ validate.js             … 入力検証・サニタイズ
│  ├ gameSpec.js             … 工程仕様(roundSpec)・公開情報(visible)・カード結合(assemble)
│  ├ store.js                … ルームストア(メモリ + 任意Redis永続化 + TTL掃除)
│  ├ rooms.js                … ルーム作成/参加/コード発行
│  ├ game.js                 … ゲームエンジン(進行・タイマー・提出・結果・CPU)
│  └ sockets.js              … Socket.ioイベント配線・レート制限
├ client/
│  ├ main.jsx / App.jsx      … エントリ・状態管理・画面ルーティング
│  ├ socketClient.js / session.js / audio.js / hooks.js
│  ├ styles.css
│  └ components/ Home, Lobby, QrCode, GameRound, inputs(Text/Stats),
│     DrawingCanvas, Waiting, Results, Gallery, CardView, CardBack,
│     ReconnectOverlay, CardInfoPanel
├ public/ manifest.webmanifest / sw.js / icons/
└ scripts/ generate-icons.mjs / smoke-test.mjs
```

## 4. 開発環境と本番環境の違い

| 項目 | 開発 (`npm run dev`) | 本番 (`npm run build` → `npm start`) |
|---|---|---|
| フロント配信 | Vite devサーバー(5173, HMR) | Expressが `dist/` を静的配信 |
| Socket.io | Viteの `/socket.io` プロキシ経由 | 同一オリジン直結 |
| ルーム状態 | メモリのみで可 | REDIS_URL があればRedisへスナップショット(TTL) |
| ラウンド秒数 | 環境変数で短縮可 | 既定 30s / 120s |
| 開発機能 | CPUプレイヤー追加・FORCE_CARD_TYPE有効 | すべて無効(サーバー側で拒否) |

## 5. サーバー側のルーム状態・ゲーム状態のデータ構造

```js
Room = {
  code: 'ABCD', createdAt, lastActiveAt,
  phase: 'lobby' | 'playing' | 'results',
  hostId, players: [Player],          // 配列順 = プレイヤーインデックス(固定)
  game: {                              // playing中のみ
    round: 1..8, startAt, endAt,       // epoch ms(サーバー時刻)
    cards: [Card],
    drafts:     { [round]: { [cardIndex]: value } },
    submissions:{ [round]: { [cardIndex]: {playerId, auto} } },
    finalized:  { [round]: true },     // 二重確定防止フラグ
  },
  finalCards: [AssembledCard],         // results中のみ
  credits: [[{round, role, playerId, playerName} x8]],
  results: { index, revealed, finished },
}
```
※ setTimeoutハンドルはシリアライズ不可のため `game.js` 内の `Map(code → handles)` に分離保持。

## 6. Redisへ保存するデータ構造

- キー: `cwroom:<CODE>`、値: 上記Roomの `JSON.stringify`(タイマーは含まない)、`EX = ROOM_TTL_SECONDS`(既定7200)。
- 保存タイミング: 状態変更時(参加/提出/ラウンド進行/結果進行)。下書きは2秒スロットルで保存。
- 復元: メモリに無いコードへの join/reconnect 時に GET → メモリへ復元 → `resumeIfNeeded()` がタイマー再武装 or 期限超過なら即確定。
- REDIS_URL 未設定時はメモリのみ + 5分間隔の期限切れ掃除（README に再起動時消失の注意を明記）。

## 7. カードデータの型

```js
Card = {
  index, cardType: 'normal'|'effect'|'fusion',   // 抽選 50/35/15%(config定数)
  species: 'ドラゴン族' など21種からランダム,
  modes: { [round]: 'continue'|'new' },          // effect: R5-7 / fusion: R7 (開始時に50%で確定)
  nameFirst, nameSecond,                          // R1, R2
  attribute('闇'|'光'|'地'|'水'|'炎'|'風'), level(1-12), atk, def(0-9999),  // R3
  texts: { 4:str, 5:str, 6:str, 7:str },          // R4-7 (fusionの4,5は素材名)
  image: 'data:image/png;base64,...',             // R8
}
AssembledCard = { index, no, cardType, species, name, attribute, level, atk, def,
                  materialsText('「A」＋「B」'|null), bodyText, image }
```

## 8. プレイヤーデータの型

```js
Player = { id(ランダム16hex), token(セッショントークン, 192bit base64url),
           name(1..12文字), connected, socketId, isBot }
```

## 9. 各ラウンドの入力データの型

| ラウンド | kind | 値の型 | 制限 |
|---|---|---|---|
| 1 | nameFirst | string | 〜16文字 |
| 2 | nameSecond | string | 〜16文字 |
| 3 | stats | {attribute, level, atk, def} | 属性6種 / 1-12 / 0-9999 |
| 4-7 通常 | flavor | string | 〜120文字 |
| 4-7 効果 | effect | string | 〜120文字 (R5-7は続き/新効果モード付き) |
| 4,5 融合 | material | string | 〜24文字 |
| 6,7 融合 | fusionEffect | string | 〜120文字 (R7はモード付き) |
| 8 | drawing | PNG dataURL | MIME検証・MAX_IMAGE_BYTES以内 |

自動提出時は空文字/白紙PNG/既定ステータス(闇・Lv4・0/0)を許容。手動提出は形式不正を拒否。

## 10. Socket.ioイベント設計

**クライアント→サーバー**
| イベント | ペイロード | 役割 |
|---|---|---|
| `room:create` | {name} | ルーム作成・トークン発行 |
| `room:join` | {code, name} | コード参加 |
| `room:reconnect` | {code, token} | 再接続・状態復帰 |
| `room:leave` | – | 開始前の自主退出 |
| `game:start` | – | ホストが開始 |
| `round:draft` | {round, cardIndex, value} | 下書き保存(テキスト/Canvas) |
| `round:submit` | {round, cardIndex, value} | 正式提出 |
| `state:sync` | – | スリープ復帰時の再同期 |
| `results:reveal` | {cardIndex} | カードめくり同期 |
| `results:next` | {fromIndex} | 次のカードへ |
| `results:restart` | – | 発表を最初から |
| `dev:addBot` | – | 【開発専用】CPU追加 |

**サーバー→クライアント**
| イベント | 役割 |
|---|---|
| `room:created` / `room:joined` | 成功応答(code, playerId, token, joinUrl) |
| `room:state` | 参加者一覧・ホスト・接続状態・phase(=game:stateの役割を統合) |
| `room:error` | {code, message}(NOT_FOUND/FULL/IN_PROGRESS/BAD_NAME/BAD_SUBMIT…) |
| `game:started` | 開始通知 |
| `round:state` | 現在ラウンド・担当カード・工程仕様・閲覧可能情報・開始/終了時刻・serverNow・下書き(個別送信=情報公開制御) |
| `round:progress` | 提出済み人数・各人の提出/接続状態 |
| `round:submitted` / `round:autoSubmitted` | 提出確定 / 時間切れ自動提出 |
| `round:advanced` | ラウンド移行 |
| `game:results` | 完成カード一覧+担当者クレジット |
| `results:state` | 発表中カード・表裏・終了フラグ |
| `session:invalid` | トークン無効 |

※ 仕様書の `game:state` は `room:state`(phase) + `round:state` に統合(役割は同等、仕様書§26の「イベント名変更可」に基づく)。

## 11. タイマーと自動提出の仕組み

- ラウンド開始時にサーバーが `startAt / endAt / serverNow` を送信。クライアントは `offset = serverNow - Date.now()` を保持し、**表示専用**の残り時間を200ms間隔+visibilitychangeで再計算(端末時刻・バックグラウンド移行の影響なし)。
- サーバーは `endAt + 400ms`(猶予) に setTimeout でラウンド確定。未提出カードは最新下書き(無ければ空/白紙)を自動提出して次ラウンドへ。
- 全カード提出済みになった時点で即確定。確定処理は `finalized[round]` フラグ + タイマー解除で**排他制御**(早期進行とタイムアウトの二重実行防止)。
- テキスト下書き: 400ms debounce送信、残り時間僅少時は即時送信。Canvas下書き: ストローク完了/Undo/塗り/全消し毎に1秒スロットル送信 + タイマー0時・画面非表示時にフラッシュ。

## 12. 再接続とセッショントークンの仕組み

- 参加成功時に `crypto.randomBytes(24)` のトークンを発行し、localStorage に {code, token, playerId, name} を保存。
- ページロード時/Socket再接続時に `room:reconnect {code, token}` → サーバーがトークン照合 → 同一プレイヤーとして socketId を差し替え(旧接続は切断)、phaseに応じて ロビー/入力(下書き復元)/待機/結果発表 の状態を個別送信。
- 切断時は connected=false のまま保持(即退出させない)。時間切れ時は下書きで自動提出。ロビーでのみ90秒無応答で自動退出(ホスト移譲あり)。

## 13. 通常・効果・融合モンスターのラウンド分岐方法

`gameSpec.roundSpecFor(card, round)` が種別×ラウンドから工程仕様(kind/タイトル/説明/上限/モード/新効果番号/直前ラベル)を一元生成し、サーバーの検証・クライアントのUI・結果画面のクレジット役割名すべてがこれを参照する。

- 結合規則: 通常・効果・融合とも、R4〜7(融合はR6+R7)の全断片を**改行なしでそのまま連結**する(①②等の番号も付与しない)。融合素材のみ「A」＋「B」形式。続き/新効果モードは担当者への指示文の違いとして残る。

## 14. Canvasの描画・Undo・塗りつぶしの設計

- 表示 約360px四方(レスポンシブ)、内部解像度 640×640 固定(高DPI対策・端末間で成果物が同一)。
- Pointer Events + `touch-action:none` + setPointerCapture(Canvas外へ出ても状態が壊れない)。getCoalescedEventsで滑らかな線。
- パレット9色(白=消しゴム兼用)・太さスライダー・ペン/塗りつぶしツール切替(選択状態を枠表示)。
- Undo: 操作開始前に ImageData をスタックへ(上限10件でメモリ制御)。全消し・塗りつぶしもUndo対象。
- 塗りつぶし: ImageData上のFlood Fill(訪問済みUint8Array+インデックススタック、許容誤差48)。640²は数十ms以内で完了しUIをブロックしない。
- 提出/下書きとも `toDataURL('image/png')`。サーバーでMIME・サイズ検証。

## 15. Canvasの下書き保存方法

ストローク完了・Undo・塗りつぶし・全消しの各操作後にdataURL化し、1秒スロットルで `round:draft` 送信。タイマー0・visibilitychange(hidden)で即時フラッシュ。サーバーは round×card 単位で最新のみ保持し、時間切れ時にそれを正式提出へ昇格(無ければサーバー生成の白紙PNG)。

## 16. QRコード参加の仕組み

- 参加URL: `<公開URL>/join/<CODE>`。ロビーで `qrcode` ライブラリ(フロントエンド内、外部サービス送信なし)によりDataURL生成して表示。
- `/join/:code` はExpressのSPA fallbackでindex.htmlを返し、クライアントがpathnameからコードを抽出して参加画面に自動入力。保存済みの名前があれば確認して即参加可能。
- ルームコードは紛らわしい文字(0/O, 1/I, 8/B)を除いた30文字集合から4文字生成、既存ルームと重複照合。
- Web Share API対応端末は共有ボタン、非対応はURLコピー(clipboard API+フォールバック)。

## 17. スマートフォン向けUI設計

- 縦画面最優先・最大幅520pxの中央カラム。`100dvh` + `env(safe-area-inset-*)`。横スクロール禁止。
- 主要ボタン高さ48px以上。タイマーとラウンド情報は上部sticky(キーボード表示中も見える)。提出ボタンは入力欄直下(キーボードに隠れない)。
- 入力欄はfont-size 16px以上(iOSの自動ズーム防止)。連打防止は送信中フラグ+サーバー側二重提出拒否。
- 切断時は再接続オーバーレイ(自動再試行+手動ボタン+ホームへ)。ゲーム中のみbeforeunloadで離脱確認。visibilitychangeで`state:sync`再同期。
- 状態表示は色+文字/アイコン併用(接続●/提出✓など)。
- アートディレクション: 濃紺〜深紫の夜の工房、金のアクセント、羊皮紙のカード枠。見出しは游明朝系フォールバック、本文はゴシック。

## 18. 結果発表画面の構成

1. 「結果発表」+ n/N枚目 → カード裏面(オリジナル錬成紋デザイン)がスライドイン+金粒子
2. タップ → `results:reveal` で全端末同期、3DフリップSFX付きで表面公開
3. カード名→ステータス→テキストの順に段階アニメーション → 担当者クレジット(8工程、種別に応じた役割名)
4. 「次のカードへ」(`results:next`) → 最終カードで「結果一覧へ」→ 全カードグリッド(タップ拡大・最初から見る・新しいルーム・ホームへ)
- 効果音はWeb Audio APIで生成したオリジナルSFX(開始/登場/フリップ/公開/移動/完了)。初回タップでAudioContextをresume。ミュートはlocalStorage保存。音が出せなくても進行に影響しない。

## 19. クラウドへのデプロイ方針

- 単一Node.jsプロセス(Express+Socket.io+dist配信)なので、WebSocket対応のNode.jsホスティング(例: Render / Railway / Fly.io / Koyeb)にそのまま載る。
  - Build: `npm install && npm run build` / Start: `npm start` / `PORT`はサービス供給値を使用、`0.0.0.0`待受。
- スケールアウト(複数インスタンス)は対象外(1インスタンス前提)。Redisは**再起動・入れ替え時の状態退避**用。
- HTTPSはホスティングのTLS終端を利用(同一オリジンなのでWSSも自動)。`PUBLIC_BASE_URL`は任意(参加URLはクライアントが自オリジンから生成)。

## 20. 想定される問題と対策

| 問題 | 対策 |
|---|---|
| スマホのスリープ/バックグラウンドで時間がずれる | サーバー時刻基準のendAt+visibilitychange再計算、復帰時`state:sync` |
| 時間切れ直前の入力が失われる | 下書きのdebounce/スロットル送信+残り僅かで即時送信+サーバー側400ms猶予 |
| 早期進行とタイムアウトの二重進行 | `finalized[round]`フラグとタイマー解除で排他 |
| 提出ボタン連打・イベント再送 | サーバー側で提出済みチェック(冪等応答)、クライアントは送信中無効化 |
| 巨大ペイロード攻撃 | maxHttpBufferSize制限+dataURLのMIME/サイズ検証+文字数クリップ+簡易レート制限 |
| 他人のカード/過去ラウンドへの提出 | 担当式(i+r-1)%Nとラウンド番号をサーバーで照合し拒否 |
| WebSocket遮断環境 | Socket.io pollingフォールバック維持 |
| サーバー再起動でゲーム消失 | Redisスナップショット+復元時のタイマー再武装(メモリのみ運用時の制約はREADME明記) |
| iOSの音声制限 | ユーザー操作時にAudioContext resume、失敗しても無音で進行 |
| Flood Fillの固まり | 型付き配列による走査(640²で数十ms) |
| XSS | Reactの標準エスケープのみ使用、dangerouslySetInnerHTML不使用、制御文字除去 |
