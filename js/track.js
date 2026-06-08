// コース自動生成（契約ベース）。各生成関数は接続点で高さと傾きを連続させる。
// 物理側は points(折れ線) と gaps/loops/nitros を参照して動く。
import { config } from './config.js';

const STEP = 20;     // 地形ラインの x 刻み(px)
const BASE_Y = 500;  // 基準の地面高さ(y下正：大きいほど画面下)

// 決定的擬似乱数。seed 固定で同じコースを再現できる(テスト・デバッグ用)。
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

// 平坦/起伏/上り/下りを生成。傾きを余弦補間で滑らかに変化させ C1 連続を保つ。
function genSmooth(track, startX, startY, startSlope, type, len, rng) {
  let targetSlope;
  if (type === 'up') targetSlope = -(0.22 + rng() * 0.22);     // 上り(y下正で負)
  else if (type === 'down') targetSlope = 0.22 + rng() * 0.22; // 下り(正)
  else targetSlope = 0;                                        // flat / hill のベース
  const steps = Math.max(1, Math.round(len / STEP));
  let x = startX;
  let y = startY;
  let slope = startSlope;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    let s = startSlope + (targetSlope - startSlope) * (0.5 - 0.5 * Math.cos(u * Math.PI));
    if (type === 'hill') s += Math.sin(u * Math.PI * 2) * 0.18; // 起伏の波
    slope = s;
    y += Math.tan(slope) * STEP;
    x += STEP;
    track.points.push({ x, y });
  }
  return { endX: x, endY: y, endSlope: slope };
}

// ジャンプ台(キッカー)＋ギャップ(ピット)＋着地リム。離陸→放物落下→着地。
function genGap(track, startX, startY, startSlope, rng) {
  let x = startX;
  let y = startY;
  let slope = startSlope;
  const kickerSlope = -(0.4 + rng() * 0.2); // 上向き(負=上り)
  const kickSteps = 6;
  for (let i = 1; i <= kickSteps; i++) {
    const u = i / kickSteps;
    slope = startSlope + (kickerSlope - startSlope) * (0.5 - 0.5 * Math.cos(u * Math.PI));
    y += Math.tan(slope) * STEP;
    x += STEP;
    track.points.push({ x, y });
  }
  const liftX = x;
  const liftY = y;
  const gapW = 120 + rng() * 160;
  const landX = liftX + gapW;
  const landY = liftY + (20 + rng() * 80); // 着地リムは少し低い
  const pitY = liftY + 320;                // ピット底(crashの目印。深さは演出)
  track.gaps.push([liftX, landX]);
  // ピット形状(左壁→底→右壁)。ギャップ内の地形に触れたら game 側でクラッシュ。
  track.points.push({ x: liftX + 2, y: pitY });
  track.points.push({ x: landX - 2, y: pitY });
  track.points.push({ x: landX, y: landY });
  // 着地後の平坦な助走路
  x = landX;
  y = landY;
  for (let i = 1; i <= 4; i++) {
    x += STEP;
    track.points.push({ x, y });
  }
  return { endX: x, endY: y, endSlope: 0 };
}

// 360度ループ。地形は平坦のまま。進入速度判定＋回転演出は game/renderer 側。
function genLoop(track, startX, startY, startSlope, rng) {
  let x = startX;
  let y = startY;
  let slope = startSlope;
  const runSteps = 8;
  for (let i = 1; i <= runSteps; i++) {
    const u = i / runSteps;
    slope = startSlope + (0 - startSlope) * (0.5 - 0.5 * Math.cos(u * Math.PI));
    y += Math.tan(slope) * STEP;
    x += STEP;
    track.points.push({ x, y });
  }
  const baseY = y;
  const r = 55 + rng() * 25;
  const width = r * 2.4;
  const enterX = x;
  const cx = enterX + width * 0.5;
  const exitX = enterX + width;
  track.loops.push({ enterX, exitX, r, cx, cy: baseY - r, baseY });
  // ループ下の地面は平坦
  while (x + STEP < exitX) {
    x += STEP;
    track.points.push({ x, y: baseY });
  }
  track.points.push({ x: exitX, y: baseY });
  return { endX: exitX, endY: baseY, endSlope: 0 };
}

const TYPES = ['flat', 'hill', 'up', 'down', 'gap', 'loop'];

// 進行距離で難所の重みを上げる。難易度カーブはこの1関数に集約。
function pickType(rng, worldX) {
  const hard = Math.min(worldX / 20000, 1);
  const w = {
    flat: Math.max(0.5, 3 - hard * 1.5),
    hill: 2 + hard,
    up: 1 + hard,
    down: 1 + hard,
    gap: worldX < 2500 ? 0 : 0.3 + hard * 1.2,
    loop: 0, // ループは extendTo のスケジュールで配置するためランダムでは出さない
  };
  let total = 0;
  for (const t of TYPES) total += w[t];
  let pick = rng() * total;
  for (const t of TYPES) {
    pick -= w[t];
    if (pick <= 0) return t;
  }
  return 'flat';
}

// 区間 [fromX,toX) にニトロカプセルを散布。セグメント境界をまたいで一定間隔で置く。
// track.nextNitroX を前進カーソルにして、短い区間でも取りこぼさず均等配置する。
function scatterNitros(track, fromX, toX) {
  const rng = track.rng;
  while (track.nextNitroX < toX) {
    const x = track.nextNitroX;
    if (x >= fromX && !isGap(track, x) && !loopAt(track, x)) {
      track.nitros.push({
        x,
        y: heightAt(track, x) - (16 + rng() * 20),
        taken: false,
        guaranteed: false,
      });
    }
    track.nextNitroX += 220 + rng() * 200; // 次の間隔 220-420px
  }
}

// 難所(ループ)手前にクリアに足りるニトロを必ず置く(運ゲー防止)。
function guaranteeNitrosBeforeHazards(track) {
  for (const lp of track.loops) {
    if (lp._guaranteed) continue;
    lp._guaranteed = true;
    for (let i = 0; i < 4; i++) {
      const nx = lp.enterX - 1800 + i * 300;
      if (nx <= 0) continue;
      track.nitros.push({
        x: nx,
        y: heightAt(track, nx) - 40,
        taken: false,
        guaranteed: true,
      });
    }
  }
}

// 新しいコースを作る。最初は必ず平坦な助走路から始める(操作に慣れる)。
export function createTrack(seed = 1) {
  const track = {
    points: [{ x: 0, y: BASE_Y }],
    gaps: [],
    loops: [],
    nitros: [],
    nextNitroX: 350, // ニトロ散布の前進カーソル(助走路の終盤から置き始める)
    nextLoopX: 2200, // 次にループを必ず置く位置(売りの機能を運任せにしない)
    rng: mulberry32(seed),
    endX: 0,
    endY: BASE_Y,
    endSlope: 0,
  };
  const r = genSmooth(track, 0, BASE_Y, 0, 'flat', 600, track.rng);
  track.endX = r.endX;
  track.endY = r.endY;
  track.endSlope = r.endSlope;
  return track;
}

// worldX まで右方向へセグメントを生成し続ける。
export function extendTo(track, worldX) {
  let guard = 0;
  while (track.endX < worldX && guard++ < 100000) {
    const prevEndX = track.endX;
    let type;
    if (track.endX >= track.nextLoopX) {
      type = 'loop'; // スケジュールでループを必ず出す
      track.nextLoopX = track.endX + 2400 + track.rng() * 1600; // 次まで 2400-4000px
    } else {
      type = pickType(track.rng, track.endX);
    }
    let res;
    if (type === 'gap') {
      res = genGap(track, track.endX, track.endY, track.endSlope, track.rng);
    } else if (type === 'loop') {
      res = genLoop(track, track.endX, track.endY, track.endSlope, track.rng);
    } else {
      const len = 200 + track.rng() * 300;
      res = genSmooth(track, track.endX, track.endY, track.endSlope, type, len, track.rng);
    }
    track.endX = res.endX;
    track.endY = res.endY;
    track.endSlope = res.endSlope;
    scatterNitros(track, prevEndX, track.endX);
    guaranteeNitrosBeforeHazards(track);
  }
}

// 画面より十分後方の点・アイテムを捨ててメモリを節約。
export function dropBehind(track, worldX) {
  const keepFrom = worldX - 2000;
  if (keepFrom <= 0) return;
  let drop = 0;
  while (drop < track.points.length - 2 && track.points[drop + 1].x < keepFrom) drop++;
  if (drop > 0) track.points.splice(0, drop);
  track.nitros = track.nitros.filter((n) => n.x >= keepFrom);
  track.gaps = track.gaps.filter((g) => g[1] >= keepFrom);
  track.loops = track.loops.filter((lp) => lp.exitX >= keepFrom);
}
