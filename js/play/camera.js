// 追従カメラ。
// 速度・カーブ・着地・体勢に合わせて、常に少しずつ動いている。
// 「ゲームが上手くいっている」という手応えの半分はカメラが作っている。

import { V3, M4, clamp, clamp01, lerp, damp, dampAngle, angleDelta, smoothstep, DEG } from '../core/math.js';
import { STATE } from './rider.js';
import * as Terrain from '../world/terrain.js';

export const CAM = {
  DIST: 7.4,          // 基本の後方距離
  DIST_SPEED: 3.2,    // 速度で伸びる分
  HEIGHT: 2.5,        // 基本の高さ
  LOOK_AHEAD: 9.0,    // 注視点を前に置く距離
  FOV: 62 * DEG,
  FOV_SPEED: 17 * DEG, // 全速で足される画角
  BANK: 0.30,         // カーブでのロール
};

export class Camera {
  constructor() {
    this.pos = [0, 0, -10];
    this.target = [0, 0, 0];
    this.up = [0, 1, 0];
    this.yaw = 0;
    this.fov = CAM.FOV;
    this.roll = 0;
    this.shake = 0;
    this.view = M4.create();
    this.proj = M4.create();
    this.viewProj = M4.create();
    this.invViewProj = M4.create();
    this.mode = 0;          // 0: 追従  1: 近め  2: 一人称寄り
    this._shakeT = 0;
    this._smoothSpeed = 0;
    this._landDip = 0;
    this._prevPos = [0, 0, 0];
  }

  cycleMode() { this.mode = (this.mode + 1) % 3; }

  /** 着地の沈み込み。rider.onLand から呼ぶ。 */
  impulse(strength) {
    this._landDip = Math.min(1.6, this._landDip + strength);
    this.shake = Math.min(1.4, this.shake + strength * 0.55);
  }

  update(dt, rider, aspect) {
    const wipe = rider.state === STATE.WIPEOUT;
    this._smoothSpeed = damp(this._smoothSpeed, rider.speed, 2.2, dt);
    const sn = clamp01(this._smoothSpeed / 30);

    // --- 向き ---
    // 進行方向をベースに、ボードの向きへ少しだけ寄せる。
    // 完全にボード追従にすると、スピン中に画面が回りすぎて酔う。
    const velYaw = rider.speed > 2.5
      ? Math.atan2(rider.vel[0], rider.vel[2])
      : rider.yaw;
    let aimYaw = velYaw + angleDelta(velYaw, rider.yaw) * 0.28;
    const follow = wipe ? 1.6 : lerp(4.6, 2.6, sn);
    this.yaw = dampAngle(this.yaw, aimYaw, follow, dt);

    // --- 距離と高さ ---
    const modeDist = [1, 0.72, 0.4][this.mode];
    const modeHeight = [1, 0.85, 0.62][this.mode];
    let dist = (CAM.DIST + CAM.DIST_SPEED * sn) * modeDist;
    let hgt = (CAM.HEIGHT + 0.5 * sn) * modeHeight;

    this._landDip = damp(this._landDip, 0, 6.5, dt);
    hgt -= this._landDip * 0.55;
    dist -= this._landDip * 0.5;

    if (wipe) { dist += 2.5; hgt += 1.4; }

    // --- 位置 ---
    const bx = Math.sin(this.yaw), bz = Math.cos(this.yaw);
    let px = rider.pos[0] - bx * dist;
    let pz = rider.pos[2] - bz * dist;
    let py = rider.pos[1] + hgt;

    // 空中では少し引いて、飛距離が見えるようにする
    py += clamp(rider.airHeight * 0.28, 0, 3.2);

    // 地面へめり込まない
    const groundY = Terrain.height(px, pz) + 1.35;
    if (py < groundY) py = groundY;

    const rate = wipe ? 6 : lerp(11, 7.5, sn);
    this.pos[0] = damp(this.pos[0], px, rate, dt);
    this.pos[1] = damp(this.pos[1], py, rate * 1.15, dt);
    this.pos[2] = damp(this.pos[2], pz, rate, dt);

    // --- 注視点。少し先を見る ---
    const ahead = CAM.LOOK_AHEAD * (0.55 + 0.45 * sn);
    const tx = rider.pos[0] + bx * ahead;
    const tz = rider.pos[2] + bz * ahead;
    const ty = rider.pos[1] + 0.9 - ahead * 0.14;
    this.target[0] = damp(this.target[0], tx, 9, dt);
    this.target[1] = damp(this.target[1], ty, 7, dt);
    this.target[2] = damp(this.target[2], tz, 9, dt);

    // --- ロール（バンク）---
    const bank = -rider.edge * CAM.BANK * clamp01(rider.speed / 12);
    this.roll = damp(this.roll, bank + rider.wobble * 0.06 * Math.sin(this._shakeT * 9.1), 5, dt);

    // --- 揺れ ---
    this._shakeT += dt * 60;
    this.shake = damp(this.shake, 0, 3.4, dt);
    const chatterShake = rider.chatter * 0.5 + rider.wobble * 0.35;
    const amp = (this.shake * 0.14 + chatterShake * 0.055) * (wipe ? 2.2 : 1);
    const sx = Math.sin(this._shakeT * 1.7) * Math.sin(this._shakeT * 0.61) * amp;
    const sy = Math.sin(this._shakeT * 2.3 + 1.1) * Math.sin(this._shakeT * 0.43) * amp;

    // 手持ちのような微細な揺れ。止まっているときも画面が死なない。
    const idle = 0.018 * (1 - sn * 0.6);
    const hx = Math.sin(this._shakeT * 0.21) * idle;
    const hy = Math.sin(this._shakeT * 0.17 + 2.3) * idle;

    // --- 行列 ---
    const upX = Math.sin(this.roll), upY = Math.cos(this.roll);
    this.up[0] = upX * bz; this.up[1] = upY; this.up[2] = -upX * bx;

    const eye = _eye;
    eye[0] = this.pos[0] + sx + hx;
    eye[1] = this.pos[1] + sy + hy;
    eye[2] = this.pos[2];

    this.fov = damp(this.fov, CAM.FOV + CAM.FOV_SPEED * sn * sn +
      (wipe ? 6 * DEG : 0) + rider.flow * 2.5 * DEG, 3.5, dt);

    M4.lookAt(this.view, eye, this.target, this.up);
    M4.perspective(this.proj, this.fov, aspect, 0.35, 3200);
    M4.multiply(this.viewProj, this.proj, this.view);
    M4.invert(this.invViewProj, this.viewProj);

    this.eye = eye;
    return this;
  }
}

const _eye = [0, 0, 0];
