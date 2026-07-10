import React, {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { sfx } from '../audio.js';

// 内部解像度は端末によらず固定（高DPIでもぼやけず、成果物が全端末で同一になる）
const SIZE = 640;
const UNDO_LIMIT = 10; // Undo履歴の上限（メモリ使用量の制御）

// パレット9色（白は消しゴム兼用）
const PALETTE = [
  { color: '#1a1a1a', label: '黒' },
  { color: '#ffffff', label: '白（消しゴム）' },
  { color: '#e5484d', label: '赤' },
  { color: '#f76b15', label: '橙' },
  { color: '#f5d90a', label: '黄' },
  { color: '#30a46c', label: '緑' },
  { color: '#0090ff', label: '青' },
  { color: '#8e4ec6', label: '紫' },
  { color: '#8d6e63', label: '茶' },
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Flood Fill（境界内塗りつぶし）。
 * 訪問済みフラグ+インデックススタックの走査で、640x640でも数十msで完了する。
 * アンチエイリアスの縁を拾えるよう、対象色との差に許容誤差を持たせる。
 */
function floodFill(ctx, sx, sy, hex) {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const start = (sy * SIZE + sx) * 4;
  const target = [d[start], d[start + 1], d[start + 2], d[start + 3]];
  const [fr, fg, fb] = hexToRgb(hex);
  const TOL = 48;

  // すでに同色なら何もしない
  if (Math.abs(target[0] - fr) <= 8 && Math.abs(target[1] - fg) <= 8 && Math.abs(target[2] - fb) <= 8) {
    return false;
  }

  const visited = new Uint8Array(SIZE * SIZE);
  const stack = new Int32Array(SIZE * SIZE);
  let sp = 0;
  stack[sp++] = sy * SIZE + sx;

  const matches = (i4) =>
    Math.abs(d[i4] - target[0]) <= TOL &&
    Math.abs(d[i4 + 1] - target[1]) <= TOL &&
    Math.abs(d[i4 + 2] - target[2]) <= TOL &&
    Math.abs(d[i4 + 3] - target[3]) <= TOL;

  while (sp > 0) {
    const idx = stack[--sp];
    if (visited[idx]) continue;
    visited[idx] = 1;
    const i4 = idx * 4;
    if (!matches(i4)) continue;
    d[i4] = fr; d[i4 + 1] = fg; d[i4 + 2] = fb; d[i4 + 3] = 255;

    const x = idx % SIZE;
    if (x > 0 && !visited[idx - 1]) stack[sp++] = idx - 1;
    if (x < SIZE - 1 && !visited[idx + 1]) stack[sp++] = idx + 1;
    if (idx >= SIZE && !visited[idx - SIZE]) stack[sp++] = idx - SIZE;
    if (idx < SIZE * (SIZE - 1) && !visited[idx + SIZE]) stack[sp++] = idx + SIZE;
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

/**
 * お絵かきCanvas。
 * - Pointer Events + touch-action:none（スクロール競合防止）
 * - setPointerCaptureでCanvas外へ出ても描画状態が壊れない
 * - 操作完了ごとに onOp(dataURL) を呼ぶ（親がスロットルして下書き送信）
 */
const DrawingCanvas = forwardRef(function DrawingCanvas({ initialImage, onOp }, ref) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const undoRef = useRef([]);
  const stateRef = useRef({ drawing: false, last: null, pointerId: null });
  const [tool, setTool] = useState('pen'); // 'pen' | 'fill'
  const [color, setColor] = useState('#1a1a1a');
  const [penSize, setPenSize] = useState(8);
  const [undoCount, setUndoCount] = useState(0);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const penRef = useRef(penSize);
  penRef.current = penSize;

  useImperativeHandle(ref, () => ({
    toDataURL: () => canvasRef.current?.toDataURL('image/png') || null,
  }));

  // 初期化: 白背景（初期背景は完全な白）。再接続時は下書き画像を復元
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctxRef.current = ctx;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (initialImage) {
      const img = new Image();
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, SIZE, SIZE);
        } catch { /* 壊れた下書きは無視して白紙から */ }
      };
      img.src = initialImage;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitOp = () => {
    const url = canvasRef.current?.toDataURL('image/png');
    if (url && onOp) onOp(url);
  };

  const pushUndo = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const stack = undoRef.current;
    if (stack.length >= UNDO_LIMIT) stack.shift();
    stack.push(ctx.getImageData(0, 0, SIZE, SIZE));
    setUndoCount(stack.length);
  };

  const undo = () => {
    const stack = undoRef.current;
    const prev = stack.pop();
    if (!prev) return;
    ctxRef.current.putImageData(prev, 0, 0);
    setUndoCount(stack.length);
    sfx.tap();
    emitOp();
  };

  const clearAll = () => {
    if (!window.confirm('全部消しますか？')) return;
    pushUndo();
    const ctx = ctxRef.current;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    sfx.tap();
    emitOp();
  };

  // 表示座標 → 内部座標
  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(SIZE - 1, Math.round(((e.clientX - rect.left) / rect.width) * SIZE)));
    const y = Math.max(0, Math.min(SIZE - 1, Math.round(((e.clientY - rect.top) / rect.height) * SIZE)));
    return { x, y };
  };

  const lineWidth = () => penRef.current * (SIZE / 360); // 表示上の太さ感覚に合わせる

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    const p = pos(e);

    if (toolRef.current === 'fill') {
      pushUndo();
      const changed = floodFill(ctx, p.x, p.y, colorRef.current);
      if (!changed) {
        undoRef.current.pop(); // 変化なしなら履歴を戻す
        setUndoCount(undoRef.current.length);
      } else {
        emitOp();
      }
      return;
    }

    pushUndo();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch { /* 古い環境では無視 */ }
    stateRef.current = { drawing: true, last: p, pointerId: e.pointerId };
    // 点を打つ（タップのみでも描けるように）
    ctx.fillStyle = colorRef.current;
    ctx.beginPath();
    ctx.arc(p.x, p.y, lineWidth() / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const onPointerMove = (e) => {
    const st = stateRef.current;
    if (!st.drawing || e.pointerId !== st.pointerId) return;
    e.preventDefault();
    const ctx = ctxRef.current;
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = lineWidth();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const p = pos(ev);
      ctx.beginPath();
      ctx.moveTo(st.last.x, st.last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      st.last = p;
    }
  };

  const endStroke = (e) => {
    const st = stateRef.current;
    if (!st.drawing || (e && e.pointerId !== st.pointerId)) return;
    st.drawing = false;
    st.pointerId = null;
    try {
      canvasRef.current.releasePointerCapture(e.pointerId);
    } catch { /* 無視 */ }
    emitOp(); // 1ストローク完了ごとに下書き保存
  };

  return (
    <div className="draw">
      <div className="draw-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="draw-canvas"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          aria-label="お絵かきキャンバス"
        />
      </div>

      <div className="draw-palette" role="radiogroup" aria-label="色">
        {PALETTE.map((c) => (
          <button
            key={c.color}
            type="button"
            role="radio"
            aria-checked={color === c.color}
            aria-label={c.label}
            className={`swatch ${color === c.color ? 'is-selected' : ''} ${c.color === '#ffffff' ? 'is-white' : ''}`}
            style={{ background: c.color }}
            onClick={() => { setColor(c.color); sfx.tap(); }}
          />
        ))}
      </div>
      <p className="draw-hint">白＝消しゴムとして使えます</p>

      <div className="draw-tools">
        <button
          type="button"
          className={`btn btn-tool ${tool === 'pen' ? 'is-active' : ''}`}
          aria-pressed={tool === 'pen'}
          onClick={() => { setTool('pen'); sfx.tap(); }}
        >
          ✏️ ペン
        </button>
        <button
          type="button"
          className={`btn btn-tool ${tool === 'fill' ? 'is-active' : ''}`}
          aria-pressed={tool === 'fill'}
          onClick={() => { setTool('fill'); sfx.tap(); }}
        >
          🪣 塗りつぶし
        </button>
        <button type="button" className="btn btn-tool" onClick={undo} disabled={undoCount === 0}>
          ↩ 元に戻す
        </button>
        <button type="button" className="btn btn-tool btn-tool-danger" onClick={clearAll}>
          🗑 全消し
        </button>
      </div>

      <label className="draw-size">
        <span>太さ</span>
        <input
          type="range"
          min="2"
          max="28"
          value={penSize}
          onChange={(e) => setPenSize(Number(e.target.value))}
          aria-label="ペンの太さ"
        />
        <span
          className="draw-size-preview"
          style={{ width: penSize, height: penSize, background: color === '#ffffff' ? '#ccc' : color }}
        />
      </label>
    </div>
  );
});

export default DrawingCanvas;
