// ゲーム状態管理。GROUNDED⇄AIRBORNE 状態遷移、ループ判定ゲート、ニトロ取得、
// クラッシュ／リスタート、簡易エフェクト(砂埃・シェイク・スロー)をまとめる。
import { config } from './config.js';
import {
  createBike,
  stepGrounded,
  launch,
  landingTangentSpeed,
  canClearLoop,
} from './physics.js';
import {
  createTrack,
  extendTo,
  dropBehind,
  heightAt,
  slopeAt,
  isGap,
  loopAt,
} from './track.js';
import { distanceMeters, shouldCrash, isBest } from './score.js';
import { loadBest, saveBest } from './storage.js';

const AHEAD = 2000;       // バイク前方どこまで生成しておくか(px)
const NITRO_R = 28;       // ニトロ取得判定の半径(px)
const FALL_LIMIT = 1300;  // 地面からこれ以上落ちたらクラッシュ(px)
const LOOP_DUR = 0.7;     // ループ回転演出の長さ(秒)
const LAND_ANGLE_MAX = 0.95; // 着地時の進行方向と地形傾きの許容差(rad)

function freshRun(seed) {
  const track = createTrack(seed);
  extendTo(track, AHEAD);
  const bike = createBike();
  bike.x = 0;
  bike.y = heightAt(track, 0);
  return { track, bike };
}

export function createGame(seed = (Math.random() * 1e9) | 0) {
  const { track, bike } = freshRun(seed);
  return {
    seed,
    track,
    bike,
    status: 'playing', // 'playing' | 'crashed'
    dist: 0,
    time: 0,
    best: loadBest(),
    newBest: false,
    failLoop: false,
    shake: 0,
    flash: 0,
    slowmo: 0,
    loopAnim: null,
    particles: [],
    landingX: null,
  };
}

export function restart(game) {
  const seed = (Math.random() * 1e9) | 0;
  const { track, bike } = freshRun(seed);
  game.seed = seed;
  game.track = track;
  game.bike = bike;
  game.status = 'playing';
  game.dist = 0;
  game.time = 0;
  game.newBest = false;
  game.failLoop = false;
  game.shake = 0;
  game.flash = 0;
  game.slowmo = 0;
  game.loopAnim = null;
  game.particles = [];
  game.landingX = null;
  // best は前回値を保持(マーカーと比較に使う)
}

// 物理1ステップ(固定dt)。main.js のアキュムレータから複数回呼ばれる。
export function stepFixed(game, dt, pressing) {
  if (game.status !== 'playing') return;
  const { track, bike } = game;
  game.time += dt;

  extendTo(track, bike.x + AHEAD);
  dropBehind(track, bike.x);

  if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 40);
  if (game.flash > 0) game.flash = Math.max(0, game.flash - dt * 3);
  if (game.slowmo > 0) game.slowmo = Math.max(0, game.slowmo - dt);
  updateParticles(game, dt);

  if (game.loopAnim) {
    stepLoopAnim(game, dt, pressing);
  } else if (bike.airborne) {
    stepAir(game, dt);
  } else {
    stepGround(game, dt, pressing);
  }

  collectNitros(game);
  game.dist = distanceMeters(bike);
  if (!game.newBest && isBest(game.dist, game.best)) game.newBest = true;
}

function stepGround(game, dt, pressing) {
  const { track, bike } = game;
  const slope = slopeAt(track, bike.x);
  stepGrounded(bike, { slope, nitro: pressing });

  if (shouldCrash(bike, false)) {
    crash(game);
    return;
  }

  // v は接線方向の速さ。水平成分で x を進める。
  const nextX = bike.x + bike.v * Math.cos(slope) * dt;

  // ギャップに踏み込むなら離陸(キッカーの上向き接線で跳ぶ)
  if (isGap(track, nextX)) {
    launch(bike, slope);
    spawnDust(game, bike.x, bike.y, 8);
    return;
  }

  bike.x = nextX;
  bike.y = heightAt(track, bike.x);

  const lp = loopAt(track, bike.x);
  if (lp && !lp._entered) {
    lp._entered = true;
    enterLoop(game, lp);
  }
}

function enterLoop(game, lp) {
  const { bike } = game;
  if (canClearLoop(bike.v, lp.r)) {
    // 成功: 回転演出。位置はループ曲線(renderer)、物理は平坦床を進む。
    game.loopAnim = { lp, t: 0, dur: LOOP_DUR };
    game.slowmo = 0.3;
    game.flash = 1;
  } else {
    // 失敗: 頂点付近で離脱→落下→着地時にクラッシュ確定
    bike.airborne = true;
    launch(bike, -1.1);
    game.failLoop = true;
    spawnDust(game, bike.x, bike.y, 6);
  }
}

function stepLoopAnim(game, dt, pressing) {
  const { track, bike } = game;
  const a = game.loopAnim;
  const lp = a.lp;
  a.t += dt;
  if (pressing && bike.nitro > 0) {
    bike.v += config.NITRO_THRUST * 0.5 * dt;
    bike.nitro = Math.max(0, bike.nitro - config.NITRO_BURN * dt);
    bike.firing = true;
  } else {
    bike.firing = false;
  }
  const prog = Math.min(1, a.t / a.dur);
  bike.x = lp.enterX + (lp.exitX - lp.enterX) * prog;
  bike.y = lp.baseY;
  bike.s += bike.v * dt;
  bike.inLoop = true;
  bike.loopT = prog; // renderer が 0..1 を 0..2π に
  if (prog >= 1) {
    game.loopAnim = null;
    bike.inLoop = false;
    bike.loopT = 0;
    bike.x = lp.exitX;
    bike.y = heightAt(track, bike.x);
    bike.angle = slopeAt(track, bike.x);
    spawnDust(game, bike.x, bike.y, 12);
    game.shake = 6;
  }
}

function stepAir(game, dt) {
  const { track, bike } = game;
  const SUB = 5;
  const h = dt / SUB;
  for (let i = 0; i < SUB; i++) {
    bike.vy += config.GRAVITY * h;
    bike.x += bike.vx * h;
    bike.y += bike.vy * h;
    bike.s += Math.hypot(bike.vx, bike.vy) * h;
    const groundY = heightAt(track, bike.x);
    if (bike.y >= groundY) {
      land(game, groundY);
      return;
    }
    if (bike.y - groundY > FALL_LIMIT) {
      crash(game);
      return;
    }
  }
  bike.angle = Math.atan2(bike.vy, bike.vx);
  game.landingX = predictLanding(game);
}

function land(game, groundY) {
  const { track, bike } = game;
  // ギャップ内の地形(ピット壁/底)に触れた、またはループ失敗 → クラッシュ
  if (isGap(track, bike.x) || game.failLoop) {
    crash(game);
    return;
  }
  const slope = slopeAt(track, bike.x);
  const moveAng = Math.atan2(bike.vy, bike.vx);
  if (Math.abs(normalizeAngle(moveAng - slope)) > LAND_ANGLE_MAX) {
    crash(game); // 着地角度が急すぎる
    return;
  }
  bike.y = groundY;
  bike.airborne = false;
  bike.v = Math.max(config.V_MIN, landingTangentSpeed(bike.vx, bike.vy, slope));
  bike.angle = slope;
  game.landingX = null;
  spawnDust(game, bike.x, bike.y, 10);
  game.shake = 4;
}

// 着地予測地点x(理不尽死の防止用マーカー)。落下中のみ計算。
function predictLanding(game) {
  const { track, bike } = game;
  let x = bike.x;
  let y = bike.y;
  let vy = bike.vy;
  const vx = bike.vx;
  const h = config.DT;
  for (let i = 0; i < 600; i++) {
    vy += config.GRAVITY * h;
    x += vx * h;
    y += vy * h;
    const gy = heightAt(track, x);
    if (y >= gy) return isGap(track, x) ? null : x;
  }
  return null;
}

function collectNitros(game) {
  const { track, bike } = game;
  for (const n of track.nitros) {
    if (n.taken) continue;
    if (Math.abs(n.x - bike.x) < NITRO_R && Math.abs(n.y - bike.y) < NITRO_R + 16) {
      n.taken = true;
      bike.nitro = Math.min(config.NITRO_MAX, bike.nitro + config.NITRO_PICKUP);
      spawnDust(game, n.x, n.y, 6, '#7cf');
    }
  }
}

function crash(game) {
  const { bike } = game;
  game.status = 'crashed';
  bike.firing = false;
  game.shake = 14;
  game.landingX = null;
  spawnDust(game, bike.x, bike.y, 26, '#f66');
  game.dist = distanceMeters(bike);
  if (isBest(game.dist, game.best)) {
    game.newBest = true;
    saveBest(game.dist);
    game.best = game.dist;
  }
}

function spawnDust(game, x, y, n, color = '#d8c9b0') {
  for (let i = 0; i < n; i++) {
    game.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 180,
      vy: -Math.random() * 180,
      life: 0.4 + Math.random() * 0.3,
      color,
    });
  }
  if (game.particles.length > 300) {
    game.particles.splice(0, game.particles.length - 300);
  }
}

function updateParticles(game, dt) {
  const ps = game.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) {
      ps.splice(i, 1);
      continue;
    }
    p.vy += 420 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
