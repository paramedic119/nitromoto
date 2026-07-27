// 手続き的なメッシュ。外部アセットは一切使わない。
// 箱・円柱・円錐だけを組み合わせて、木・ライダー・小物を作る。

import { TAU, clamp01, lerp } from '../core/math.js';

/* ------------------------------------------------------- ビルダー */

// 頂点: px py pz  nx ny nz  r g b  ao/bone
const STRIDE = 10;

export class MeshBuilder {
  constructor() {
    this.v = [];
    this.i = [];
    this.mat = [1, 1, 1];
    this.ao = 0;
    this.bone = 0;
    // 変換スタック（単純な平行移動・回転・スケールだけ）
    this.tx = 0; this.ty = 0; this.tz = 0;
    this.ryaw = 0;
    this.sx = 1; this.sy = 1; this.sz = 1;
  }

  color(r, g, b) { this.mat[0] = r; this.mat[1] = g; this.mat[2] = b; return this; }
  setAO(a) { this.ao = a; return this; }
  setBone(b) { this.bone = b; return this; }

  vert(px, py, pz, nx, ny, nz) {
    this.v.push(px, py, pz, nx, ny, nz, this.mat[0], this.mat[1], this.mat[2],
      this.bone || this.ao);
    return this.v.length / STRIDE - 1;
  }

  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }

  /** 中心 (cx,cy,cz)、半サイズ (hx,hy,hz) の箱。上面だけ別色にできる。 */
  box(cx, cy, cz, hx, hy, hz, topColor) {
    const F = [
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
      [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
      [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
      [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    ];
    const saved = this.mat.slice();
    for (let f = 0; f < 6; f++) {
      const [n, corners] = F[f];
      if (f === 4 && topColor) this.color(topColor[0], topColor[1], topColor[2]);
      const idx = corners.map(([ax, ay, az]) =>
        this.vert(cx + ax * hx, cy + ay * hy, cz + az * hz, n[0], n[1], n[2]));
      this.quad(idx[0], idx[1], idx[2], idx[3]);
      if (f === 4 && topColor) this.color(saved[0], saved[1], saved[2]);
    }
    return this;
  }

  /** Y 軸まわりの円柱（上下の半径を変えられる＝円錐台）。 */
  cylinder(cx, cy, cz, r0, r1, h, seg = 8, capTop = true, capBottom = false, topColor) {
    const slope = (r0 - r1) / h;
    const ringA = [], ringB = [];
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nl = 1 / Math.hypot(1, slope);
      const nx = ca * nl, ny = slope * nl, nz = sa * nl;
      ringA.push(this.vert(cx + ca * r0, cy, cz + sa * r0, nx, ny, nz));
      ringB.push(this.vert(cx + ca * r1, cy + h, cz + sa * r1, nx, ny, nz));
    }
    for (let s = 0; s < seg; s++) this.quad(ringA[s], ringA[s + 1], ringB[s + 1], ringB[s]);

    const saved = this.mat.slice();
    if (capTop && r1 > 1e-4) {
      if (topColor) this.color(topColor[0], topColor[1], topColor[2]);
      const c = this.vert(cx, cy + h, cz, 0, 1, 0);
      const ring = [];
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * TAU;
        ring.push(this.vert(cx + Math.cos(a) * r1, cy + h, cz + Math.sin(a) * r1, 0, 1, 0));
      }
      for (let s = 0; s < seg; s++) this.tri(c, ring[s], ring[s + 1]);
      this.color(saved[0], saved[1], saved[2]);
    }
    if (capBottom && r0 > 1e-4) {
      const c = this.vert(cx, cy, cz, 0, -1, 0);
      const ring = [];
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * TAU;
        ring.push(this.vert(cx + Math.cos(a) * r0, cy, cz + Math.sin(a) * r0, 0, -1, 0));
      }
      for (let s = 0; s < seg; s++) this.tri(c, ring[s + 1], ring[s]);
    }
    return this;
  }

  /** 頂点が尖った円錐。針葉樹の枝の 1 段に使う。 */
  cone(cx, cy, cz, r, h, seg = 8, skirtColor) {
    const slope = r / h;
    const nl = 1 / Math.hypot(1, slope);
    const ring = [];
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * TAU;
      ring.push(this.vert(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r,
        Math.cos(a) * nl, slope * nl, Math.sin(a) * nl));
    }
    for (let s = 0; s < seg; s++) {
      const a = ((s + 0.5) / seg) * TAU;
      const apex = this.vert(cx, cy + h, cz, Math.cos(a) * nl * 0.35, 1, Math.sin(a) * nl * 0.35);
      this.tri(ring[s], apex, ring[s + 1]);
    }
    // 下面（見上げたときに抜けないように）
    const saved = this.mat.slice();
    if (skirtColor) this.color(skirtColor[0], skirtColor[1], skirtColor[2]);
    const c = this.vert(cx, cy, cz, 0, -1, 0);
    const ring2 = [];
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * TAU;
      ring2.push(this.vert(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r, 0, -1, 0));
    }
    for (let s = 0; s < seg; s++) this.tri(c, ring2[s + 1], ring2[s]);
    this.color(saved[0], saved[1], saved[2]);
    return this;
  }

  build() {
    return {
      vertices: new Float32Array(this.v),
      indices: this.v.length / STRIDE > 65535
        ? new Uint32Array(this.i) : new Uint16Array(this.i),
      count: this.i.length,
      stride: STRIDE * 4,
    };
  }
}

/* ------------------------------------------------------------ 木 */

// 正規化されたモミの木。高さ 1、半径 1。インスタンスごとにスケールする。
export function buildTreeMesh(kind = 0) {
  const b = new MeshBuilder();
  const needle = kind === 2 ? [0.13, 0.30, 0.19] : [0.10, 0.26, 0.16];
  const shade = [needle[0] * 0.6, needle[1] * 0.6, needle[2] * 0.62];
  const bark = [0.20, 0.145, 0.115];
  const snow = [0.93, 0.95, 1.0];

  // 幹
  b.color(bark[0], bark[1], bark[2]).setAO(0.35);
  b.cylinder(0, 0, 0, 0.09, 0.05, kind === 3 ? 0.42 : 0.30, 6, false, false);

  // 枝の段。下ほど広く、上ほど暗い影から明るい雪へ。
  const layers = kind === 3 ? 3 : kind === 2 ? 5 : 6;
  const y0 = kind === 3 ? 0.18 : 0.12;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = lerp(y0, 0.80, t * t * 0.72 + t * 0.28);
    const r = lerp(1.0, 0.16, t) * (kind === 2 ? 1.12 : 1.0);
    const h = lerp(0.34, 0.22, t);
    // 下の段ほど暗く（自己遮蔽）
    const k = lerp(0.55, 1.0, t);
    b.setAO(lerp(0.55, 0.05, t));
    b.color(lerp(shade[0], needle[0], k), lerp(shade[1], needle[1], k), lerp(shade[2], needle[2], k));
    b.cone(0, y, 0, r, h, kind === 3 ? 6 : 9, shade);
  }
  // てっぺんの雪
  b.setAO(0).color(snow[0], snow[1], snow[2]);
  b.cone(0, 0.86, 0, 0.13, 0.20, 7, snow);
  return b.build();
}

/* --------------------------------------------------------- ライダー */

export const BONE = {
  BOARD: 0, PELVIS: 1, TORSO: 2, HEAD: 3,
  ARM_L: 4, ARM_R: 5, LEG_F: 6, LEG_B: 7, BOOT_F: 8, BOOT_B: 9,
};
export const BONE_COUNT = 10;

/**
 * スノーボーダー。ボーン番号を頂点属性に持たせて 1 ドローで描く。
 * 服の色はシェーダ側で uTint と混ぜるので、ここでは陰影のベースだけ作る。
 */
export function buildRiderMesh() {
  const b = new MeshBuilder();
  const skin = [0.82, 0.62, 0.50];
  const dark = [0.13, 0.14, 0.17];
  const pants = [0.22, 0.24, 0.30];
  const boardTop = [0.14, 0.15, 0.19];
  const boardBase = [0.55, 0.58, 0.66];

  // --- ボード（1.52m）。ノーズとテールを少し反らせる ---
  b.setBone(BONE.BOARD);
  const L = 0.76, W = 0.145, T = 0.018;
  b.color(boardTop[0], boardTop[1], boardTop[2]);
  const segs = 7;
  for (let s = 0; s < segs; s++) {
    const z0 = -L + (2 * L * s) / segs;
    const z1 = -L + (2 * L * (s + 1)) / segs;
    const zc = (z0 + z1) * 0.5;
    const tt = Math.abs(zc / L);
    const rise = tt * tt * tt * 0.075;                 // ノーズ/テールの反り
    const w = W * (1 - 0.28 * tt * tt) * (1 + 0.10 * (1 - tt));  // サイドカット
    b.box(0, rise + T, zc, w, T, (z1 - z0) * 0.5,
      s === 3 ? [0.85, 0.30, 0.22] : undefined);
  }
  // バインディング
  b.color(dark[0], dark[1], dark[2]);
  b.box(0, 0.055, 0.20, 0.11, 0.030, 0.10);
  b.box(0, 0.055, -0.20, 0.11, 0.030, 0.10);
  // 滑走面（下から見たとき）
  b.color(boardBase[0], boardBase[1], boardBase[2]);
  b.box(0, T * 0.4, 0, W * 0.92, T * 0.5, L * 0.94);

  // --- ブーツ ---
  b.color(dark[0], dark[1], dark[2]);
  b.setBone(BONE.BOOT_F); b.box(0, 0.10, 0, 0.076, 0.10, 0.115);
  b.setBone(BONE.BOOT_B); b.box(0, 0.10, 0, 0.076, 0.10, 0.115);

  // --- 脚。太もも側をわずかに太くして人らしく見せる ---
  b.color(pants[0], pants[1], pants[2]);
  b.setBone(BONE.LEG_F);
  b.box(0, 0.16, 0, 0.079, 0.18, 0.093);
  b.box(0, 0.42, 0, 0.093, 0.14, 0.102);
  b.setBone(BONE.LEG_B);
  b.box(0, 0.16, 0, 0.079, 0.18, 0.093);
  b.box(0, 0.42, 0, 0.093, 0.14, 0.102);

  // --- 腰と胴（uTint が乗る部分は白めにしておく）---
  b.setBone(BONE.PELVIS);
  b.color(pants[0] * 1.15, pants[1] * 1.15, pants[2] * 1.15);
  b.box(0, 0.07, 0, 0.145, 0.10, 0.125);

  b.setBone(BONE.TORSO);
  b.color(1, 1, 1);                                   // ジャケット = uTint
  b.box(0, 0.26, 0, 0.152, 0.25, 0.118);
  b.box(0, 0.47, 0, 0.175, 0.055, 0.125);             // 肩
  b.color(0.86, 0.87, 0.90);
  b.box(0, 0.535, 0, 0.098, 0.045, 0.088);            // 襟

  // --- 頭（ヘルメット + ゴーグル）---
  b.setBone(BONE.HEAD);
  b.color(0.16, 0.17, 0.21);
  b.cylinder(0, 0, 0, 0.108, 0.092, 0.175, 9, true, true);
  b.color(0.35, 0.72, 0.85);                          // ゴーグル
  b.box(0, 0.10, 0.092, 0.092, 0.038, 0.024);

  // --- 腕 ---
  b.color(1, 1, 1);
  b.setBone(BONE.ARM_L); b.box(0, -0.19, 0, 0.058, 0.21, 0.063);
  b.setBone(BONE.ARM_R); b.box(0, -0.19, 0, 0.058, 0.21, 0.063);
  b.color(0.20, 0.21, 0.25);
  b.setBone(BONE.ARM_L); b.box(0, -0.43, 0, 0.058, 0.05, 0.063);   // グローブ
  b.setBone(BONE.ARM_R); b.box(0, -0.43, 0, 0.058, 0.05, 0.063);

  return b.build();
}

/* ------------------------------------------------------------ 小物 */

function poleMesh() {
  const b = new MeshBuilder();
  // 竹ポール。赤白のしま。
  const n = 5;
  for (let i = 0; i < n; i++) {
    const y = i * 0.34;
    if (i % 2 === 0) b.color(0.82, 0.20, 0.18); else b.color(0.95, 0.95, 0.97);
    b.cylinder(0, y, 0, 0.026, 0.024, 0.34, 5, i === n - 1, false);
  }
  return b.build();
}

function signMesh() {
  const b = new MeshBuilder();
  b.color(0.30, 0.24, 0.18).cylinder(0, 0, 0, 0.055, 0.05, 1.5, 6, false, false);
  b.color(0.95, 0.96, 0.98).box(0, 1.72, 0.03, 0.42, 0.26, 0.035);
  b.color(0.15, 0.42, 0.70).box(0, 1.72, 0.07, 0.34, 0.19, 0.01);
  b.color(0.92, 0.94, 1.0).box(0, 1.99, 0.03, 0.44, 0.035, 0.05);  // 屋根の雪
  return b.build();
}

function fenceMesh() {
  const b = new MeshBuilder();
  b.color(0.34, 0.26, 0.19);
  b.cylinder(0, 0, -1.0, 0.05, 0.045, 1.15, 5, true, false);
  b.cylinder(0, 0, 1.0, 0.05, 0.045, 1.15, 5, true, false);
  b.box(0, 0.95, 0, 0.035, 0.055, 1.0);
  b.box(0, 0.60, 0, 0.035, 0.05, 1.0);
  b.color(0.94, 0.96, 1.0).box(0, 1.02, 0, 0.045, 0.022, 1.0);     // 雪
  return b.build();
}

function rockMesh() {
  const b = new MeshBuilder();
  // 粗い多面体の岩。上面に雪を載せる。
  const rock = [0.30, 0.29, 0.31];
  const seg = 7, rings = 4;
  const pts = [];
  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = v * Math.PI * 0.5;
    const row = [];
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * TAU;
      // 決定論的な凹凸
      const wob = 0.78 + 0.30 * Math.sin(a * 3 + r * 1.7) * Math.cos(v * 5.1 + a);
      const rr = Math.cos(phi) * wob;
      const yy = Math.sin(phi) * wob * 0.72;
      row.push([Math.cos(a) * rr, yy, Math.sin(a) * rr]);
    }
    pts.push(row);
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const p00 = pts[r][s], p10 = pts[r][s + 1], p01 = pts[r + 1][s], p11 = pts[r + 1][s + 1];
      // 面法線（フラットシェーディングで岩らしく）
      const ux = p10[0] - p00[0], uy = p10[1] - p00[1], uz = p10[2] - p00[2];
      const vx = p01[0] - p00[0], vy = p01[1] - p00[1], vz = p01[2] - p00[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const il = 1 / (Math.hypot(nx, ny, nz) || 1); nx *= il; ny *= il; nz *= il;
      const snowy = clamp01((ny - 0.35) / 0.45) * clamp01((p00[1] + 0.1) * 2);
      b.color(lerp(rock[0], 0.94, snowy), lerp(rock[1], 0.96, snowy), lerp(rock[2], 1.0, snowy));
      b.setAO(0.25 * (1 - snowy));
      const a = b.vert(p00[0], p00[1], p00[2], nx, ny, nz);
      const c = b.vert(p10[0], p10[1], p10[2], nx, ny, nz);
      const d = b.vert(p11[0], p11[1], p11[2], nx, ny, nz);
      const e = b.vert(p01[0], p01[1], p01[2], nx, ny, nz);
      b.quad(a, c, d, e);
    }
  }
  return b.build();
}

function flagMesh() {
  const b = new MeshBuilder();
  b.color(0.85, 0.85, 0.88).cylinder(0, 0, 0, 0.022, 0.02, 1.35, 5, true, false);
  b.color(0.95, 0.72, 0.10);
  const a = b.vert(0, 1.32, 0, 0, 0, 1);
  const c = b.vert(0, 0.86, 0, 0, 0, 1);
  const d = b.vert(0.55, 1.12, 0.06, 0, 0, 1);
  b.tri(a, c, d); b.tri(a, d, c);
  return b.build();
}

function liftTowerMesh() {
  const b = new MeshBuilder();
  const steel = [0.42, 0.45, 0.50];
  b.color(steel[0], steel[1], steel[2]);
  b.cylinder(0, 0, 0, 0.42, 0.24, 11.5, 7, false, false);
  // クロスアーム
  b.box(0, 11.6, 0, 1.9, 0.13, 0.16);
  b.color(0.30, 0.32, 0.36);
  b.box(-1.7, 11.35, 0, 0.16, 0.22, 0.20);
  b.box(1.7, 11.35, 0, 0.16, 0.22, 0.20);
  b.color(0.95, 0.96, 1.0).box(0, 11.78, 0, 1.95, 0.05, 0.18);    // 積もった雪
  return b.build();
}

function lodgeMesh() {
  const b = new MeshBuilder();
  const wall = [0.35, 0.24, 0.17];
  b.color(wall[0], wall[1], wall[2]);
  b.box(0, 1.5, 0, 3.2, 1.5, 2.4);
  // 切妻屋根（2 枚の傾いた箱で作る）
  b.color(0.90, 0.93, 0.99);
  const rh = 1.5;
  for (const s of [-1, 1]) {
    const idx = [];
    const pts = [
      [s * 3.6, 3.0, -2.8], [s * 3.6, 3.0, 2.8], [0, 3.0 + rh, 2.8], [0, 3.0 + rh, -2.8],
    ];
    const nl = 1 / Math.hypot(rh, 3.6);
    for (const p of pts) idx.push(b.vert(p[0], p[1], p[2], s * rh * nl, 3.6 * nl, 0));
    b.quad(idx[0], idx[1], idx[2], idx[3]);
  }
  // 妻壁
  b.color(wall[0] * 0.9, wall[1] * 0.9, wall[2] * 0.9);
  for (const z of [-2.79, 2.79]) {
    const n = z > 0 ? 1 : -1;
    const a = b.vert(-3.2, 3.0, z, 0, 0, n);
    const c = b.vert(3.2, 3.0, z, 0, 0, n);
    const d = b.vert(0, 3.0 + rh, z, 0, 0, n);
    if (n > 0) b.tri(a, c, d); else b.tri(a, d, c);
  }
  // 窓
  b.color(0.98, 0.80, 0.42);
  b.box(-1.4, 1.7, 2.42, 0.5, 0.42, 0.04);
  b.box(1.4, 1.7, 2.42, 0.5, 0.42, 0.04);
  return b.build();
}

export function buildPropMeshes() {
  return [liftTowerMesh(), signMesh(), poleMesh(), fenceMesh(), rockMesh(), flagMesh(), lodgeMesh()];
}
