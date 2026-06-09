// 入力。PCはキーボード、スマホは画面ボタン。
//   アクセル: → / D / L       … 押している間 accel
//   ターボ : Space / Shift / X … 押している間 turbo
//   後傾(↑): ↑ / W / K         … 空中で背面回転・着地で前輪上げ
//   前傾(↓): ↓ / S / J         … 空中で前面回転
// state.anyDown は「何か押された」フラグ（フィニッシュ後の再開検出に使う）。
export function createInput() {
  const state = { accel: false, turbo: false, up: false, down: false, anyDown: false };

  const KEYMAP = {
    ArrowRight: 'accel', KeyD: 'accel', KeyL: 'accel',
    Space: 'turbo', ShiftLeft: 'turbo', ShiftRight: 'turbo', KeyX: 'turbo',
    ArrowUp: 'up', KeyW: 'up', KeyK: 'up',
    ArrowDown: 'down', KeyS: 'down', KeyJ: 'down',
  };

  function recompute() {
    state.anyDown = state.accel || state.turbo || state.up || state.down;
  }

  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    state[k] = true;
    recompute();
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    state[k] = false;
    recompute();
    e.preventDefault();
  });

  // 画面ボタン（要素が無ければスキップ）
  function bindButton(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    const press = (e) => { state[key] = true; recompute(); if (e.cancelable) e.preventDefault(); };
    const release = (e) => { state[key] = false; recompute(); if (e.cancelable) e.preventDefault(); };
    el.addEventListener('touchstart', press, { passive: false });
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('touchcancel', release, { passive: false });
    el.addEventListener('mousedown', press);
    el.addEventListener('mouseup', release);
    el.addEventListener('mouseleave', release);
  }
  bindButton('btn-accel', 'accel');
  bindButton('btn-turbo', 'turbo');
  bindButton('btn-up', 'up');
  bindButton('btn-down', 'down');

  // フィニッシュ画面はどこをタップ/Enterしても再開できるように
  window.addEventListener('touchstart', () => { state.tap = true; }, { passive: true });
  window.addEventListener('mousedown', () => { state.tap = true; });
  window.addEventListener('keydown', (e) => { if (e.code === 'Enter') state.tap = true; });
  // tap は main 側で1フレーム読んだら false に戻す
  return state;
}
