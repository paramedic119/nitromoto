// 周回コースの生成。固定シードで「1周ぶん」の地形（ループ・ジャンプ・
// スプリング・トンネル）を作り、ラップ数ぶんタイル接続してゴールを置く。
// 物理側は points(折れ線) と gaps/loops/springs/tunnels/turbos を参照して動く。
import { config } from './config.js';

const STEP = 20;     // 地形ラインの x 刻み(px)
const BASE_Y = 500;  // 基準の地面高さ(y下正：大きいほど画面下)

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

// x 以下で最大の点のインデックス(線分の左端)を二分探索で返す
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

// x がギャップ(切れ目)内か。上端は exclusive（着地リム landX は地面扱い）。
export function isGap(track, x) {
  for (const g of track.gaps) {
    if (x >= g[0] && x < g[1]) return true;
  }
  return false;
}

// x を含むループを返す(なければ null)
export function loopAt(track, x) {
  for (const lp of track.loops) {
    if (x >= lp.enterX && x <= lp.exitX) return lp;
  }
  return null;
}

// x のトンネル天井の高さ(world y)。トンネル外は null。
export function tunnelCeilingAt(track, x) {
  for (const t of track.tunnels) {
    if (x >= t.x0 && x <= t.x1) return t.ceilY;
  }
  return null;
}

// 区間 [a, b] を横切るスプリングを返す(まだ未使用のもの)。
export function springBetween(track, a, b) {
  for (const s of track.springs) {
    if (!s._done && s.x > a && s.x <= b) return s;
  }
  return null;
}

// ---- 1周ぶんの地形生成 ----------------------------------------------------
// 各 gen* は t(生成中のコース)の end{X,Y,Slope} を更新しつつ points を伸ばす。

// 平坦/起伏/上り/下り。傾きを余弦補間で滑らかに変化させ C1 連続を保つ。
function genSmooth(t, type, len, rng) {
  let targetSlope;
  if (type === 'up') targetSlope = -(0.20 + rng() * 0.18);     // 上り(y下正で負)
  else if (type === 'down') targetSlope = 0.20 + rng() * 0.18; // 下り(正)
  else targetSlope = 0;                                        // flat / hill のベース
  const steps = Math.max(1, Math.round(len / STEP));
  const s0 = t.endSlope;
  let x = t.endX;
  let y = t.endY;
  let slope = s0;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    let s = s0 + (targetSlope - s0) * (0.5 - 0.5 * Math.cos(u * Math.PI));
    if (type === 'hill') s += Math.sin(u * Math.PI * 2) * 0.16; // 起伏の波
    slope = s;
    y += Math.tan(slope) * STEP;
    x += STEP;
    t.points.push({ x, y });
  }
  t.endX = x;
  t.endY = y;
  t.endSlope = slope;
}

// 現在地から targetY へ滑らかに戻し、末端を平坦(slope=0)にする。
// 周回をシームレスにつなぐため、各ラップは必ず BASE_Y / 水平で終える。
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

// ジャンプ台(キッカー)＋ギャップ(ピット)＋着地リム。離陸→放物落下→着地。
function genGap(t, rng) {
  const s0 = t.endSlope;
  let x = t.endX;
  let y = t.endY;
  let slope = s0;
  const kickerSlope = -(0.4 + rng() * 0.2); // 上向き(負=上り)
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
  const gapW = 130 + rng() * 150;
  const landX = liftX + gapW;
  const landY = liftY + (10 + rng() * 60); // 着地リムは少し低い
  const pitY = liftY + 320;                // ピット底(crashの目印)
  t.gaps.push([liftX, landX]);
  t.points.push({ x: liftX + 2, y: pitY });
  t.points.push({ x: landX - 2, y: pitY });
  t.points.push({ x: landX, y: landY });
  x = landX;
  y = landY;
  for (let i = 1; i <= 4; i++) {
    x += STEP;
    t.points.push({ x, y });
  }
  t.endX = x;
  t.endY = y;
  t.endSlope = 0;
}

// 360度ループ。地形は平坦のまま。進入速度判定＋回転演出は game/renderer 側。
function genLoop(t, rng) {
  // 助走で水平に整える
  genSmooth(t, 'flat', 120, rng);
  const baseY = t.endY;
  const r = 55 + rng() * 25;
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

// スプリング(ジャンプ台)。平坦な助走に1基設置。踏むと真上へ大ジャンプ。
function genSpring(t, rng) {
  genSmooth(t, 'flat', 120, rng);
  t.springs.push({ x: t.endX, y: t.endY, _done: false });
  genSmooth(t, 'flat', 160, rng);
}

// トンネル。平坦区間の上に低い天井。飛び上がって頭をぶつけるとクラッシュ。
function genTunnel(t, rng) {
  genSmooth(t, 'flat', 100, rng); // 水平な導入
  const x0 = t.endX;
  const ground = t.endY;
  const len = 240 + rng() * 220;
  genSmooth(t, 'flat', len, rng);
  const x1 = t.endX;
  t.tunnels.push({ x0, x1, ceilY: ground - config.TUNNEL_GAP });
  genSmooth(t, 'flat', 80, rng);
}

// 1周ぶんの地形を組み立てる。本家風に難所を順序立てて配置（運ゲーにしない）。
function buildLapTemplate(seed) {
  const rng = mulberry32(seed);
  const t = {
    points: [{ x: 0, y: BASE_Y }],
    gaps: [],
    loops: [],
    springs: [],
    tunnels: [],
    endX: 0,
    endY: BASE_Y,
    endSlope: 0,
  };
  // スタートストレート
  genSmooth(t, 'flat', 520, rng);
  // 難所シーケンス（ループ前は必ず下り/平坦で速度を乗せる）
  const seq = [
    'hill', 'down', 'loop', 'hill', 'gap', 'up',
    'spring', 'down', 'tunnel', 'hill', 'down', 'loop',
    'gap', 'hill', 'spring', 'down',
  ];
  for (const type of seq) {
    if (type === 'gap') genGap(t, rng);
    else if (type === 'loop') genLoop(t, rng);
    else if (type === 'spring') genSpring(t, rng);
    else if (type === 'tunnel') genTunnel(t, rng);
    else genSmooth(t, type, 220 + rng() * 240, rng);
  }
  // フィニッシュ前は必ず水平・基準高へ戻す（周回のシームレス接続のため）
  genRampTo(t, BASE_Y, 360);
  genSmooth(t, 'flat', 260, rng);
  t.lapLen = t.endX;
  return t;
}

// テンプレを offset ぶん右へずらして本コースへ流し込む。
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

// ターボパネルを区間に均等散布（ギャップ/ループ/トンネル上は避ける）。
function scatterTurbos(track) {
  const rng = track.rng;
  let x = 360;
  while (x < track.finishX) {
    if (!isGap(track, x) && !loopAt(track, x) && tunnelCeilingAt(track, x) == null) {
      track.turbos.push({
        x,
        y: heightAt(track, x) - (16 + rng() * 20),
        taken: false,
        guaranteed: false,
      });
    }
    x += 220 + rng() * 180;
  }
}

// 各ループ手前にクリアへ足りるターボを必ず置く(運ゲー防止)。
function guaranteeTurbosBeforeLoops(track) {
  for (const lp of track.loops) {
    for (let i = 0; i < 3; i++) {
      const nx = lp.enterX - 1500 + i * 360;
      if (nx <= 80) continue;
      track.turbos.push({
        x: nx,
        y: heightAt(track, nx) - 40,
        taken: false,
        guaranteed: true,
      });
    }
  }
}

// 固定シードの周回コースを作る。laps 周ぶんタイル接続し、末尾にゴール。
export function createCourse(seed = config.SEED, laps = config.LAPS) {
  const tmpl = buildLapTemplate(seed);
  const track = {
    seed,
    laps,
    lapLen: tmpl.lapLen,
    points: [], // 最初のラップ(includeFirstPoint)で x=0 から積む
    gaps: [],
    loops: [],
    springs: [],
    tunnels: [],
    turbos: [],
    lapBoundaries: [],
    rng: mulberry32(seed ^ 0x9e3779b9),
  };
  for (let k = 0; k < laps; k++) {
    appendLap(track, tmpl, k * tmpl.lapLen, k === 0);
    track.lapBoundaries.push((k + 1) * tmpl.lapLen);
  }
  track.finishX = laps * tmpl.lapLen;
  // ゴール後の流走路（減速して停止できるように）
  let x = track.finishX;
  for (let i = 1; i <= 40; i++) {
    x += STEP;
    track.points.push({ x, y: BASE_Y });
  }
  track.endX = x;
  scatterTurbos(track);
  guaranteeTurbosBeforeLoops(track);
  return track;
}

// 後方互換のためのエイリアス（旧名 createTrack を残す）。
export const createTrack = createCourse;
