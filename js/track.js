// 周回サーキットの生成。固定シードで「1周ぶん」の地形（ループ・ジャンプ・
// スプリング・トンネル）を作り、ラップ数ぶんタイル接続してゴールを置く。
import { config } from './config.js';

const STEP = 20;     // 地形ラインの x 刻み(px)
const BASE_Y = 500;  // 基準の地面高さ(y下正：大きいほど画面下)
const GAP_ARC = 70;  // ライバルがギャップを飛び越える見た目の山の高さ(px)

// 決定的擬似乱数。seed 固定で同じコースを再現できる。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function indexAt(track, x) {
  const p = track.points;
  if (x <= p[0].x) return 0;
  if (x >= p[p.length - 1].x) return p.length - 2;
  let lo = 0;
  let hi = p.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p[mid].x <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// x における地面の高さ(線形補間)
export function heightAt(track, x) {
  const p = track.points;
  const i = indexAt(track, x);
  const a = p[i];
  const b = p[i + 1];
  if (!b) return a.y;
  const t = (x - a.x) / (b.x - a.x);
  return a.y + (b.y - a.y) * t;
}

// x における地面の傾き(rad, 下り正)
export function slopeAt(track, x) {
  const p = track.points;
  const i = indexAt(track, x);
  const a = p[i];
  const b = p[i + 1] || a;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// x がギャップ(切れ目)内か
export function isGap(track, x) {
  for (const g of track.gaps) {
    if (x >= g[0] && x < g[1]) return true;
  }
  return false;
}

// x を含むギャップ [liftX, landX] を返す（無ければ null）
export function gapContaining(track, x) {
  for (const g of track.gaps) {
    if (x >= g[0] && x < g[1]) return g;
  }
  return null;
}

export function loopAt(track, x) {
  for (const lp of track.loops) {
    if (x >= lp.enterX && x <= lp.exitX) return lp;
  }
  return null;
}

export function tunnelCeilingAt(track, x) {
  for (const t of track.tunnels) {
    if (x >= t.x0 && x <= t.x1) return t.ceilY;
  }
  return null;
}

export function springBetween(track, a, b) {
  for (const s of track.springs) {
    if (!s._done && s.x > a && s.x <= b) return s;
  }
  return null;
}

// ライバル用：ギャップ上はリム間を結ぶ山なりで「飛び越える」滑らかな路面。
export function surfaceYAt(track, x) {
  for (const g of track.gaps) {
    if (x >= g[0] && x < g[1]) {
      const t = (x - g[0]) / (g[1] - g[0]);
      const y0 = heightAt(track, g[0]);
      const y1 = heightAt(track, g[1]);
      return y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * GAP_ARC;
    }
  }
  return heightAt(track, x);
}

export function surfaceSlopeAt(track, x) {
  const d = 6;
  return Math.atan2(surfaceYAt(track, x + d) - surfaceYAt(track, x - d), 2 * d);
}

// ---- 1周ぶんの地形生成 ----------------------------------------------------
function genSmooth(t, type, len, rng) {
  let targetSlope;
  if (type === 'up') targetSlope = -(0.20 + rng() * 0.18);
  else if (type === 'down') targetSlope = 0.20 + rng() * 0.18;
  else targetSlope = 0;
  const steps = Math.max(1, Math.round(len / STEP));
  const s0 = t.endSlope;
  let x = t.endX;
  let y = t.endY;
  let slope = s0;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    let s = s0 + (targetSlope - s0) * (0.5 - 0.5 * Math.cos(u * Math.PI));
    if (type === 'hill') s += Math.sin(u * Math.PI * 2) * 0.16;
    slope = s;
    y += Math.tan(slope) * STEP;
    x += STEP;
    t.points.push({ x, y });
  }
  t.endX = x;
  t.endY = y;
  t.endSlope = slope;
}

function genRampTo(t, targetY, len) {
  const steps = Math.max(1, Math.round(len / STEP));
  const y0 = t.endY;
  let x = t.endX;
  let y = y0;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    y = y0 + (targetY - y0) * (0.5 - 0.5 * Math.cos(u * Math.PI));
    x += STEP;
    t.points.push({ x, y });
  }
  t.endX = x;
  t.endY = targetY;
  t.endSlope = 0;
}

function genGap(t, rng) {
  const s0 = t.endSlope;
  let x = t.endX;
  let y = t.endY;
  let slope = s0;
  const kickerSlope = -(0.42 + rng() * 0.22); // 上向きキッカー
  const kickSteps = 6;
  for (let i = 1; i <= kickSteps; i++) {
    const u = i / kickSteps;
    slope = s0 + (kickerSlope - s0) * (0.5 - 0.5 * Math.cos(u * Math.PI));
    y += Math.tan(slope) * STEP;
    x += STEP;
    t.points.push({ x, y });
  }
  const liftX = x;
  const liftY = y;
  const gapW = 150 + rng() * 150;
  const landX = liftX + gapW;
  const landY = liftY + (10 + rng() * 50);
  const pitY = liftY + 320;
  t.gaps.push([liftX, landX]);
  t.points.push({ x: liftX + 2, y: pitY });
  t.points.push({ x: landX - 2, y: pitY });
  t.points.push({ x: landX, y: landY });
  x = landX;
  y = landY;
  for (let i = 1; i <= 5; i++) {
    x += STEP;
    t.points.push({ x, y });
  }
  t.endX = x;
  t.endY = y;
  t.endSlope = 0;
}

function genLoop(t, rng) {
  genSmooth(t, 'flat', 120, rng);
  const baseY = t.endY;
  const r = 56 + rng() * 24;
  const width = r * 2.4;
  const enterX = t.endX;
  const cx = enterX + width * 0.5;
  const exitX = enterX + width;
  t.loops.push({ enterX, exitX, r, cx, cy: baseY - r, baseY, _entered: false });
  let x = enterX;
  while (x + STEP < exitX) {
    x += STEP;
    t.points.push({ x, y: baseY });
  }
  t.points.push({ x: exitX, y: baseY });
  t.endX = exitX;
  t.endY = baseY;
  t.endSlope = 0;
}

function genSpring(t, rng) {
  genSmooth(t, 'flat', 120, rng);
  t.springs.push({ x: t.endX, y: t.endY, _done: false });
  genSmooth(t, 'flat', 180, rng);
}

function genTunnel(t, rng) {
  genSmooth(t, 'flat', 100, rng);
  const x0 = t.endX;
  const ground = t.endY;
  const len = 240 + rng() * 220;
  genSmooth(t, 'flat', len, rng);
  const x1 = t.endX;
  t.tunnels.push({ x0, x1, ceilY: ground - config.TUNNEL_GAP });
  genSmooth(t, 'flat', 90, rng);
}

// 1周ぶんの地形（本家風に難所を順序立てて配置）
function buildLapTemplate(seed) {
  const rng = mulberry32(seed);
  const t = {
    points: [{ x: 0, y: BASE_Y }],
    gaps: [], loops: [], springs: [], tunnels: [],
    endX: 0, endY: BASE_Y, endSlope: 0,
  };
  genSmooth(t, 'flat', 520, rng); // スタートストレート
  const seq = [
    'hill', 'down', 'loop', 'hill', 'gap', 'up',
    'spring', 'down', 'tunnel', 'hill', 'down', 'loop',
    'gap', 'hill', 'spring', 'down', 'gap',
  ];
  for (const type of seq) {
    if (type === 'gap') genGap(t, rng);
    else if (type === 'loop') genLoop(t, rng);
    else if (type === 'spring') genSpring(t, rng);
    else if (type === 'tunnel') genTunnel(t, rng);
    else genSmooth(t, type, 220 + rng() * 240, rng);
  }
  genRampTo(t, BASE_Y, 360);     // 周回をシームレスに繋ぐため水平・基準高へ
  genSmooth(t, 'flat', 260, rng);
  t.lapLen = t.endX;
  return t;
}

function appendLap(track, tmpl, off, includeFirstPoint) {
  const pts = tmpl.points;
  for (let i = includeFirstPoint ? 0 : 1; i < pts.length; i++) {
    track.points.push({ x: pts[i].x + off, y: pts[i].y });
  }
  for (const g of tmpl.gaps) track.gaps.push([g[0] + off, g[1] + off]);
  for (const lp of tmpl.loops) {
    track.loops.push({
      enterX: lp.enterX + off, exitX: lp.exitX + off, r: lp.r,
      cx: lp.cx + off, cy: lp.cy, baseY: lp.baseY, _entered: false,
    });
  }
  for (const s of tmpl.springs) track.springs.push({ x: s.x + off, y: s.y, _done: false });
  for (const tn of tmpl.tunnels) track.tunnels.push({ x0: tn.x0 + off, x1: tn.x1 + off, ceilY: tn.ceilY });
}

function scatterTurbos(track) {
  const rng = track.rng;
  let x = 360;
  while (x < track.finishX) {
    if (!isGap(track, x) && !loopAt(track, x) && tunnelCeilingAt(track, x) == null) {
      track.turbos.push({ x, y: heightAt(track, x) - (16 + rng() * 18), taken: false, guaranteed: false });
    }
    x += 320 + rng() * 240; // 連続噴射はできない密度（配分が勝負）
  }
}

function guaranteeTurbosBeforeLoops(track) {
  for (const lp of track.loops) {
    for (let i = 0; i < 2; i++) {
      const nx = lp.enterX - 1100 + i * 380;
      if (nx <= 80) continue;
      track.turbos.push({ x: nx, y: heightAt(track, nx) - 40, taken: false, guaranteed: true });
    }
  }
}

// 固定シードの周回サーキットを作る。laps 周ぶんタイル接続し、末尾にゴール。
export function createCourse(seed = config.SEED, laps = config.LAPS) {
  const tmpl = buildLapTemplate(seed);
  const track = {
    seed, laps,
    lapLen: tmpl.lapLen,
    points: [],
    gaps: [], loops: [], springs: [], tunnels: [], turbos: [],
    lapBoundaries: [],
    rng: mulberry32(seed ^ 0x9e3779b9),
  };
  for (let k = 0; k < laps; k++) {
    appendLap(track, tmpl, k * tmpl.lapLen, k === 0);
    track.lapBoundaries.push((k + 1) * tmpl.lapLen);
  }
  track.finishX = laps * tmpl.lapLen;
  let x = track.finishX;
  for (let i = 1; i <= 50; i++) { x += STEP; track.points.push({ x, y: BASE_Y }); }
  track.endX = x;
  scatterTurbos(track);
  guaranteeTurbosBeforeLoops(track);
  return track;
}
