// 数学ユーティリティ。ベクトルは長さ3の配列、行列は列優先の Float32Array(16)。
// ホットパスで使うので、出力先を渡して確保を避けられる形にしてある。

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const mix = lerp;

export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
}

export function smootherstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// フレームレート非依存の指数補間。rate が大きいほど速く追従する。
export function damp(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

// -PI..PI に折り返した角度差
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function lerpAngle(a, b, t) {
  return a + angleDelta(a, b) * t;
}

export function dampAngle(a, b, rate, dt) {
  return a + angleDelta(a, b) * (1 - Math.exp(-rate * dt));
}

/* ------------------------------------------------------------------ vec3 */

export const V3 = {
  create: (x = 0, y = 0, z = 0) => [x, y, z],
  set(o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; },
  copy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  clone: (a) => [a[0], a[1], a[2]],
  add(o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub(o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  mul(o, a, b) { o[0] = a[0] * b[0]; o[1] = a[1] * b[1]; o[2] = a[2] * b[2]; return o; },
  scale(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  // o = a + b*s
  scaleAndAdd(o, a, b, s) { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross(o, a, b) {
    const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    o[0] = ay * bz - az * by;
    o[1] = az * bx - ax * bz;
    o[2] = ax * by - ay * bx;
    return o;
  },
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  lenSq: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  distSq(a, b) {
    const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
    return x * x + y * y + z * z;
  },
  normalize(o, a) {
    const l = Math.hypot(a[0], a[1], a[2]);
    if (l < 1e-12) { o[0] = 0; o[1] = 0; o[2] = 0; return o; }
    const s = 1 / l;
    o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s;
    return o;
  },
  lerp(o, a, b, t) {
    o[0] = a[0] + (b[0] - a[0]) * t;
    o[1] = a[1] + (b[1] - a[1]) * t;
    o[2] = a[2] + (b[2] - a[2]) * t;
    return o;
  },
  // a を法線 n の平面へ射影（n は正規化済みであること）
  projectOnPlane(o, a, n) {
    const d = a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
    o[0] = a[0] - n[0] * d;
    o[1] = a[1] - n[1] * d;
    o[2] = a[2] - n[2] * d;
    return o;
  },
  transformM4(o, a, m) {
    const x = a[0], y = a[1], z = a[2];
    let w = m[3] * x + m[7] * y + m[11] * z + m[15];
    w = w || 1;
    o[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    o[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    o[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    return o;
  },
};

/* ------------------------------------------------------------------ mat4 */
// 列優先。m[col*4 + row]。WebGL がそのまま食える並び。

export const M4 = {
  create() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  identity(o) {
    o.fill(0);
    o[0] = o[5] = o[10] = o[15] = 1;
    return o;
  },
  copy(o, a) { o.set(a); return o; },

  multiply(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    o.fill(0);
    o[0] = f / aspect;
    o[5] = f;
    o[11] = -1;
    if (far != null && far !== Infinity) {
      const nf = 1 / (near - far);
      o[10] = (far + near) * nf;
      o[14] = 2 * far * near * nf;
    } else {
      o[10] = -1;
      o[14] = -2 * near;
    }
    return o;
  },

  ortho(o, left, right, bottom, top, near, far) {
    const lr = 1 / (left - right), bt = 1 / (bottom - top), nf = 1 / (near - far);
    o.fill(0);
    o[0] = -2 * lr;
    o[5] = -2 * bt;
    o[10] = 2 * nf;
    o[12] = (left + right) * lr;
    o[13] = (top + bottom) * bt;
    o[14] = (far + near) * nf;
    o[15] = 1;
    return o;
  },

  lookAt(o, eye, center, up) {
    let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    let len = Math.hypot(z0, z1, z2);
    if (len < 1e-8) { z0 = 0; z1 = 0; z2 = 1; len = 1; }
    z0 /= len; z1 /= len; z2 /= len;

    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    len = Math.hypot(x0, x1, x2);
    if (len < 1e-8) {
      // up と視線が平行。適当な直交軸を選ぶ。
      x0 = z1 !== 0 || z2 !== 0 ? 1 : 0;
      x1 = 0; x2 = x0 === 1 ? 0 : 1;
      const d = x0 * z0 + x1 * z1 + x2 * z2;
      x0 -= z0 * d; x1 -= z1 * d; x2 -= z2 * d;
      len = Math.hypot(x0, x1, x2) || 1;
    }
    x0 /= len; x1 /= len; x2 /= len;

    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;

    o[0] = x0; o[1] = y0; o[2] = z0; o[3] = 0;
    o[4] = x1; o[5] = y1; o[6] = z1; o[7] = 0;
    o[8] = x2; o[9] = y2; o[10] = z2; o[11] = 0;
    o[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    o[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    o[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    o[15] = 1;
    return o;
  },

  // 平行移動・クォータニオン回転・スケールから合成
  compose(o, pos, q, scale) {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = scale ? scale[0] : 1, sy = scale ? scale[1] : 1, sz = scale ? scale[2] : 1;

    o[0] = (1 - (yy + zz)) * sx;
    o[1] = (xy + wz) * sx;
    o[2] = (xz - wy) * sx;
    o[3] = 0;
    o[4] = (xy - wz) * sy;
    o[5] = (1 - (xx + zz)) * sy;
    o[6] = (yz + wx) * sy;
    o[7] = 0;
    o[8] = (xz + wy) * sz;
    o[9] = (yz - wx) * sz;
    o[10] = (1 - (xx + yy)) * sz;
    o[11] = 0;
    o[12] = pos[0];
    o[13] = pos[1];
    o[14] = pos[2];
    o[15] = 1;
    return o;
  },

  // 基底ベクトル（正規直交である前提）と位置から合成
  fromBasis(o, right, up, fwd, pos) {
    o[0] = right[0]; o[1] = right[1]; o[2] = right[2]; o[3] = 0;
    o[4] = up[0]; o[5] = up[1]; o[6] = up[2]; o[7] = 0;
    o[8] = fwd[0]; o[9] = fwd[1]; o[10] = fwd[2]; o[11] = 0;
    o[12] = pos[0]; o[13] = pos[1]; o[14] = pos[2]; o[15] = 1;
    return o;
  },

  translate(o, a, v) {
    if (o !== a) o.set(a);
    o[12] = a[0] * v[0] + a[4] * v[1] + a[8] * v[2] + a[12];
    o[13] = a[1] * v[0] + a[5] * v[1] + a[9] * v[2] + a[13];
    o[14] = a[2] * v[0] + a[6] * v[1] + a[10] * v[2] + a[14];
    o[15] = a[3] * v[0] + a[7] * v[1] + a[11] * v[2] + a[15];
    return o;
  },

  scale(o, a, v) {
    for (let i = 0; i < 4; i++) {
      o[i] = a[i] * v[0];
      o[4 + i] = a[4 + i] * v[1];
      o[8 + i] = a[8 + i] * v[2];
      o[12 + i] = a[12 + i];
    }
    return o;
  },

  invert(o, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;

    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },

  // 法線行列（左上3x3の逆転置）を mat3 相当の Float32Array(9) で返す
  normalMatrix(o9, m) {
    const a00 = m[0], a01 = m[1], a02 = m[2];
    const a10 = m[4], a11 = m[5], a12 = m[6];
    const a20 = m[8], a21 = m[9], a22 = m[10];
    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) { o9.fill(0); o9[0] = o9[4] = o9[8] = 1; return o9; }
    det = 1 / det;
    o9[0] = b01 * det;
    o9[1] = (-a22 * a01 + a02 * a21) * det;
    o9[2] = (a12 * a01 - a02 * a11) * det;
    o9[3] = b11 * det;
    o9[4] = (a22 * a00 - a02 * a20) * det;
    o9[5] = (-a12 * a00 + a02 * a10) * det;
    o9[6] = b21 * det;
    o9[7] = (-a21 * a00 + a01 * a20) * det;
    o9[8] = (a11 * a00 - a01 * a10) * det;
    return o9;
  },
};

/* ------------------------------------------------------------- quaternion */
// [x, y, z, w]

export const Q = {
  create: () => [0, 0, 0, 1],
  identity(o) { o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 1; return o; },
  copy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; o[3] = a[3]; return o; },

  fromAxisAngle(o, axis, rad) {
    const h = rad * 0.5, s = Math.sin(h);
    o[0] = axis[0] * s; o[1] = axis[1] * s; o[2] = axis[2] * s; o[3] = Math.cos(h);
    return o;
  },

  multiply(o, a, b) {
    const ax = a[0], ay = a[1], az = a[2], aw = a[3];
    const bx = b[0], by = b[1], bz = b[2], bw = b[3];
    o[0] = ax * bw + aw * bx + ay * bz - az * by;
    o[1] = ay * bw + aw * by + az * bx - ax * bz;
    o[2] = az * bw + aw * bz + ax * by - ay * bx;
    o[3] = aw * bw - ax * bx - ay * by - az * bz;
    return o;
  },

  normalize(o, a) {
    const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
    const s = 1 / l;
    o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; o[3] = a[3] * s;
    return o;
  },

  slerp(o, a, b, t) {
    let ax = a[0], ay = a[1], az = a[2], aw = a[3];
    let bx = b[0], by = b[1], bz = b[2], bw = b[3];
    let cos = ax * bx + ay * by + az * bz + aw * bw;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let s0, s1;
    if (1 - cos > 1e-6) {
      const omega = Math.acos(cos), sin = Math.sin(omega);
      s0 = Math.sin((1 - t) * omega) / sin;
      s1 = Math.sin(t * omega) / sin;
    } else {
      s0 = 1 - t; s1 = t;
    }
    o[0] = s0 * ax + s1 * bx;
    o[1] = s0 * ay + s1 * by;
    o[2] = s0 * az + s1 * bz;
    o[3] = s0 * aw + s1 * bw;
    return o;
  },

  rotateVec(o, q, v) {
    const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const vx = v[0], vy = v[1], vz = v[2];
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    o[0] = vx + qw * tx + (qy * tz - qz * ty);
    o[1] = vy + qw * ty + (qz * tx - qx * tz);
    o[2] = vz + qw * tz + (qx * ty - qy * tx);
    return o;
  },

  // 正規直交基底からクォータニオンを作る（列: right, up, fwd）
  fromBasis(o, r, u, f) {
    const m00 = r[0], m01 = u[0], m02 = f[0];
    const m10 = r[1], m11 = u[1], m12 = f[1];
    const m20 = r[2], m21 = u[2], m22 = f[2];
    const trace = m00 + m11 + m22;
    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      o[3] = 0.25 * s;
      o[0] = (m21 - m12) / s;
      o[1] = (m02 - m20) / s;
      o[2] = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      o[3] = (m21 - m12) / s;
      o[0] = 0.25 * s;
      o[1] = (m01 + m10) / s;
      o[2] = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      o[3] = (m02 - m20) / s;
      o[0] = (m01 + m10) / s;
      o[1] = 0.25 * s;
      o[2] = (m12 + m21) / s;
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      o[3] = (m10 - m01) / s;
      o[0] = (m02 + m20) / s;
      o[1] = (m12 + m21) / s;
      o[2] = 0.25 * s;
    }
    return Q.normalize(o, o);
  },
};

/* ------------------------------------------------------------- 視錐台判定 */

// viewProj から6平面を取り出す（正規化済み、Float32Array(24) に [nx,ny,nz,d] * 6）
export function extractFrustum(out, m) {
  const rows = [
    [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],   // left
    [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],   // right
    [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],   // bottom
    [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],   // top
    [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],  // near
    [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],  // far
  ];
  for (let i = 0; i < 6; i++) {
    const p = rows[i];
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    out[i * 4] = p[0] / l;
    out[i * 4 + 1] = p[1] / l;
    out[i * 4 + 2] = p[2] / l;
    out[i * 4 + 3] = p[3] / l;
  }
  return out;
}

// 球が視錐台と交差するか
export function sphereInFrustum(planes, cx, cy, cz, r) {
  for (let i = 0; i < 6; i++) {
    const d = planes[i * 4] * cx + planes[i * 4 + 1] * cy + planes[i * 4 + 2] * cz + planes[i * 4 + 3];
    if (d < -r) return false;
  }
  return true;
}
