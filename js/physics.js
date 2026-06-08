import { config } from './config.js';

// === GROUNDED ⇄ AIRBORNE 状態遷移（設計書3.2）===
// GROUNDED: 弧長 s で地形に追従。x,y は地形から算出。
//   離陸条件: ギャップに入った / 地形が急に落ちて追従しきれない
//   → launch(bike, slope): スカラー v を (vx, vy) に分解して AIRBORNE へ。
// AIRBORNE: (x,y,vx,vy) で放物運動。重力で vy が増える(y下正)。
//   着地: 1フレームをサブステップ走査し、放物線が地形を下に跨いだ点で着地。
//   → landingTangentSpeed(vx, vy, slope): (vx,vy) を地形接線へ射影して v に戻す。

export function createBike() {
  return {
    s: 0, v: config.V_START, airborne: false,
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, nitro: config.NITRO_START,
    inLoop: false, loopT: 0, loopRef: null, failLoop: false,
    pressing: false, firing: false, _prevX: 0,
  };
}

// env = { slope, nitro }。slope は rad(下り正)、nitro はタップ中フラグ
export function stepGrounded(bike, env) {
  const dt = config.DT;
  // 下り(slope>0)で加速・上り(slope<0)で減速。y下正のため符号は+
  const aGravity = config.GRAVITY * Math.sin(env.slope) * config.SLOPE_GAIN;
  // ニトロは「タップ中 かつ 残量あり」のときだけ噴射し残量を消費
  const firing = env.nitro && bike.nitro > 0;
  const aNitro = firing ? config.NITRO_THRUST : 0;
  if (firing) {
    bike.nitro -= config.NITRO_BURN * dt;
    if (bike.nitro < 0) bike.nitro = 0;
  }
  bike.firing = firing;
  const aDrag = -config.DRAG * bike.v;
  bike.v += (aGravity + aNitro + aDrag) * dt;
  if (bike.v < 0) bike.v = 0;
  bike.s += bike.v * dt;
  bike.angle = env.slope;
}

// スカラー速度 v を接線(slope)方向の (vx, vy) に分解して離陸
export function launch(bike, slope) {
  bike.airborne = true;
  bike.vx = bike.v * Math.cos(slope);
  bike.vy = bike.v * Math.sin(slope);
}

// 放物運動。重力で vy 増加（y下正）。s も移動分だけ進める
export function stepAirborne(bike) {
  const dt = config.DT;
  bike.vy += config.GRAVITY * dt;
  bike.x += bike.vx * dt;
  bike.y += bike.vy * dt;
  bike.s += Math.hypot(bike.vx, bike.vy) * dt;
  bike.angle = Math.atan2(bike.vy, bike.vx);
}

// 着地時、速度ベクトルを地形接線へ射影したスカラー速度を返す
export function landingTangentSpeed(vx, vy, slope) {
  const tx = Math.cos(slope), ty = Math.sin(slope);
  return vx * tx + vy * ty;
}

// ループ頂点を保つのに必要な最低速度（円運動 v=√(g·r) に安全係数）
export function loopRequiredSpeed(r) {
  return Math.sqrt(config.GRAVITY * r) * config.LOOP_SAFETY;
}

export function canClearLoop(v, r) {
  return v >= loopRequiredSpeed(r);
}
