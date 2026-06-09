import { config } from './config.js';

// === GROUNDED ⇄ AIRBORNE 状態遷移 ===
// GROUNDED: 弧長 s で地形に追従。x,y は地形から算出。
//   エンジンが常に前進させ、平地では巡航速度 ENGINE/DRAG に収束する。
//   ターボ(ホールド中かつ残量あり)で更に加速。坂で加減速。
// AIRBORNE: (x,y,vx,vy) で放物運動。重力で vy が増える(y下正)。
//   着地時は速度ベクトルを地形接線へ射影してスカラー v に戻す。

export function createBike() {
  return {
    s: 0, v: config.V_START, airborne: false,
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, turbo: config.TURBO_START,
    inLoop: false, loopT: 0,
    firing: false, safeX: 0,
  };
}

// env = { slope, turbo }。slope は rad(下り正)、turbo はホールド中フラグ
export function stepGrounded(bike, env) {
  const dt = config.DT;
  // 下り(slope>0)で加速・上り(slope<0)で減速。y下正のため符号は+
  const aGravity = config.GRAVITY * Math.sin(env.slope) * config.SLOPE_GAIN;
  // ターボは「ホールド中 かつ 残量あり」のときだけ噴射し残量を消費
  const firing = env.turbo && bike.turbo > 0;
  const aTurbo = firing ? config.TURBO_THRUST : 0;
  if (firing) {
    bike.turbo -= config.TURBO_BURN * dt;
    if (bike.turbo < 0) bike.turbo = 0;
  }
  bike.firing = firing;
  // エンジンの定常推進と速度比例の抵抗。平地無ターボの平衡は ENGINE/DRAG。
  const aEngine = config.ENGINE;
  const aDrag = -config.DRAG * bike.v;
  bike.v += (aGravity + aEngine + aTurbo + aDrag) * dt;
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

// スプリング(ジャンプ台)で真上に強く打ち上げる。前進成分は維持。
export function launchSpring(bike, slope) {
  bike.airborne = true;
  bike.vx = bike.v * Math.cos(slope);
  bike.vy = -config.SPRING_VY;
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
