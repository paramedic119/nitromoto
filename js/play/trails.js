// シュプール（滑走の軌跡）。
//
// ワールド空間を span メートル周期でタイリングした 1 枚のテクスチャに書き込む。
// テクセルは「ワールド座標 mod span」に固定で対応するので、原点を動かす必要がない。
// 表示窓から出ていったテクセルだけを消せば、無限の山にどこまでも轍が残る。
// R = 溝の深さ / G = 掻き出された雪。

import { createProgram, createBuffer, createVAO, createFBO } from '../core/gl.js';
import { trailVS, trailFS } from '../gfx/shaders.js';

export const TRAIL_SPAN = 320;    // テクスチャが覆うワールドの一辺 (m)
export const TRAIL_RES = 1024;

const MAX_STROKES = 256;

export class Trails {
  constructor(gl) {
    this.gl = gl;
    this.span = TRAIL_SPAN;
    this.texel = TRAIL_SPAN / TRAIL_RES;

    this.fbo = createFBO(gl, {
      width: TRAIL_RES, height: TRAIL_RES,
      color: [{ internalFormat: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE }],
      depth: false,
    });
    this.texture = this.fbo.colors[0];
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.prog = createProgram(gl, trailVS, trailFS, 'trail');

    const corners = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
    this.cornerBuf = createBuffer(gl, gl.ARRAY_BUFFER, corners);
    this.quadBuf = gl.createBuffer();
    this.sizeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_STROKES * 16, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_STROKES * 12, gl.DYNAMIC_DRAW);

    this.vao = createVAO(gl, [
      { buffer: this.cornerBuf, loc: 0, size: 2 },
      { buffer: this.quadBuf, loc: 1, size: 4, divisor: 1 },
      { buffer: this.sizeBuf, loc: 2, size: 3, divisor: 1 },
    ]);

    this.quadData = new Float32Array(MAX_STROKES * 4);
    this.sizeData = new Float32Array(MAX_STROKES * 3);
    this.count = 0;

    this._minX = null;
    this._minZ = null;
    this._cleared = false;
  }

  /** 表示窓を動かし、外へ出たテクセル列を消す。 */
  recenter(centerX, centerZ) {
    const gl = this.gl;
    const half = this.span * 0.5;
    const minX = Math.floor((centerX - half) / this.texel);
    const minZ = Math.floor((centerZ - half) / this.texel);

    if (!this._cleared) {
      this.fbo.bind([0, 0, 0, 1]);
      this._minX = minX; this._minZ = minZ;
      this._cleared = true;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }
    if (minX === this._minX && minZ === this._minZ) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.fbo);
    gl.viewport(0, 0, TRAIL_RES, TRAIL_RES);
    gl.enable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.disable(gl.BLEND);

    const clearSpan = (start, n, axis) => {
      // 窓から出ていった n 本のテクセル列。折り返すので最大 2 矩形になる。
      if (n <= 0) return;
      if (n >= TRAIL_RES) {
        gl.scissor(0, 0, TRAIL_RES, TRAIL_RES);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      let a = ((start % TRAIL_RES) + TRAIL_RES) % TRAIL_RES;
      const first = Math.min(n, TRAIL_RES - a);
      if (axis === 0) gl.scissor(a, 0, first, TRAIL_RES);
      else gl.scissor(0, a, TRAIL_RES, first);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (n > first) {
        if (axis === 0) gl.scissor(0, 0, n - first, TRAIL_RES);
        else gl.scissor(0, 0, TRAIL_RES, n - first);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    };

    const dx = minX - this._minX;
    if (dx > 0) clearSpan(this._minX, Math.min(dx, TRAIL_RES), 0);
    else if (dx < 0) clearSpan(minX + TRAIL_RES, Math.min(-dx, TRAIL_RES), 0);

    const dz = minZ - this._minZ;
    if (dz > 0) clearSpan(this._minZ, Math.min(dz, TRAIL_RES), 1);
    else if (dz < 0) clearSpan(minZ + TRAIL_RES, Math.min(-dz, TRAIL_RES), 1);

    this._minX = minX; this._minZ = minZ;
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** 1 ストローク積む。dir は進行方向。スキーは左右 2 本ぶん呼ばれる。 */
  stroke(x, z, dirX, dirZ, halfLen, halfWidth, depth) {
    if (this.count >= MAX_STROKES) return;
    const i = this.count++;
    const l = Math.hypot(dirX, dirZ) || 1;
    this.quadData[i * 4] = x;
    this.quadData[i * 4 + 1] = z;
    this.quadData[i * 4 + 2] = dirX / l;
    this.quadData[i * 4 + 3] = dirZ / l;
    this.sizeData[i * 3] = halfLen;
    this.sizeData[i * 3 + 1] = halfWidth;
    this.sizeData[i * 3 + 2] = depth;
  }

  /** 積んだストロークをまとめて書き込む。 */
  flush() {
    const gl = this.gl;
    if (!this.count) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.quadData, 0, this.count * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sizeData, 0, this.count * 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.fbo);
    gl.viewport(0, 0, TRAIL_RES, TRAIL_RES);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    this.prog.use();
    gl.uniform2f(this.prog.u.uOrigin, 0, 0);
    gl.uniform1f(this.prog.u.uSpan, this.span);
    gl.bindVertexArray(this.vao);

    // ワールドを周期タイリングしているので、境界をまたぐぶんを 9 通り描く。
    // ほとんどはクリップされるので実質ただ。
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        gl.uniform2f(this.prog.u.uWrap, ox, oy);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
      }
    }

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    this.count = 0;
  }
}
