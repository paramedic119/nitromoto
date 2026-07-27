// 地形チャンクのストリーミング。
//
// ・チャンクは 96m 四方。距離に応じて 5 段階の LOD を持つ。
// ・頂点の (x, z) は LOD ごとに共有した 1 本のバッファに入っている。
//   チャンク固有のデータは「高さ・法線・サーフェス」だけなので転送量が半分で済む。
// ・外周に 1 列スカートを垂らして、LOD 境界の隙間を隠す。
// ・生成は毎フレームの時間予算内でしか進めない。無限に続く山が途切れずに伸びていく。

import { createBuffer, createVAO } from '../core/gl.js';
import { profileAt, heightP, height, trailCenterX, SEED } from './terrain.js';
import { clamp, clamp01, smoothstep } from '../core/math.js';
import { gradNoise2 } from '../core/rng.js';
import { forEachTree, TREE_CELL } from './scatter.js';

export const CHUNK = 96;                       // チャンクの一辺 (m)
const LOD_RES = [96, 48, 24, 12, 6];           // LOD ごとの分割数
const LOD_RING = [1, 2, 4, 7, 11];             // その LOD を使う最大チャンク距離
const VIEW_RADIUS = 11;
const SKIRT = 9;                               // スカートの深さ (m)

const TREES_LOD_MAX = 2;                       // この LOD までは木を配置する
                                               // （それ以上遠い木は霧の中で浮いて見えるだけ）

/* ------------------------------------------- LOD ごとの共有グリッド */

const gridCache = new Map();

function getGrid(gl, lod) {
  let g = gridCache.get(lod);
  if (g) return g;

  const N = LOD_RES[lod];
  const step = CHUNK / N;
  const M = N + 3;                    // 外側 1 列がスカート

  // aGrid = (localX, localZ, skirtFlag)
  const grid = new Float32Array(M * M * 3);
  let p = 0;
  for (let j = 0; j < M; j++) {
    const gj = clamp(j - 1, 0, N);
    const skirtJ = (j === 0 || j === M - 1) ? 1 : 0;
    for (let i = 0; i < M; i++) {
      const gi = clamp(i - 1, 0, N);
      const skirtI = (i === 0 || i === M - 1) ? 1 : 0;
      grid[p++] = gi * step;
      grid[p++] = gj * step;
      grid[p++] = (skirtI || skirtJ) ? 1 : 0;
    }
  }

  // インデックス。全チャンクで共有する。
  const quads = (M - 1) * (M - 1);
  const idx = quads * 4 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let q = 0;
  for (let j = 0; j < M - 1; j++) {
    for (let i = 0; i < M - 1; i++) {
      const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
      // 対角の向きを交互にして、格子模様が出ないようにする
      if (((i ^ j) & 1) === 0) {
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      } else {
        idx[q++] = a; idx[q++] = c; idx[q++] = d;
        idx[q++] = a; idx[q++] = d; idx[q++] = b;
      }
    }
  }

  g = {
    N, M, step,
    gridBuf: createBuffer(gl, gl.ARRAY_BUFFER, grid),
    idxBuf: createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, idx),
    idxType: idx.BYTES_PER_ELEMENT === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
    idxCount: idx.length,
    // 生成用の作業バッファ（LOD ごとに 1 枚だけ確保して使い回す）
    heights: new Float32Array(M * M),
    verts: new Float32Array(M * M * 6),
  };
  gridCache.set(lod, g);
  return g;
}

/* -------------------------------------------------- チャンクの生成 */

// 頂点データ: height, nx, ny, nz, groomed, ice
function buildChunkData(cx, cz, lod, g) {
  const { N, M, step, heights, verts } = g;
  const ox = cx * CHUNK, oz = cz * CHUNK;

  // --- 高さ（1 セル外側まで含めて評価する。法線を中央差分で取るため）---
  for (let j = 0; j < M; j++) {
    const wz = oz + (j - 1) * step;
    const P = profileAt(wz);
    const rowBase = j * M;
    for (let i = 0; i < M; i++) {
      heights[rowBase + i] = heightP(ox + (i - 1) * step, P);
    }
  }

  // --- 頂点 ---
  const inv2 = 1 / (2 * step);
  let p = 0;
  for (let j = 0; j < M; j++) {
    const jj = clamp(j, 1, M - 2);          // スカート行は内側の値を借りる
    const wz = oz + (jj - 1) * step;
    const P = profileAt(wz);
    const hw = P.hw, cxx = P.cx, pIce = P.ice, pPark = P.park, pitch = P.pitch;
    const gully = P.gully, side0 = P.side0, side1 = P.side1;
    const steep = smoothstep(0.29, 0.45, pitch);

    for (let i = 0; i < M; i++) {
      const ii = clamp(i, 1, M - 2);
      const base = jj * M + ii;
      const wx = ox + (ii - 1) * step;

      // 中央差分。1 セル外側まで高さがあるので端でも成立する。
      const hL = heights[base - 1], hR = heights[base + 1];
      const hD = heights[base - M], hU = heights[base + M];
      let nx = (hL - hR) * inv2, ny = 1, nz = (hD - hU) * inv2;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;

      // サーフェス（terrain.sample と同じ式。物理と見た目を合わせる）
      const adx = Math.abs(wx - cxx);
      const groomed = smoothstep(hw + 7, hw - 3, adx);
      const park = pPark * groomed;
      const iceMask = smoothstep(-0.05, 0.35, gradNoise2(wx * 0.021, wz * 0.0135, SEED + 61));
      const ice = clamp01(iceMask * pIce * groomed * (0.80 + 0.50 * steep)) * (1 - park * 0.85);
      const sidePath = gully < 0.02 ? 0
        : smoothstep(11, 3.8, Math.min(Math.abs(wx - side0), Math.abs(wx - side1))) * gully;
      const packed = clamp01(groomed + sidePath * 0.55);

      verts[p++] = heights[base];
      verts[p++] = nx; verts[p++] = ny; verts[p++] = nz;
      verts[p++] = packed;
      verts[p++] = ice;
    }
  }
  return verts;
}

/* ---------------------------------------------------- 木のインスタンス */

// 1 本あたり: x, y, z, height, radius, trunk, lean, leanDir, tint, snow, phase, kind
const TREE_STRIDE = 12;
const _treeScratch = [];

function buildTrees(cx, cz, g) {
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const { M, step } = g;
  const heights = g.heights;
  _treeScratch.length = 0;

  forEachTree(ox, oz, ox + CHUNK, oz + CHUNK, (t) => {
    // 高さはチャンクの高さグリッドから双一次補間で引く。地形メッシュと必ず一致する。
    const fx = (t.x - ox) / step + 1;
    const fz = (t.z - oz) / step + 1;
    const i0 = clamp(Math.floor(fx), 0, M - 2), j0 = clamp(Math.floor(fz), 0, M - 2);
    const u = clamp01(fx - i0), v = clamp01(fz - j0);
    const b = j0 * M + i0;
    const h = (heights[b] * (1 - u) + heights[b + 1] * u) * (1 - v)
      + (heights[b + M] * (1 - u) + heights[b + M + 1] * u) * v;
    _treeScratch.push(
      t.x, h, t.z, t.height, t.radius, t.trunk,
      t.lean, t.leanDir, t.tint, t.snow, t.phase, t.kind,
    );
  });

  if (!_treeScratch.length) return null;
  return new Float32Array(_treeScratch);
}

/* ------------------------------------------------------- マネージャ */

export class ChunkManager {
  constructor(gl, opts = {}) {
    this.gl = gl;
    this.chunks = new Map();          // key -> chunk
    this.visible = [];
    this.queue = [];
    this.budgetMs = opts.budgetMs ?? 4.0;
    this.stats = { built: 0, live: 0, queued: 0, tris: 0 };
    this._center = [0, 0];
  }

  key(cx, cz) { return cx * 100003 + cz; }

  lodFor(d) {
    for (let i = 0; i < LOD_RING.length; i++) if (d <= LOD_RING[i]) return i;
    return LOD_RES.length - 1;
  }

  /** カメラ位置に合わせて必要なチャンクを洗い出す。 */
  update(camX, camZ, budgetMs = this.budgetMs) {
    const ccx = Math.floor(camX / CHUNK), ccz = Math.floor(camZ / CHUNK);
    this._center[0] = ccx; this._center[1] = ccz;

    // --- 必要なチャンクの一覧 ---
    this.queue.length = 0;
    const want = new Set();
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        if (d > VIEW_RADIUS) continue;
        // 進行方向(+Z)は遠くまで、背後は近くだけ見せる
        if (dz < -4 && d > 5) continue;
        const cx = ccx + dx, cz = ccz + dz;
        const k = this.key(cx, cz);
        want.add(k);
        const lod = this.lodFor(d);
        const c = this.chunks.get(k);
        if (!c || c.lod !== lod) {
          this.queue.push({ k, cx, cz, lod, d: dx * dx + dz * dz * 0.55 });
        }
      }
    }

    // --- 範囲外を破棄 ---
    for (const [k, c] of this.chunks) {
      if (!want.has(k)) { this._destroy(c); this.chunks.delete(k); }
    }

    // --- 近いものから作る。予算を超えたら次のフレームへ ---
    // 大きく出遅れているとき（リスポーン直後など）は予算を増やして一気に追いつく。
    this.queue.sort((a, b) => a.d - b.d);
    const budget = Math.min(18, budgetMs + this.queue.length * 0.035);
    const t0 = performance.now();
    let built = 0;
    for (const job of this.queue) {
      if (performance.now() - t0 > budget && built > 0) break;
      this._build(job);
      built++;
    }
    this.stats.built = built;
    this.stats.live = this.chunks.size;
    this.stats.queued = Math.max(0, this.queue.length - built);
  }

  _build({ k, cx, cz, lod }) {
    const gl = this.gl;
    const g = getGrid(gl, lod);
    const data = buildChunkData(cx, cz, lod, g);

    let c = this.chunks.get(k);
    if (c && c.lod !== lod) { this._destroy(c); c = null; }

    if (!c) {
      c = {
        cx, cz, lod,
        buf: gl.createBuffer(),
        vao: null,
        treeBuf: null, treeCount: 0,
        originX: cx * CHUNK, originZ: cz * CHUNK,
        minY: 0, maxY: 0, cy: 0, radius: 0,
      };
      gl.bindBuffer(gl.ARRAY_BUFFER, c.buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      c.vao = createVAO(gl, [
        { buffer: g.gridBuf, loc: 0, size: 3, stride: 12, offset: 0 },
        { buffer: c.buf, loc: 1, size: 1, stride: 24, offset: 0 },   // height
        { buffer: c.buf, loc: 2, size: 3, stride: 24, offset: 4 },   // normal
        { buffer: c.buf, loc: 3, size: 2, stride: 24, offset: 16 },  // groomed, ice
      ], { buffer: g.idxBuf });
      this.chunks.set(k, c);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, c.buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    }

    // --- バウンディング（視錐台カリング用）---
    let lo = Infinity, hi = -Infinity;
    const hs = g.heights;
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    c.minY = lo - SKIRT; c.maxY = hi;
    c.cy = (lo + hi) * 0.5;
    c.radius = Math.hypot(CHUNK * 0.72, (hi - lo + SKIRT) * 0.5) + 2;
    c.idxCount = g.idxCount;
    c.idxType = g.idxType;

    // --- 木 ---
    if (lod <= TREES_LOD_MAX) {
      const td = buildTrees(cx, cz, g);
      if (td) {
        if (!c.treeBuf) c.treeBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, c.treeBuf);
        gl.bufferData(gl.ARRAY_BUFFER, td, gl.STATIC_DRAW);
        c.treeCount = td.length / TREE_STRIDE;
      } else {
        c.treeCount = 0;
      }
    } else {
      c.treeCount = 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _destroy(c) {
    const gl = this.gl;
    if (c.vao) gl.deleteVertexArray(c.vao);
    if (c.buf) gl.deleteBuffer(c.buf);
    if (c.treeBuf) gl.deleteBuffer(c.treeBuf);
  }

  /** 描画対象を距離順に集める。planes は math.extractFrustum の出力。 */
  collect(planes, camX, camY, camZ, out = this.visible) {
    out.length = 0;
    let tris = 0;
    for (const c of this.chunks.values()) {
      const cx = c.originX + CHUNK * 0.5;
      const cz = c.originZ + CHUNK * 0.5;
      if (planes) {
        let inside = true;
        for (let i = 0; i < 6; i++) {
          const d = planes[i * 4] * cx + planes[i * 4 + 1] * c.cy + planes[i * 4 + 2] * cz + planes[i * 4 + 3];
          if (d < -c.radius) { inside = false; break; }
        }
        if (!inside) continue;
      }
      c.dist = (cx - camX) ** 2 + (cz - camZ) ** 2;
      out.push(c);
      tris += c.idxCount / 3;
    }
    out.sort((a, b) => a.dist - b.dist);
    this.stats.tris = tris;
    return out;
  }

  dispose() {
    for (const c of this.chunks.values()) this._destroy(c);
    this.chunks.clear();
  }
}

export { TREE_STRIDE };
