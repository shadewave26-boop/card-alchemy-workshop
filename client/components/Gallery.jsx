import React, { useEffect, useState } from 'react';
import CardView from './CardView.jsx';
import { CreditsList } from './Results.jsx';
import { sfx } from '../audio.js';

/** 全カード発表後の一覧画面。タップで拡大表示 */
export default function Gallery({ api, results }) {
  const { cards, credits } = results;
  const [zoom, setZoom] = useState(null); // 拡大中のカードindex

  useEffect(() => {
    sfx.fanfare();
  }, []);

  const thumbW = Math.min(200, Math.floor((Math.min(window.innerWidth, 520) - 52) / 2));

  return (
    <div className="gallery">
      <h2 className="results-title">☥ 完成カード一覧 ☥</h2>
      <p className="gallery-sub">全{cards.length}枚のカードが錬成されました！タップで拡大</p>

      <div className="gallery-grid">
        {cards.map((card) => (
          <button
            key={card.index}
            type="button"
            className="gallery-item"
            onClick={() => { sfx.tap(); setZoom(card.index); }}
            aria-label={`${card.name} を拡大表示`}
          >
            <CardView card={card} width={thumbW} />
          </button>
        ))}
      </div>

      <div className="gallery-actions">
        <button type="button" className="btn btn-secondary btn-block" onClick={api.restart}>
          ▶ 最初から発表を見る
        </button>
        <button type="button" className="btn btn-primary btn-block" onClick={api.goHome}>
          新しいルームを作る
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={api.goHome}>
          ホームへ戻る
        </button>
      </div>

      {zoom !== null && (
        <div className="modal" onClick={() => setZoom(null)} role="dialog" aria-modal="true">
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <CardView card={cards[zoom]} width={Math.min(320, window.innerWidth - 72)} />
            <CreditsList credits={credits[zoom]} />
            <button type="button" className="btn btn-secondary btn-block" onClick={() => setZoom(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
