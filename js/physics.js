import { config } from './config.js';

// バイクの物理。状態を持つのは createBike が返すオブジェクトで、
// 各関数は純粋に近い形で状態を更新する（テストしやすさのため）。
//
// 角度 angle は地形傾きと同じ約束（atan2(dy,dx)、下り正）。
// 地上では angle≒地形傾き。空中では ↑↓ リーンと自然トルク AIR_PITCH で
// 回転し、着地時に地形傾きとの差が LAND_TOL を超えるとクラッシュ。

export function createBike() {
  return {
    s: 0,            // 走行弧長(px)。総距離・周回判定に使う
    v: config.V_START, // 接線方向の速さ(px/s)
    x: 0, y: 0,      // ワールド座標(y下正)
    vx: 0, vy: 0,    // 空中の速度
    angle: 0,        // 車体の傾き(rad)
    av: 0,           // 角速度(rad/s, 空中回転)
    airborne: false,
    turbo: config.TURBO_START,
    inLoop: false, loopT: 0,
    firing: false,   // ターボ噴射中(描画用)
    flips: 0,        // 空中で稼いだ回転量(演出/将来用)
    safeX: 0,        // 直近の安全な接地x(リスポーン地点)
  };
}

// 地上の速度更新。env = { slope, accel, turbo }
export function stepGroundSpeed(bike, env) {
  const dt = config.DT;
  const aGravity = config.GRAVITY * Math.sin(env.slope) * config.SLOPE_GAIN;
  const aEngine = env.accel ? config.ACCEL : 0;
  const firing = env.turbo && bike.turbo > 0;
  const aTurbo = firing ? config.TURBO : 0;
  if (firing) {
    bike.turbo -= config.TURBO_BURN * dt;
    if (bike.turbo < 0) bike.turbo = 0;
  }
  bike.firing = firing;
  const aDrag = -config.DRAG * bike.v;
  bike.v += (aGravity + aEngine + aTurbo + aDrag) * dt;
  if (bike.v < 0) bike.v = 0;
  if (bike.v > config.V_MAX) bike.v = config.V_MAX;
  bike.s += bike.v * dt;
}

// スカラー速度 v を接線(slope)方向の (vx, vy) に分解して離陸
export function launch(bike, slope) {
  bike.airborne = true;
  bike.vx = bike.v * Math.cos(slope);
  bike.vy = bike.v * Math.sin(slope);
  bike.angle = slope;
  bike.av = 0;
  bike.flips = 0;
}

// スプリングで真上へ強く打ち上げる。前進成分は維持。
export function launchSpring(bike, slope) {
  bike.airborne = true;
  bike.vx = bike.v * Math.cos(slope);
  bike.vy = -config.SPRING_VY;
  bike.angle = slope;
  bike.av = 0;
  bike.flips = 0;
}

// 空中の運動＋プレイヤーのリーン入力で回転。lean = { up, down }
export function stepAir(bike, lean, dt = config.DT) {
  bike.vy += config.GRAVITY * dt;
  bike.x += bike.vx * dt;
  bike.y += bike.vy * dt;
  bike.s += Math.hypot(bike.vx, bike.vy) * dt;

  // 自然に前のめり(角度+)。↑で後傾(−)、↓で前傾(+)。
  let aAng = config.AIR_PITCH;
  if (lean && lean.up) aAng -= config.LEAN_ACCEL;
  if (lean && lean.down) aAng += config.LEAN_ACCEL;
  bike.av += aAng * dt;
  if (bike.av > config.LEAN_AV_MAX) bike.av = config.LEAN_AV_MAX;
  if (bike.av < -config.LEAN_AV_MAX) bike.av = -config.LEAN_AV_MAX;
  bike.angle += bike.av * dt;
  bike.flips += Math.abs(bike.av * dt);
}

// 着地姿勢の判定。車体角と地形傾きの差が許容内なら true。
export function landingOk(angle, slope) {
  return Math.abs(normalizeAngle(angle - slope)) <= config.LAND_TOL;
}

// 着地時、速度ベクトルを地形接線へ射影したスカラー速度を返す
export function landingTangentSpeed(vx, vy, slope) {
  const tx = Math.cos(slope), ty = Math.sin(slope);
  return vx * tx + vy * ty;
}

// ループ頂点を保つのに必要な最低速度（v=√(g·r) に安全係数）
export function loopRequiredSpeed(r) {
  return Math.sqrt(config.GRAVITY * r) * config.LOOP_SAFETY;
}

export function canClearLoop(v, r) {
  return v >= loopRequiredSpeed(r);
}

export function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
