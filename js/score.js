import { config } from './config.js';

// 弧長 s(ピクセル) を走行距離(メートル)へ。進捗表示の基準。
export function distanceMeters(bike) {
  return bike.s / config.PX_PER_M;
}

// 速さ(px/s) を時速(km/h)へ。HUD演出用。
export function speedKmh(bike) {
  return (bike.v / config.PX_PER_M) * 3.6;
}

// タイムアタックの自己ベスト判定。タイムは小さいほど良い。0 は記録なし。
export function isBestTime(time, prevBest) {
  return prevBest <= 0 || time < prevBest;
}

// 秒を mm:ss.s 表記へ（60秒未満は ss.s）。
export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '--.-';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  if (m <= 0) return s.toFixed(1);
  return m + ':' + s.toFixed(1).padStart(4, '0');
}
