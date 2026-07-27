// 「地元の人たち」。サーバに繋がっていなくても、山に誰かがいる。
//
// 完全な物理は回さない。落下線に沿って振り子のようにターンしながら降りるだけ。
// それでも遠目には十分に「滑っている」ように見える。たまに転ぶし、たまに飛ぶ。

import * as Terrain from '../world/terrain.js';
import { clamp, clamp01, lerp, damp, angleDelta, TAU } from '../core/math.js';
import { Rng } from '../core/rng.js';

const NAMES = [
  'ゆき', 'カズ', 'みなと', 'Tomo', 'なぎ', 'ハル', 'リオ', 'ケン',
  'あお', 'しの', 'Yuki', 'そら', 'まお', 'Rin', 'たく', 'こはる',
];

const TINTS = [
  [0.95, 0.55, 0.20], [0.30, 0.66, 0.92], [0.85, 0.32, 0.48], [0.42, 0.80, 0.55],
  [0.96, 0.80, 0.25], [0.62, 0.45, 0.88], [0.25, 0.78, 0.78], [0.92, 0.42, 0.28],
];

const _fl = [0, 0, 1];
const _n = [0, 1, 0];

class Local {
  constructor(seed, index) {
    this.rng = new Rng(seed * 7919 + index * 104729 + 13);
    this.id = `local${index}`;
    this.name = NAMES[(index * 5 + seed) % NAMES.length];
    this.tint = TINTS[index % TINTS.length];
    this.skill = 0.35 + this.rng.next() * 0.62;
    this.phase = this.rng.next() * TAU;
    this.turnRate = 0.16 + this.rng.next() * 0.24;
    this.amp = 0.42 + this.rng.next() * 0.62;
    this.lane = (this.rng.next() - 0.5) * 1.6;
    this.pos = [0, 0, 0];
    this.up = [0, 1, 0];
    this.yaw = 0;
    this.roll = 0;
    this.edge = 0;
    this.crouch = 0.1;
    this.grab = 0;
    this.wobble = 0;
    this.tumble = 0;
    this.spinRate = 0;
    this.grounded = true;
    this.speed = 0;
    this.vy = 0;
    this.distance = 0;
    this.down = false;
    this.downTimer = 0;
    this.animT = this.rng.next() * 100;
    this.visible = false;
    this.reset(0);
  }

  reset(startZ) {
    // 基本は前方に配置する。真後ろから追い抜かれ続けると画面がうるさい。
    const z = startZ + this.rng.range(-70, 320);
    const x = Terrain.trailCenterX(z) + this.lane * Terrain.trailHalfWidth(z) * 0.8;
    this.pos[0] = x;
    this.pos[2] = z;
    this.pos[1] = Terrain.height(x, z);
    this.speed = 6 + this.rng.next() * 6;
    this.yaw = 0;
    this.vy = 0;
    this.distance = Math.max(0, z);
    this.down = false;
    this.downTimer = 0;
    this.tumble = 0;
  }

  step(dt, playerZ) {
    this.animT += dt;

    if (this.down) {
      this.downTimer -= dt;
      this.tumble += dt * 4.5;
      this.speed = damp(this.speed, 0, 3, dt);
      this.pos[0] += Math.sin(this.yaw) * this.speed * dt;
      this.pos[2] += Math.cos(this.yaw) * this.speed * dt;
      this.pos[1] = Terrain.height(this.pos[0], this.pos[2]);
      if (this.downTimer <= 0) this.reset(playerZ + 40);
      return;
    }

    // --- 目標の向き: 落下線のまわりを振り子のように ---
    Terrain.fallLine(this.pos[0], this.pos[2], _fl);
    const fallYaw = Math.atan2(_fl[0], _fl[2]);
    const cx = Terrain.trailCenterX(this.pos[2]);
    const hw = Terrain.trailHalfWidth(this.pos[2]);
    const off = this.pos[0] - cx - this.lane * hw * 0.8;
    const bias = clamp(-off / Math.max(hw, 12) * 0.7, -1.0, 1.0);
    const wave = Math.sin(this.animT * this.turnRate * TAU + this.phase);
    const want = fallYaw + wave * this.amp + bias;

    const turn = angleDelta(this.yaw, want);
    this.yaw += clamp(turn * 2.2, -1.8, 1.8) * dt;

    // --- 速度。腕の差がそのまま出る ---
    const pitch = Terrain.pitchAt(this.pos[2]);
    const target = (7 + this.skill * 19) * (0.55 + pitch * 1.5)
      * (1 - Math.abs(wave) * 0.22);
    this.speed = damp(this.speed, target, 1.1, dt);

    this.pos[0] += Math.sin(this.yaw) * this.speed * dt;
    this.pos[2] += Math.cos(this.yaw) * this.speed * dt;

    // --- 接地 ---
    const ty = Terrain.height(this.pos[0], this.pos[2]);
    if (this.pos[1] < ty + 0.05 || this.vy <= 0 && this.pos[1] <= ty) {
      this.pos[1] = ty;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.vy -= 20.5 * dt;
      this.pos[1] += this.vy * dt;
      if (this.pos[1] <= ty) { this.pos[1] = ty; this.vy = 0; this.grounded = true; }
      else this.grounded = false;
    }
    // たまに飛ぶ
    if (this.grounded && this.rng.next() < dt * 0.10 * this.skill) {
      this.vy = 3 + this.rng.next() * 3.5;
      this.pos[1] += 0.05;
      this.grounded = false;
    }

    Terrain.normal(this.pos[0], this.pos[2], _n);
    this.up[0] = damp(this.up[0], _n[0], 9, dt);
    this.up[1] = damp(this.up[1], _n[1], 9, dt);
    this.up[2] = damp(this.up[2], _n[2], 9, dt);

    this.edge = damp(this.edge, clamp(-turn * 1.5, -1, 1) * clamp01(this.speed / 10), 8, dt);
    this.roll = damp(this.roll, -this.edge * 0.85, 9, dt);
    this.crouch = 0.1 + (this.grounded ? 0 : 0.35);
    this.grab = this.grounded ? 0 : clamp01((this.rng.s % 97) / 97);
    this.distance = Math.max(this.distance, this.pos[2]);

    // --- たまに転ぶ。下手なほどよく転ぶ ---
    if (this.grounded && this.rng.next() < dt * 0.012 * (1.4 - this.skill)) {
      this.down = true;
      this.downTimer = 2.2;
      this.distance = 0;
    }

    // --- プレイヤーから離れすぎたら前へ戻す ---
    const rel = this.pos[2] - playerZ;
    if (rel < -180 || rel > 620) this.reset(playerZ + 30);
  }
}

export class Locals {
  constructor(seed = 1, count = 7) {
    this.list = [];
    for (let i = 0; i < count; i++) this.list.push(new Local(seed, i));
  }

  update(dt, playerZ, camX, camZ) {
    for (const l of this.list) {
      l.step(dt, playerZ);
      const dx = l.pos[0] - camX, dz = l.pos[2] - camZ;
      l.visible = dx * dx + dz * dz < 620 * 620;
    }
  }
}
