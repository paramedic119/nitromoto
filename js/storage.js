// ベスト距離(m)を localStorage に保存・読込。失敗時は 0 にフォールバック。
const KEY = 'nitromoto.best';

export function loadBest() {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw == null ? 0 : parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function saveBest(dist) {
  try {
    localStorage.setItem(KEY, String(dist));
  } catch {
    // localStorage 不可環境では黙って無視（プレイは継続可能）
  }
}
