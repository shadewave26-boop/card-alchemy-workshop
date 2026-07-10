// localStorageに保存するセッション情報とユーザー設定

const SESSION_KEY = 'cw_session';
const NAME_KEY = 'cw_name';
const MUTE_KEY = 'cw_mute';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* プライベートモード等では保存しない */
  }
}

export function loadSession() {
  try {
    const raw = safeGet(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && typeof s.code === 'string' && typeof s.token === 'string') return s;
    return null;
  } catch {
    return null;
  }
}

export function saveSession(s) {
  safeSet(SESSION_KEY, JSON.stringify(s));
}

export function clearSession() {
  safeSet(SESSION_KEY, null);
}

export function loadName() {
  return safeGet(NAME_KEY) || '';
}

export function saveName(name) {
  safeSet(NAME_KEY, name);
}

export function loadMute() {
  return safeGet(MUTE_KEY) === '1';
}

export function saveMute(m) {
  safeSet(MUTE_KEY, m ? '1' : '0');
}
