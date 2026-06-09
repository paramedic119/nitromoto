import { config } from './config.js';
import { surfaceSlopeAt } from './track.js';

// CPUライバル。プレイヤーと同じサーキットを走るペース対戦相手。
// クラッシュはせず、ギャップやループも滑らかな路面(surface*)を辿って進む。
// 実効推進 RIVAL_ACCEL とドラッグの平衡で巡航し、坂で加減速する。
export function createRival() {
  return { x: 0, s: 0, v: config.V_START, finished: false, finishTime: null };
}

export function stepRival(rival, track, dt, time) {
  if (rival.finished) return;
  const slope = surfaceSlopeAt(track, rival.x);
  const aGravity = config.GRAVITY * Math.sin(slope) * config.SLOPE_GAIN;
  const a = config.RIVAL_ACCEL + aGravity - config.DRAG * rival.v;
  rival.v += a * dt;
  if (rival.v < 0) rival.v = 0;
  if (rival.v > config.V_MAX) rival.v = config.V_MAX;
  rival.x += rival.v * dt;
  rival.s += rival.v * dt;
  if (rival.x >= track.finishX) {
    rival.x = track.finishX;
    rival.finished = true;
    rival.finishTime = time;
  }
}

// ライバルの現在ラップ(1..laps)
export function rivalLap(rival, track) {
  return Math.min(track.laps, Math.floor(rival.x / track.lapLen) + 1);
}
