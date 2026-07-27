// レンダラ。パスの構成と、全ステートの管理。
//
//   1. 軌跡の更新（ワールド空間のテクスチャに書き込む）
//   2. シャドウパス（プレイヤー追従の平行光源、深度のみ）
//   3. メインパス（HDR）: 空 → 地形 → 木 → 小物 → ライダー → パーティクル
//   4. ポスト: ブライトパス → ブラー x2 → 合成（トーンマップ・ブルーム・
//      ビネット・色収差・グレイン・速度ブラー・カラーグレード）

import {
  createProgram, createBuffer, createVAO, createTexture2D, createFBO, resizeFBO, drawFullscreen,
} from '../core/gl.js';
import { M4, V3, clamp, clamp01, lerp, extractFrustum, DEG } from '../core/math.js';
import * as S from './shaders.js';
import { buildTreeMesh, buildRiderMesh, buildPropMeshes, BONE, BONE_COUNT } from './meshes.js';
import { CHUNK, TREE_STRIDE } from '../world/chunks.js';
import { PROP } from '../world/scatter.js';
import { STATE } from '../play/rider.js';

const SHADOW_RES = 2048;
const SHADOW_EXTENT = 108;
const SKIRT = 9;

// 太陽。高めで、進行方向のやや右前。滑っていく先が明るく、影は手前に伸びる。
export const SUN_DIR = (() => {
  const d = [0.48, 0.60, 0.64];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
})();
export const SUN_COLOR = [1.42, 1.24, 0.99];
const AMB_SKY = [0.26, 0.36, 0.62];
const AMB_GROUND = [0.34, 0.37, 0.44];

const GLARE_COLOR = [1.00, 0.86, 0.62];
const _sunWorld = [0, 0, 0];

const FOG_DENSITY = 0.00082;
const FOG_HEIGHT = 210;

/* -------------------------------------------------- 小さな道具 */

const setM4 = (gl, p, n, v) => { const l = p.u[n]; if (l) gl.uniformMatrix4fv(l, false, v); };
const set3 = (gl, p, n, v) => { const l = p.u[n]; if (l) gl.uniform3fv(l, v); };
const set2f = (gl, p, n, a, b) => { const l = p.u[n]; if (l) gl.uniform2f(l, a, b); };
const set1f = (gl, p, n, a) => { const l = p.u[n]; if (l) gl.uniform1f(l, a); };
const set1i = (gl, p, n, a) => { const l = p.u[n]; if (l) gl.uniform1i(l, a); };

function uploadMesh(gl, mesh) {
  const vb = createBuffer(gl, gl.ARRAY_BUFFER, mesh.vertices);
  const ib = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
  return {
    vb, ib,
    count: mesh.count,
    type: mesh.indices.BYTES_PER_ELEMENT === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
    stride: mesh.stride,
  };
}

// pos3 / nrm3 / col3 / extra1 の共通レイアウト
function meshAttribs(gl, m, extra = []) {
  return [
    { buffer: m.vb, loc: 0, size: 3, stride: m.stride, offset: 0 },
    { buffer: m.vb, loc: 1, size: 3, stride: m.stride, offset: 12 },
    { buffer: m.vb, loc: 2, size: 3, stride: m.stride, offset: 24 },
    { buffer: m.vb, loc: 3, size: 1, stride: m.stride, offset: 36 },
    ...extra,
  ];
}

/* -------------------------------------------------- ライダーの姿勢 */

const _bones = new Float32Array(BONE_COUNT * 16);
const _tmpM = M4.create();
const _boardM = M4.create();
const _up = [0, 1, 0], _fwd = [0, 0, 1], _right = [1, 0, 0];

// 位置と Y→X→Z オイラー角とスケールから 4x4 を作る
function trs(out, px, py, pz, ry, rx, rz, sx = 1, sy = 1, sz = 1) {
  const cy = Math.cos(ry), sy_ = Math.sin(ry);
  const cx = Math.cos(rx), sx_ = Math.sin(rx);
  const cz = Math.cos(rz), sz_ = Math.sin(rz);
  // R = Ry * Rx * Rz
  const m00 = cy * cz + sy_ * sx_ * sz_;
  const m01 = -cy * sz_ + sy_ * sx_ * cz;
  const m02 = sy_ * cx;
  const m10 = cx * sz_;
  const m11 = cx * cz;
  const m12 = -sx_;
  const m20 = -sy_ * cz + cy * sx_ * sz_;
  const m21 = sy_ * sz_ + cy * sx_ * cz;
  const m22 = cy * cx;
  out[0] = m00 * sx; out[1] = m10 * sx; out[2] = m20 * sx; out[3] = 0;
  out[4] = m01 * sy; out[5] = m11 * sy; out[6] = m21 * sy; out[7] = 0;
  out[8] = m02 * sz; out[9] = m12 * sz; out[10] = m22 * sz; out[11] = 0;
  out[12] = px; out[13] = py; out[14] = pz; out[15] = 1;
  return out;
}

/**
 * ライダーのボーン行列を作る。
 * 体はボードのローカル座標で組み立て、最後にボードのワールド行列を掛ける。
 * カービング中は板が寝ても上体は起きている（アンギュレーション）ようにしてある。
 */
export function poseRider(out, r) {
  // --- ボードのワールド姿勢 ---
  V3.copy(_up, r.up || [0, 1, 0]);
  V3.normalize(_up, _up);
  _fwd[0] = Math.sin(r.yaw); _fwd[1] = 0; _fwd[2] = Math.cos(r.yaw);
  V3.projectOnPlane(_fwd, _fwd, _up);
  if (V3.lenSq(_fwd) < 1e-6) { _fwd[0] = 0; _fwd[1] = 0; _fwd[2] = 1; }
  V3.normalize(_fwd, _fwd);

  // ロール（エッジ角）を前方軸まわりに掛ける
  const roll = r.roll || 0;
  V3.cross(_right, _up, _fwd);
  V3.normalize(_right, _right);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const ux = _up[0] * cr - _right[0] * sr;
  const uy = _up[1] * cr - _right[1] * sr;
  const uz = _up[2] * cr - _right[2] * sr;
  const rx = _right[0] * cr + _up[0] * sr;
  const ry = _right[1] * cr + _up[1] * sr;
  const rz = _right[2] * cr + _up[2] * sr;
  _up[0] = ux; _up[1] = uy; _up[2] = uz;
  _right[0] = rx; _right[1] = ry; _right[2] = rz;

  M4.fromBasis(_boardM, _right, _up, _fwd, r.pos);

  // 転倒中は前方軸まわりに転がる
  if (r.tumble) {
    const t = r.tumble;
    trs(_tmpM, 0, 0.4, 0, 0, t, t * 0.7);
    M4.multiply(_boardM, _boardM, _tmpM);
  }

  // --- ボードローカルで体を組む ---
  const crouch = clamp01(r.crouch || 0);
  const edge = clamp(r.edge || 0, -1, 1);
  const grab = clamp01(r.grab || 0);
  const wob = clamp01(r.wobble || 0);
  const air = r.grounded === false;
  const t = r.animT || 0;

  const legLen = 0.68 * (1 - crouch * 0.42) * (1 - grab * 0.20);
  const hipY = legLen + 0.05;
  // 板が寝たぶんだけ腰を内側へ入れて、上体は起こす
  const angul = -roll;
  const hipX = angul * 0.20 + wob * Math.sin(t * 9.3) * 0.05;

  const put = (bone, m) => _bones.set(m, bone * 16);
  const localToWorld = (bone, local) => {
    M4.multiply(_tmpM, _boardM, local);
    put(bone, _tmpM);
  };

  // ボード本体
  put(BONE.BOARD, _boardM);

  // ブーツ（バインディングに固定）
  const stance = 0.20;
  localToWorld(BONE.BOOT_F, trs(_scratch, 0, 0.01, stance, 0.30, 0, 0));
  localToWorld(BONE.BOOT_B, trs(_scratch, 0, 0.01, -stance, -0.16, 0, 0));

  // 脚。腰へ向けて傾ける。
  const legTiltF = Math.atan2(hipX, hipY);
  localToWorld(BONE.LEG_F, trs(_scratch, 0, 0.11, stance,
    0.22, 0, legTiltF, 1, legLen / 0.56, 1));
  localToWorld(BONE.LEG_B, trs(_scratch, 0, 0.11, -stance,
    -0.12, 0, legTiltF, 1, legLen / 0.56, 1));

  // 腰
  localToWorld(BONE.PELVIS, trs(_scratch, hipX, hipY, 0, 0.28, 0, angul * 0.35));

  // 上体。板より正面（トゥサイド）を向く。旋回の反対へわずかに捻る。
  const torsoYaw = 1.02 + edge * 0.22 - (r.spinRate || 0) * 0.03;
  const torsoLean = angul * 0.60 + crouch * 0.10;
  const torsoPitch = (air ? 0.14 : 0.08) + crouch * 0.30 + grab * 0.45;
  const torsoM = trs(_scratch, hipX * 1.1, hipY + 0.02, 0, torsoYaw, torsoPitch, torsoLean);
  M4.multiply(_tmpM, _boardM, torsoM);
  put(BONE.TORSO, _tmpM);
  const torsoWorld = M4.copy(M4.create(), _tmpM);

  // 頭。進行方向を見る（上体の捻りを打ち消す方向）。
  const headM = trs(_scratch2, 0, 0.58, 0, -torsoYaw * 0.55, -torsoPitch * 0.7 + 0.06, 0);
  M4.multiply(_tmpM, torsoWorld, headM);
  put(BONE.HEAD, _tmpM);

  // 腕。バランスを取って広げる。グラブ中は前手が板へ伸びる。
  const swing = Math.sin(t * 1.8) * 0.06;
  const armSpreadL = 0.95 - edge * 0.55 + swing + wob * 0.5 * Math.sin(t * 7.1);
  const armSpreadR = 0.95 + edge * 0.55 - swing + wob * 0.5 * Math.cos(t * 6.3);
  const armFwd = air ? 0.35 : 0.12;

  const grabReach = grab * 1.5;
  const armLM = trs(_scratch2, -0.20, 0.45, 0.02,
    0, armFwd - grabReach * 0.5, -armSpreadL + grabReach * 0.9);
  M4.multiply(_tmpM, torsoWorld, armLM);
  put(BONE.ARM_L, _tmpM);

  const armRM = trs(_scratch2, 0.20, 0.45, 0.02,
    0, armFwd + (air ? 0.2 : 0), armSpreadR);
  M4.multiply(_tmpM, torsoWorld, armRM);
  put(BONE.ARM_R, _tmpM);

  out.set(_bones);
  return out;
}

const _scratch = M4.create();
const _scratch2 = M4.create();

/* ------------------------------------------------------- レンダラ */

export class Renderer {
  constructor(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.width = 1; this.height = 1;
    this.pixelRatio = 1;
    this.quality = 1;               // 解像度スケール

    // --- プログラム ---
    this.pSky = createProgram(gl, S.skyVS, S.skyFS, 'sky');
    this.pTerrain = createProgram(gl, S.terrainVS, S.terrainFS, 'terrain');
    this.pTree = createProgram(gl, S.treeVS, S.treeFS, 'tree');
    this.pProp = createProgram(gl, S.propVS, S.propFS, 'prop');
    this.pRider = createProgram(gl, S.riderVS, S.riderFS, 'rider');
    this.pShadowTerrain = createProgram(gl, S.shadowTerrainVS, S.depthFS, 'shadowTerrain');
    this.pShadowTree = createProgram(gl, S.shadowTreeVS, S.depthFS, 'shadowTree');
    this.pShadowProp = createProgram(gl, S.shadowPropVS, S.depthFS, 'shadowProp');
    this.pShadowRider = createProgram(gl, S.shadowRiderVS, S.depthFS, 'shadowRider');
    this.pBright = createProgram(gl, S.fullscreenVS, S.brightFS, 'bright');
    this.pBlur = createProgram(gl, S.fullscreenVS, S.blurFS, 'blur');
    this.pComposite = createProgram(gl, S.fullscreenVS, S.compositeFS, 'composite');

    // --- メッシュ ---
    this.treeMesh = uploadMesh(gl, buildTreeMesh(0));
    this.riderMesh = uploadMesh(gl, buildRiderMesh());
    this.propMeshes = buildPropMeshes().map((m) => uploadMesh(gl, m));

    // 木のインスタンス用 VAO はチャンクごとに必要なので、遅延で作って持たせる
    this.treeVAOCache = new WeakMap();

    this.riderVAO = createVAO(gl, [
      { buffer: this.riderMesh.vb, loc: 0, size: 3, stride: this.riderMesh.stride, offset: 0 },
      { buffer: this.riderMesh.vb, loc: 1, size: 3, stride: this.riderMesh.stride, offset: 12 },
      { buffer: this.riderMesh.vb, loc: 2, size: 3, stride: this.riderMesh.stride, offset: 24 },
      { buffer: this.riderMesh.vb, loc: 3, size: 1, stride: this.riderMesh.stride, offset: 36 },
    ], { buffer: this.riderMesh.ib });

    // --- 小物のインスタンスバッファ ---
    this.propInst = this.propMeshes.map((m) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, 900 * 5 * 4, gl.DYNAMIC_DRAW);
      const vao = createVAO(gl, [
        ...meshAttribs(gl, m, [
          { buffer: buf, loc: 4, size: 3, stride: 20, offset: 0, divisor: 1 },
          { buffer: buf, loc: 5, size: 2, stride: 20, offset: 12, divisor: 1 },
        ]),
      ], { buffer: m.ib });
      return { buf, vao, data: new Float32Array(900 * 5), count: 0 };
    });

    // --- FBO ---
    this.shadow = createFBO(gl, {
      width: SHADOW_RES, height: SHADOW_RES, color: [],
      depth: { texture: true, compare: gl.LESS },
    });
    this.scene = createFBO(gl, {
      width: 2, height: 2,
      color: [{ internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }],
      depth: true,
    });
    this.bloomA = createFBO(gl, {
      width: 2, height: 2,
      color: [{ internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }],
      depth: false,
    });
    this.bloomB = createFBO(gl, {
      width: 2, height: 2,
      color: [{ internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }],
      depth: false,
    });
    this.bloomC = createFBO(gl, {
      width: 2, height: 2,
      color: [{ internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }],
      depth: false,
    });
    this.bloomD = createFBO(gl, {
      width: 2, height: 2,
      color: [{ internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }],
      depth: false,
    });

    this.lightViewProj = M4.create();
    this.frustum = new Float32Array(24);
    this.riderBones = new Float32Array(BONE_COUNT * 16);
    this.stats = { drawCalls: 0, treesDrawn: 0 };
    this.exposure = 0.66;
  }

  resize(w, h, pixelRatio, quality = 1) {
    const gl = this.gl;
    const W = Math.max(2, Math.round(w * pixelRatio * quality));
    const H = Math.max(2, Math.round(h * pixelRatio * quality));
    if (W === this.width && H === this.height) return;
    this.width = W; this.height = H;
    this.canvas.width = Math.max(2, Math.round(w * pixelRatio));
    this.canvas.height = Math.max(2, Math.round(h * pixelRatio));
    resizeFBO(gl, this.scene, W, H);
    resizeFBO(gl, this.bloomA, W >> 1, H >> 1);
    resizeFBO(gl, this.bloomB, W >> 1, H >> 1);
    resizeFBO(gl, this.bloomC, Math.max(2, W >> 3), Math.max(2, H >> 3));
    resizeFBO(gl, this.bloomD, Math.max(2, W >> 3), Math.max(2, H >> 3));
  }

  /* ------------------------------------------------ シャドウの行列 */

  _fitShadow(rider) {
    // プレイヤーを中心にした平行投影。テクセル単位にスナップしてちらつきを止める。
    const cx = rider.pos[0] + SUN_DIR[0] * 12;
    const cy = rider.pos[1] + SUN_DIR[1] * 12;
    const cz = rider.pos[2] + SUN_DIR[2] * 12 + 18;
    const eye = [cx + SUN_DIR[0] * 260, cy + SUN_DIR[1] * 260, cz + SUN_DIR[2] * 260];
    const view = _lightView;
    M4.lookAt(view, eye, [cx, cy, cz], [0, 1, 0]);

    const texelWorld = (SHADOW_EXTENT * 2) / SHADOW_RES;
    // 視点空間での中心をテクセルに丸める
    const c = [0, 0, 0];
    V3.transformM4(c, [cx, cy, cz], view);
    const sx = Math.round(c[0] / texelWorld) * texelWorld - c[0];
    const sy = Math.round(c[1] / texelWorld) * texelWorld - c[1];

    M4.ortho(_lightProj, -SHADOW_EXTENT + sx, SHADOW_EXTENT + sx,
      -SHADOW_EXTENT + sy, SHADOW_EXTENT + sy, 1, 560);
    M4.multiply(this.lightViewProj, _lightProj, view);
  }

  /* ------------------------------------------------------- 描画 */

  render(scene) {
    const gl = this.gl;
    const { camera, rider, chunks, particles, trails, props, peers, time, wind } = scene;
    this.stats.drawCalls = 0;
    this.stats.treesDrawn = 0;

    poseRider(this.riderBones, rider);
    this._fitShadow(rider);
    extractFrustum(this.frustum, camera.viewProj);
    const visible = chunks.collect(this.frustum, camera.eye[0], camera.eye[1], camera.eye[2]);

    /* --- 1. シャドウ --- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fbo);
    gl.viewport(0, 0, SHADOW_RES, SHADOW_RES);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);       // ピーターパン現象を避ける

    this.pShadowTerrain.use();
    setM4(gl, this.pShadowTerrain, 'uLightViewProj', this.lightViewProj);
    set1f(gl, this.pShadowTerrain, 'uSkirt', SKIRT);
    for (const c of visible) {
      if (c.lod > 2) continue;
      set2f(gl, this.pShadowTerrain, 'uChunkOrigin', c.originX, c.originZ);
      gl.bindVertexArray(c.vao);
      gl.drawElements(gl.TRIANGLES, c.idxCount, c.idxType, 0);
    }

    gl.cullFace(gl.BACK);
    this.pShadowTree.use();
    setM4(gl, this.pShadowTree, 'uLightViewProj', this.lightViewProj);
    for (const c of visible) {
      if (c.lod > 1 || !c.treeCount) continue;
      this._drawTreeInstances(c, true);
    }

    this.pShadowRider.use();
    setM4(gl, this.pShadowRider, 'uLightViewProj', this.lightViewProj);
    setM4(gl, this.pShadowRider, 'uBones', this.riderBones);
    gl.bindVertexArray(this.riderVAO);
    gl.drawElements(gl.TRIANGLES, this.riderMesh.count, this.riderMesh.type, 0);

    /* --- 2. メインパス --- */
    this.scene.bind();
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);

    // 空
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    this.pSky.use();
    setM4(gl, this.pSky, 'uInvViewProj', camera.invViewProj);
    set3(gl, this.pSky, 'uCamPos', camera.eye);
    set3(gl, this.pSky, 'uSunDir', SUN_DIR);
    set3(gl, this.pSky, 'uSunColor', SUN_COLOR);
    set1f(gl, this.pSky, 'uTime', time);
    drawFullscreen(gl);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    // 地形
    const p = this.pTerrain;
    p.use();
    this._commonUniforms(p, camera, time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.depthTex);
    set1i(gl, p, 'uShadowMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, trails.texture);
    set1i(gl, p, 'uTrail', 1);
    set2f(gl, p, 'uTrailOrigin', 0, 0);
    set1f(gl, p, 'uTrailSpan', trails.span);
    set1f(gl, p, 'uSkirt', SKIRT);
    for (const c of visible) {
      set2f(gl, p, 'uChunkOrigin', c.originX, c.originZ);
      gl.bindVertexArray(c.vao);
      gl.drawElements(gl.TRIANGLES, c.idxCount, c.idxType, 0);
      this.stats.drawCalls++;
    }

    // 木
    const pt = this.pTree;
    pt.use();
    this._commonUniforms(pt, camera, time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.depthTex);
    set1i(gl, pt, 'uShadowMap', 0);
    set1f(gl, pt, 'uWind', wind);
    gl.disable(gl.CULL_FACE);
    for (const c of visible) {
      if (!c.treeCount) continue;
      this._drawTreeInstances(c, false);
      this.stats.treesDrawn += c.treeCount;
      this.stats.drawCalls++;
    }
    gl.enable(gl.CULL_FACE);

    // 小物
    this._drawProps(props, camera, time);

    // ライダー本体と他プレイヤー
    const pr = this.pRider;
    pr.use();
    this._commonUniforms(pr, camera, time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.depthTex);
    set1i(gl, pr, 'uShadowMap', 0);
    gl.bindVertexArray(this.riderVAO);
    gl.disable(gl.CULL_FACE);

    set1f(gl, pr, 'uGhost', 1.0);
    set3(gl, pr, 'uTint', scene.riderTint || [0.90, 0.28, 0.20]);
    setM4(gl, pr, 'uBones', this.riderBones);
    gl.drawElements(gl.TRIANGLES, this.riderMesh.count, this.riderMesh.type, 0);

    if (peers) {
      for (const peer of peers) {
        if (!peer.visible) continue;
        const ddx = peer.pos[0] - camera.eye[0], ddy = peer.pos[1] - camera.eye[1],
          ddz = peer.pos[2] - camera.eye[2];
        if (ddx * ddx + ddy * ddy + ddz * ddz < 6.0) continue;   // 目の前をすり抜ける瞬間は隠す
        poseRider(this.riderBones, peer);
        setM4(gl, pr, 'uBones', this.riderBones);
        set3(gl, pr, 'uTint', peer.tint);
        gl.drawElements(gl.TRIANGLES, this.riderMesh.count, this.riderMesh.type, 0);
        this.stats.drawCalls++;
      }
      // 自分のボーンを戻しておく（次フレームの影パス用）
      poseRider(this.riderBones, rider);
    }
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);

    // パーティクル
    const right = [camera.view[0], camera.view[4], camera.view[8]];
    const up = [camera.view[1], camera.view[5], camera.view[9]];
    particles.draw(gl, camera.viewProj, right, up, camera.eye,
      SUN_DIR, SUN_COLOR, FOG_DENSITY, FOG_HEIGHT);

    /* --- 3. ポスト --- */
    this._post(scene);
  }

  _commonUniforms(p, camera, time) {
    const gl = this.gl;
    setM4(gl, p, 'uViewProj', camera.viewProj);
    setM4(gl, p, 'uLightViewProj', this.lightViewProj);
    set3(gl, p, 'uCamPos', camera.eye);
    set3(gl, p, 'uSunDir', SUN_DIR);
    set3(gl, p, 'uSunColor', SUN_COLOR);
    set3(gl, p, 'uAmbSky', AMB_SKY);
    set3(gl, p, 'uAmbGround', AMB_GROUND);
    set1f(gl, p, 'uShadowTexel', 1 / SHADOW_RES);
    set1f(gl, p, 'uFogDensity', FOG_DENSITY);
    set1f(gl, p, 'uFogHeight', FOG_HEIGHT);
    set1f(gl, p, 'uTime', time);
  }

  _drawTreeInstances(chunk, shadowPass) {
    const gl = this.gl;
    // 種類ごとに分けず、1 本のインスタンスバッファを全メッシュで共有する。
    // 木の kind は iPhase.y に入っているが、形の差はメッシュではなくスケールで出す。
    let entry = this.treeVAOCache.get(chunk);
    if (!entry || entry.buf !== chunk.treeBuf) {
      const m = this.treeMesh;
      const vao = createVAO(gl, meshAttribs(gl, m, [
        { buffer: chunk.treeBuf, loc: 4, size: 3, stride: TREE_STRIDE * 4, offset: 0, divisor: 1 },
        { buffer: chunk.treeBuf, loc: 5, size: 3, stride: TREE_STRIDE * 4, offset: 12, divisor: 1 },
        { buffer: chunk.treeBuf, loc: 6, size: 4, stride: TREE_STRIDE * 4, offset: 24, divisor: 1 },
        { buffer: chunk.treeBuf, loc: 7, size: 2, stride: TREE_STRIDE * 4, offset: 40, divisor: 1 },
      ]), { buffer: m.ib });
      entry = { vao, buf: chunk.treeBuf, count: m.count, type: m.type };
      this.treeVAOCache.set(chunk, entry);
    }
    gl.bindVertexArray(entry.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, entry.count, entry.type, 0, chunk.treeCount);
  }

  _drawProps(props, camera, time) {
    const gl = this.gl;
    if (!props || !props.length) return;

    for (const s of this.propInst) s.count = 0;
    const cx = camera.eye[0], cz = camera.eye[2];
    for (const pr of props) {
      const t = pr.type;
      const slot = this.propInst[t];
      if (!slot || slot.count >= 900) continue;
      const dx = pr.x - cx, dz = pr.z - cz;
      const d2 = dx * dx + dz * dz;
      // 小さい小物は近くだけ
      const maxD = (t === PROP.POLE || t === PROP.FLAG) ? 160 : t === PROP.LIFT_TOWER ? 900 : 420;
      if (d2 > maxD * maxD) continue;
      const i = slot.count++;
      slot.data[i * 5] = pr.x;
      slot.data[i * 5 + 1] = pr.y;
      slot.data[i * 5 + 2] = pr.z;
      slot.data[i * 5 + 3] = pr.rot;
      slot.data[i * 5 + 4] = pr.scale;
    }

    const p = this.pProp;
    p.use();
    this._commonUniforms(p, camera, time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.depthTex);
    set1i(gl, p, 'uShadowMap', 0);
    gl.disable(gl.CULL_FACE);
    for (let t = 0; t < this.propInst.length; t++) {
      const slot = this.propInst[t];
      if (!slot.count) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, slot.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, slot.data, 0, slot.count * 5);
      gl.bindVertexArray(slot.vao);
      const m = this.propMeshes[t];
      gl.drawElementsInstanced(gl.TRIANGLES, m.count, m.type, 0, slot.count);
      this.stats.drawCalls++;
    }
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  _post(scene) {
    const gl = this.gl;
    const rider = scene.rider;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // ブライトパス
    this.bloomA.bind();
    this.pBright.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.color);
    set1i(gl, this.pBright, 'uTex', 0);
    set1f(gl, this.pBright, 'uThreshold', 1.30);
    drawFullscreen(gl);

    const blur = (src, dst, dx, dy) => {
      dst.bind();
      this.pBlur.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.color);
      set1i(gl, this.pBlur, 'uTex', 0);
      set2f(gl, this.pBlur, 'uDir', dx / dst.width, dy / dst.height);
      drawFullscreen(gl);
    };
    blur(this.bloomA, this.bloomB, 1, 0);
    blur(this.bloomB, this.bloomA, 0, 1);
    // もう一段小さくして広いにじみを作る
    blur(this.bloomA, this.bloomC, 1, 0);
    blur(this.bloomC, this.bloomD, 0, 1);
    blur(this.bloomD, this.bloomC, 2, 0);
    blur(this.bloomC, this.bloomD, 0, 2);

    // 合成
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const c = this.pComposite;
    c.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.color);
    set1i(gl, c, 'uScene', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.color);
    set1i(gl, c, 'uBloom', 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomD.color);
    set1i(gl, c, 'uBloom2', 2);

    // --- 太陽の画面座標。グレアを引き伸ばす向きに使う ---
    const eye = scene.camera.eye;
    const sw = _sunWorld;
    sw[0] = eye[0] + SUN_DIR[0] * 6000;
    sw[1] = eye[1] + SUN_DIR[1] * 6000;
    sw[2] = eye[2] + SUN_DIR[2] * 6000;
    const m = scene.camera.viewProj;
    const cw = m[3] * sw[0] + m[7] * sw[1] + m[11] * sw[2] + m[15];
    let sunU = 0.5, sunV = 0.5, sunVis = 0;
    if (cw > 0) {
      const cx2 = (m[0] * sw[0] + m[4] * sw[1] + m[8] * sw[2] + m[12]) / cw;
      const cy2 = (m[1] * sw[0] + m[5] * sw[1] + m[9] * sw[2] + m[13]) / cw;
      sunU = cx2 * 0.5 + 0.5;
      sunV = cy2 * 0.5 + 0.5;
      // 画面外へ出るほど滑らかに消す
      const out = Math.max(Math.abs(sunU - 0.5), Math.abs(sunV - 0.5));
      sunVis = clamp01(1 - (out - 0.5) / 0.55);
    }
    set2f(gl, c, 'uSunScreen', sunU, sunV);
    set1f(gl, c, 'uSunVisible', sunVis * 0.9);
    set3(gl, c, 'uGlareColor', GLARE_COLOR);

    const speed01 = clamp01(rider.speed / 34);
    set1f(gl, c, 'uExposure', this.exposure);
    set1f(gl, c, 'uBloomAmt', 0.30);
    set1f(gl, c, 'uVignette', 0.34 + speed01 * 0.16);
    set1f(gl, c, 'uAberration', 0.0009 + speed01 * 0.0018);
    set1f(gl, c, 'uGrain', 0.020);
    set1f(gl, c, 'uTime', scene.time);
    set1f(gl, c, 'uSpeedBlur', Math.max(0, speed01 - 0.32) * 1.5);
    set1f(gl, c, 'uFlow', rider.flow);
    set1f(gl, c, 'uWipe', rider.state === STATE.WIPEOUT
      ? clamp01(rider.wipeoutTimer / 0.5) * clamp01(2 - rider.wipeoutTimer) : 0);
    drawFullscreen(gl);

    gl.enable(gl.DEPTH_TEST);
  }
}

const _lightView = M4.create();
const _lightProj = M4.create();
