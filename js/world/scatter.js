// 木・岩・小物の決定論的な配置。
//
// グリッドのセルごとにハッシュで「そこに何があるか」を決めるので、どのクライアントでも、
// どのタイミングでも、まったく同じ山になる。木は z 行ごとにまとめて評価する
// （地形の z プロファイルを 1 行 1 回しか計算しないため）。
//
// 木の Y 座標はここでは求めない。チャンク生成側が持っている高さグリッドから
// 引いてもらう方が速いし、地形メッシュと必ず一致する。

import { hash2i } from '../core/rng.js';
import {
  height, treeDensityP, trailCenterX, trailHalfWidth, profileAt, ZONE,
} from './terrain.js';
import { TAU } from '../core/math.js';

export const TREE_CELL = 5.0;    // 木のセル間隔(m)。最大密度は 1本 / 25m² = 400本/ha
export const PROP_CELL = 60;     // 小物のセル間隔(m)

export const PROP = {
  LIFT_TOWER: 0,   // リフトの鉄塔
  SIGN: 1,         // コース標識
  POLE: 2,         // 竹ポール
  FENCE: 3,        // 木の柵
  ROCK: 4,         // 岩
  FLAG: 5,         // パトロールの旗
  LODGE: 6,        // 山小屋
};
export const PROP_NAME = ['LIFT_TOWER', 'SIGN', 'POLE', 'FENCE', 'ROCK', 'FLAG', 'LODGE'];

/* ---------------------------------------------------------------- 木 */

/**
 * セル (cx, cz) に木があれば out に書き込んで true を返す。
 * P は cz 行の地形プロファイル（profileAt((cz+0.5)*TREE_CELL)）。
 * out.y は設定しない（呼び出し側が高さグリッドから引く）。
 */
export function treeAt(cx, cz, P, out) {
  const h = hash2i(cx, cz, 0x7be3);
  const x = (cx + 0.12 + ((h & 1023) / 1024) * 0.76) * TREE_CELL;
  const z = (cz + 0.12 + (((h >>> 10) & 1023) / 1024) * 0.76) * TREE_CELL;

  const d = treeDensityP(x, P);
  if (d <= 0.02) return false;
  if (((h >>> 20) & 4095) / 4096 > d) return false;

  const h2 = hash2i(cx, cz, 0x1f4d);
  const t = (h2 & 255) / 255;
  const size = 0.5 + 1.05 * t * t;
  const kind = (h2 >>> 8) & 3;      // 0,1: 細身のモミ  2: 幅広  3: 若木

  out.x = x;
  out.z = z;
  out.height = (kind === 3 ? 4.2 : 11.5) * size;
  out.radius = (kind === 2 ? 2.5 : 1.75) * size;
  out.trunk = 0.16 * size * (kind === 2 ? 1.3 : 1);
  out.lean = ((((h2 >>> 10) & 255) / 255) - 0.5) * 0.15;
  out.leanDir = (((h2 >>> 18) & 255) / 255) * TAU;
  out.kind = kind;
  out.tint = 0.7 + 0.3 * (((h2 >>> 24) & 255) / 255);
  out.snow = 0.3 + 0.7 * ((hash2i(cx * 3, cz * 5, 0x33aa) & 255) / 255);
  out.phase = (((h >>> 6) & 255) / 255) * TAU;   // 風で揺れる位相
  return out;
}

/** 当たり判定用の実効半径。掠めるだけなら通れる太さ。 */
export function treeCollisionRadius(tree) {
  return 0.40 + tree.trunk * 2.6;
}

const _tree = {};

/**
 * 矩形範囲の木を列挙する。visit(tree) の tree は使い回されるのでコピーすること。
 * z 行ごとに地形プロファイルを 1 回だけ計算する。
 */
export function forEachTree(x0, z0, x1, z1, visit) {
  const c0x = Math.floor(x0 / TREE_CELL), c1x = Math.floor(x1 / TREE_CELL);
  const c0z = Math.floor(z0 / TREE_CELL), c1z = Math.floor(z1 / TREE_CELL);
  for (let cz = c0z; cz <= c1z; cz++) {
    const P = profileAt((cz + 0.5) * TREE_CELL);
    if (P.trees < 0.02) continue;
    // 圧雪路の内側は必ず空くので、その範囲のセルは丸ごと飛ばす
    const innerL = P.cx - (P.hw + 2), innerR = P.cx + (P.hw + 2);
    for (let cx = c0x; cx <= c1x; cx++) {
      const cellL = cx * TREE_CELL, cellR = cellL + TREE_CELL;
      if (cellR > innerL && cellL < innerR) continue;
      if (treeAt(cx, cz, P, _tree)) visit(_tree);
    }
  }
}

/* -------------------------------------------------------------- 小物 */

const _props = [];

/** z 範囲の小物を集める。返る配列は使い回し。 */
export function propsInRange(z0, z1) {
  _props.length = 0;
  const c0 = Math.floor(z0 / PROP_CELL), c1 = Math.floor(z1 / PROP_CELL);
  for (let c = c0; c <= c1; c++) collectProps(c, _props);
  return _props;
}

function push(list, type, x, z, opts) {
  list.push({
    type, x, z, y: height(x, z),
    scale: opts?.scale ?? 1,
    rot: opts?.rot ?? 0,
    variant: opts?.variant ?? 0,
  });
}

function collectProps(c, list) {
  const zc = c * PROP_CELL;
  const h = hash2i(c, 0x9911, 0x2c5f);
  const P = profileAt(zc);
  const kind = P.kind, ledge = P.ledge, pitch = P.pitch, local = P.local;
  const hw = P.hw;

  // --- リフトの鉄塔。120m ごとに、トレイルの片側へ一直線に ---
  if (c % 2 === 0) {
    const z = zc + 12;
    const side = Math.sin(zc / 1900) > 0 ? 1 : -1;
    push(list, PROP.LIFT_TOWER, trailCenterX(z) + side * (hw + 36), z,
      { variant: (c >>> 2) & 1 });
  }

  // --- ゾーン入口のコース標識 ---
  if (local < PROP_CELL) {
    const z = zc + 6;
    push(list, PROP.SIGN, trailCenterX(z) - trailHalfWidth(z) - 3.4, z,
      { rot: 0.22, variant: kind });
  }

  // --- 竹ポール。コースの縁に等間隔 ---
  for (let i = 0; i < 4; i++) {
    const z = zc + i * (PROP_CELL / 4) + 3;
    const w = trailHalfWidth(z);
    const cxi = trailCenterX(z);
    const flip = ((h >>> i) & 1) ? 1 : -1;
    push(list, PROP.POLE, cxi + flip * (w + 1.7), z, { variant: (i + c) & 1 });
    if (((h >>> (i + 8)) & 3) === 0) {
      push(list, PROP.POLE, cxi - flip * (w + 1.7), z, { variant: (i + c + 1) & 1 });
    }
  }

  // --- 段差の手前に立つパトロールの旗 ---
  if (ledge > 0.5 && ((h >>> 12) & 3) === 0) {
    const z = zc + 30;
    const s = Math.tanh((Math.sin(z / 143 + 1.1) + 0.55 * Math.sin(z / 61)) * 2.2);
    const edge = 16 + 9 * Math.sin(z / 88 + 0.6);
    push(list, PROP.FLAG, trailCenterX(z) + s * (edge - 2.5), z, { variant: (h >>> 14) & 1 });
  }

  // --- 細いキャットトラックの谷側に木の柵 ---
  if (kind === ZONE.NARROWS) {
    for (let i = 0; i < 3; i++) {
      const z = zc + i * 20 + 5;
      push(list, PROP.FENCE, trailCenterX(z) + trailHalfWidth(z) + 2.4, z, {});
    }
  }

  // --- 岩。ボウルとオフピステに転がる ---
  const rockCount = kind === ZONE.BOWL ? 5 : kind === ZONE.OPEN ? 2 : 1;
  for (let i = 0; i < rockCount; i++) {
    const rh = hash2i(c, i * 977 + 5, 0x4d21);
    const off = ((rh & 1023) / 1024 - 0.5) * 280;
    const z = zc + (((rh >>> 10) & 255) / 256) * PROP_CELL;
    const x = trailCenterX(z) + off;
    if (Math.abs(off) < trailHalfWidth(z) + 10) continue;   // コース上には置かない
    push(list, PROP.ROCK, x, z, {
      scale: 0.55 + 1.9 * (((rh >>> 18) & 255) / 255),
      rot: (((rh >>> 26) & 63) / 64) * TAU,
      variant: (rh >>> 24) & 3,
    });
  }

  // --- 山小屋。ごくたまに、緩斜面の脇に ---
  if (((h >>> 20) & 31) === 7 && pitch < 0.31) {
    const z = zc + 25;
    push(list, PROP.LODGE,
      trailCenterX(z) + (((h >>> 26) & 1) ? 1 : -1) * (trailHalfWidth(z) + 17), z,
      { rot: (((h >>> 27) & 15) / 16) * 0.6 - 0.3 });
  }

  return list;
}

/* --------------------------------------------------- 障害物の当たり判定 */

const _hit = { x: 0, z: 0, r: 0, dist: 0, size: 1 };

/**
 * (x, z) の近くの木を探す。ライダーの当たり判定用。
 * 見つかれば { x, z, r, dist, size } を返す（dist は表面までの距離。負なら食い込み）。
 */
export function nearestTree(x, z, searchRadius = 3.0) {
  const c0x = Math.floor((x - searchRadius) / TREE_CELL), c1x = Math.floor((x + searchRadius) / TREE_CELL);
  const c0z = Math.floor((z - searchRadius) / TREE_CELL), c1z = Math.floor((z + searchRadius) / TREE_CELL);
  let found = null, bestD = searchRadius;
  for (let cz = c0z; cz <= c1z; cz++) {
    const P = profileAt((cz + 0.5) * TREE_CELL);
    if (P.trees < 0.02) continue;
    for (let cx = c0x; cx <= c1x; cx++) {
      if (!treeAt(cx, cz, P, _tree)) continue;
      const r = treeCollisionRadius(_tree);
      const d = Math.hypot(_tree.x - x, _tree.z - z) - r;
      if (d < bestD) {
        bestD = d;
        _hit.x = _tree.x; _hit.z = _tree.z; _hit.r = r;
        _hit.dist = d; _hit.size = _tree.height / 11.5;
        found = _hit;
      }
    }
  }
  return found;
}
