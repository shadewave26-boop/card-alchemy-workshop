import React from 'react';

/**
 * オリジナルのカード裏面: 焦茶〜黒の夜の神殿 + 金の同心円とピラミッド・聖なる眼の錬成紋。
 * 古代エジプト意匠をモチーフにしたオリジナルデザイン（既存TCGの裏面は再現しない）。
 */
export default function CardBack({ width = 320 }) {
  return (
    <div className="card-back" style={{ width, fontSize: width / 20 }}>
      <svg viewBox="0 0 200 288" className="card-back-svg" aria-hidden="true">
        <defs>
          <radialGradient id="backBg" cx="50%" cy="44%" r="85%">
            <stop offset="0%" stopColor="#4a3517" />
            <stop offset="50%" stopColor="#2a1c0b" />
            <stop offset="100%" stopColor="#150d04" />
          </radialGradient>
        </defs>
        <rect x="4" y="4" width="192" height="280" rx="9" fill="url(#backBg)" stroke="#d8b45a" strokeWidth="3" />
        <rect x="11" y="11" width="178" height="266" rx="6" fill="none" stroke="#8a6d2f" strokeWidth="1.2" />
        {/* ヒエログリフ風の点線飾り枠 */}
        <rect x="17" y="17" width="166" height="254" rx="4" fill="none" stroke="#b28f3e"
          strokeWidth="1" strokeDasharray="2 5" opacity="0.7" />

        {/* 錬成紋: 同心円 + 放射 + ピラミッド + 聖なる眼 */}
        <g stroke="#d8b45a" fill="none">
          <circle cx="100" cy="140" r="66" strokeWidth="2" />
          <circle cx="100" cy="140" r="58" strokeWidth="0.8" opacity="0.6" />
          <circle cx="100" cy="140" r="76" strokeWidth="1" strokeDasharray="2 7" opacity="0.75" />
          {/* 太陽円盤 */}
          <circle cx="100" cy="92" r="9" strokeWidth="1.6" />
          <circle cx="100" cy="92" r="3.2" fill="#d8b45a" stroke="none" opacity="0.9" />
          {/* ピラミッド */}
          <polygon points="100,104 140,176 60,176" strokeWidth="1.8" />
          <polygon points="100,116 128,168 72,168" strokeWidth="0.8" opacity="0.55" />
          {/* 聖なる眼 */}
          <path d="M80,151 Q100,138 120,151 Q100,162 80,151 Z" strokeWidth="1.7" />
          <circle cx="100" cy="150" r="4.6" fill="#d8b45a" stroke="none" />
          <path d="M78,145 Q100,132 122,145" strokeWidth="1.4" opacity="0.85" />
          <path d="M106,158 q5,9 -5,12" strokeWidth="1.4" opacity="0.85" />
        </g>
        {/* 周囲の星飾り */}
        <g fill="#d8b45a" opacity="0.85">
          <circle cx="100" cy="60" r="2.2" />
          <circle cx="100" cy="222" r="2.2" />
          <circle cx="30" cy="140" r="2.2" />
          <circle cx="170" cy="140" r="2.2" />
          <circle cx="48" cy="82" r="1.3" />
          <circle cx="152" cy="82" r="1.3" />
          <circle cx="48" cy="198" r="1.3" />
          <circle cx="152" cy="198" r="1.3" />
        </g>
        <text x="100" y="252" textAnchor="middle" fill="#d8b45a" fontSize="10" opacity="0.9"
          style={{ fontFamily: '"Yu Mincho", "Hiragino Mincho ProN", serif' }}>
          ☥ 魔札錬成工房 ☥
        </text>
      </svg>
    </div>
  );
}
