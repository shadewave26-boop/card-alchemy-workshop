import React, { useState } from 'react';
import QrCode from './QrCode.jsx';

export default function Lobby({ api, room, me, isHost }) {
  const [copied, setCopied] = useState(false);
  const joinUrl = `${window.location.origin}/join/${room.code}`;
  const canStart = room.players.length >= room.minPlayers && room.players.length <= room.maxPlayers;
  const humanCount = room.players.length;

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard APIが使えない場合のフォールバック
      const ta = document.createElement('textarea');
      ta.value = joinUrl;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        ta.remove();
      }
    }
  };

  const share = async () => {
    try {
      await navigator.share({
        title: 'カード錬成工房',
        text: `ルームコード ${room.code} で参加してね！`,
        url: joinUrl,
      });
    } catch {
      /* キャンセル時は何もしない */
    }
  };

  return (
    <div className="lobby">
      <div className="panel lobby-code-panel">
        <p className="lobby-label">ルームコード</p>
        <div className="lobby-code mono">{room.code}</div>
        <QrCode url={joinUrl} />
        <p className="lobby-url mono">{joinUrl}</p>
        <div className="lobby-share-row">
          <button type="button" className="btn btn-secondary" onClick={copyUrl}>
            {copied ? '✓ コピーしました' : 'URLをコピー'}
          </button>
          {typeof navigator.share === 'function' && (
            <button type="button" className="btn btn-secondary" onClick={share}>
              共有…
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <p className="panel-title">
          参加者 <span className="count-badge">{humanCount} / {room.maxPlayers}人</span>
        </p>
        <ul className="player-list">
          {room.players.map((p) => (
            <li key={p.id} className={`player-item ${p.connected ? '' : 'is-offline'}`}>
              <span className={`conn-dot ${p.connected ? 'is-on' : 'is-off'}`}>
                {p.connected ? '●' : '○'}
              </span>
              <span className="player-name">
                {p.name}
                {p.id === me && <span className="tag tag-you">あなた</span>}
                {p.isHost && <span className="tag tag-host">👑 ホスト</span>}
                {p.isBot && <span className="tag">CPU</span>}
              </span>
              <span className="player-state">{p.connected ? '接続中' : '切断中'}</span>
            </li>
          ))}
        </ul>

        {isHost ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={!canStart}
              onClick={api.startGame}
            >
              {canStart ? 'ゲームを開始する' : `あと${Math.max(0, room.minPlayers - humanCount)}人集まったら開始できます`}
            </button>
            {room.devMode && humanCount < room.maxPlayers && (
              <button type="button" className="btn btn-ghost btn-block" onClick={api.addBot}>
                ＋ テスト用CPUを追加（開発モード）
              </button>
            )}
          </>
        ) : (
          <p className="lobby-wait-note">ホストがゲームを開始するのを待っています…</p>
        )}
      </div>

      <button type="button" className="btn btn-ghost btn-block" onClick={api.goHome}>
        ルームを出る
      </button>
    </div>
  );
}
