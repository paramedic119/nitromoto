// ゲーム状態管理。タイムアタックのレース進行（時間・ラップ・ゴール判定）、
// GROUNDED⇄AIRBORNE 状態遷移、ループ/スプリング/トンネル、ターボ取得、
// クラッシュ→時間ロス付きリスポーン、簡易エフェクトをまとめる。
import { config } from './config.js';
import {
  createBike,
  stepGrounded,
  launch,
  launchSpring,
  landingTangentSpeed,
  canClearLoop,
} from './physics.js';
import {
  createCourse,
  heightAt,
  slopeAt,
  isGap,
  loopAt,
  tunnelCeilingAt,
  springBetween,
} from './track.js';
import { distanceMeters, isBestTime } from './score.js';
import { loadBest, saveBest } from './storage.js';

const TURBO_R = 28;       // ターボ取得判定の半径(px)
const FALL_LIMIT = 1300;  // 地面からこれ以上落ちたらクラッシュ(px)
const LOOP_DUR = 0.7;     // ループ回転演出の長さ(秒)
const LAND_ANGLE_MAX = 0.95; // 着地時の進行方向と地形傾きの許容差(rad)

function freshRun(seed) {
  const track = createCourse(seed, config.LAPS);
  const bike = createBike();
  bike.x = 0;
  bike.y = heightAt(track, 0);
  bike.safeX = 0;
  return { track, bike };
}

export function createGame(seed = config.SEED) {
  const { track, bike } = freshRun(seed);
  return {
    seed,
    track,
    bike,
    status: 'playing', // 'playing' | 'crashed' | 'cleared' | 'timeup'
    time: 0,
    dist: 0,
    lap: 1,
    laps: config.LAPS,
    best: loadBest(),
    newBest: false,
    finishTime: null,
    rivalX: 0,
    failLoop: false,
    respawn: 0,
    shake: 0,
    flash: 0,
    slowmo: 0,
    loopAnim: null,
    particles: [],
    landingX: null,
  };
}

export function restart(game) {
  const { track, bike } = freshRun(game.seed); // 同シード＝同コースで再挑戦
  game.track = track;
  game.bike = bike;
  game.status = 'playing';
  game.time = 0;
  game.dist = 0;
  game.lap = 1;
  game.newBest = false;
  game.finishTime = null;
  game.rivalX = 0;
  game.failLoop = false;
  game.respawn = 0;
  game.shake = 0;
  game.flash = 0;
  game.slowmo = 0;
  game.loopAnim = null;
  game.particles = [];
  game.landingX = null;
  // best は前回値を保持
}

// 物理1ステップ(固定dt)。main.js のアキュムレータから複数回呼ばれる。
export function stepFixed(game, dt, pressing) {
  if (game.status === 'cleared' || game.status === 'timeup') return;

  const { track, bike } = game;
  game.time += dt;

  if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 40);
  if (game.flash > 0) game.flash = Math.max(0, game.flash - dt * 3);
  if (game.slowmo > 0) game.slowmo = Math.max(0, game.slowmo - dt);
  updateParticles(game, dt);

  // ライバル(ペース走行のゴースト)
  const rivalSpeed = track.finishX / (config.TIME_LIMIT * config.PAR_RATIO);
  game.rivalX = Math.min(track.finishX, rivalSpeed * game.time);

  // クラッシュ中：時計は止まらず、待ち時間後にリスポーン
  if (game.status === 'crashed') {
    game.respawn -= dt;
    if (game.respawn <= 0) respawnBike(game);
    if (game.status === 'playing' || game.status === 'crashed') checkTimeUp(game);
    return;
  }

  if (game.loopAnim) {
    stepLoopAnim(game, dt, pressing);
  } else if (bike.airborne) {
    stepAir(game, dt);
  } else {
    stepGround(game, dt, pressing);
  }

  collectTurbos(game);
  game.dist = distanceMeters(bike);
  game.lap = Math.min(game.laps, Math.floor(bike.x / track.lapLen) + 1);

  if (bike.x >= track.finishX) {
    clearRace(game);
    return;
  }
  checkTimeUp(game);
}

function checkTimeUp(game) {
  if (game.status !== 'playing' && game.status !== 'crashed') return;
  if (game.time >= config.TIME_LIMIT) {
    game.time = config.TIME_LIMIT;
    game.status = 'timeup';
    game.shake = 10;
    game.bike.firing = false;
  }
}

function stepGround(game, dt, pressing) {
  const { track, bike } = game;
  const slope = slopeAt(track, bike.x);
  stepGrounded(bike, { slope, turbo: pressing });
  bike.safeX = bike.x; // 接地中の現在地は安全（リスポーン地点）

  const nextX = bike.x + bike.v * Math.cos(slope) * dt;

  // スプリングを踏んだら真上へ大ジャンプ
  const sp = springBetween(track, bike.x, nextX);
  if (sp) {
    sp._done = true;
    launchSpring(bike, slope);
    spawnDust(game, sp.x, bike.y, 10, '#ffd24a');
    game.shake = 4;
    return;
  }

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
    game.loopAnim = { lp, t: 0, dur: LOOP_DUR };
    game.slowmo = 0.3;
    game.flash = 1;
  } else {
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
  if (pressing && bike.turbo > 0) {
    bike.v += config.TURBO_THRUST * 0.5 * dt;
    bike.turbo = Math.max(0, bike.turbo - config.TURBO_BURN * dt);
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
    bike.safeX = bike.x;
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

    // トンネルの天井で頭を打つとクラッシュ
    const ceil = tunnelCeilingAt(track, bike.x);
    if (ceil != null && bike.y < ceil) {
      crash(game);
      return;
    }
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
  bike.v = Math.max(config.V_START * 0.5, landingTangentSpeed(bike.vx, bike.vy, slope));
  bike.angle = slope;
  bike.safeX = bike.x;
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

function collectTurbos(game) {
  const { track, bike } = game;
  for (const n of track.turbos) {
    if (n.taken) continue;
    if (Math.abs(n.x - bike.x) < TURBO_R && Math.abs(n.y - bike.y) < TURBO_R + 16) {
      n.taken = true;
      bike.turbo = Math.min(config.TURBO_MAX, bike.turbo + config.TURBO_PICKUP);
      spawnDust(game, n.x, n.y, 6, '#7cf');
    }
  }
}

function crash(game) {
  const { bike } = game;
  game.status = 'crashed';
  game.respawn = config.RESPAWN_DELAY;
  bike.firing = false;
  bike.airborne = false;
  game.loopAnim = null;
  bike.inLoop = false;
  game.shake = 14;
  game.landingX = null;
  spawnDust(game, bike.x, bike.y, 26, '#f66');
}

// 時間ロス後、直前の安全地点へ復帰してレース続行。
function respawnBike(game) {
  const { track, bike } = game;
  let rx = Math.max(0, bike.safeX - 60);
  while (rx > 0 && isGap(track, rx)) rx -= 20;
  bike.x = rx;
  bike.y = heightAt(track, rx);
  bike.angle = slopeAt(track, rx);
  bike.v = config.V_START;
  bike.vx = 0;
  bike.vy = 0;
  bike.airborne = false;
  bike.firing = false;
  game.failLoop = false;
  game.landingX = null;
  game.status = 'playing';
}

function clearRace(game) {
  const { bike, track } = game;
  bike.x = track.finishX;
  game.dist = distanceMeters(bike);
  game.status = 'cleared';
  game.finishTime = game.time;
  game.flash = 1;
  game.shake = 4;
  bike.firing = false;
  if (isBestTime(game.time, game.best)) {
    game.newBest = true;
    saveBest(game.time);
    game.best = game.time;
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
