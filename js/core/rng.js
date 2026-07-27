// 決定論的な乱数とノイズ。Math.random は一切使わない。
// オンラインで全員が同じ山にいるためには、地形が完全に再現可能である必要がある。

/** 32bit 整数ハッシュ（Thomas Wang / murmur 系のミックス）。 */
export function hashInt(n) {
  n = n | 0;
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return n >>> 0;
}

// ノイズの内側で何十万回も回るので、乗算は 3 回に抑えてある。
// seed は x/y の乗算で十分に撹拌されるため、そのまま XOR するだけでよい。
export function hash2i(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ (seed | 0)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  return h >>> 0;
}

export function hash3i(x, y, z, seed = 0) {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^
          Math.imul(z | 0, 0x1b56c4e9) ^ Math.imul(seed | 0, 0xcb1ab31f);
  h = h ^ (h >>> 15);
  h = Math.imul(h, 0x2c1b3c6d);
  h = h ^ (h >>> 12);
  h = Math.imul(h, 0x297a2d39);
  h = h ^ (h >>> 15);
  return h >>> 0;
}

/** 格子点の [0,1) 乱数 */
export const rand2 = (x, y, seed = 0) => hash2i(x, y, seed) / 4294967296;
export const rand3 = (x, y, z, seed = 0) => hash3i(x, y, z, seed) / 4294967296;
export const rand1 = (x, seed = 0) => hash2i(x, 0x5bf03635, seed) / 4294967296;

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D バリューノイズ。戻り値 -1..1。 */
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = rand2(xi, yi, seed);
  const b = rand2(xi + 1, yi, seed);
  const c = rand2(xi, yi + 1, seed);
  const d = rand2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * u;
  const bot = c + (d - c) * u;
  return (top + (bot - top) * v) * 2 - 1;
}

/** 1D バリューノイズ。戻り値 -1..1。 */
export function noise1(x, seed = 0) {
  const xi = Math.floor(x);
  const u = fade(x - xi);
  const a = rand1(xi, seed);
  const b = rand1(xi + 1, seed);
  return (a + (b - a) * u) * 2 - 1;
}

/**
 * 2D 勾配ノイズ（Perlin 風）。バリューノイズより格子の癖が出にくいので、
 * 地形の大きなうねりにはこちらを使う。戻り値はおおよそ -1..1。
 */
// 16 方向の勾配テーブル。分岐なしで引けるようにしてある。
const K = 0.9238795, S = 0.3826834, R = 0.7071068;
const GX = new Float64Array([1, K, R, S, 0, -S, -R, -K, -1, -K, -R, -S, 0, S, R, K]);
const GY = new Float64Array([0, S, R, K, 1, K, R, S, 0, -S, -R, -K, -1, -K, -R, -S]);

export function gradNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);

  const h00 = hash2i(xi, yi, seed) & 15;
  const h10 = hash2i(xi + 1, yi, seed) & 15;
  const h01 = hash2i(xi, yi + 1, seed) & 15;
  const h11 = hash2i(xi + 1, yi + 1, seed) & 15;

  const xf1 = xf - 1, yf1 = yf - 1;
  const n00 = GX[h00] * xf + GY[h00] * yf;
  const n10 = GX[h10] * xf1 + GY[h10] * yf;
  const n01 = GX[h01] * xf + GY[h01] * yf1;
  const n11 = GX[h11] * xf1 + GY[h11] * yf1;

  const top = n00 + (n10 - n00) * u;
  const bot = n01 + (n11 - n01) * u;
  return (top + (bot - top) * v) * 1.42;
}

/** フラクタルブラウン運動。戻り値はおおよそ -1..1 に正規化される。 */
export function fbm2(x, y, seed = 0, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += gradNoise2(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

export function fbmValue2(x, y, seed = 0, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 7919) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

/** 尾根状ノイズ。0..1。稜線や吹きだまりに使う。 */
export function ridged2(x, y, seed = 0, octaves = 4, lacunarity = 2.07, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(gradNoise2(x * freq, y * freq, seed + i * 3571));
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

/** ボロノイ距離場。0..1 程度。コブ・木の配置・岩に使う。 */
export function worley2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 8;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const h = hash2i(cx, cy, seed);
      const px = cx + (h & 0xffff) / 65536;
      const py = cy + ((h >>> 16) & 0xffff) / 65536;
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/** シード付き PRNG（mulberry32）。生成物の一貫性が必要な所で使う。 */
export class Rng {
  constructor(seed = 1) {
    this.s = (seed | 0) >>> 0 || 1;
  }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(a + (b - a + 1) * this.next()); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  // 正規分布っぽい値（-1..1 中心寄り）
  bell() { return (this.next() + this.next() + this.next()) / 1.5 - 1; }
}
