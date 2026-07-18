import React from 'react';

// TCG風のオリジナルカードデザイン。既存作品の枠・アイコン等は使わず、
// 情報階層（名前/属性/レベル/イラスト/種族/テキスト/ATK・DEF）のみ参考にした自動配置。

const ATTR_CLASS = { 闇: 'dark', 光: 'light', 地: 'earth', 水: 'water', 炎: 'fire', 風: 'wind' };

// 種族行に併記するカード種別の短縮表記（例:【ドラゴン族／通常】）
const TYPE_SHORT = { normal: '通常', effect: '効果', fusion: '融合' };

export default function CardView({ card, width = 320, animate = false }) {
  // 魔法・罠カード: 属性アイコンと★の代わりに専用の表記を使う
  const kindInfo = card.cardType === 'spell'
    ? { orb: '魔', orbClass: 'attr-spell', label: `【魔法カード／${card.spellKind}】` }
    : card.cardType === 'trap'
      ? { orb: '罠', orbClass: 'attr-trap', label: `【罠カード／${card.trapKind}】` }
      : null;
  const nameLen = [...(card.name || '')].length;
  const nameSize = nameLen > 16 ? 0.62 : nameLen > 11 ? 0.78 : 1;
  const level = Math.max(1, Math.min(12, card.level ?? 1));

  return (
    <div
      className={`tcg-card type-${card.cardType} ${animate ? 'is-animated' : ''}`}
      style={{ width, fontSize: width / 20 }}
    >
      <div className="tcg-inner">
        <div className="tcg-head">
          <div className="tcg-name" style={{ fontSize: `${nameSize}em` }}>{card.name}</div>
          {kindInfo ? (
            <div className={`tcg-attr ${kindInfo.orbClass}`}>{kindInfo.orb}</div>
          ) : (
            <div className={`tcg-attr attr-${ATTR_CLASS[card.attribute] || 'dark'}`}>{card.attribute}</div>
          )}
        </div>

        {kindInfo ? (
          /* 魔法・罠カード: レベル(★)の位置に種類を右寄せ表記 */
          <div className="tcg-stars">
            <span className="tcg-spelltype">{kindInfo.label}</span>
          </div>
        ) : (
          <div className="tcg-stars" style={{ fontSize: level > 8 ? '0.66em' : '0.85em' }}>
            {Array.from({ length: level }, (_, i) => (
              <span key={i} className="tcg-star">★</span>
            ))}
          </div>
        )}

        <div className="tcg-art">
          {card.image ? (
            <img src={card.image} alt={`${card.name}のイラスト`} draggable={false} />
          ) : (
            <div className="tcg-art-empty">？</div>
          )}
        </div>

        <div className="tcg-box">
          {/* 魔法・罠カード: 種族行・ATK/DEF行は表示しない（種類はレベル行に表記済み） */}
          {!kindInfo && (
            <div className="tcg-species">【{card.species}／{TYPE_SHORT[card.cardType] || '通常'}】</div>
          )}
          {card.materialsText && <div className="tcg-materials">{card.materialsText}</div>}
          <div className="tcg-text pre-wrap">{card.bodyText}</div>
          {!kindInfo && (
            <div className="tcg-atkdef">
              <span>ATK/{card.atk}</span>
              <span>DEF/{card.def}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
