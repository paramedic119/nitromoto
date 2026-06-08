import { config } from './config.js';

// 弧長 s(ピクセル) を走行距離(メートル)へ。スコア表示の基準。
export function distanceMeters(bike) {
  return bike.s / config.PX_PER_M;
}

// クラッシュ判定: 地上で失速(v_min割れ) / 画面下端より下へ落下。
export function shouldCrash(bike, fellBelowY) {
  if (!bike.airborne && bike.v < config.V_MIN) return true;
  if (fellBelowY) return true;
  return false;
}

// 新記録か（自己ベスト更新判定）
export function isBest(dist, prevBest) {
  return dist > prevBest;
}
