// サーバーのゲームフロー自動検証スクリプト。
// 実サーバーを起動し、socket.io-clientで2/3/4人のプレイヤーを模擬して
// 全8ラウンド〜結果発表までを検証する。
// 使い方: npm run smoke

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as ioc } from 'socket.io-client';
import { C2S, S2C } from '../shared/constants.js';
import { whitePngDataUrl } from '../server/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  ✗ FAIL:', msg);
  }
}

function assertEq(a, b, msg) {
  assert(a === b, `${msg} (expected=${JSON.stringify(b)} actual=${JSON.stringify(a)})`);
}

/** Socketラッパ: サーバーイベントをバッファし、条件付きで待てるようにする */
class TC {
  constructor(port, label) {
    this.label = label;
    this.sock = ioc(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
    this.buf = [];
    this.waiters = [];
    for (const ev of Object.values(S2C)) {
      this.sock.on(ev, (payload) => this._push(ev, payload));
    }
  }

  _push(event, payload) {
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      if (w.event === event && w.pred(payload)) {
        this.waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(payload);
        return;
      }
    }
    this.buf.push({ event, payload });
    if (this.buf.length > 500) this.buf.shift();
  }

  wait(event, pred = () => true, timeoutMs = 10000, desc = '') {
    for (let i = 0; i < this.buf.length; i++) {
      if (this.buf[i].event === event && pred(this.buf[i].payload)) {
        const { payload } = this.buf.splice(i, 1)[0];
        return Promise.resolve(payload);
      }
    }
    return new Promise((resolve, reject) => {
      const w = { event, pred, resolve };
      w.timer = setTimeout(() => {
        const idx = this.waiters.indexOf(w);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`[${this.label}] timeout waiting ${event} ${desc}`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  emit(event, payload) {
    this.sock.emit(event, payload);
  }

  close() {
    this.sock.close();
  }
}

function startServer(port, env = {}) {
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      REDIS_URL: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => console.error('[server-err]', d.toString().trim()));
  return proc;
}

async function waitServer(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return;
    } catch { /* まだ起動中 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

const png = whitePngDataUrl();

/** ラウンド仕様に応じた提出値を作る（検証用に決定的な文字列） */
function valueFor(spec, r, ci) {
  switch (spec.kind) {
    case 'stats':
      return { attribute: '炎', level: 7, atk: 1500, def: 800 };
    case 'drawing':
      return png;
    default:
      return `V${r}C${ci}`;
  }
}

/**
 * 1ゲームを最後まで回す共通ルーチン。
 * clients: TC[]（参加順=プレイヤーインデックス）
 * 戻り値: record[cardIndex][round] = 提出値
 */
async function playGame(clients, { checkVisibility = true, hooks = {} } = {}) {
  const n = clients.length;
  const record = Array.from({ length: n }, () => ({}));

  for (let r = 1; r <= 8; r++) {
    const states = await Promise.all(
      clients.map((c) => c.wait(S2C.ROUND_STATE, (p) => p.round === r, 15000, `round ${r}`))
    );

    for (let idx = 0; idx < n; idx++) {
      const rs = states[idx];
      // カードの回転: 担当プレイヤー = (cardIndex + r - 1) % N
      assertEq((rs.cardIndex + r - 1) % n, idx, `R${r} P${idx} 担当式`);

      if (checkVisibility) {
        const rec = record[rs.cardIndex];
        if (r === 2) assertEq(rs.visible.nameFirst, rec[1], `R2 直前(名前前半)のみ表示`);
        if (r === 3) assertEq(rs.visible.name, rec[1] + rec[2], `R3 完成カード名の表示`);
        if (r === 4) {
          assertEq(rs.visible.stats.atk, rec[3].atk, 'R4 ステータス表示(ATK)');
          assertEq(rs.visible.stats.attribute, rec[3].attribute, 'R4 ステータス表示(属性)');
          assert(rs.visible.prevText === undefined, 'R4 に余計なテキストが漏れていない');
        }
        if (r >= 5 && r <= 7) {
          assertEq(rs.visible.prevText, rec[r - 1], `R${r} 直前テキストのみ表示`);
          assert(rs.visible.name === undefined && rs.visible.stats === undefined,
            `R${r} 過去情報(名前/ステータス)が漏れていない`);
        }
        if (r === 8) {
          assert(rs.visible.card && typeof rs.visible.card.name === 'string', 'R8 全情報が表示される');
          assertEq(rs.visible.card.name, rec[1] + rec[2], 'R8 カード名');
        }
      }

      await hooks.beforeSubmit?.(r, idx, rs, clients);

      const v = valueFor(rs.spec, r, rs.cardIndex);
      record[rs.cardIndex][r] = v;
      clients[idx].emit(C2S.SUBMIT, { round: r, cardIndex: rs.cardIndex, value: v });
    }

    await Promise.all(
      clients.map((c) => c.wait(S2C.SUBMITTED, (p) => p.round === r, 15000, `submitted ${r}`))
    );
    await hooks.afterRound?.(r, clients);
  }

  const results = await clients[0].wait(S2C.RESULTS, () => true, 15000, 'results');
  return { record, results };
}

// ================================================================
// シナリオA: 3人・効果モンスター固定
//   回転式・情報公開・続き/新効果モード・二重/不正提出・結果発表の進行
// ================================================================
async function scenarioA() {
  console.log('--- シナリオA: 3人 / 効果モンスター ---');
  const port = 3101;
  const server = startServer(port, { TEXT_ROUND_SECONDS: '20', DRAWING_ROUND_SECONDS: '20', FORCE_CARD_TYPE: 'effect' });
  try {
    await waitServer(port);
    const c1 = new TC(port, 'A1');
    c1.emit(C2S.CREATE, { name: 'アリス' });
    const created = await c1.wait(S2C.CREATED);
    assert(/^[A-Z0-9]{4}$/.test(created.code), 'ルームコードは4文字');
    assert(typeof created.token === 'string' && created.token.length >= 24, 'セッショントークン発行');

    const c2 = new TC(port, 'A2');
    const c3 = new TC(port, 'A3');
    c2.emit(C2S.JOIN, { code: created.code, name: 'ボブ' });
    await c2.wait(S2C.JOINED);
    c3.emit(C2S.JOIN, { code: created.code, name: 'チホ' });
    await c3.wait(S2C.JOINED);
    await c1.wait(S2C.ROOM_STATE, (p) => p.players.length === 3);

    const clients = [c1, c2, c3];
    c1.emit(C2S.START);
    await c1.wait(S2C.GAME_STARTED);

    let checkedErrors = false;
    const { record, results } = await playGame(clients, {
      hooks: {
        beforeSubmit: async (r, idx, rs, cs) => {
          // 効果モンスター: R5〜7には続き/新効果モードが必ずある
          if (r >= 5 && r <= 7) {
            assert(rs.spec.mode === 'continue' || rs.spec.mode === 'new', `R${r} モードあり(${rs.spec.mode})`);
          }
          if (r === 2 && idx === 0 && !checkedErrors) {
            checkedErrors = true;
            // 担当外カードへの提出 → 拒否
            cs[0].emit(C2S.SUBMIT, { round: 2, cardIndex: (rs.cardIndex + 1) % 3, value: 'ズル' });
            const e1 = await cs[0].wait(S2C.ROOM_ERROR, (p) => p.code === 'BAD_CARD');
            assert(!!e1, '担当外カードへの提出を拒否');
            // 過去ラウンドへの提出 → 拒否
            cs[0].emit(C2S.SUBMIT, { round: 1, cardIndex: rs.cardIndex, value: '過去' });
            const e2 = await cs[0].wait(S2C.ROOM_ERROR, (p) => p.code === 'BAD_ROUND');
            assert(!!e2, '過去ラウンドへの提出を拒否');
          }
        },
        afterRound: async (r, cs) => {
          if (r === 3) {
            // 同一イベント再送 → 二重確定せず冪等応答のみ
            const rs = await cs[0].wait(S2C.ROUND_STATE, (p) => p.round === 4, 15000, 'dup check');
            cs[0].buf.unshift({ event: S2C.ROUND_STATE, payload: rs }); // 戻す
            cs[0].emit(C2S.SUBMIT, { round: 3, cardIndex: ((0 - 2 + 3) % 3), value: { attribute: '闇', level: 1, atk: 0, def: 0 } });
            // 過去ラウンド扱いで拒否される（すでにR4へ進んでいるため）
            await cs[0].wait(S2C.ROOM_ERROR, (p) => p.code === 'BAD_ROUND');
            assert(true, 'ラウンド進行後の再送は確定されない');
          }
        },
      },
    });

    // ---- 結果の検証 ----
    assertEq(results.cards.length, 3, 'カード枚数=プレイヤー数');
    for (const card of results.cards) {
      const rec = record[card.index];
      assertEq(card.cardType, 'effect', 'カード種別が固定されている');
      assertEq(card.name, rec[1] + rec[2], '名前=前半+後半の連結');
      assertEq(card.attribute, '炎', '属性');
      assertEq(card.level, 7, 'レベル');
      assertEq(card.atk, 1500, 'ATK');
      assertEq(card.def, 800, 'DEF');
      assert(card.image.startsWith('data:image/png;base64,'), 'イラストPNG');
      assert(typeof card.species === 'string' && card.species.endsWith('族'), '種族');
      for (const r of [4, 5, 6, 7]) {
        assert(card.bodyText.includes(rec[r]), `効果テキストに断片R${r}を含む`);
      }
      assert(!/[①②③④]/.test(card.bodyText), '効果テキストに番号が付与されない');
      assertEq(card.bodyText, [4, 5, 6, 7].map((r) => rec[r]).join(''), '効果テキストは改行なしで連結');
      const credits = results.credits[card.index];
      assertEq(credits.length, 8, 'クレジット8工程');
      assertEq(credits[0].role, 'カード名・前半', 'クレジット役割名(R1)');
      assertEq(credits[3].role.startsWith('効果テキスト'), true, 'クレジット役割名(R4)');
      // 担当者名の検証: R1担当はプレイヤー(cardIndex)
      const names = ['アリス', 'ボブ', 'チホ'];
      assertEq(credits[0].playerName, names[card.index % 3], 'R1担当者');
      assertEq(credits[7].playerName, names[(card.index + 7) % 3], 'R8担当者');
    }

    // ---- 結果発表の進行（誰でもめくれる・二重送信で飛ばない） ----
    let st = await c2.wait(S2C.RESULTS_STATE, (p) => p.index === 0 && !p.revealed);
    c2.emit(C2S.REVEAL, { cardIndex: 0 });
    st = await c3.wait(S2C.RESULTS_STATE, (p) => p.revealed);
    assertEq(st.index, 0, 'めくり同期');
    c3.emit(C2S.NEXT, { fromIndex: 0 });
    c3.emit(C2S.NEXT, { fromIndex: 0 }); // 二重送信
    st = await c1.wait(S2C.RESULTS_STATE, (p) => p.index === 1 && !p.revealed);
    assert(true, '次のカードへ（二重送信でスキップしない）');
    c1.emit(C2S.REVEAL, { cardIndex: 1 });
    await c1.wait(S2C.RESULTS_STATE, (p) => p.index === 1 && p.revealed);
    c1.emit(C2S.NEXT, { fromIndex: 1 });
    await c1.wait(S2C.RESULTS_STATE, (p) => p.index === 2);
    c1.emit(C2S.REVEAL, { cardIndex: 2 });
    await c1.wait(S2C.RESULTS_STATE, (p) => p.revealed && p.index === 2);
    c1.emit(C2S.NEXT, { fromIndex: 2 });
    st = await c2.wait(S2C.RESULTS_STATE, (p) => p.finished);
    assert(st.finished, '全カード発表完了');
    c2.emit(C2S.RESTART);
    await c1.wait(S2C.RESULTS_STATE, (p) => p.index === 0 && !p.finished);
    assert(true, '最初から見る');

    c1.close(); c2.close(); c3.close();
  } finally {
    server.kill();
  }
}

// ================================================================
// シナリオB: 2人・融合モンスター固定
//   下書き自動提出・再接続・下書き復元・ゲーム中の新規参加拒否・無効トークン
// ================================================================
async function scenarioB() {
  console.log('--- シナリオB: 2人 / 融合モンスター / 自動提出・再接続 ---');
  const port = 3102;
  const server = startServer(port, { TEXT_ROUND_SECONDS: '4', DRAWING_ROUND_SECONDS: '4', FORCE_CARD_TYPE: 'fusion' });
  try {
    await waitServer(port);
    const c1 = new TC(port, 'B1');
    c1.emit(C2S.CREATE, { name: 'ホスト' });
    const created = await c1.wait(S2C.CREATED);
    let c2 = new TC(port, 'B2');
    c2.emit(C2S.JOIN, { code: created.code, name: 'ゲスト' });
    const joined2 = await c2.wait(S2C.JOINED);
    await c1.wait(S2C.ROOM_STATE, (p) => p.players.length === 2);

    c1.emit(C2S.START);

    // --- ラウンド1: c1は提出、c2は下書きのみ → 時間切れで下書きが自動提出される ---
    const rs1a = await c1.wait(S2C.ROUND_STATE, (p) => p.round === 1);
    const rs1b = await c2.wait(S2C.ROUND_STATE, (p) => p.round === 1);
    c1.emit(C2S.SUBMIT, { round: 1, cardIndex: rs1a.cardIndex, value: 'まぼろしの' });
    c2.emit(C2S.DRAFT, { round: 1, cardIndex: rs1b.cardIndex, value: '朧月' });
    await c2.wait(S2C.AUTO_SUBMITTED, (p) => p.round === 1, 8000, 'auto submit');
    assert(true, '時間切れで自動提出の通知');

    // R2: c2のカード(=rs1b.cardIndex)はc1が担当。下書き「朧月」が反映されているはず
    const rs2a = await c1.wait(S2C.ROUND_STATE, (p) => p.round === 2);
    const rs2b = await c2.wait(S2C.ROUND_STATE, (p) => p.round === 2);
    const forC1 = rs2a.cardIndex === rs1b.cardIndex ? rs2a : rs2b;
    assertEq(forC1.visible.nameFirst, '朧月', '切断者の下書きが自動提出されている');

    // ゲーム中の新規参加は拒否
    const c9 = new TC(port, 'B9');
    c9.emit(C2S.JOIN, { code: created.code, name: 'おそい' });
    await c9.wait(S2C.ROOM_ERROR, (p) => p.code === 'IN_PROGRESS');
    assert(true, 'ゲーム開始後の新規参加を拒否');
    // 無効トークンの再接続
    c9.emit(C2S.RECONNECT, { code: created.code, token: 'x'.repeat(32) });
    await c9.wait(S2C.SESSION_INVALID);
    assert(true, '無効トークンで session:invalid');
    c9.close();

    // --- R2〜R8を進める。R2の途中でc2を切断→トークン再接続して下書き復元を確認 ---
    c2.emit(C2S.DRAFT, { round: 2, cardIndex: rs2b.cardIndex, value: 'かけら' });
    await new Promise((r) => setTimeout(r, 250)); // 下書き到達待ち
    c2.sock.disconnect();
    const c2b = new TC(port, 'B2r');
    c2b.emit(C2S.RECONNECT, { code: created.code, token: joined2.token });
    const rj = await c2b.wait(S2C.JOINED, (p) => p.reconnected === true);
    assertEq(rj.playerId, joined2.playerId, '同一プレイヤーとして復帰');
    const rs2r = await c2b.wait(S2C.ROUND_STATE, (p) => p.round === 2, 5000, 'reconnect round state');
    assertEq(rs2r.draft, 'かけら', '再接続で下書きが復元される');
    assertEq(rs2r.submitted, false, '未提出状態で復帰');
    c2.close();
    c2 = c2b;

    // 残りのラウンドを両者提出で進める
    const record = { [rs1a.cardIndex]: { 1: 'まぼろしの' }, [rs1b.cardIndex]: { 1: '朧月' } };
    const clients = [c1, c2];
    // round2はすでにround:stateを受信済み（rs2a / rs2r）
    let states = { 0: rs2a, 1: rs2r };
    for (let r = 2; r <= 8; r++) {
      if (r > 2) {
        const [sa, sb] = await Promise.all([
          c1.wait(S2C.ROUND_STATE, (p) => p.round === r, 10000, `B round ${r}`),
          c2.wait(S2C.ROUND_STATE, (p) => p.round === r, 10000, `B round ${r}`),
        ]);
        states = { 0: sa, 1: sb };
      }
      for (const idx of [0, 1]) {
        const rs = states[idx];
        // 融合: R4/5は素材、R6は効果(モードなし)、R7はモードあり
        if (rs.round === 4 || rs.round === 5) assertEq(rs.spec.kind, 'material', `R${rs.round} 融合素材工程`);
        if (rs.round === 6) {
          assertEq(rs.spec.kind, 'fusionEffect', 'R6 効果工程');
          assert(!rs.spec.mode, 'R6 はモードなし');
        }
        if (rs.round === 7) assert(rs.spec.mode === 'continue' || rs.spec.mode === 'new', 'R7 モードあり');
        const v = valueFor(rs.spec, rs.round, rs.cardIndex);
        record[rs.cardIndex][rs.round] = v;
        clients[idx].emit(C2S.SUBMIT, { round: rs.round, cardIndex: rs.cardIndex, value: v });
      }
      await Promise.all(clients.map((c) => c.wait(S2C.SUBMITTED, (p) => p.round === r, 10000, `B submitted ${r}`)));
    }

    const results = await c1.wait(S2C.RESULTS, () => true, 10000, 'B results');
    for (const card of results.cards) {
      const rec = record[card.index];
      assertEq(card.cardType, 'fusion', '融合固定');
      assertEq(card.materialsText, `「${rec[4]}」＋「${rec[5]}」`, '融合素材の表示形式');
      assert(card.bodyText.includes(rec[6]) && card.bodyText.includes(rec[7]), '融合効果の結合');
      const credits = results.credits[card.index];
      assertEq(credits[3].role, '融合素材①', '融合クレジットR4');
      assertEq(credits[4].role, '融合素材②', '融合クレジットR5');
    }

    c1.close(); c2.close();
  } finally {
    server.kill();
  }
}

// ================================================================
// シナリオC: 4人・通常モンスター固定 + 満員/人数不足の拒否
// ================================================================
async function scenarioC() {
  console.log('--- シナリオC: 4人 / 通常モンスター / 満員・人数チェック ---');
  const port = 3103;
  const server = startServer(port, { TEXT_ROUND_SECONDS: '20', DRAWING_ROUND_SECONDS: '20', FORCE_CARD_TYPE: 'normal' });
  try {
    await waitServer(port);
    const c1 = new TC(port, 'C1');
    c1.emit(C2S.CREATE, { name: 'P1' });
    const created = await c1.wait(S2C.CREATED);

    // 1人では開始できない
    c1.emit(C2S.START);
    await c1.wait(S2C.ROOM_ERROR, (p) => p.code === 'NOT_ENOUGH');
    assert(true, '1人では開始不可');

    // 名前バリデーション
    const cx = new TC(port, 'CX');
    cx.emit(C2S.JOIN, { code: created.code, name: 'あ'.repeat(20) });
    await cx.wait(S2C.ROOM_ERROR, (p) => p.code === 'BAD_NAME');
    assert(true, '13文字以上の名前を拒否');
    cx.emit(C2S.JOIN, { code: 'ZZZZ', name: 'だれか' });
    await cx.wait(S2C.ROOM_ERROR, (p) => p.code === 'NOT_FOUND');
    assert(true, '存在しないルームを拒否');
    cx.close();

    const others = [];
    for (let i = 2; i <= 4; i++) {
      const c = new TC(port, `C${i}`);
      c.emit(C2S.JOIN, { code: created.code, name: `P${i}` });
      await c.wait(S2C.JOINED);
      others.push(c);
    }
    // 5人目は拒否
    const c5 = new TC(port, 'C5');
    c5.emit(C2S.JOIN, { code: created.code, name: 'P5' });
    await c5.wait(S2C.ROOM_ERROR, (p) => p.code === 'FULL');
    assert(true, '5人目の参加を拒否');
    c5.close();

    await c1.wait(S2C.ROOM_STATE, (p) => p.players.length === 4);
    const clients = [c1, ...others];
    c1.emit(C2S.START);

    const { record, results } = await playGame(clients, {
      hooks: {
        beforeSubmit: async (r, idx, rs) => {
          if (r >= 4 && r <= 7) {
            assertEq(rs.spec.kind, 'flavor', `通常 R${r} はフレーバー工程`);
            assert(!rs.spec.mode, `通常 R${r} は続き/新効果モードなし`);
          }
        },
      },
    });

    assertEq(results.cards.length, 4, '4枚生成');
    for (const card of results.cards) {
      const rec = record[card.index];
      assertEq(card.cardType, 'normal', '通常固定');
      assertEq(card.bodyText, [4, 5, 6, 7].map((r) => rec[r]).join(''), 'フレーバーは改行なしで連結');
      assert(!card.materialsText, '通常カードに融合素材なし');
    }

    for (const c of clients) c.close();
  } finally {
    server.kill();
  }
}

// ================================================================
try {
  await scenarioA();
  await scenarioB();
  await scenarioC();
} catch (err) {
  failed++;
  console.error('✗ シナリオ実行エラー:', err.message);
}

console.log('----------------------------------------');
console.log(`結果: ${passed} passed / ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
