// スキーヤーの物理。ゲームの手触りのほぼ全部がここにある。
//
// 設計の芯:
//   板は「横滑りをグリップの限界まで打ち消すもの」としてだけモデル化する。
//   カービングもずらしも減速も、そこから勝手に生まれる。
//     ・ゆっくり丁寧に板を回す → 横滑りが小さい → エッジが吸収 → 削れない → 速くなる
//     ・速く雑に回す → 横滑りがグリップを超える → ずれる → 削れる → 遅くなる
//   スキーはエッジが 2 枚あるぶん立ち上がりが速く、プルーク（ハの字）で
//   低速でも確実に止まれる。そのぶん逆向き（スイッチ）の着地は苦手。
//   そして FLOW が最高速そのものを上げるので、
//     「丁寧に滑る → 速くなる → 丁寧に滑るのが難しくなる」
//   という自己調整ループが自然に閉じる。設計で難易度を押し付ける必要がない。

import {
  V3, clamp, clamp01, lerp, smoothstep, damp, angleDelta, TAU,
} from '../core/math.js';
import * as Terrain from '../world/terrain.js';
import { nearestTree } from '../world/scatter.js';

export const CFG = {
  GRAVITY: 20.5,            // 実測より強め。落ちる気持ちよさ優先。

  // --- 速度 ---
  V_BASE: 15.5,             // FLOW 0 のときの巡航上限 (m/s)  ≒ 56 km/h
  V_BONUS: 19.0,            // FLOW 1 で足される分            ≒ 124 km/h まで
  OVER_DRAG: 2.6,           // 上限超過分にかかる抵抗
  AIR_DRAG: 0.0024,         // 空気抵抗 (a = k v^2)。v=35 で約 3 m/s^2
  TUCK_DRAG_MUL: 0.55,      // タック中の空気抵抗
  TUCK_PUSH: 1.0,           // タックの押し出し (m/s^2)
  SKATE_SPEED: 3.4,         // これ以下では足で漕げる (m/s)
  SKATE_PUSH: 3.6,          // 漕ぎの加速度 (m/s^2)

  // --- 板を梁として扱う。小さい凹凸は板が跨いで均す。 ---
  // 板の全長は 1.65m だが、雪に当たっているのはトップロッカーを除いた
  // 有効エッジ長（約 1.45m）なので、その半分を使う。
  BOARD_HALF: 0.72,

  // --- ステアリングとグリップ ---
  YAW_RATE: 1.95,           // フルスティックで板を回す角速度 (rad/s)
  YAW_RATE_HI: 0.62,        // 高速時に落ちる割合
  ALIGN_RATE: 2.4,          // 無入力時に板が進行方向へ戻る速さ
  GRIP_ACCEL: 23.0,         // エッジ 2 枚が受け持てる横加速度の基準 (m/s^2)
  SKID_SCRUB: 1.35,         // 横滑り 1 m/s あたりの減速 (m/s^2)
  BRAKE_DECEL: 17.0,        // プルーク（ハの字）の減速
  BRAKE_YAW: 0.80,          // ずらしターン時に板が横を向く量
  WEDGE_GRIP: 0.35,         // プルーク中に増えるグリップ（両エッジが効く）

  // --- 空中 ---
  POLE_TIME: 0.34,          // ストックを突いている時間 (s)
  AIR_SPIN_ACCEL: 7.0,      // 空中で回転を掛ける速さ
  AIR_SPIN_MAX: 6.2,        // 最大角速度 (rad/s)
  GRAB_SPIN_MUL: 1.42,      // グラブ中の回転倍率
  OLLIE_V: 6.0,             // 抜重をフルに溜めたときのジャンプ初速 (m/s)
  OLLIE_MIN: 0.34,          // 溜めなしでも出る割合
  CHARGE_TIME: 0.42,        // フルチャージまでの秒数

  // --- 地形追従 ---
  ABSORB: 46.0,             // 膝で吸収できる加速度。これを超えると弾かれて飛ぶ (m/s^2)
  CHATTER_LO: 32.0,         // ここから板がバタつき始める
  CHATTER_HI: 115.0,        // ここで最大

  // --- 着地 ---
  LAND_SOFT: 7.0,           // これ以下の衝突速度ならノーダメージ (m/s)
  LAND_HARD: 15.5,          // これを超えると大きくバランスを失う
  LAND_ANGLE_OK: 0.38,      // 着地の許容ずれ角 (rad)
  SWITCH_PENALTY: 0.55,     // 逆向き着地のペナルティ（スキーは板より苦手）

  // --- FLOW ---
  // 上手い人で 25 秒、普通に滑って 60〜80 秒で満タンになるくらい。
  // 失う速さは得る速さの 5 倍前後。だから「積み上げたものを守る」感覚が生まれる。
  FLOW_GAIN: 0.072,         // 完璧に滑っているときの毎秒上昇量
  FLOW_DECAY: 0.020,        // 自然減衰
  FLOW_SKID_LOSS: 0.25,     // 横滑り由来の減少
  FLOW_LAND_LOSS: 0.45,
  FLOW_HIT_LOSS: 0.30,

  // --- BALANCE ---
  BAL_RECOVER: 0.34,        // 毎秒の回復
  BAL_SKID_LOSS: 0.30,
  BAL_WOBBLE: 0.55,         // これを下回るとよろけ始める

  RIDE_HEIGHT: 0.06,        // 滑走面から接地点までの余裕
  WIPEOUT_TIME: 1.9,        // 転倒してから復帰までの秒数
};

export const STATE = { RIDE: 0, AIR: 1, WIPEOUT: 2 };

const _s = Terrain.sample(0, 0, {});   // 専用のサンプル出力（共有バッファを踏まないように）
const _n = [0, 1, 0];
const _f = [0, 0, 1];
const _r = [1, 0, 0];
const _tmp = [0, 0, 0];
const _g = [0, 0, 1, 0];   // 接地面 [y, nx, ny, nz]

export class Rider {
  constructor() {
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0;              // 板の向き。0 = +Z（落下線方向）
    this.roll = 0;             // 見た目の傾き（エッジ角から作る）
    this.pitch = 0;            // 見た目の前後傾
    this.up = [0, 1, 0];       // 接地面の法線（空中では徐々に鉛直へ）

    this.state = STATE.RIDE;
    this.grounded = true;
    this.airTime = 0;
    this.groundTime = 0;
    this.wipeoutTimer = 0;
    this.tumble = 0;

    this.speed = 0;
    this.distance = 0;
    this.bestDistance = 0;
    this.edge = 0;             // -1..1 エッジ角（見た目と音に使う）
    this.skid = 0;             // 横滑り量 m/s
    this.skidNorm = 0;         // 0..1 に正規化した横滑り
    this.chatter = 0;          // 0..1 板のバタつき
    this.wedge = 0;            // 0..1 プルーク（ハの字）の開き
    this.tuckAmt = 0;          // 0..1 タックの深さ（見た目用）
    this.poleTimer = 0;        // ストックを突いている残り時間の正規化値
    this.poleSide = 0;         // 突いている側 -1 左 / +1 右
    this.crouch = 0;
    this.charge = 0;
    this.grab = 0;
    this.spinRate = 0;
    this.spinAccum = 0;        // 空中での累積回転（度）
    this.lastTrick = null;
    this.trickTimer = 0;

    this.flow = 0;
    this.balance = 1;
    this.wobble = 0;
    this.vMax = CFG.V_BASE;

    // サーフェス情報（描画・音が読む）
    this.surface = Terrain.SURFACE.GROOMED;
    this.powder = 0;
    this.ice = 0;
    this.groomedAmt = 1;
    this.iceSlip = 0;
    this.terrainY = 0;
    this.airHeight = 0;

    // イベント（外から差し替える）
    this.onLand = null;        // (impact, clean, trick)
    this.onPop = null;         // (power)
    this.onWipeout = null;     // (cause)
    this.onTreeHit = null;     // (glancing, speed)
    this.onRespawn = null;
    this.onTrick = null;       // (name, degrees)
    this.onCarveTick = null;   // (intensity)
    this.onPolePlant = null;   // (side, speed)

    this._prevSteer = 0;
    this._jerk = 0;
    this._noiseT = 0;
    this._popCooldown = 0;
    this._vyPrev = 0;
    this._velPrev = [0, 0, 0];
    this._edgeSign = 0;
    this.respawn();
  }

  respawn() {
    const [x, y, z] = Terrain.startPosition();
    this.pos[0] = x; this.pos[1] = y; this.pos[2] = z;
    this.vel[0] = 0; this.vel[1] = 0; this.vel[2] = 4;
    this.yaw = 0;
    this.roll = 0; this.pitch = 0;
    this.state = STATE.RIDE;
    this.grounded = true;
    this.airTime = 0;
    this.groundTime = 0;
    this.wipeoutTimer = 0;
    this.tumble = 0;
    this.speed = 4;
    this.distance = 0;
    this.edge = 0; this.skid = 0; this.skidNorm = 0; this.chatter = 0;
    this.wedge = 0; this.tuckAmt = 0; this.poleTimer = 0; this.poleSide = 0;
    this._edgeSign = 0;
    this._vyPrev = 0;
    this._velPrev[0] = 0; this._velPrev[1] = 0; this._velPrev[2] = 4;
    this.crouch = 0; this.charge = 0; this.grab = 0;
    this.spinRate = 0; this.spinAccum = 0;
    this.flow = 0;
    this.balance = 1;
    this.wobble = 0;
    this.up[0] = 0; this.up[1] = 1; this.up[2] = 0;
    if (this.onRespawn) this.onRespawn();
  }

  /**
   * 板の接地面。トップ・センター・テールの 3 点から求める。
   * 有効エッジ 1.45m の剛体の梁なので、それより短い波長の凹凸は跨いで均される。
   * これがないと、細かいノイズを全部拾って高速域が暴れる。
   * out = [y, nx, ny, nz]
   */
  _ground(x, z, yaw, out) {
    const hx = Math.sin(yaw) * CFG.BOARD_HALF, hz = Math.cos(yaw) * CFG.BOARD_HALF;
    const yC = Terrain.height(x, z);
    const yN = Terrain.height(x + hx, z + hz);
    const yT = Terrain.height(x - hx, z - hz);

    // 板の下面は 3 点の一番高いところに乗る（凸は跨がず、凹は跨ぐ）
    const top = yN > yT ? yN : yT;
    out[0] = Math.max(yC, top) * 0.55 + (yC + yN + yT) / 3 * 0.45;

    // 前後の傾きは板の長さで測る
    const sF = (yN - yT) / (2 * CFG.BOARD_HALF);
    // 横方向の傾きは板が短いので地形の勾配をそのまま使う
    Terrain.normal(x, z, _tmp);
    const gx = -_tmp[0] / Math.max(_tmp[1], 0.15), gz = -_tmp[2] / Math.max(_tmp[1], 0.15);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const sR = gx * rx + gz * rz;

    // 2 本の接ベクトルから法線を作る
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // n = normalize(cross(tangentR, tangentF))
    const nx = sR * fz - rz * sF;
    const ny = rz * fx - rx * fz;
    const nz = rx * sF - sR * fx;
    const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
    const s = ny < 0 ? -inv : inv;
    out[1] = nx * s; out[2] = ny * s; out[3] = nz * s;
    return out;
  }

  /** 固定ステップで呼ぶ。input は core/input.js の Input か同じ形のオブジェクト。 */
  step(dt, input) {
    this._noiseT += dt;
    this.trickTimer = Math.max(0, this.trickTimer - dt);
    this._popCooldown = Math.max(0, this._popCooldown - dt);
    if (this.poleTimer > 0) this.poleTimer = Math.max(0, this.poleTimer - dt / CFG.POLE_TIME);

    if (this.state === STATE.WIPEOUT) {
      this._stepWipeout(dt);
      return;
    }

    // よろけているときは操作が少し勝手に振れる
    let steer = input.steer;
    if (this.balance < CFG.BAL_WOBBLE) {
      const w = 1 - this.balance / CFG.BAL_WOBBLE;
      this.wobble = w;
      steer += Math.sin(this._noiseT * 11.3) * Math.sin(this._noiseT * 4.1 + 1.2) * w * 0.42;
      steer = clamp(steer, -1, 1);
    } else {
      this.wobble = damp(this.wobble, 0, 6, dt);
    }

    const terr = Terrain.sample(this.pos[0], this.pos[2], _s);
    this._ground(this.pos[0], this.pos[2], this.yaw, _g);
    this.terrainY = _g[0];

    if (this.grounded) {
      this.pos[1] = _g[0];               // 接地中は常に面へ吸い付かせる（ドリフト防止）
      this._stepGround(dt, input, steer, terr, _g);
    } else {
      this._stepAir(dt, input, steer, terr);
    }

    // --- 位置の積分 ---
    this.pos[0] += this.vel[0] * dt;
    this.pos[1] += this.vel[1] * dt;
    this.pos[2] += this.vel[2] * dt;

    // --- 地面拘束 ---
    this._ground(this.pos[0], this.pos[2], this.yaw, _g);
    const ty = _g[0];
    this.terrainY = ty;
    if (this.grounded) {
      this.pos[1] = ty;
    } else if (this.pos[1] <= ty) {
      const vn = this.vel[0] * _g[1] + this.vel[1] * _g[2] + this.vel[2] * _g[3];
      this.pos[1] = ty;
      this.grounded = true;
      this.state = STATE.RIDE;
      if (vn < 0) {
        this._land(-vn, terr);
        // 雪は跳ねない。法線成分を消す。
        this.vel[0] -= _g[1] * vn;
        this.vel[1] -= _g[2] * vn;
        this.vel[2] -= _g[3] * vn;
      }
      this._velPrev[0] = this.vel[0]; this._velPrev[1] = this.vel[1]; this._velPrev[2] = this.vel[2];
      this._vyPrev = this.vel[1];
    }
    this.airHeight = Math.max(0, this.pos[1] - ty);

    // --- 障害物 ---
    this._checkTrees(dt);

    // --- 見た目の姿勢 ---
    this._updatePose(dt);

    // --- 進行距離 ---
    this.speed = Math.hypot(this.vel[0], this.vel[2]);
    this.distance = Math.max(this.distance, this.pos[2]);
    if (this.distance > this.bestDistance) this.bestDistance = this.distance;

    // --- FLOW と BALANCE ---
    this._updateFlow(dt, input);

    if (this.balance <= 0) this._wipeout('balance');
  }

  /* ------------------------------------------------------------- 接地 */

  _stepGround(dt, input, steer, terr, g) {
    this.groundTime += dt;
    this.airTime = 0;
    this.state = STATE.RIDE;
    _n[0] = g[1]; _n[1] = g[2]; _n[2] = g[3];

    // 板の前方向。
    // 単純に法線平面へ「投影」すると、水平の向きまで勝手に回ってしまう
    // （横断勾配のある斜面で、操作していないのに進路が曲がっていく）。
    // 正しくは「水平成分が yaw と一致する接ベクトル」を作る。
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const ny = Math.max(_n[1], 0.15);
    _f[0] = sy;
    _f[1] = -(_n[0] * sy + _n[2] * cy) / ny;
    _f[2] = cy;
    V3.normalize(_f, _f);
    V3.cross(_r, _n, _f);          // 右方向（面内で前方向と直交）
    V3.normalize(_r, _r);

    // --- ステアリング（板の向きは常に自分で回せる）---
    const speedNorm = clamp01(this.speed / 32);
    const yawRate = CFG.YAW_RATE * lerp(1, CFG.YAW_RATE_HI, speedNorm * speedNorm);
    // ブレーキは板を横に向ける
    const brakeYaw = input.brake * CFG.BRAKE_YAW * (steer !== 0 ? Math.sign(steer) : 1);
    this.yaw += (steer * yawRate + brakeYaw * 2.2) * dt;

    // 無入力なら板は進行方向へ戻ろうとする（実際の板の直進安定性）
    if (this.speed > 2.5) {
      const velYaw = Math.atan2(this.vel[0], this.vel[2]);
      const align = CFG.ALIGN_RATE * (1 - Math.min(1, Math.abs(steer) * 1.6 + input.brake));
      if (align > 0) this.yaw += angleDelta(this.yaw, velYaw) * Math.min(1, align * dt);
    }

    // --- 速度を板の座標へ分解 ---
    let vF = V3.dot(this.vel, _f);
    let vR = V3.dot(this.vel, _r);

    // --- プルーク（ハの字）---
    // 両方のエッジが雪に食い込むので、グリップが増えて低速でも確実に止まれる。
    this.wedge = damp(this.wedge, input.brake, 11, dt);
    this.tuckAmt = damp(this.tuckAmt, input.tuck, 9, dt);

    // --- 横滑りをグリップで打ち消す（ここが全部の source）---
    const gripAccel = CFG.GRIP_ACCEL * terr.grip * (1 + this.wedge * CFG.WEDGE_GRIP);
    const wanted = -vR / dt;                       // 完全に消したい加速度
    const applied = clamp(wanted, -gripAccel, gripAccel);
    vR += applied * dt;

    this.skid = Math.abs(vR);
    this.skidNorm = clamp01(this.skid / 7);
    // エッジ角 = グリップをどれだけ使っているか
    const load = clamp(-applied / CFG.GRIP_ACCEL, -1, 1);
    this.edge = damp(this.edge, load, 14, dt);
    // アイスで流されている感じ
    this.iceSlip = damp(this.iceSlip, terr.ice * this.skidNorm, 8, dt);

    // --- 前後方向 ---
    // 重力の斜面成分
    const gN = -CFG.GRAVITY * _n[1];
    const aGF = -CFG.GRAVITY * _f[1];              // 重力の前方成分
    const aGR = -CFG.GRAVITY * _r[1];
    vR += aGR * dt;                                // 横方向の重力（トラバース時に効く）

    let aF = aGF;
    // 雪の抵抗。滑走摩擦 + 雪を押しのける抵抗。
    // 摩擦は v→0 でフェードさせる。そうしないと停止点で符号が振動して張り付く。
    const normalLoad = Math.max(0.25, _n[1]);
    const dir = vF >= 0 ? 1 : -1;
    const fade = Math.min(1, Math.abs(vF) / 0.9);
    aF -= dir * fade * terr.mu * CFG.GRAVITY * normalLoad * (0.75 + 0.45 * Math.abs(this.edge));
    aF -= dir * terr.plow * vF * vF;
    // 横滑りによる削れ
    aF -= Math.sign(vF || 1) * this.skid * CFG.SKID_SCRUB;
    // 空気抵抗
    const airMul = lerp(1, CFG.TUCK_DRAG_MUL, input.tuck);
    aF -= dir * CFG.AIR_DRAG * vF * vF * airMul;
    // タックの押し出し
    aF += input.tuck * CFG.TUCK_PUSH;
    // プルーク制動。摩擦と違い、ほぼ停止まで効かせる。
    const brakeFade = Math.min(1, Math.abs(vF) / 0.25);
    aF -= dir * brakeFade * input.brake * CFG.BRAKE_DECEL;
    // 低速では足で漕げる。緩斜面やパウダーで完全に詰むことがなくなる。
    if (vF < CFG.SKATE_SPEED && input.brake < 0.3) {
      aF += CFG.SKATE_PUSH * (1 - vF / CFG.SKATE_SPEED);
    }

    // --- FLOW が決める最高速 ---
    this.vMax = CFG.V_BASE + CFG.V_BONUS * this.flow;
    if (vF > this.vMax) aF -= (vF - this.vMax) * CFG.OVER_DRAG;

    vF += aF * dt;
    if (vF < 0 && aGF < 0.4) vF = Math.max(vF, -1.5);   // 逆走はほぼしない

    // --- 壁（切り立った面）に突っ込んだら削られる ---
    if (_n[1] < 0.62) {
      const into = -(_n[0] * this.vel[0] + _n[2] * this.vel[2]);
      if (into > 3) {
        const f = smoothstep(3, 14, into);
        vF *= 1 - 0.55 * f;
        this.balance -= f * 0.5 * dt * 8;
        this.flow *= 1 - f * 0.6 * dt * 6;
      }
    }

    // --- 組み立て直し。接地中の速度は必ず面に接している ---
    this.vel[0] = _f[0] * vF + _r[0] * vR;
    this.vel[1] = _f[1] * vF + _r[1] * vR;
    this.vel[2] = _f[2] * vF + _r[2] * vR;

    // --- 地形追従の限界＝離陸判定 ---
    // 面に沿い続けるのに必要な鉛直加速度が、重力＋膝の吸収を超えたら弾かれる。
    // キッカーのリップも、ロールの裏も、段差も、これ一本で自然に飛ぶ。
    const aReq = (this.vel[1] - this._vyPrev) / dt;
    const need = -aReq - CFG.GRAVITY;
    if (this.groundTime > 0.04 && need > CFG.ABSORB) {
      this.vel[0] = this._velPrev[0];
      this.vel[1] = this._velPrev[1] - CFG.GRAVITY * dt;
      this.vel[2] = this._velPrev[2];
      this.grounded = false;
      this.state = STATE.AIR;
      this.airTime = 0;
      this.spinAccum = 0;
      this.spinRate = 0;
      this.chatter = 0;
    } else {
      // バタつき。荒れた面を速度で走ると板が暴れ、FLOW とバランスを削る。
      const mag = Math.abs(aReq);
      const ch = clamp01((mag - CFG.CHATTER_LO) / (CFG.CHATTER_HI - CFG.CHATTER_LO));
      this.chatter = damp(this.chatter, ch, 9, dt);
      if (ch > 0) {
        this.flow = clamp01(this.flow - ch * 0.30 * dt);
        this.balance = clamp01(this.balance - ch * 0.20 * dt);
      }
      this._velPrev[0] = this.vel[0]; this._velPrev[1] = this.vel[1]; this._velPrev[2] = this.vel[2];
      this._vyPrev = this.vel[1];
    }

    // --- 抜重ジャンプ ---
    this.crouch = damp(this.crouch, input.ollieHeld ? 1 : input.brake * 0.5, 12, dt);
    if (input.ollieHeld) {
      this.charge = Math.min(1, this.charge + dt / CFG.CHARGE_TIME);
    }
    if (input.ollieReleased && this._popCooldown <= 0) {
      const power = CFG.OLLIE_MIN + (1 - CFG.OLLIE_MIN) * this.charge;
      const v = CFG.OLLIE_V * power;
      this.vel[0] += _n[0] * v;
      this.vel[1] += _n[1] * v;
      this.vel[2] += _n[2] * v;
      this.pos[1] += 0.05;
      this.charge = 0;
      this._popCooldown = 0.12;
      this.state = STATE.AIR;
      this.grounded = false;
      this.spinAccum = 0;
      this.spinRate = 0;
      if (this.onPop) this.onPop(power);
    }

    // --- 接地中のサーフェス情報 ---
    this.surface = terr.surface;
    this.powder = terr.powder;
    this.ice = terr.ice;
    this.groomedAmt = terr.groomed;

    // --- ストックワーク ---
    // ターンが切り替わる瞬間に、これから内側になる側を突く。
    // 実利はないが、スキーのリズムはこれで決まる。
    const es = Math.abs(this.edge) > 0.16 ? Math.sign(this.edge) : 0;
    if (es !== 0 && es !== this._edgeSign && this.speed > 5 && this.poleTimer <= 0) {
      this.poleSide = -es;                 // 内側の手
      this.poleTimer = 1;
      if (this.onPolePlant) this.onPolePlant(this.poleSide, this.speed);
    }
    if (es !== 0) this._edgeSign = es;

    if (this.onCarveTick) {
      const intensity = clamp01(Math.abs(this.edge) * 0.7 + this.skidNorm * 0.9) *
        clamp01(this.speed / 12);
      this.onCarveTick(intensity);
    }
  }

  /* ------------------------------------------------------------- 空中 */

  _stepAir(dt, input, steer, terr) {
    this.state = STATE.AIR;
    this.airTime += dt;
    this.groundTime = 0;

    // グラブ（空中でジャンプボタン）
    this.grab = damp(this.grab, input.ollieHeld ? 1 : 0, 10, dt);
    this.crouch = damp(this.crouch, 0.25 + 0.55 * this.grab, 7, dt);
    this.wedge = damp(this.wedge, 0, 8, dt);
    this.tuckAmt = damp(this.tuckAmt, input.tuck * 0.5, 6, dt);
    this.charge = 0;

    // スピン
    const mul = lerp(1, CFG.GRAB_SPIN_MUL, this.grab);
    this.spinRate += steer * CFG.AIR_SPIN_ACCEL * mul * dt;
    this.spinRate = clamp(this.spinRate, -CFG.AIR_SPIN_MAX, CFG.AIR_SPIN_MAX);
    if (steer === 0) this.spinRate = damp(this.spinRate, 0, 0.8, dt);
    this.yaw += this.spinRate * dt;
    this.spinAccum += this.spinRate * dt;

    // 重力と空気抵抗
    this.vel[1] -= CFG.GRAVITY * dt;
    const v = Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
    const d = CFG.AIR_DRAG * v * lerp(1, 0.7, input.tuck) * dt;
    this.vel[0] -= this.vel[0] * d;
    this.vel[1] -= this.vel[1] * d;
    this.vel[2] -= this.vel[2] * d;

    this.edge = damp(this.edge, steer * 0.35, 6, dt);
    this.skid = 0;
    this.skidNorm = 0;
    this.iceSlip = damp(this.iceSlip, 0, 6, dt);
  }

  /* ----------------------------------------------------------- 着地 */

  _land(impact, terr) {
    const wasAir = this.airTime;
    // 着地時の板と進行方向のずれ。逆スタンス（スイッチ）も正解とみなす。
    const velYaw = Math.atan2(this.vel[0], this.vel[2]);
    let off = Math.abs(angleDelta(velYaw, this.yaw));
    const switchLanding = off > Math.PI / 2;
    if (switchLanding) {
      // 逆向きでも降りられるが、スキーは板ほど得意ではない
      off = Math.PI - off + CFG.SWITCH_PENALTY;
    }

    const angleBad = clamp01((off - CFG.LAND_ANGLE_OK) / (1.15 - CFG.LAND_ANGLE_OK));
    const hard = clamp01((impact - CFG.LAND_SOFT) / (CFG.LAND_HARD - CFG.LAND_SOFT));
    const clean = angleBad < 0.18 && hard < 0.5;

    // トリック判定
    let trick = null;
    const deg = Math.abs(this.spinAccum) * 180 / Math.PI;
    if (wasAir > 0.28) {
      const steps = Math.round(deg / 180);
      if (steps >= 1) {
        trick = `${steps * 180}`;
        if (this.grab > 0.4) trick += ' GRAB';
      } else if (wasAir > 0.75) {
        trick = this.grab > 0.4 ? 'GRAB' : 'AIR';
      }
      if (switchLanding && steps >= 1) trick = `SW ${trick}`;
    }

    if (clean) {
      // 決めた着地はご褒美。滞空が長いほど大きい。
      const bonus = clamp01(wasAir / 1.4) * 0.11 + (trick ? 0.06 : 0);
      this.flow = clamp01(this.flow + bonus);
      this.balance = clamp01(this.balance + 0.06);
      if (trick && this.onTrick) {
        this.onTrick(trick, deg);
        this.lastTrick = trick;
        this.trickTimer = 2.2;
      }
    } else {
      const dmg = angleBad * 0.42 + hard * 0.5;
      this.balance = clamp01(this.balance - dmg);
      this.flow = clamp01(this.flow - dmg * CFG.FLOW_LAND_LOSS);
      // 角度がずれていた分は横滑りとして残る（自然に削れる）
      const scrub = 1 - clamp01(angleBad * 0.55 + hard * 0.3);
      this.vel[0] *= scrub; this.vel[2] *= scrub;
      if (impact > CFG.LAND_HARD * 1.55 && off > 0.9) {
        this._wipeout('landing');
        return;
      }
    }

    this.spinAccum = 0;
    this.spinRate = 0;
    if (this.onLand) this.onLand(impact, clean, trick, terr);
  }

  /* --------------------------------------------------------- 障害物 */

  _checkTrees(dt) {
    if (this.state === STATE.WIPEOUT) return;
    // 空高くにいるときは枝の上を飛べる
    if (this.airHeight > 7) return;

    const t = nearestTree(this.pos[0], this.pos[2], 2.6);
    if (!t || t.dist > 0) return;

    const dx = this.pos[0] - t.x, dz = this.pos[2] - t.z;
    const d = Math.hypot(dx, dz) || 1e-4;
    const nx = dx / d, nz = dz / d;
    // 押し出す
    const push = -t.dist + 0.02;
    this.pos[0] += nx * push;
    this.pos[2] += nz * push;

    const closing = -(this.vel[0] * nx + this.vel[2] * nz);
    if (closing < 0.5) return;

    const head = clamp01(closing / Math.max(this.speed, 1));   // 正面から当たったか
    const severity = clamp01(closing / 15) * (0.35 + 0.65 * head);

    if (this.speed > 13 && head > 0.72 && this.balance < 0.92) {
      if (this.onTreeHit) this.onTreeHit(false, this.speed);
      this._wipeout('tree');
      return;
    }

    // 掠めた: 速度を削って体勢を崩す
    const scrub = 1 - 0.45 * severity;
    this.vel[0] = (this.vel[0] + nx * closing) * scrub;
    this.vel[2] = (this.vel[2] + nz * closing) * scrub;
    this.balance = clamp01(this.balance - (0.08 + severity * 0.46));
    this.flow = clamp01(this.flow - CFG.FLOW_HIT_LOSS * (0.3 + severity));
    if (this.onTreeHit) this.onTreeHit(true, closing);
    if (this.balance <= 0) this._wipeout('tree');
  }

  /* ------------------------------------------------- FLOW / BALANCE */

  _updateFlow(dt, input) {
    if (this.state === STATE.AIR) {
      // 空中は維持（減衰だけ半分）
      this.flow = clamp01(this.flow - CFG.FLOW_DECAY * 0.4 * dt);
      this.balance = clamp01(this.balance + CFG.BAL_RECOVER * 0.35 * dt);
      return;
    }

    const moving = clamp01(this.speed / 8);

    // 入力の滑らかさ。ガクガク動かすと落ちる。
    // 瞬間値はノイズが乗るので均してから使う。
    const jerk = Math.abs(input.steer - this._prevSteer) / Math.max(dt, 1e-4);
    this._prevSteer = input.steer;
    this._jerk = damp(this._jerk, jerk, 5, dt);
    const smooth = 1 - clamp01(this._jerk / 13);

    // カービングの質。横滑りが小さいほど良い。
    // ただしパウダーは横にずらしながら乗るのが正しいので、しきい値を緩める。
    const slideOk = 3.2 + 4.5 * this.powder;
    const carveQ = 1 - clamp01(this.skid / slideOk);
    // エッジを使っているほど価値が高い（直滑降でも少しは上がる）
    const engage = 0.42 + 0.58 * clamp01(Math.abs(this.edge) * 1.25);

    let gain = CFG.FLOW_GAIN * carveQ * engage * smooth * moving;
    // ブレーキ中は上がらない
    gain *= 1 - input.brake * 0.9;
    // 体勢が崩れていると乗らない
    gain *= lerp(0.35, 1, this.balance);

    this.flow = clamp01(this.flow + gain * dt - CFG.FLOW_DECAY * dt);

    // 横滑りによる減少（グリップ限界を超えたぶん）。圧雪の上ほど厳しく効く。
    const over = clamp01((this.skid - 2.0) / 6) * (0.35 + 0.65 * this.groomedAmt);
    if (over > 0) {
      this.flow = clamp01(this.flow - over * CFG.FLOW_SKID_LOSS * dt);
      this.balance = clamp01(this.balance - over * CFG.BAL_SKID_LOSS * dt);
    }

    // バランスの回復。丁寧に滑るかブレーキで整えると戻る。
    const calm = (1 - clamp01(this.skid / 4)) * (0.55 + 0.45 * input.brake);
    this.balance = clamp01(this.balance + CFG.BAL_RECOVER * calm * dt);
  }

  /* --------------------------------------------------------- 転倒 */

  _wipeout(cause) {
    if (this.state === STATE.WIPEOUT) return;
    this.state = STATE.WIPEOUT;
    this.wipeoutTimer = 0;
    this.tumble = 0;
    this.balance = 0;
    this.flow = 0;
    this.grounded = false;
    // 転がる勢い
    this.vel[1] += 3.2;
    this.vel[0] *= 0.55; this.vel[2] *= 0.55;
    if (this.onWipeout) this.onWipeout(cause);
  }

  _stepWipeout(dt) {
    this.wipeoutTimer += dt;
    this.tumble += dt * (5.5 + this.speed * 0.25);

    this.vel[1] -= CFG.GRAVITY * dt;
    this.pos[0] += this.vel[0] * dt;
    this.pos[1] += this.vel[1] * dt;
    this.pos[2] += this.vel[2] * dt;

    const ty = Terrain.height(this.pos[0], this.pos[2]);
    this.terrainY = ty;
    if (this.pos[1] < ty) {
      this.pos[1] = ty;
      Terrain.normal(this.pos[0], this.pos[2], _n);
      const vn = this.vel[0] * _n[0] + this.vel[1] * _n[1] + this.vel[2] * _n[2];
      if (vn < 0) {
        // 跳ねながら止まっていく
        this.vel[0] -= _n[0] * vn * 1.25;
        this.vel[1] -= _n[1] * vn * 1.25;
        this.vel[2] -= _n[2] * vn * 1.25;
      }
      this.vel[0] *= 0.86; this.vel[2] *= 0.86;
    }
    this.speed = Math.hypot(this.vel[0], this.vel[2]);
    this.airHeight = Math.max(0, this.pos[1] - ty);

    if (this.wipeoutTimer > CFG.WIPEOUT_TIME) this.respawn();
  }

  /* --------------------------------------------------------- 見た目 */

  _updatePose(dt) {
    // 接地面の法線へ徐々に合わせる（空中では鉛直へ戻る）
    if (this.grounded) {
      Terrain.normal(this.pos[0], this.pos[2], _tmp);
      this.up[0] = damp(this.up[0], _tmp[0], 12, dt);
      this.up[1] = damp(this.up[1], _tmp[1], 12, dt);
      this.up[2] = damp(this.up[2], _tmp[2], 12, dt);
    } else {
      this.up[0] = damp(this.up[0], 0, 3.5, dt);
      this.up[1] = damp(this.up[1], 1, 3.5, dt);
      this.up[2] = damp(this.up[2], 0, 3.5, dt);
    }
    V3.normalize(this.up, this.up);

    // エッジ角に応じて板を傾ける。深いカーブほど寝る。
    const targetRoll = this.grounded
      ? -this.edge * 0.92 * clamp01(this.speed / 9)
      : -this.edge * 0.30;
    this.roll = damp(this.roll, targetRoll, 11, dt);

    // 前後傾。加速で後ろ、減速で前。
    const targetPitch = this.grounded
      ? clamp(-this.vel[1] * 0.02, -0.2, 0.2) + this.crouch * 0.12
      : clamp01(this.airTime * 1.4) * 0.10;
    this.pitch = damp(this.pitch, targetPitch, 8, dt);
  }

  /* -------------------------------------------------------- 補助 */

  /** ネットワークへ送る最小限の状態 */
  netState() {
    return {
      x: Math.round(this.pos[0] * 32) / 32,
      y: Math.round(this.pos[1] * 32) / 32,
      z: Math.round(this.pos[2] * 32) / 32,
      a: Math.round(this.yaw * 256) / 256,
      r: Math.round(this.roll * 128) / 128,
      s: Math.round(this.speed * 8) / 8,
      d: Math.round(this.distance),
      f: Math.round(this.flow * 100) / 100,
      w: this.state === STATE.WIPEOUT ? 1 : this.grounded ? 0 : 2,
    };
  }
}
