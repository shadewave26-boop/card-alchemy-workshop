import React, { useEffect, useMemo, useReducer, useRef, useCallback } from 'react';
import { C2S, S2C } from '../shared/constants.js';
import { socket } from './socketClient.js';
import { loadSession, saveSession, clearSession, saveName } from './session.js';
import { unlockAudio, sfx, isMuted, setMuted } from './audio.js';
import Home from './components/Home.jsx';
import Lobby from './components/Lobby.jsx';
import GameRound from './components/GameRound.jsx';
import Results from './components/Results.jsx';
import Gallery from './components/Gallery.jsx';
import ReconnectOverlay from './components/ReconnectOverlay.jsx';

/** URLが /join/XXXX ならルームコードを取り出す */
function parseJoinPath() {
  const m = window.location.pathname.match(/^\/join\/([A-Za-z0-9]{4})\/?$/);
  return m ? m[1].toUpperCase() : null;
}

const initialState = {
  conn: 'idle', // idle | connected | reconnecting
  session: loadSession(),
  joinCode: parseJoinPath(),
  room: null,
  round: null,
  progress: null,
  results: null,
  resultsState: null,
  error: null, // {code, message, at}
  notice: null, // {message, at}
  muted: isMuted(),
};

function reducer(state, action) {
  switch (action.type) {
    case 'conn': return { ...state, conn: action.value };
    case 'session': return { ...state, session: action.value };
    case 'room': return { ...state, room: action.value };
    case 'round': return { ...state, round: action.value };
    case 'progress': return { ...state, progress: action.value };
    case 'submitted':
      return state.round && state.round.round === action.round
        ? { ...state, round: { ...state.round, submitted: true } }
        : state;
    case 'results': return { ...state, results: action.value };
    case 'resultsState': return { ...state, resultsState: action.value };
    case 'error': return { ...state, error: { ...action.value, at: Date.now() } };
    case 'clearError': return { ...state, error: null };
    case 'notice': return { ...state, notice: { message: action.message, at: Date.now() } };
    case 'clearNotice': return { ...state, notice: null };
    case 'muted': return { ...state, muted: action.value };
    case 'resetToHome':
      return {
        ...initialState,
        session: null,
        joinCode: state.joinCode,
        muted: state.muted,
        conn: state.conn,
        error: action.error || null,
      };
    default: return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const sessionRef = useRef(state.session);
  sessionRef.current = state.session;
  const nameRef = useRef('');

  // ---- Socketイベント配線（マウント時に一度だけ） ----
  useEffect(() => {
    const onConnect = () => {
      dispatch({ type: 'conn', value: 'connected' });
      // 再接続時: セッションがあれば同一プレイヤーとして復帰
      const s = sessionRef.current;
      if (s) socket.emit(C2S.RECONNECT, { code: s.code, token: s.token });
    };
    const onDisconnect = () => {
      dispatch({ type: 'conn', value: sessionRef.current ? 'reconnecting' : 'idle' });
    };
    const onCreated = (p) => {
      const s = { code: p.code, token: p.token, playerId: p.playerId, name: nameRef.current };
      saveSession(s);
      dispatch({ type: 'session', value: s });
      history.replaceState(null, '', '/');
    };
    const onJoined = (p) => {
      const s = {
        code: p.code, token: p.token, playerId: p.playerId,
        name: nameRef.current || sessionRef.current?.name || '',
      };
      saveSession(s);
      dispatch({ type: 'session', value: s });
      if (!p.reconnected) history.replaceState(null, '', '/');
    };
    const onRoomState = (p) => dispatch({ type: 'room', value: p });
    const onRoomError = (p) => dispatch({ type: 'error', value: p });
    const onGameStarted = () => {
      sfx.start();
      dispatch({ type: 'notice', message: 'ゲーム開始！' });
    };
    const onRoundState = (p) => dispatch({ type: 'round', value: p });
    const onProgress = (p) => dispatch({ type: 'progress', value: p });
    const onSubmitted = (p) => dispatch({ type: 'submitted', round: p.round });
    const onAutoSubmitted = () => dispatch({ type: 'notice', message: '時間切れのため自動提出されました' });
    const onAdvanced = () => sfx.advance();
    const onResults = (p) => dispatch({ type: 'results', value: p });
    const onResultsState = (p) => dispatch({ type: 'resultsState', value: p });
    const onSessionInvalid = () => {
      clearSession();
      dispatch({ type: 'resetToHome', error: { code: 'SESSION', message: 'セッションが無効になりました。もう一度参加してください' } });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(S2C.CREATED, onCreated);
    socket.on(S2C.JOINED, onJoined);
    socket.on(S2C.ROOM_STATE, onRoomState);
    socket.on(S2C.ROOM_ERROR, onRoomError);
    socket.on(S2C.GAME_STARTED, onGameStarted);
    socket.on(S2C.ROUND_STATE, onRoundState);
    socket.on(S2C.PROGRESS, onProgress);
    socket.on(S2C.SUBMITTED, onSubmitted);
    socket.on(S2C.AUTO_SUBMITTED, onAutoSubmitted);
    socket.on(S2C.ADVANCED, onAdvanced);
    socket.on(S2C.RESULTS, onResults);
    socket.on(S2C.RESULTS_STATE, onResultsState);
    socket.on(S2C.SESSION_INVALID, onSessionInvalid);

    // 保存済みセッションがあれば自動再接続
    if (sessionRef.current) socket.connect();

    // スリープ復帰・タブ復帰時の再同期
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!sessionRef.current) return;
      if (socket.connected) socket.emit(C2S.SYNC);
      else socket.connect();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(S2C.CREATED, onCreated);
      socket.off(S2C.JOINED, onJoined);
      socket.off(S2C.ROOM_STATE, onRoomState);
      socket.off(S2C.ROOM_ERROR, onRoomError);
      socket.off(S2C.GAME_STARTED, onGameStarted);
      socket.off(S2C.ROUND_STATE, onRoundState);
      socket.off(S2C.PROGRESS, onProgress);
      socket.off(S2C.SUBMITTED, onSubmitted);
      socket.off(S2C.AUTO_SUBMITTED, onAutoSubmitted);
      socket.off(S2C.ADVANCED, onAdvanced);
      socket.off(S2C.RESULTS, onResults);
      socket.off(S2C.RESULTS_STATE, onResultsState);
      socket.off(S2C.SESSION_INVALID, onSessionInvalid);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // エラー・お知らせトーストの自動消去
  useEffect(() => {
    if (!state.error) return;
    const h = setTimeout(() => dispatch({ type: 'clearError' }), 4000);
    return () => clearTimeout(h);
  }, [state.error]);
  useEffect(() => {
    if (!state.notice) return;
    const h = setTimeout(() => dispatch({ type: 'clearNotice' }), 3000);
    return () => clearTimeout(h);
  }, [state.notice]);

  // ゲーム中の誤リロード・戻る操作への離脱確認
  const playing = state.room?.phase === 'playing';
  useEffect(() => {
    if (!playing) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [playing]);

  // ---- 画面から呼ぶ操作 ----
  const api = useMemo(() => ({
    createRoom(name) {
      nameRef.current = name;
      saveName(name);
      unlockAudio();
      sfx.tap();
      socket.connect();
      socket.emit(C2S.CREATE, { name });
    },
    joinRoom(code, name) {
      nameRef.current = name;
      saveName(name);
      unlockAudio();
      sfx.tap();
      socket.connect();
      socket.emit(C2S.JOIN, { code, name });
    },
    startGame() {
      unlockAudio();
      sfx.tap();
      socket.emit(C2S.START);
    },
    addBot() {
      socket.emit(C2S.ADD_BOT);
    },
    sendDraft(round, cardIndex, value) {
      socket.emit(C2S.DRAFT, { round, cardIndex, value });
    },
    submit(round, cardIndex, value) {
      unlockAudio();
      socket.emit(C2S.SUBMIT, { round, cardIndex, value });
    },
    reveal(cardIndex) {
      unlockAudio();
      sfx.flip();
      socket.emit(C2S.REVEAL, { cardIndex });
    },
    next(fromIndex) {
      unlockAudio();
      sfx.next();
      socket.emit(C2S.NEXT, { fromIndex });
    },
    restart() {
      unlockAudio();
      sfx.tap();
      socket.emit(C2S.RESTART);
    },
    retryConnect() {
      socket.connect();
    },
    toggleMute() {
      const m = !isMuted();
      setMuted(m);
      if (!m) {
        unlockAudio();
        sfx.tap();
      }
      dispatch({ type: 'muted', value: m });
    },
    goHome() {
      // セッションを破棄してホームへ（ルーム退出）
      try {
        socket.emit(C2S.LEAVE);
      } catch { /* 未接続でも続行 */ }
      clearSession();
      window.location.href = '/';
    },
  }), []);

  const me = state.session?.playerId || null;
  const isHost = !!(state.room && me && state.room.hostId === me);

  // ---- 表示する画面の決定 ----
  let view;
  if (!state.room || !state.session) {
    view = (
      <Home
        api={api}
        joinCode={state.joinCode}
        hasPendingSession={!!state.session}
      />
    );
  } else if (state.room.phase === 'lobby') {
    view = <Lobby api={api} room={state.room} me={me} isHost={isHost} />;
  } else if (state.room.phase === 'playing') {
    view = state.round ? (
      <GameRound api={api} round={state.round} progress={state.progress} />
    ) : (
      <div className="center-note">ゲーム状態を同期しています…</div>
    );
  } else if (state.room.phase === 'results') {
    view = state.results && state.resultsState ? (
      state.resultsState.finished ? (
        <Gallery api={api} results={state.results} />
      ) : (
        <Results api={api} results={state.results} resultsState={state.resultsState} />
      )
    ) : (
      <div className="center-note">結果を読み込んでいます…</div>
    );
  }

  const showReconnect = !!state.session && state.conn === 'reconnecting';

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <span className="app-title-mark">☥</span> 魔札錬成工房
        </div>
        <div className="app-header-right">
          {state.room && <span className="room-chip">{state.room.code}</span>}
          <span
            className={`conn-dot ${state.conn === 'connected' ? 'is-on' : 'is-off'}`}
            title={state.conn === 'connected' ? '接続中' : '未接続'}
          >
            {state.conn === 'connected' ? '●' : '○'}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={api.toggleMute}
            aria-label={state.muted ? '効果音をオンにする' : '効果音をミュートする'}
          >
            {state.muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      <main className="app-main">{view}</main>

      {state.error && (
        <div className="toast toast-error" role="alert">⚠ {state.error.message}</div>
      )}
      {state.notice && <div className="toast toast-info">{state.notice.message}</div>}

      {showReconnect && <ReconnectOverlay api={api} />}
    </div>
  );
}
