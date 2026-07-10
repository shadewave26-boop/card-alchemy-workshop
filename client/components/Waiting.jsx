import React from 'react';

/** 提出後の待機画面（再編集は不可） */
export default function Waiting({ progress, remainMs }) {
  const sec = Math.ceil((remainMs || 0) / 1000);
  return (
    <div className="waiting">
      <div className="waiting-check" aria-hidden="true">✓</div>
      <p className="waiting-title">提出が完了しました</p>
      <p className="waiting-sub">他のプレイヤーを待っています…</p>

      {progress && (
        <>
          <p className="waiting-count">
            <strong>{progress.submittedCount} / {progress.total}人</strong> が提出済み
          </p>
          <ul className="waiting-list">
            {progress.players.map((p) => (
              <li key={p.id} className={p.submitted ? 'is-done' : ''}>
                <span className={`conn-dot ${p.connected ? 'is-on' : 'is-off'}`}>
                  {p.connected ? '●' : '○'}
                </span>
                <span className="waiting-name">{p.name}</span>
                <span className="waiting-state">{p.submitted ? '✓ 提出済み' : '✍ 入力中'}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="waiting-note">
        残り {sec}秒 で自動的に次へ進みます（未提出の人は入力途中の内容が自動提出されます）
      </p>
      <div className="waiting-dots" aria-hidden="true"><span /><span /><span /></div>
    </div>
  );
}
