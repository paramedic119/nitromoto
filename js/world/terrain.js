// 山。すべて解析的・決定論的な純関数。GL にも DOM にも依存しない。
//
// 座標系:  Y が上。ライダーは +Z 方向へ滑り降りる。distance = z（メートル）。
// 高さは z が増えるほど下がる。全クライアントが同じシードから同じ山を得る。
//
// 高速化の要:  高さ関数のうち z だけに依存する部分（斜度・トレイル中心・ゾーン・段差・
// サイド路）を「プロファイル」として 1 エントリだけキャッシュする。メッシュ生成は
// 行優先（z 固定で x を走査）なので、実質 1 行に 1 回しか計算しない。

import { hash2i, noise2, gradNoise2 } from '../core/rng.js';
import { clamp, clamp01, lerp, smoothstep, smootherstep, TAU } from '../core/math.js';

export const SEED = 20260727;

export const SURFACE = {
  GROOMED: 0,   // 圧雪
  POWDER: 1,    // 非圧雪
  ICE: 2,       // アイスバーン
  PARK: 3,      // パーク（締まった雪）
  ROCK: 4,      // 岩
};

export const ZONE = {
  OPEN: 0, GLADE: 1, PARK: 2, BOWL: 3, NARROWS: 4, MOGULS: 5,
};

export const ZONE_NAME = ['OPEN', 'GLADE', 'PARK', 'BOWL', 'NARROWS', 'MOGULS'];
export const ZONE_LABEL = ['オープンバーン', '樹林帯', 'テレインパーク', 'ボウル', 'キャットトラック', 'コブ斜面'];

// ゾーンごとのパラメータ。すべて数値なので境界でそのまま補間できる。
// width は「圧雪路の幅」の倍率であって、滑れる範囲の広さではない。
// ボウルは圧雪路を細くして、まわりを一面のパウダーにしてある。
const ZP = [
  { width: 1.15, trees: 0.26, mogul: 0.06, ice: 0.55, park: 0.0, ledge: 0.15, roll: 1.00, gully: 0.5 }, // OPEN
  { width: 0.58, trees: 1.00, mogul: 0.34, ice: 0.22, park: 0.0, ledge: 0.45, roll: 0.85, gully: 1.0 }, // GLADE
  { width: 1.05, trees: 0.10, mogul: 0.00, ice: 0.06, park: 1.0, ledge: 0.00, roll: 0.45, gully: 0.0 }, // PARK
  { width: 0.85, trees: 0.07, mogul: 0.14, ice: 0.40, park: 0.0, ledge: 0.85, roll: 1.55, gully: 0.2 }, // BOWL
  { width: 0.44, trees: 0.72, mogul: 0.10, ice: 0.80, park: 0.0, ledge: 1.00, roll: 0.55, gully: 0.3 }, // NARROWS
  { width: 0.75, trees: 0.32, mogul: 1.00, ice: 0.18, park: 0.0, ledge: 0.10, roll: 0.90, gully: 0.4 }, // MOGULS
];

const SEG = 380;          // ゾーン 1 区画の長さ(m)
const BLEND = 84;         // ゾーン境界のブレンド距離(m)

/* ------------------------------------------------------------ 基本斜面 */
// 斜度 pitch(z) を z で解析的に積分して高さを作る。急斜面 → 緩斜面のリズムが生まれる。

const P0 = 0.335, A1 = 0.085, L1 = 430, A2 = 0.055, L2 = 176, PH2 = 1.7, A3 = 0.022, L3 = 71, PH3 = 0.4;
const BASE_C = A1 * L1 + A2 * L2 * Math.cos(PH2) + A3 * L3 * Math.cos(PH3);

/** 落下線方向の斜度（tan）。おおよそ 0.14〜0.51。 */
export function pitchAt(z) {
  return P0 + A1 * Math.sin(z / L1) + A2 * Math.sin(z / L2 + PH2) + A3 * Math.sin(z / L3 + PH3);
}

export function baseHeight(z) {
  return -(P0 * z
    - A1 * L1 * Math.cos(z / L1)
    - A2 * L2 * Math.cos(z / L2 + PH2)
    - A3 * L3 * Math.cos(z / L3 + PH3)) - BASE_C;
}

/* --------------------------------------------------------- トレイル中心 */

/** メイン圧雪路の中心 X。ゆるやかに蛇行する。 */
export function trailCenterX(z) {
  return 62 * Math.sin(z / 395) + 27 * Math.sin(z / 152 + 2.1) + 10 * Math.sin(z / 63 + 0.9);
}

/** トレイルの向き（+Z からのずれ角, ラジアン）。 */
export function trailHeading(z) {
  const dx = (62 / 395) * Math.cos(z / 395)
    + (27 / 152) * Math.cos(z / 152 + 2.1)
    + (10 / 63) * Math.cos(z / 63 + 0.9);
  return Math.atan(dx);
}

/** 樹林帯を貫く裏ルートの中心 X（k = 0 が左、1 が右）。 */
export function sidePathX(z, k) {
  const sign = k === 0 ? -1 : 1;
  return trailCenterX(z) + sign * (56 + 19 * Math.sin(z / 118 + k * 2.37) + 8 * Math.sin(z / 47 + k));
}

/* -------------------------------------------------------------- ゾーン */

function zoneKindAt(i) {
  const h = hash2i(i, 0x5eed, SEED);
  const r = (h & 0xffff) / 65536;
  const prevRaw = (hash2i(i - 1, 0x5eed, SEED) & 0xffff) / 65536;
  let kind = pickKind(r);
  // 同じゾーンが延々続かないよう、直前と被ったら半々でずらす
  if (kind === pickKind(prevRaw) && ((h >>> 16) & 1)) kind = (kind + 1) % 6;
  return kind;
}

function pickKind(r) {
  if (r < 0.30) return ZONE.OPEN;
  if (r < 0.52) return ZONE.GLADE;
  if (r < 0.64) return ZONE.PARK;
  if (r < 0.80) return ZONE.BOWL;
  if (r < 0.90) return ZONE.NARROWS;
  return ZONE.MOGULS;
}

/* ------------------------------------------------------- z プロファイル */
// z だけで決まる値をまとめて 1 度だけ計算し、1 エントリキャッシュする。

const PROF = {
  z: NaN,
  base: 0, cx: 0, hw: 0, pitch: 0,
  kind: 0, other: 0, blend: 1, local: 0,
  width: 1, trees: 0, mogul: 0, ice: 0, park: 0, ledge: 0, roll: 1, gully: 0,
  ledgeSign: 0, ledgeEdge: 0, ledgeDrop: 0, ledgeFace: 0,
  side0: 0, side1: 0,
  mogSin: 0, mogCos: 0,
  wallStart: 0, groomE0: 0, lipZ: 0, rollAmt: 1, hCenter: 0, cxSlope: 0,
};

function buildProfile(z, P) {
  P.z = z;
  P.base = baseHeight(z);
  P.pitch = pitchAt(z);

  const cx = 62 * Math.sin(z / 395) + 27 * Math.sin(z / 152 + 2.1) + 10 * Math.sin(z / 63 + 0.9);
  P.cx = cx;
  // トレイルが z 方向にどれだけ横へ寄っていくか。圧雪面の傾け方に使う。
  P.cxSlope = (62 / 395) * Math.cos(z / 395)
    + (27 / 152) * Math.cos(z / 152 + 2.1)
    + (10 / 63) * Math.cos(z / 63 + 0.9);

  // --- ゾーン混合 ---
  const t = z / SEG;
  const i = Math.floor(t);
  const f = t - i;
  const half = BLEND * 0.5 / SEG;
  let kind = zoneKindAt(i);
  let other = kind;
  let w = 1;
  if (f < half) {
    other = zoneKindAt(i - 1);
    w = 0.5 + 0.5 * smootherstep(0, 1, f / half);
  } else if (f > 1 - half) {
    other = zoneKindAt(i + 1);
    w = 0.5 + 0.5 * smootherstep(0, 1, (1 - f) / half);
  }
  const a = ZP[kind], b = ZP[other];
  P.width = b.width + (a.width - b.width) * w;
  P.trees = b.trees + (a.trees - b.trees) * w;
  P.mogul = b.mogul + (a.mogul - b.mogul) * w;
  P.ice = b.ice + (a.ice - b.ice) * w;
  P.park = b.park + (a.park - b.park) * w;
  P.ledge = b.ledge + (a.ledge - b.ledge) * w;
  P.roll = b.roll + (a.roll - b.roll) * w;
  P.gully = b.gully + (a.gully - b.gully) * w;
  P.kind = w >= 0.5 ? kind : other;
  P.other = other;
  P.blend = w;
  P.local = f * SEG;

  // --- 圧雪路の幅 ---
  P.hw = clamp((26 + 11 * Math.sin(z / 217 + 1.3) + 5.5 * Math.sin(z / 79)) * P.width, 8, 48);
  P.wallStart = P.hw + 62 + 30 * P.width;
  P.groomE0 = P.hw + 7;              // ここから hw-3 までが圧雪の縁（幅 10m 固定）
  P.lipZ = 0.5 + 0.5 * Math.sin(z * 0.40);
  // 緩斜面ほどうねりを抑える。窪地ができにくくなり、見た目も自然。
  P.rollAmt = P.roll * (0.45 + 0.55 * smoothstep(0.15, 0.34, P.pitch));

  // --- 段差（キャットトラック / ボウルのドロップ）---
  if (P.ledge > 0.02) {
    P.ledgeSign = Math.tanh((Math.sin(z / 143 + 1.1) + 0.55 * Math.sin(z / 61)) * 2.2);
    P.ledgeEdge = 11 + 7 * Math.sin(z / 88 + 0.6) + P.hw * 0.35;
    P.ledgeDrop = (2.8 + 4.6 * (0.5 + 0.5 * Math.sin(z / 97 + 2.0))) * P.ledge;
    P.ledgeFace = 7.5 + (1.8 - 7.5) * P.ledge;
  } else {
    P.ledgeDrop = 0;
  }

  // --- サイド路 ---
  if (P.gully > 0.02) {
    P.side0 = cx - (56 + 19 * Math.sin(z / 118) + 8 * Math.sin(z / 47));
    P.side1 = cx + (56 + 19 * Math.sin(z / 118 + 2.37) + 8 * Math.sin(z / 47 + 1));
  }

  // --- コブの z 成分 ---
  if (P.mogul > 0.02) {
    const v = z / 5.6;
    P.mogSin = 0.26 * Math.sin(TAU * v);
    P.mogCos = (0.5 - 0.5 * Math.cos(TAU * v)) * smoothstep(0.20, 0.33, P.pitch);
  } else {
    P.mogCos = 0;
  }

  // 圧雪路をならすための基準高さ（トレイル中心の素の高さ）
  P.hCenter = heightShell(cx, P);
  return P;
}

/** z プロファイルを取得（1 エントリキャッシュ）。返るオブジェクトは使い回し。 */
export function profileAt(z) {
  if (PROF.z !== z) buildProfile(z, PROF);
  return PROF;
}

/** ゾーン情報（プロファイルと同一オブジェクト）。 */
export function zoneAt(z) { return profileAt(z); }

/** 圧雪路の半幅。 */
export function trailHalfWidth(z) { return profileAt(z).hw; }

/** 次に来るゾーンと、そこまでの距離。HUD の予告に使う。 */
export function nextZone(z) {
  const i = Math.floor(z / SEG);
  const cur = zoneKindAt(i);
  for (let k = 1; k < 6; k++) {
    const nk = zoneKindAt(i + k);
    if (nk !== cur) return { kind: nk, distance: (i + k) * SEG - z };
  }
  return { kind: cur, distance: (i + 6) * SEG - z };
}

/* ---------------------------------------------------------- フィーチャ */
// パークのキッカーとボックス。高さ場そのものを変形するので描画と物理が必ず一致する。

// ramp は短めにしてある。リップの角度 = 2h/ramp が跳ね上げ角になるため。
const KICKERS = [
  { z: 74, ramp: 10, table: 5, land: 21, h: 3.1, w: 9, off: 0 },
  { z: 154, ramp: 8, table: 3.5, land: 16, h: 2.2, w: 7, off: -15 },
  { z: 158, ramp: 9, table: 4, land: 18, h: 2.6, w: 7, off: 17 },
  { z: 236, ramp: 12, table: 7, land: 28, h: 4.2, w: 11, off: 2 },
  { z: 312, ramp: 7, table: 3, land: 14, h: 1.8, w: 15, off: 0 },
];

// ジブボックス。1m メッシュでも形が出るよう、実物より少し幅広にしてある。
const BOXES = [
  { z: 110, len: 13, h: 0.85, w: 2.3, off: -10 },
  { z: 196, len: 17, h: 1.20, w: 2.5, off: 9 },
  { z: 276, len: 15, h: 0.95, w: 2.2, off: -5 },
];

function kickerHeight(dz, dx, f) {
  if (dz < -2.5 || dz > f.ramp + f.table + f.land) return 0;
  const adx = dx < 0 ? -dx : dx;
  if (adx > f.w) return 0;
  const taper = smoothstep(f.w, f.w * 0.62, adx);
  let h;
  if (dz < 0) h = f.h * 0.03 * smoothstep(-2.5, 0, dz);
  else if (dz < f.ramp) { const t = dz / f.ramp; h = f.h * t * t; }
  else if (dz < f.ramp + f.table) h = f.h;
  else h = f.h * (1 - smootherstep(0, 1, (dz - f.ramp - f.table) / f.land));
  return h * taper;
}

function boxHeight(dz, dx, f) {
  if (dz < -3.5 || dz > f.len + 2.5) return 0;
  const adx = dx < 0 ? -dx : dx;
  if (adx > f.w) return 0;
  let h = f.h * smoothstep(f.w, f.w * 0.55, adx);
  if (dz < 0) h *= smoothstep(-3.5, 0, dz);
  else if (dz > f.len) h *= 1 - smoothstep(f.len, f.len + 2.5, dz);
  return h;
}

function parkFeatures(x, P) {
  const park = P.park;
  if (park < 0.02) return 0;
  const local = P.local;
  const rx = x - P.cx;
  let h = 0;
  for (let i = 0; i < KICKERS.length; i++) {
    const f = KICKERS[i];
    h += kickerHeight(local - f.z, rx - f.off, f);
  }
  for (let i = 0; i < BOXES.length; i++) {
    const f = BOXES[i];
    h += boxHeight(local - f.z, rx - f.off, f);
  }
  return h * park;
}

/* -------------------------------------------------------------- 高さ場 */

/**
 * 整地前の素の斜面。谷形状・大きなうねり・細かい凹凸・サイド路のガリーまで。
 * 圧雪路のならしとフィーチャ（コブ・リップ・段差・パーク）はこの後で足す。
 */
function heightShell(x, P) {
  const z = P.z;
  const dx = x - P.cx;
  const adx = dx < 0 ? -dx : dx;

  let h = P.base;

  // --- 谷形状。トレイルから離れるほど盛り上がり、自然な境界になる ---
  const a = adx - P.wallStart;
  if (a > 0) h += 0.036 * a * Math.sqrt(a);

  // --- 大きなうねり ---
  // 落下線(z)方向に強く引き伸ばした異方性ノイズ。
  // 山は必ず下っていなければならないので、z 方向の勾配は基本斜度より小さく抑える。
  // 逆に x 方向は自由に暴れさせてよく、それが尾根・ガリー・バンクになる。
  const roll = P.rollAmt;
  h += (gradNoise2(x * 0.0072, z * 0.00115, SEED + 11) * 5.4
    + gradNoise2(x * 0.0145, z * 0.00230, SEED + 12) * 2.3
    + gradNoise2(x * 0.0270, z * 0.00520, SEED + 13) * 1.0) * roll;

  // --- 圧雪路は高周波を均す。外は荒れる ---
  // groomed: adx が hw+7 で 0、hw-3 で 1（幅 10m 固定なので除算を畳んである）
  let gt = (P.groomE0 - adx) * 0.1;
  const groomed = gt <= 0 ? 0 : gt >= 1 ? 1 : gt * gt * (3 - 2 * gt);
  const rough = 1 - groomed * 0.86;
  h += noise2(x * 0.155, z * 0.155, SEED + 31) * 0.24 * rough;
  if (rough > 0.25) h += noise2(x * 0.44, z * 0.44, SEED + 37) * 0.10 * rough;

  // --- サイド路の浅いガリー ---
  if (P.gully > 0.02) {
    const d0 = Math.abs(x - P.side0), d1 = Math.abs(x - P.side1);
    const d = d0 < d1 ? d0 : d1;
    if (d < 11) h -= 1.5 * P.gully * smoothstep(11, 0, d);
  }

  return h;
}

/** プロファイルを与えて高さを求める（内部用の高速版）。 */
export function heightP(x, P) {
  const z = P.z;
  const dx = x - P.cx;
  const adx = dx < 0 ? -dx : dx;

  let h = heightShell(x, P);

  // --- 圧雪路のならし ---
  // ゲレンデは横方向にほぼ平ら（むしろ内側へわずかに凹む）ように圧される。
  // これが無いと、山の横断勾配に押し流されて、操作しないとコースに留まれない。
  // 「道がそこにある」という手応えは、この 1 段でほとんど決まる。
  let gt = (P.groomE0 - adx) * 0.1;
  const groomed = gt <= 0 ? 0 : gt >= 1 ? 1 : gt * gt * (3 - 2 * gt);
  if (groomed > 0.004) {
    // コースの落下線がコースの向きと揃うように、圧雪面を進行方向へ傾ける。
    // これをやらないと、蛇行するコースの上で「まっすぐ滑ると外へ流される」ことになる。
    const along = dx * P.cxSlope / (1 + P.cxSlope * P.cxSlope);
    const bank = 0.045 * dx * dx / P.hw;      // 外側がゆるく持ち上がる＝自然に留まる
    const target = P.hCenter - P.pitch * along + bank;
    h += (target - h) * groomed * 0.92;
  }

  // --- コブ（圧雪されない）---
  if (P.mogCos > 0) {
    const u = x / 6.3 + P.mogSin;
    const bump = (0.5 - 0.5 * Math.cos(TAU * u)) * P.mogCos;
    const mask = 0.72 + 0.28 * gradNoise2(x * 0.012, z * 0.012, SEED + 43);
    h += bump * 1.45 * P.mogul * mask;
  }

  // --- 段差 ---
  if (P.ledgeDrop > 0) {
    const signed = dx * P.ledgeSign;
    if (signed > P.ledgeEdge) {
      h -= P.ledgeDrop * smootherstep(P.ledgeEdge, P.ledgeEdge + P.ledgeFace, signed);
    }
  }

  // --- パーク ---
  if (P.park > 0.02) h += parkFeatures(x, P);

  // --- 自然のリップ（不意に飛べる凸） ---
  if (P.lipZ > 0.05) {
    const lipPhase = noise2(z * 0.0125, x * 0.0031, SEED + 53);
    if (lipPhase > 0.30) {
      h += smoothstep(0.30, 0.60, lipPhase) * 1.0 * P.lipZ;
    }
  }

  return h;
}

export function height(x, z) {
  return heightP(x, profileAt(z));
}

/* ------------------------------------------------------------- 法線 */

const NORMAL_EPS = 0.6;
const _n = [0, 1, 0];

export function normal(x, z, out = _n) {
  const e = NORMAL_EPS;
  const P = profileAt(z);                 // 中央の z（キャッシュに残る）
  const hL = heightP(x - e, P), hR = heightP(x + e, P);
  const hD = height(x, z - e);
  const hU = height(x, z + e);
  const nx = hL - hR, ny = 2 * e, nz = hD - hU;
  const inv = 1 / Math.hypot(nx, ny, nz);
  out[0] = nx * inv; out[1] = ny * inv; out[2] = nz * inv;
  return out;
}

/* ---------------------------------------------------------- サーフェス */

// 雪の抵抗は 2 成分に分ける。
//   mu   : 速度に依らない滑走摩擦係数（実際の雪は 0.03〜0.10）
//   plow : 雪を押しのける速度依存の抵抗（a = plow * v^2）。深雪ほど大きい。
// 単一の定数にすると、緩斜面のパウダーで完全に止まって二度と動けなくなる。
const SURF = {
  groomedGrip: 1.00, groomedMu: 0.042, groomedPlow: 0.0000,
  powderGrip: 0.74, powderMu: 0.062, powderPlow: 0.0215,
  iceGrip: 0.29, iceMu: 0.016, icePlow: 0.0000,
  parkGrip: 1.06, parkMu: 0.038, parkPlow: 0.0000,
};

const _sample = {
  y: 0, nx: 0, ny: 1, nz: 0,
  surface: SURFACE.GROOMED,
  grip: 1, mu: 0.042, plow: 0,
  groomed: 1, powder: 0, ice: 0, park: 0,
  zoneKind: 0, pitch: 0.3, cx: 0, halfWidth: 26, sidePath: 0,
};

/** サイド路への近さ 0..1（1 = 道の真ん中）。 */
export function sidePathAmount(x, z) {
  const P = profileAt(z);
  if (P.gully < 0.02) return 0;
  const d = Math.min(Math.abs(x - P.side0), Math.abs(x - P.side1));
  return smoothstep(11, 3.8, d) * P.gully;
}

/** 物理が必要とする情報をまとめて 1 回で返す。返るオブジェクトは使い回し。 */
export function sample(x, z, out = _sample) {
  const P = profileAt(z);
  // normal() が別の z のプロファイルを踏むので、必要な値は先に控える
  const hw = P.hw, pPark = P.park, pIce = P.ice, pitch = P.pitch, cx = P.cx, kind = P.kind;
  const gully = P.gully, side0 = P.side0, side1 = P.side1;
  const adx = Math.abs(x - cx);

  out.y = heightP(x, P);
  normal(x, z, _n);
  out.nx = _n[0]; out.ny = _n[1]; out.nz = _n[2];

  const groomed = smoothstep(hw + 7, hw - 3, adx);
  const park = pPark * groomed;

  // アイスは急斜面の圧雪面に出やすい
  const steep = smoothstep(0.29, 0.45, pitch);
  const iceMask = smoothstep(-0.05, 0.35, gradNoise2(x * 0.021, z * 0.0135, SEED + 61));
  const ice = clamp01(iceMask * pIce * groomed * (0.80 + 0.50 * steep)) * (1 - park * 0.85);

  const sidePath = gully < 0.02 ? 0
    : smoothstep(11, 3.8, Math.min(Math.abs(x - side0), Math.abs(x - side1))) * gully;

  const packed = clamp01(groomed + sidePath * 0.55);
  const powder = 1 - packed;

  let grip = lerp(SURF.powderGrip, lerp(SURF.groomedGrip, SURF.parkGrip, park), packed);
  grip = lerp(grip, SURF.iceGrip, ice);
  let mu = lerp(SURF.powderMu, lerp(SURF.groomedMu, SURF.parkMu, park), packed);
  mu = lerp(mu, SURF.iceMu, ice);
  let plow = lerp(SURF.powderPlow, lerp(SURF.groomedPlow, SURF.parkPlow, park), packed);
  plow = lerp(plow, SURF.icePlow, ice);

  out.groomed = packed;
  out.powder = powder;
  out.ice = ice;
  out.park = park;
  out.grip = grip;
  out.mu = mu;
  out.plow = plow;
  out.surface = ice > 0.30 ? SURFACE.ICE
    : park > 0.5 ? SURFACE.PARK
      : packed > 0.5 ? SURFACE.GROOMED : SURFACE.POWDER;
  out.zoneKind = kind;
  out.pitch = pitch;
  out.cx = cx;
  out.halfWidth = hw;
  out.sidePath = sidePath;
  return out;
}

/* --------------------------------------------------------- 木の密度 */

/**
 * 木の生えやすさ 0..1。圧雪路とサイド路の上はゼロ。これが「木のトンネル」を作る。
 */
export function treeDensity(x, z) {
  return treeDensityP(x, profileAt(z));
}

/** プロファイルを与える版。木の散布は行ごとにまとめて評価するのでこちらを使う。 */
export function treeDensityP(x, P) {
  if (P.trees < 0.02) return 0;
  const z = P.z;
  const adx = Math.abs(x - P.cx);

  // 圧雪路とその縁を空ける
  let d = smoothstep(P.hw + 2, P.hw + 16, adx);
  if (d <= 0) return 0;

  // サイド路のトンネルを空ける
  if (P.gully > 0.02) {
    const sd = Math.min(Math.abs(x - P.side0), Math.abs(x - P.side1));
    d *= lerp(1, smoothstep(6, 15, sd), clamp01(P.gully));
  }

  // まだらな林相
  d *= clamp01(0.55 + 0.45 * gradNoise2(x * 0.0085, z * 0.0085, SEED + 71));

  // 遠くほど密になり、自然な壁になる
  d *= lerp(0.75, 1.3, smoothstep(P.hw + 20, P.hw + 150, adx));

  return clamp01(d * P.trees);
}

/* ------------------------------------------------------------ その他 */

/**
 * 落下線方向（下り最大傾斜の水平方向）。
 * 高さ場 y=h(x,z) の法線は (-hx, 1, -hz) の正規化なので、
 * 最急降下方向 -(hx, hz) は (n.x, n.z) にそのまま比例する。
 */
export function fallLine(x, z, out = [0, 0, 1]) {
  normal(x, z, _n);
  const gx = _n[0], gz = _n[2];
  const l = Math.hypot(gx, gz);
  if (l < 1e-6) { out[0] = 0; out[1] = 0; out[2] = 1; return out; }
  out[0] = gx / l; out[1] = 0; out[2] = gz / l;
  return out;
}

/** スタート地点。 */
export function startPosition() {
  const x = trailCenterX(0);
  return [x, height(x, 0), 0];
}
