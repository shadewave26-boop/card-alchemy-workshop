import React, { useEffect, useState } from 'react';
import { LIMITS } from '../../shared/constants.js';
import { loadName } from '../session.js';

export default function Home({ api, joinCode }) {
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState(joinCode || '');
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState('');
  const viaQr = !!joinCode;

  // サーバーからエラーが返るとApp側でトースト表示される。busyだけ解除する
  useEffect(() => {
    if (!busy) return;
    const h = setTimeout(() => setBusy(false), 4000);
    return () => clearTimeout(h);
  }, [busy]);

  const validName = () => {
    const n = name.trim();
    if (n.length < 1 || [...n].length > LIMITS.playerNameMax) {
      setWarn(`プレイヤー名は1〜${LIMITS.playerNameMax}文字で入力してください`);
      return null;
    }
    setWarn('');
    return n;
  };

  const onCreate = () => {
    const n = validName();
    if (!n || busy) return;
    setBusy(true);
    api.createRoom(n);
  };

  const onJoin = () => {
    const n = validName();
    if (!n || busy) return;
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(c)) {
      setWarn('ルームコードは4文字の英数字です');
      return;
    }
    setBusy(true);
    api.joinRoom(c, n);
  };

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-emblem" aria-hidden="true">
          {/* 太陽円盤・ピラミッド・聖なる眼のオリジナル紋章（古代エジプト意匠） */}
          <svg viewBox="0 0 120 120" width="104" height="104">
            <circle cx="60" cy="26" r="12" fill="none" stroke="var(--gold)" strokeWidth="2" opacity="0.9" />
            <circle cx="60" cy="26" r="5" fill="var(--gold)" opacity="0.75" />
            <polygon points="60,34 106,104 14,104" fill="none" stroke="var(--gold)" strokeWidth="2.2" />
            <polygon points="60,50 92,98 28,98" fill="none" stroke="var(--gold)" strokeWidth="1" opacity="0.5" />
            <path d="M40,82 Q60,68 80,82 Q60,94 40,82 Z" fill="none" stroke="var(--gold)" strokeWidth="2" />
            <circle cx="60" cy="81" r="5" fill="var(--gold)" />
            <path d="M38,76 Q60,62 82,76" fill="none" stroke="var(--gold)" strokeWidth="1.6" opacity="0.85" />
            <path d="M66,89 q5,9 -5,12" fill="none" stroke="var(--gold)" strokeWidth="1.6" opacity="0.85" />
            <line x1="6" y1="104" x2="114" y2="104" stroke="var(--gold)" strokeWidth="1.4" opacity="0.7" />
          </svg>
        </div>
        <h1 className="home-title">魔札錬成工房</h1>
        <p className="home-sub">カードを回して、予測不能なモンスターを完成させよう。</p>
      </div>

      {viaQr && (
        <div className="panel panel-highlight">
          <p>ルーム <strong className="mono">{joinCode}</strong> に招待されています。名前を入力して参加してください。</p>
        </div>
      )}

      <div className="panel">
        <label className="field-label" htmlFor="player-name">プレイヤー名</label>
        <input
          id="player-name"
          className="text-input"
          type="text"
          value={name}
          maxLength={LIMITS.playerNameMax}
          placeholder="名前を入力"
          onChange={(e) => setName(e.target.value)}
          autoComplete="nickname"
        />

        {!viaQr && (
          <button type="button" className="btn btn-primary btn-block" onClick={onCreate} disabled={busy}>
            ルームを作る（ホスト）
          </button>
        )}

        <div className="join-row">
          <input
            className="text-input code-input"
            type="text"
            inputMode="latin"
            autoCapitalize="characters"
            autoCorrect="off"
            value={code}
            maxLength={4}
            placeholder="コード"
            aria-label="ルームコード"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button type="button" className="btn btn-secondary" onClick={onJoin} disabled={busy}>
            コードで参加
          </button>
        </div>

        {viaQr && (
          <button type="button" className="btn btn-ghost btn-block" onClick={onCreate} disabled={busy}>
            代わりに新しいルームを作る
          </button>
        )}

        {warn && <p className="field-error" role="alert">⚠ {warn}</p>}
      </div>

      <details className="panel howto">
        <summary>あそびかた</summary>
        <ol>
          <li>ホストがルームを作り、QRコードかルームコードを共有（2〜4人）</li>
          <li>全員でN枚のカードを同時に錬成。毎ラウンド、カードは隣のプレイヤーへ</li>
          <li>名前の前半 → 後半 → ステータス → テキスト×4 → イラスト の全8工程</li>
          <li>見えるのは<strong>直前の工程だけ</strong>。時間切れは自動提出！</li>
          <li>最後に完成カードをみんなで1枚ずつ鑑賞して大団円</li>
        </ol>
        <p className="howto-note">テキスト1分30秒／イラスト2分30秒。スマホだけで遊べます。</p>
      </details>
    </div>
  );
}
