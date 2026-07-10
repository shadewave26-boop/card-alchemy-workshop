// Web Audio APIで生成するオリジナル効果音。
// スマホの自動再生制限に対応するため、ユーザー操作時に unlockAudio() を呼ぶ。
// 音が出せない環境でもゲーム進行を妨げない（すべてtry/catchで無害化）。

import { loadMute, saveMute } from './session.js';

let ctx = null;
let muted = loadMute();

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = m;
  saveMute(m);
}

/** ユーザーのタップ操作時に呼ぶ: AudioContextの生成とresume */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    ctx = null;
  }
}

function play(builder) {
  if (muted) return;
  try {
    if (!ctx || ctx.state !== 'running') return;
    builder(ctx);
  } catch {
    /* 効果音の失敗は無視 */
  }
}

/** 単音: 音量は控えめ(既定0.1)に抑える */
function tone(c, { f = 440, t = 0, d = 0.15, type = 'sine', g = 0.1, slideTo = null }) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  const t0 = c.currentTime + t;
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + d);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(g, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + d + 0.05);
}

export const sfx = {
  /** ボタンタップ */
  tap() {
    play((c) => tone(c, { f: 660, d: 0.07, type: 'triangle', g: 0.06 }));
  },
  /** ゲーム開始・結果発表開始 */
  start() {
    play((c) => {
      tone(c, { f: 523, d: 0.14, type: 'triangle' });
      tone(c, { f: 784, t: 0.11, d: 0.22, type: 'triangle' });
    });
  },
  /** カード登場（スライドイン） */
  appear() {
    play((c) => tone(c, { f: 220, slideTo: 640, d: 0.28, type: 'sine', g: 0.08 }));
  },
  /** カードをめくる */
  flip() {
    play((c) => {
      tone(c, { f: 880, d: 0.06, type: 'square', g: 0.045 });
      tone(c, { f: 1245, t: 0.06, d: 0.09, type: 'square', g: 0.045 });
    });
  },
  /** 表面公開（きらめき） */
  reveal() {
    play((c) => {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(c, { f, t: i * 0.09, d: 0.3, type: 'sine', g: 0.085 })
      );
    });
  },
  /** 次のカードへ */
  next() {
    play((c) => tone(c, { f: 440, d: 0.08, type: 'triangle', g: 0.07 }));
  },
  /** ラウンド進行 */
  advance() {
    play((c) => {
      tone(c, { f: 587, d: 0.1, type: 'triangle', g: 0.06 });
      tone(c, { f: 880, t: 0.09, d: 0.12, type: 'triangle', g: 0.06 });
    });
  },
  /** 全カード発表完了のファンファーレ */
  fanfare() {
    play((c) => {
      const chords = [
        [523, 659, 784],
        [587, 740, 880],
        [659, 831, 988, 1319],
      ];
      chords.forEach((chord, i) =>
        chord.forEach((f) =>
          tone(c, { f, t: i * 0.22, d: i === 2 ? 0.6 : 0.2, type: 'triangle', g: 0.055 })
        )
      );
    });
  },
};
