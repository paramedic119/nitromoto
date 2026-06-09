// レース進行。カウントダウン→レース→(クラッシュ→リスポーン)→フィニッシュ。
// プレイヤーは地上=アクセル/ターボ、空中=↑↓リーンで姿勢制御。CPUライバルと周回勝負。
import { config } from './config.js';
import {
  createBike,
  stepGroundSpeed,
  launch,
  launchSpring,
  stepAir as stepAirPhysics,
  landingOk,
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
import { createRival, stepRival, rivalLap } from './rival.js';
import { distanceMeters, isBestTime } from './score.js';
import { loadBest, saveBest } from './storage.js';

const TURBO_R = 28;
const FALL_LIMIT = 1300;
const LOOP_DUR = 0.66;

const NO_INPUT = { accel: false, turbo: false, up: false, down: false };

function freshRun(seed) {
  const track = createCourse(seed, config.LAPS);
  const bike = createBike();
  bike.x = 0;
  bike.y = heightAt(track, 0);
  bike.angle = slopeAt(track, 0);
  bike.safeX = 0;
  return { track, bike, rival: createRival() };
}

export function createGame(seed = config.SEED) {
  const { track, bike, rival } = freshRun(seed);
  return {
    seed, track, bike, rival,
    status: 'countdown', // 'countdown'|'racing'|'crashed'|'finished'
    countdown: config.COUNTDOWN,
    time: 0,
    dist: 0,
    lap: 1,
    laps: config.LAPS,
    best: loadBest(),
    newBest: false,
    finishTime: null,
    placement: null, // 1=1st, 2=2nd
    win: false,
    dnf: false,
    failLoop: false,
    respawn: 0,
    shake: 0, flash: 0, slowmo: 0,
    loopAnim: null,
    particles: [],
    landingX: null,
  };
}

export function restart(game) {
  const { track, bike, rival } = freshRun(game.seed);
  game.track = track;
  game.bike = bike;
  game.rival = rival;
  game.status = 'countdown';
  game.countdown = config.COUNTDOWN;
  game.time = 0;
  game.dist = 0;
  game.lap = 1;
  game.newBest = false;
  game.finishTime = null;
  game.placement = null;
  game.win = false;
  game.dnf = false;
  game.failLoop = false;
  game.respawn = 0;
  game.shake = 0; game.flash = 0; game.slowmo = 0;
  game.loopAnim = null;
  game.particles = [];
  game.landingX = null;
}

export function stepFixed(game, dt, input = NO_INPUT) {
  if (game.status === 'finished') return;

  if (game.status === 'countdown') {
    game.countdown -= dt;
    updateParticles(game, dt);
    if (game.countdown <= 0) {
      game.countdown = 0;
      game.status = 'racing';
    }
    return;
  }

  const { track, bike, rival } = game;
  game.time += dt;

  if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 40);
  if (game.flash > 0) game.flash = Math.max(0, game.flash - dt * 3);
  if (game.slowmo > 0) game.slowmo = Math.max(0, game.slowmo - dt);
  updateParticles(game, dt);

  stepRival(rival, track, dt, game.time);

  if (game.status === 'crashed') {
    game.respawn -= dt;
    if (game.respawn <= 0) respawnBike(game);
    failsafeTimeUp(game);
    return;
  }

  if (game.loopAnim) {
    stepLoopAnim(game, dt, input);
  } else if (bike.airborne) {
    stepAirborne(game, dt, input);
  } else {
    stepGround(game, dt, input);
  }

  collectTurbos(game);
  game.dist = distanceMeters(bike);
  game.lap = Math.min(game.laps, Math.floor(bike.x / track.lapLen) + 1);

  if (bike.x >= track.finishX) {
    finishRace(game, false);
    return;
  }
  failsafeTimeUp(game);
}

function failsafeTimeUp(game) {
  if (game.status !== 'racing' && game.status !== 'crashed') return;
  if (game.time >= config.TIME_LIMIT) finishRace(game, true);
}

function stepGround(game, dt, input) {
  const { track, bike } = game;
  const slope = slopeAt(track, bike.x);
  stepGroundSpeed(bike, { slope, accel: input.accel, turbo: input.turbo });
  bike.safeX = bike.x;
  // ウィリー表現（↑で前輪上げ、↓で前傾）
  bike.angle = slope - (input.up ? config.WHEELIE : 0) + (input.down ? config.WHEELIE * 0.5 : 0);

  const nextX = bike.x + bike.v * Math.cos(slope) * dt;

  const sp = springBetween(track, bike.x, nextX);
  if (sp) {
    sp._done = true;
    launchSpring(bike, slope);
    applyTakeoffSpin(bike, input);
    spawnDust(game, sp.x, bike.y, 10, '#ffd24a');
    game.shake = 4;
    return;
  }

  if (isGap(track, nextX)) {
    launch(bike, slope);
    applyTakeoffSpin(bike, input);
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

// 離陸時、リーン入力で初期スピンを与える（押しっぱなしでフリップ）
function applyTakeoffSpin(bike, input) {
  if (input.up) bike.av = -3.2;
  else if (input.down) bike.av = 3.2;
}

function enterLoop(game, lp) {
  const { bike } = game;
  if (canClearLoop(bike.v, lp.r)) {
    game.loopAnim = { lp, t: 0, dur: LOOP_DUR };
    game.slowmo = 0.25;
    game.flash = 0.8;
  } else {
    bike.airborne = true;
    launch(bike, -1.1);
    game.failLoop = true;
    spawnDust(game, bike.x, bike.y, 6);
  }
}

function stepLoopAnim(game, dt, input) {
  const { track, bike } = game;
  const a = game.loopAnim;
  const lp = a.lp;
  a.t += dt;
  // ループ中もアクセル/ターボで加速可
  const slope = 0;
  stepGroundSpeed(bike, { slope, accel: input.accel, turbo: input.turbo });
  const prog = Math.min(1, a.t / a.dur);
  bike.x = lp.enterX + (lp.exitX - lp.enterX) * prog;
  bike.y = lp.baseY;
  bike.inLoop = true;
  bike.loopT = prog;
  if (prog >= 1) {
    game.loopAnim = null;
    bike.inLoop = false;
    bike.loopT = 0;
    bike.x = lp.exitX;
    bike.y = heightAt(track, bike.x);
    bike.angle = slopeAt(track, bike.x);
    bike.safeX = bike.x;
    spawnDust(game, bike.x, bike.y, 12);
    game.shake = 5;
  }
}

function stepAirborne(game, dt, input) {
  const { track, bike } = game;
  const lean = { up: input.up, down: input.down };
  const SUB = 5;
  const h = dt / SUB;
  for (let i = 0; i < SUB; i++) {
    stepAirPhysics(bike, lean, h);
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
  game.landingX = predictLanding(game);
}

function land(game, groundY) {
  const { track, bike } = game;
  if (isGap(track, bike.x) || game.failLoop) {
    crash(game);
    return;
  }
  const slope = slopeAt(track, bike.x);
  if (!landingOk(bike.angle, slope)) {
    crash(game); // 着地姿勢が崩れている
    return;
  }
  bike.y = groundY;
  bike.airborne = false;
  bike.av = 0;
  bike.v = Math.max(config.V_START * 0.4, landingTangentSpeed(bike.vx, bike.vy, slope));
  bike.angle = slope;
  bike.safeX = bike.x;
  game.landingX = null;
  spawnDust(game, bike.x, bike.y, 10);
  game.shake = 4;
}

function predictLanding(game) {
  const { track, bike } = game;
  let x = bike.x, y = bike.y, vy = bike.vy;
  const vx = bike.vx;
  const h = config.DT;
  for (let i = 0; i < 700; i++) {
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

function respawnBike(game) {
  const { track, bike } = game;
  let rx = Math.max(0, bike.safeX - 60);
  while (rx > 0 && isGap(track, rx)) rx -= 20;
  bike.x = rx;
  bike.y = heightAt(track, rx);
  bike.angle = slopeAt(track, rx);
  bike.v = config.V_START;
  bike.vx = 0; bike.vy = 0; bike.av = 0;
  bike.airborne = false;
  bike.firing = false;
  game.failLoop = false;
  game.landingX = null;
  game.status = 'racing';
}

function finishRace(game, dnf) {
  const { bike, track, rival } = game;
  if (!dnf) bike.x = track.finishX;
  game.dist = distanceMeters(bike);
  game.status = 'finished';
  game.dnf = dnf;
  game.finishTime = dnf ? null : game.time;
  game.placement = !dnf && !rival.finished ? 1 : 2;
  game.win = game.placement === 1;
  game.flash = 1;
  game.shake = 4;
  bike.firing = false;
  if (!dnf && isBestTime(game.time, game.best)) {
    game.newBest = true;
    saveBest(game.time);
    game.best = game.time;
  }
}

function spawnDust(game, x, y, n, color = '#d8c9b0') {
  for (let i = 0; i < n; i++) {
    game.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 180,
      vy: -Math.random() * 180,
      life: 0.4 + Math.random() * 0.3,
      color,
    });
  }
  if (game.particles.length > 300) game.particles.splice(0, game.particles.length - 300);
}

function updateParticles(game, dt) {
  const ps = game.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) { ps.splice(i, 1); continue; }
    p.vy += 420 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

// プレイヤーが1位かどうか（HUD表示用）
export function playerPlace(game) {
  return game.rival.x > game.bike.x ? 2 : 1;
}

export { rivalLap };
