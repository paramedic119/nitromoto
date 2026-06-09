// ベストタイム(秒)を localStorage に保存・読込。失敗時は 0(記録なし)。
const KEY = 'nitromoto.bestTime';

export function loadBest() {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw == null ? 0 : parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function saveBest(time) {
  try {
    localStorage.setItem(KEY, String(time));
  } catch {
    // localStorage 不可環境では黙って無視（プレイは継続可能）
  }
}
