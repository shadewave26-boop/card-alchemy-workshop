import React from 'react';

/** 通信切断時のオーバーレイ。現在の画面を保持したまま重ねて表示する */
export default function ReconnectOverlay({ api }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <div className="overlay" role="alertdialog" aria-label="再接続中">
      <div className="overlay-box">
        <div className="spinner" aria-hidden="true" />
        <p className="overlay-title">再接続しています…</p>
        <p className="overlay-note">
          {offline
            ? '通信が切断されています。電波状況を確認してください。'
            : 'サーバーとの接続が切れました。自動で再試行しています。'}
        </p>
        <button type="button" className="btn btn-secondary btn-block" onClick={api.retryConnect}>
          いますぐ再接続
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={api.goHome}>
          ホームへ戻る
        </button>
      </div>
    </div>
  );
}
