// パーティクル。CPU で回して 1 本のインスタンスバッファに詰める。
// エッジからの雪煙、パウダーのプルーム、着地の爆発、木を掠めたときの落雪、
// 舞う粉雪、高速時のコントレイル。ここの density が「速さ」の感じを決める。

import { createProgram, createBuffer, createVAO } from '../core/gl.js';
import { particleVS, particleFS } from './shaders.js';
import { clamp01, lerp } from '../core/math.js';

export const P = {
  SPRAY: 0,     // エッジが削る雪
  PLUME: 1,     // パウダーの巻き上げ
  BURST: 2,     // 着地・転倒の爆発
  PUFF: 3,      // 木の枝から落ちる雪
  DRIFT: 4,     // 環境の粉雪
  CONTRAIL: 5,  // 高速時に尾を引く
};

const MAX = 4200;
const STRIDE = 11;   // pos3 + data4 + color4

export class Particles {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, particleVS, particleFS, 'particles');

    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX);
    this.seed = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.count = 0;

    this.instances = new Float32Array(MAX * STRIDE);

    const corners = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
    this.cornerBuf = createBuffer(gl, gl.ARRAY_BUFFER, corners);
    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX * STRIDE * 4, gl.DYNAMIC_DRAW);

    const s = STRIDE * 4;
    this.vao = createVAO(gl, [
      { buffer: this.cornerBuf, loc: 0, size: 2 },
      { buffer: this.instBuf, loc: 1, size: 3, stride: s, offset: 0, divisor: 1 },
      { buffer: this.instBuf, loc: 2, size: 4, stride: s, offset: 12, divisor: 1 },
      { buffer: this.instBuf, loc: 3, size: 4, stride: s, offset: 28, divisor: 1 },
    ]);

    this.drawCount = 0;
    this._rng = 12345;
  }

  rand() {
    this._rng = (this._rng * 1664525 + 1013904223) >>> 0;
    return this._rng / 4294967296;
  }

  spawn(kind, x, y, z, vx, vy, vz, size, life, drag = 1.6) {
    let i;
    if (this.count < MAX) {
      i = this.count++;
    } else {
      // いっぱいなら一番古いものを潰す
      i = (this._rng >>> 8) % MAX;
      this._rng = (this._rng * 1664525 + 1013904223) >>> 0;
    }
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.size0[i] = size;
    this.kind[i] = kind;
    this.seed[i] = this.rand();
    this.drag[i] = drag;
  }

  update(dt, wind) {
    const { pos, vel, life, size, kind, drag } = this;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        // 末尾と入れ替えて詰める
        n--;
        if (i !== n) {
          for (let k = 0; k < 3; k++) {
            pos[i * 3 + k] = pos[n * 3 + k];
            vel[i * 3 + k] = vel[n * 3 + k];
          }
          life[i] = life[n]; this.maxLife[i] = this.maxLife[n];
          size[i] = size[n]; this.size0[i] = this.size0[n];
          kind[i] = kind[n]; this.seed[i] = this.seed[n]; drag[i] = drag[n];
        }
        i--;
        continue;
      }
      const k = kind[i];
      const g = k === P.DRIFT ? -0.35 : k === P.CONTRAIL ? -0.15 : -3.6;
      const d = Math.exp(-drag[i] * dt);
      vel[i * 3] = vel[i * 3] * d + wind * dt * 0.6;
      vel[i * 3 + 1] = (vel[i * 3 + 1] + g * dt) * d;
      vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      // 雪煙は広がりながら薄くなる
      size[i] += this.size0[i] * (k === P.SPRAY ? 2.1 : k === P.PLUME ? 2.6 : 1.2) * dt;
    }
    this.count = n;
  }

  /** インスタンスバッファを詰めて描画する。 */
  draw(gl, viewProj, camRight, camUp, camPos, sunDir, sunColor, fogDensity, fogHeight) {
    const n = this.count;
    if (!n) { this.drawCount = 0; return; }
    const inst = this.instances;
    let p = 0;
    for (let i = 0; i < n; i++) {
      const t = clamp01(this.life[i] / this.maxLife[i]);
      const k = this.kind[i];
      inst[p++] = this.pos[i * 3];
      inst[p++] = this.pos[i * 3 + 1];
      inst[p++] = this.pos[i * 3 + 2];
      inst[p++] = this.size[i];
      inst[p++] = t;
      inst[p++] = k;
      inst[p++] = this.seed[i];
      // 色。雪は白だが、影側は青く、舞う粉雪は透ける。
      let a;
      switch (k) {
        case P.SPRAY: a = t * t * 0.62; break;
        case P.PLUME: a = Math.sin(t * Math.PI) * 0.50; break;
        case P.BURST: a = t * 0.78; break;
        case P.PUFF: a = t * 0.55; break;
        case P.DRIFT: a = Math.sin(t * Math.PI) * 0.30; break;
        default: a = t * t * 0.22; break;
      }
      const blue = k === P.DRIFT ? 0.06 : 0.03 * (1 - t);
      inst[p++] = 0.97 - blue * 0.6;
      inst[p++] = 0.98 - blue * 0.3;
      inst[p++] = 1.0;
      inst[p++] = a;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, n * STRIDE);

    const pr = this.prog;
    pr.use();
    gl.uniformMatrix4fv(pr.u.uViewProj, false, viewProj);
    gl.uniform3fv(pr.u.uCamRight, camRight);
    gl.uniform3fv(pr.u.uCamUp, camUp);
    gl.uniform3fv(pr.u.uCamPos, camPos);
    gl.uniform3fv(pr.u.uSunDir, sunDir);
    gl.uniform3fv(pr.u.uSunColor, sunColor);
    gl.uniform1f(pr.u.uFogDensity, fogDensity);
    gl.uniform1f(pr.u.uFogHeight, fogHeight);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.drawCount = n;
  }

  clear() { this.count = 0; }
}

/* ------------------------------------------------ 発生パターン */

/**
 * ライダーから出る雪煙。エッジ角・速度・雪質で見え方が変わる。
 * これが「今どれくらい削っているか」の一番わかりやすい手がかりになる。
 */
export function emitRide(parts, rider, dt, acc) {
  if (!rider.grounded) return acc;
  const sp = rider.speed;
  if (sp < 2.5) return acc;

  const edge = Math.abs(rider.edge);
  const skid = rider.skidNorm;
  const powder = rider.powder;

  // 1 秒あたりの発生数
  const rate = (edge * 26 + skid * 90 + powder * sp * 3.4) * clamp01(sp / 9);
  acc += rate * dt;
  const n = Math.floor(acc);
  acc -= n;

  const yaw = rider.yaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  // エッジの向き（削っている側）
  const side = -Math.sign(rider.edge || 1);
  const strength = clamp01(edge * 0.8 + skid * 1.4) * clamp01(sp / 14);

  for (let i = 0; i < n; i++) {
    const t = parts.rand();
    // 板に沿った位置。左右 2 枚のどちらかから出る（外足のほうが多い）。
    const along = (t - 0.5) * 1.5;
    const ski = parts.rand() < 0.72 ? side : -side;
    const ox = fx * along + rx * (side * 0.10 + ski * 0.17);
    const oz = fz * along + rz * (side * 0.10 + ski * 0.17);
    const spread = 0.9 + strength * 2.6;
    const up = 0.9 + strength * 4.6 + powder * sp * 0.22;
    parts.spawn(
      powder > 0.5 ? 1 : 0,
      rider.pos[0] + ox, rider.pos[1] + 0.05, rider.pos[2] + oz,
      -fx * sp * 0.14 + rx * side * (0.6 + parts.rand() * spread) + (parts.rand() - 0.5) * 1.2,
      up * (0.35 + parts.rand() * 0.9),
      -fz * sp * 0.14 + rz * side * (0.6 + parts.rand() * spread) + (parts.rand() - 0.5) * 1.2,
      0.16 + parts.rand() * (0.22 + powder * 0.4),
      0.42 + parts.rand() * (0.7 + powder * 0.9),
      1.5,
    );
  }
  return acc;
}

/** 着地・転倒の爆発 */
export function emitBurst(parts, x, y, z, power, dirX = 0, dirZ = 0) {
  const n = Math.min(160, Math.floor(14 + power * 14));
  for (let i = 0; i < n; i++) {
    const a = parts.rand() * Math.PI * 2;
    const r = parts.rand();
    const sp = (1.4 + power * 1.5) * (0.35 + r * 1.0);
    parts.spawn(P.BURST, x, y + 0.08, z,
      Math.cos(a) * sp + dirX * 0.35,
      (0.7 + parts.rand() * 2.4) * (0.5 + power * 0.28),
      Math.sin(a) * sp + dirZ * 0.35,
      0.18 + parts.rand() * 0.35,
      0.45 + parts.rand() * 0.85, 1.9);
  }
}

/** 木を掠めたときに枝から落ちる雪 */
export function emitPuff(parts, x, y, z, power) {
  const n = Math.min(70, 10 + Math.floor(power * 4));
  for (let i = 0; i < n; i++) {
    parts.spawn(P.PUFF,
      x + (parts.rand() - 0.5) * 1.6, y + 1.2 + parts.rand() * 4.5, z + (parts.rand() - 0.5) * 1.6,
      (parts.rand() - 0.5) * 1.2, -0.4 - parts.rand() * 1.4, (parts.rand() - 0.5) * 1.2,
      0.2 + parts.rand() * 0.4, 0.9 + parts.rand() * 1.2, 0.9);
  }
}

/**
 * 高速時のコントレイル。板の後ろに細い雪煙の尾が残る。
 * 速度の手応えは HUD の数字より、こういう「置いていかれるもの」で伝わる。
 */
export function emitContrail(parts, rider, dt, acc) {
  if (!rider.grounded && rider.airHeight > 3) return acc;
  const sp = rider.speed;
  if (sp < 17) return acc;
  const strength = clamp01((sp - 17) / 13);
  acc += strength * 44 * dt;
  const n = Math.floor(acc);
  acc -= n;
  const yaw = rider.yaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (let i = 0; i < n; i++) {
    const back = 0.8 + parts.rand() * 1.4;
    parts.spawn(P.CONTRAIL,
      rider.pos[0] - fx * back + (parts.rand() - 0.5) * 0.7,
      rider.pos[1] + 0.1 + parts.rand() * 0.55,
      rider.pos[2] - fz * back + (parts.rand() - 0.5) * 0.7,
      -fx * sp * 0.10 + (parts.rand() - 0.5) * 0.9,
      0.25 + parts.rand() * 0.7,
      -fz * sp * 0.10 + (parts.rand() - 0.5) * 0.9,
      0.10 + parts.rand() * 0.16,
      0.55 + parts.rand() * 0.65 * strength,
      0.7);
  }
  return acc;
}

/** 環境の粉雪。カメラのまわりにゆっくり供給し続ける。 */
export function emitDrift(parts, camX, camY, camZ, dt, acc, wind) {
  acc += 13 * dt;
  const n = Math.floor(acc);
  acc -= n;
  for (let i = 0; i < n; i++) {
    parts.spawn(P.DRIFT,
      camX + (parts.rand() - 0.5) * 90,
      camY + 2 + parts.rand() * 26,
      camZ + (parts.rand() - 0.35) * 90,
      wind * (0.6 + parts.rand()), -0.25 - parts.rand() * 0.5, (parts.rand() - 0.5) * 1.2,
      0.045 + parts.rand() * 0.06, 3.5 + parts.rand() * 3.5, 0.25);
  }
  return acc;
}
