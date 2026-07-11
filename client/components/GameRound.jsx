import React, { useEffect, useRef, useState } from 'react';
import { CARD_TYPE_LABEL, ATTRIBUTES, LIMITS } from '../../shared/constants.js';
import { useServerCountdown } from '../hooks.js';
import { sfx, unlockAudio } from '../audio.js';
import DrawingCanvas from './DrawingCanvas.jsx';
import Waiting from './Waiting.jsx';

const ATTR_CLASS = { 闇: 'dark', 光: 'light', 地: 'earth', 水: 'water', 炎: 'fire', 風: 'wind' };

function TimerBar({ remainMs, totalMs }) {
  const sec = Math.ceil(remainMs / 1000);
  const cls = remainMs <= 5000 ? 'timer is-critical' : remainMs <= 10000 ? 'timer is-warn' : 'timer';
  const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainMs / totalMs)) : 0;
  return (
    <div className={cls} aria-live="polite">
      <span className="timer-num">{sec}</span>
      <span className="timer-unit">秒</span>
      <div className="timer-bar"><div className="timer-bar-fill" style={{ width: `${ratio * 100}%` }} /></div>
    </div>
  );
}

/** 直前工程の成果物の表示（仕様§8: 直前の工程のみ） */
function VisiblePanel({ round }) {
  const { visible, spec } = round;
  if (round.round === 1) return null;

  if (round.round === 2) {
    return (
      <div className="prev-panel">
        <p className="prev-label">{spec.prevLabel}</p>
        <p className="prev-text">{visible.nameFirst || '（未入力）'}</p>
      </div>
    );
  }
  if (round.round === 3) {
    return (
      <div className="prev-panel">
        <p className="prev-label">{spec.prevLabel}</p>
        <p className="prev-text prev-name">{visible.name || '（カード名は未入力でした）'}</p>
      </div>
    );
  }
  if (round.round === 4) {
    const s = visible.stats || {};
    return (
      <div className="prev-panel">
        <p className="prev-label">ステータス</p>
        <div className="stats-grid-view">
          <span className={`attr-chip attr-${ATTR_CLASS[s.attribute] || 'dark'}`}>{s.attribute || '—'}</span>
          <span>Lv.{s.level ?? '—'}</span>
          <span>ATK/{s.atk ?? '—'}</span>
          <span>DEF/{s.def ?? '—'}</span>
        </div>
      </div>
    );
  }
  if (round.round >= 5 && round.round <= 7) {
    return (
      <div className="prev-panel">
        <p className="prev-label">{spec.prevLabel}（直前の担当者）</p>
        <p className="prev-text pre-wrap">{visible.prevText || '（未入力）'}</p>
      </div>
    );
  }
  return null;
}

/** ラウンド8用: 完成カードの全情報 */
function FullCardInfo({ card }) {
  if (!card) return null;
  return (
    <div className="prev-panel fullinfo">
      <p className="prev-label">完成したカード情報（これを参考に描こう！）</p>
      <p className="fullinfo-name">{card.name}</p>
      <div className="stats-grid-view">
        <span className={`attr-chip attr-${ATTR_CLASS[card.attribute] || 'dark'}`}>{card.attribute}</span>
        <span>{'★'.repeat(Math.min(card.level, 12))}</span>
        <span>ATK/{card.atk}</span>
        <span>DEF/{card.def}</span>
      </div>
      <p className="fullinfo-species">【{card.species}】</p>
      {card.materialsText && <p className="fullinfo-materials">{card.materialsText}</p>}
      <p className="prev-text pre-wrap fullinfo-body">{card.bodyText}</p>
    </div>
  );
}

/** テキスト系入力（1行/複数行）。下書きをdebounce送信し、残り僅かでは即時送信 */
function TextInput({ round, api, urgent, busy, onSubmit }) {
  const { spec } = round;
  const [val, setVal] = useState(typeof round.draft === 'string' ? round.draft : '');
  const lastSentRef = useRef(val);

  const send = (v) => {
    if (lastSentRef.current === v) return;
    lastSentRef.current = v;
    api.sendDraft(round.round, round.cardIndex, v);
  };

  // 下書きのdebounce送信（400ms）。残り時間僅少時は即時
  useEffect(() => {
    if (urgent) {
      send(val);
      return undefined;
    }
    const h = setTimeout(() => send(val), 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [val, urgent]);

  const len = [...val].length;
  const handleSubmit = () => {
    if (busy) return;
    if (!val.trim() && !window.confirm('未入力のまま提出しますか？')) return;
    send(val);
    onSubmit(val);
  };

  return (
    <div className="input-area">
      {round.round === 2 && (
        <p className="name-preview">
          完成予想：<strong>{(round.visible.nameFirst || '') + val || '（？？？）'}</strong>
        </p>
      )}
      {spec.input === 'line' ? (
        <input
          className="text-input"
          type="text"
          value={val}
          maxLength={spec.maxLength}
          placeholder={spec.placeholder || ''}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => send(val)}
        />
      ) : (
        <textarea
          className="text-input textarea"
          value={val}
          maxLength={spec.maxLength}
          placeholder={spec.placeholder || '自由に書いてみよう'}
          rows={4}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => send(val)}
        />
      )}
      <p className="char-count">{len} / {spec.maxLength}文字</p>
      <button type="button" className="btn btn-primary btn-block" onClick={handleSubmit} disabled={busy}>
        {busy ? '送信中…' : 'これで提出する'}
      </button>
    </div>
  );
}

/** ラウンド3: ステータス入力 */
function StatsInput({ round, api, busy, onSubmit }) {
  const d = round.draft && typeof round.draft === 'object' ? round.draft : {};
  const [attribute, setAttribute] = useState(d.attribute || '闇');
  const [level, setLevel] = useState(d.level ?? 4);
  const [atk, setAtk] = useState(d.atk ?? 0);
  const [def, setDef] = useState(d.def ?? 0);

  const clampNum = (v) => {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(LIMITS.atkMin, Math.min(LIMITS.atkMax, n));
  };

  // 変更をまとめて下書き送信（300ms debounce）
  useEffect(() => {
    const h = setTimeout(() => {
      api.sendDraft(round.round, round.cardIndex, { attribute, level, atk, def });
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attribute, level, atk, def]);

  return (
    <div className="input-area">
      <p className="field-label">属性</p>
      <div className="attr-row" role="radiogroup" aria-label="属性">
        {ATTRIBUTES.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={attribute === a}
            className={`attr-chip attr-${ATTR_CLASS[a]} ${attribute === a ? 'is-selected' : ''}`}
            onClick={() => { sfx.tap(); setAttribute(a); }}
          >
            {a}
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="level-select">レベル（★の数）</label>
      <select
        id="level-select"
        className="text-input select"
        value={level}
        onChange={(e) => setLevel(Number(e.target.value))}
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((lv) => (
          <option key={lv} value={lv}>Lv.{lv}　{'★'.repeat(lv)}</option>
        ))}
      </select>

      <div className="atkdef-row">
        <div>
          <label className="field-label" htmlFor="atk-input">ATK</label>
          <input
            id="atk-input"
            className="text-input"
            type="number"
            inputMode="numeric"
            min={LIMITS.atkMin}
            max={LIMITS.atkMax}
            value={atk}
            onChange={(e) => setAtk(clampNum(e.target.value))}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="def-input">DEF</label>
          <input
            id="def-input"
            className="text-input"
            type="number"
            inputMode="numeric"
            min={LIMITS.atkMin}
            max={LIMITS.atkMax}
            value={def}
            onChange={(e) => setDef(clampNum(e.target.value))}
          />
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={() => onSubmit({ attribute, level, atk, def })}
      >
        {busy ? '送信中…' : 'これで提出する'}
      </button>
    </div>
  );
}

/** ラウンド8: イラスト */
function DrawingInput({ round, api, busy, remainMs, onSubmit }) {
  const canvasRef = useRef(null);
  const throttleRef = useRef({ last: 0, handle: null, pending: null });

  // Canvas下書きの1秒スロットル送信
  const queueDraft = (dataUrl) => {
    const t = throttleRef.current;
    t.pending = dataUrl;
    const flush = () => {
      if (t.handle) { clearTimeout(t.handle); t.handle = null; }
      if (t.pending) {
        t.last = Date.now();
        api.sendDraft(round.round, round.cardIndex, t.pending);
        t.pending = null;
      }
    };
    const since = Date.now() - t.last;
    if (since >= 1000) flush();
    else if (!t.handle) t.handle = setTimeout(flush, 1000 - since);
  };

  // 時間切れ間際・画面非表示時に未送信の下書きをフラッシュ
  useEffect(() => {
    const t = throttleRef.current;
    const flushNow = () => {
      if (t.handle) { clearTimeout(t.handle); t.handle = null; }
      if (t.pending) {
        api.sendDraft(round.round, round.cardIndex, t.pending);
        t.pending = null;
        t.last = Date.now();
      }
    };
    if (remainMs <= 1200) flushNow();
    const onHide = () => document.visibilityState === 'hidden' && flushNow();
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainMs <= 1200]);

  return (
    <div className="input-area">
      <DrawingCanvas
        ref={canvasRef}
        initialImage={typeof round.draft === 'string' ? round.draft : null}
        onOp={queueDraft}
      />
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={() => {
          const url = canvasRef.current?.toDataURL();
          if (url) onSubmit(url);
        }}
      >
        {busy ? '送信中…' : 'イラストを提出する'}
      </button>
    </div>
  );
}

export default function GameRound({ api, round, progress }) {
  const remainMs = useServerCountdown(round.endAt, round.serverNow);
  const totalMs = round.endAt - round.startAt;
  const [busy, setBusy] = useState(false);

  // ラウンドが変わったら送信中フラグを解除
  useEffect(() => setBusy(false), [round.round, round.cardIndex, round.submitted]);

  const submit = (value) => {
    setBusy(true);
    unlockAudio();
    sfx.tap();
    api.submit(round.round, round.cardIndex, value);
  };

  const { spec } = round;
  const typeClass = `type-${round.cardType}`;
  // イラスト工程では長押しによるテキスト選択が描画の妨げになるため無効化する
  const drawingClass = spec.input === 'drawing' ? 'is-drawing' : '';

  // ヘッダー（タイトル・アイコン）など工程画面の外側も含め、
  // イラスト工程の間はページ全体を選択不可にする
  useEffect(() => {
    if (spec.input !== 'drawing') return undefined;
    document.body.classList.add('no-select');
    return () => document.body.classList.remove('no-select');
  }, [spec.input]);

  return (
    <div className={`game-round ${drawingClass}`}>
      {/* stickyヘッダー: キーボード表示中も工程と残り時間が見える */}
      <div className="round-header">
        <div className="round-meta">
          <span className="round-step">工程 {round.round} / {round.totalRounds}</span>
          <span className={`type-chip ${typeClass}`}>{CARD_TYPE_LABEL[round.cardType]}</span>
        </div>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${(round.round / round.totalRounds) * 100}%` }} />
        </div>
        <TimerBar remainMs={remainMs} totalMs={totalMs} />
      </div>

      <div className="round-body">
        <div className="card-meta-row">
          <span className="card-no">カード No.{round.cardNo}</span>
          <span className="species-chip">{round.species}</span>
        </div>

        <h2 className="round-title">{spec.title}</h2>
        <p className={`round-desc ${spec.mode ? 'has-mode' : ''}`}>
          {spec.mode && <span className={`mode-badge mode-${spec.mode}`}>{spec.mode === 'new' ? '新効果' : '続き'}</span>}
          {spec.description}
        </p>

        {round.round === 8 ? <FullCardInfo card={round.visible.card} /> : <VisiblePanel round={round} />}

        {round.submitted ? (
          <Waiting progress={progress} remainMs={remainMs} />
        ) : spec.input === 'stats' ? (
          <StatsInput key={round.round} round={round} api={api} busy={busy} onSubmit={submit} />
        ) : spec.input === 'drawing' ? (
          <DrawingInput key={round.round} round={round} api={api} busy={busy} remainMs={remainMs} onSubmit={submit} />
        ) : (
          <TextInput key={round.round} round={round} api={api} busy={busy} urgent={remainMs <= 1500} onSubmit={submit} />
        )}

        {!round.submitted && remainMs === 0 && (
          <p className="timeup-note">時間切れです。自動提出しています…</p>
        )}
      </div>
    </div>
  );
}
