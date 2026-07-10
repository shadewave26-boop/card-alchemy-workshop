import React, { useEffect, useMemo, useRef, useState } from 'react';
import CardView from './CardView.jsx';
import CardBack from './CardBack.jsx';
import { sfx } from '../audio.js';

/** 画面幅に応じたカードサイズ */
function useCardWidth() {
  const calc = () => Math.min(320, Math.max(240, window.innerWidth - 88));
  const [w, setW] = useState(calc);
  useEffect(() => {
    const onResize = () => setW(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

/** 金色の粒子（結果発表の飾り） */
function Particles() {
  const dots = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        left: `${6 + Math.random() * 88}%`,
        top: `${4 + Math.random() * 90}%`,
        delay: `${(i * 0.35).toFixed(2)}s`,
        size: 3 + Math.random() * 4,
      })),
    []
  );
  return (
    <div className="particles" aria-hidden="true">
      {dots.map((d, i) => (
        <span
          key={i}
          style={{ left: d.left, top: d.top, animationDelay: d.delay, width: d.size, height: d.size }}
        />
      ))}
    </div>
  );
}

export function CreditsList({ credits }) {
  return (
    <div className="credits">
      <p className="credits-title">担当者クレジット</p>
      <ul>
        {credits.map((c) => (
          <li key={c.round}>
            <span className="credits-role">{c.role}</span>
            <span className="credits-name">{c.playerName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Results({ api, results, resultsState }) {
  const { cards, credits } = results;
  const { index, revealed } = resultsState;
  const card = cards[index];
  const w = useCardWidth();
  const isLast = index >= cards.length - 1;
  const startedRef = useRef(false);
  const prevIndexRef = useRef(-1);

  // 発表開始・カード切替・公開のSFX
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      sfx.start();
    }
    if (prevIndexRef.current !== index) {
      prevIndexRef.current = index;
      sfx.appear();
    }
  }, [index]);

  useEffect(() => {
    if (revealed) sfx.reveal();
  }, [revealed]);

  return (
    <div className="results">
      <h2 className="results-title">☥ 結果発表 ☥</h2>
      <p className="results-count">{index + 1} / {cards.length} 枚目</p>

      <div className="reveal-stage" key={index}>
        <Particles />
        <div
          className={`flip ${revealed ? 'is-revealed' : ''}`}
          style={{ width: w, height: w * 1.44 }}
          onClick={() => !revealed && api.reveal(index)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && !revealed && api.reveal(index)}
          aria-label={revealed ? 'カード表面' : 'タップしてカードをめくる'}
        >
          <div className="flip-face flip-back">
            <CardBack width={w} />
          </div>
          <div className="flip-face flip-front">
            <CardView card={card} width={w} animate />
          </div>
        </div>
      </div>

      {!revealed ? (
        <p className="tap-hint">👆 タップしてカードをめくる</p>
      ) : (
        <>
          <CreditsList credits={credits[index]} />
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              if (isLast) sfx.fanfare();
              api.next(index);
            }}
          >
            {isLast ? '結果一覧へ' : '次のカードへ →'}
          </button>
        </>
      )}

      <button type="button" className="btn btn-ghost btn-block btn-small" onClick={api.restart}>
        最初から見る
      </button>
    </div>
  );
}
