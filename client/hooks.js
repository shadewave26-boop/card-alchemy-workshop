import { useEffect, useRef, useState } from 'react';

/**
 * サーバー基準の残り時間(ms)。
 * serverNow - Date.now() のオフセットを保持するため、端末時刻の変更や
 * バックグラウンド復帰の影響を受けない。visibilitychangeで即時再計算する。
 */
export function useServerCountdown(endAt, serverNow) {
  const offsetRef = useRef(serverNow - Date.now());
  const [remainMs, setRemainMs] = useState(() =>
    Math.max(0, (endAt || 0) - (Date.now() + offsetRef.current))
  );

  useEffect(() => {
    offsetRef.current = serverNow - Date.now();
    const tick = () => setRemainMs(Math.max(0, (endAt || 0) - (Date.now() + offsetRef.current)));
    tick();
    const iv = setInterval(tick, 200);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [endAt, serverNow]);

  return remainMs;
}

/** 値の変化をdebounceして送信するコールバック */
export function useDebouncedEffect(fn, deps, delayMs) {
  useEffect(() => {
    const h = setTimeout(fn, delayMs);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
