// タッチ／マウス入力。押している間 pressing=true。画面全体がタップ領域。
export function createInput(target) {
  const state = { pressing: false };
  const down = (e) => {
    state.pressing = true;
    if (e.cancelable) e.preventDefault();
  };
  const up = (e) => {
    state.pressing = false;
    if (e.cancelable) e.preventDefault();
  };
  target.addEventListener('touchstart', down, { passive: false });
  target.addEventListener('touchend', up, { passive: false });
  target.addEventListener('touchcancel', up, { passive: false });
  target.addEventListener('mousedown', down);
  window.addEventListener('mouseup', up);
  // PC確認用にスペースキーでも噴射
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') state.pressing = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') state.pressing = false;
  });
  return state;
}
