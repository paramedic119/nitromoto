// エントリポイント。固定タイムステップで物理を回し、表示レートで描く。

import { createGL } from './core/gl.js';
import { Input } from './core/input.js';
import { clamp, clamp01, lerp, damp } from './core/math.js';
import * as Terrain from './world/terrain.js';
import { ChunkManager, CHUNK } from './world/chunks.js';
import { propsInRange } from './world/scatter.js';
import { Rider, STATE } from './play/rider.js';
import { Camera } from './play/camera.js';
import { Trails } from './play/trails.js';
import { Net } from './play/net.js';
import { Renderer } from './gfx/renderer.js';
import { Particles, emitRide, emitBurst, emitPuff, emitDrift, emitContrail, P } from './gfx/particles.js';
import { Hud } from './ui/hud.js';
import { Audio } from './audio/engine.js';

// 物理は固定 90Hz。60/90/120/240Hz で挙動が一致することは tests で確認済み。
// 低フレームレートの端末でも極端に時間が遅れないよう、上限ステップに余裕を持たせている。
const FIXED = 1 / 90;
const MAX_STEPS = 8;

const canvas = document.getElementById('game');
const gl = createGL(canvas);
if (!gl) {
  document.getElementById('nowebgl').classList.remove('hidden');
  document.getElementById('title').classList.add('gone');
  throw new Error('WebGL2 unavailable');
}

const store = {
  get(k, d) { try { const v = localStorage.getItem('bluebird.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bluebird.' + k, JSON.stringify(v)); } catch { /* プライベートモード */ } },
};

const renderer = new Renderer(gl, canvas);
const chunks = new ChunkManager(gl);
const trails = new Trails(gl);
const particles = new Particles(gl);
const rider = new Rider();
const camera = new Camera();
const input = new Input(window);
const hud = new Hud();
const audio = new Audio();

rider.bestDistance = store.get('best', 0);

const playerName = store.get('name', '');
const nameInput = document.getElementById('playername');
if (playerName) nameInput.value = playerName;

let net = null;
const riderTint = [0.94, 0.36, 0.24];

/* ------------------------------------------------------- 状態 */

const app = {
  running: false,
  prewarmed: false,
  time: 0,
  wind: 1.0,
  quality: 1,
  frame: 0,
  fpsAvg: 60,
  sprayAcc: 0,
  driftAcc: 0,
  trailAcc: 0,   // コントレイルの端数
  props: [],
  propZ: -1e9,
  catchUp: 0,
};

/* --------------------------------------------------- イベント配線 */

rider.onLand = (impact, clean, trick, terr) => {
  camera.impulse(clamp01(impact / 14) * 1.1);
  emitBurst(particles, rider.pos[0], rider.pos[1], rider.pos[2],
    clamp01(impact / 12) * (1 + rider.powder), rider.vel[0] * 0.1, rider.vel[2] * 0.1);
  audio.land(impact, clean, rider);
  if (trick) hud.trick(trick + (clean ? '' : ' …'));
};

rider.onPop = (power) => {
  audio.pop(power);
  emitBurst(particles, rider.pos[0], rider.pos[1], rider.pos[2], power * 0.5);
};

rider.onTrick = (name) => { /* 着地時にまとめて表示する */ };

rider.onPolePlant = (side, speed) => audio.polePlant(side, speed);

rider.onTreeHit = (glancing, speed) => {
  emitPuff(particles, rider.pos[0], rider.pos[1], rider.pos[2], speed);
  camera.impulse(glancing ? 0.55 : 1.4);
  audio.treeHit(glancing, speed);
};

rider.onWipeout = (cause) => {
  emitBurst(particles, rider.pos[0], rider.pos[1], rider.pos[2], 2.4,
    rider.vel[0] * 0.12, rider.vel[2] * 0.12);
  camera.impulse(1.5);
  audio.wipeout();
  const d = Math.round(rider.distance);
  hud.toast(d > 40 ? `${d}m — もういちど、上から` : 'もういちど');
};

rider.onRespawn = () => {
  particles.clear();
  camera.pos[0] = rider.pos[0];
  camera.pos[1] = rider.pos[1] + 4;
  camera.pos[2] = rider.pos[2] - 8;
  camera.yaw = 0;
  camera.target[0] = rider.pos[0];
  camera.target[1] = rider.pos[1];
  camera.target[2] = rider.pos[2] + 6;
  rider._trailLast = null;
  // スタート地点のチャンクはもう捨てられている。真っ白なフェードの裏で作り直す。
  app.catchUp = 1.6;
  chunks.update(rider.pos[0], rider.pos[2] + 60, 60);
  trails.recenter(rider.pos[0], rider.pos[2]);
  if (rider.bestDistance > store.get('best', 0)) store.set('best', Math.round(rider.bestDistance));
};

/* ------------------------------------------------- リサイズ */

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.resize(w, h, dpr, app.quality);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------------------------- 起動 */

const titleEl = document.getElementById('title');
const startBtn = document.getElementById('startbtn');
const loadStatus = document.getElementById('loadstatus');

// 開始前に手前のチャンクを作っておく（最初の 1 秒がガタつかないように）。
// 生成中は描画をほぼ止める。遅い環境でも待ち時間が伸びないようにするため。
function prewarm() {
  const t0 = performance.now();
  let total = 0;
  const tick = () => {
    chunks.update(rider.pos[0], rider.pos[2], 30);
    const remain = chunks.stats.queued;
    total = Math.max(total, remain + 1);
    const done = 1 - remain / total;
    const elapsed = performance.now() - t0;
    loadStatus.textContent = remain > 0
      ? `山を生成中… ${Math.round(done * 100)}%`
      : `山ができました（${(elapsed / 1000).toFixed(1)}秒）`;
    // 実時間で打ち切る。残りはゲーム中にストリーミングで埋まる。
    if (remain > 0 && elapsed < 14000) {
      requestAnimationFrame(tick);
    } else {
      app.prewarmed = true;
      startBtn.disabled = false;
      loadStatus.textContent = 'Space か クリックで開始';
    }
  };
  startBtn.disabled = true;
  tick();
}
prewarm();

function start() {
  if (app.running) return;
  app.running = true;
  const name = (nameInput.value || '').trim() || 'ゲスト';
  store.set('name', name);
  net = new Net({ name });
  net.connect();
  titleEl.classList.add('gone');
  hud.show();
  audio.start();
  if (matchMedia('(hover: none) and (pointer: coarse)').matches) {
    document.getElementById('touch').classList.remove('hidden');
    setupTouch();
  }
  hud.toast('じわっと倒すほど、きれいに刻める', 4.5);
}

startBtn.addEventListener('click', start);
window.addEventListener('keydown', (e) => {
  if (!app.running && (e.code === 'Space' || e.code === 'Enter') && !startBtn.disabled) {
    e.preventDefault();
    start();
  }
});

/* ------------------------------------------------- タッチ */

function setupTouch() {
  const left = document.getElementById('t-left');
  const right = document.getElementById('t-right');
  const steerFrom = (el, e) => {
    const r = el.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return clamp(((t.clientX - r.left) / r.width) * 2 - 1, -1, 1);
  };
  for (const el of [left, right]) {
    const on = (e) => { e.preventDefault(); input.setTouch('steer', steerFrom(el, e) * (el === left ? 0.6 : 1)); };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchmove', on, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); input.setTouch('steer', 0); }, { passive: false });
  }
  const hold = (id, part, val) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); input.setTouch(part, val); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); input.setTouch(part, part === 'ollie' ? false : 0); }, { passive: false });
  };
  hold('t-tuck', 'tuck', 1);
  hold('t-brake', 'brake', 1);
  hold('t-ollie', 'ollie', true);
}

/* ------------------------------------------------- メインループ */

let lastTime = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.25) dt = 0.25;
  app.time += dt;
  app.frame++;

  // --- FPS を見て解像度を自動調整 ---
  app.fpsAvg = lerp(app.fpsAvg, 1 / Math.max(dt, 1e-3), 0.04);
  if (app.frame % 90 === 0) {
    const want = app.fpsAvg < 42 ? Math.max(0.62, app.quality - 0.12)
      : app.fpsAvg > 58 ? Math.min(1, app.quality + 0.06) : app.quality;
    if (Math.abs(want - app.quality) > 0.01) { app.quality = want; resize(); }
  }

  input.update(dt);

  if (app.running) {
    if (input.justPressed('reset')) { rider.respawn(); }
    if (input.justPressed('camera')) camera.cycleMode();
    if (input.justPressed('mute')) {
      const m = audio.toggleMute();
      hud.toast(m ? '音を切りました' : '音を戻しました', 1.4);
    }

    // --- 物理（固定ステップ）---
    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < MAX_STEPS) {
      rider.step(FIXED, input);
      acc -= FIXED;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
  }

  input.endFrame();

  // --- ゾーン情報（HUD 用）---
  rider.surfaceZone = Terrain.zoneAt(rider.pos[2]).kind;

  camera.update(dt, rider, canvas.width / canvas.height);

  // --- ネット / 地元の人たち ---
  if (net) net.update(dt, rider, camera.pos[0], camera.pos[2]);

  // --- チャンクストリーミング ---
  app.catchUp = Math.max(0, app.catchUp - dt);
  chunks.update(camera.pos[0], camera.pos[2] + 60, app.catchUp > 0 ? 16 : 4);

  // --- 小物 ---
  if (Math.abs(rider.pos[2] - app.propZ) > 120) {
    app.propZ = rider.pos[2];
    app.props = propsInRange(rider.pos[2] - 260, rider.pos[2] + 900).slice();
  }

  // --- パーティクル ---
  app.wind = 0.7 + 0.5 * Math.sin(app.time * 0.13) + 0.3 * Math.sin(app.time * 0.41);
  app.sprayAcc = emitRide(particles, rider, dt, app.sprayAcc);
  app.trailAcc = emitContrail(particles, rider, dt, app.trailAcc);
  app.driftAcc = emitDrift(particles, camera.pos[0], camera.pos[1], camera.pos[2],
    dt, app.driftAcc, app.wind);
  particles.update(dt, app.wind * 0.4);

  // --- 軌跡 ---
  trails.recenter(rider.pos[0], rider.pos[2]);
  emitTrail(dt);
  trails.flush();

  // --- 音 ---
  audio.update(dt, rider, app.wind);

  // --- 描画 ---
  // 山の生成中は描画を間引いて、生成に時間を回す
  if (!app.prewarmed && (app.frame % 6) !== 0) { if (app.running) hud.update(dt, rider, net); return; }
  renderer.render({
    camera, rider, chunks, particles, trails,
    props: app.props,
    peers: net ? net.riders() : null,
    riderTint,
    time: app.time,
    wind: app.wind,
  });

  // --- HUD ---
  if (app.running) hud.update(dt, rider, net);
}

/**
 * ライダーの通った跡を軌跡テクスチャへ積む。
 * スキーなので雪面に残るのは 2 本のシュプール。板の間隔ぶん左右にずらして描く。
 */
const SKI_HALF_GAP = 0.17;
function emitTrail(dt) {
  const stroke = (r, depth) => {
    const last = r._trailLast;
    const x = r.pos[0], z = r.pos[2];
    if (!last) { r._trailLast = [x, z]; return; }
    const dx = x - last[0], dz = z - last[1];
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return;
    // 進行方向に直交する向きへ、板 1 枚ぶんずらした 2 本
    const nx = -dz / d, nz = dx / d;
    const gap = SKI_HALF_GAP + Math.abs(r.wedge || 0) * 0.10;
    const cx = (x + last[0]) * 0.5, cz = (z + last[1]) * 0.5;
    for (const s of [-1, 1]) {
      trails.stroke(cx + nx * gap * s, cz + nz * gap * s, dx, dz,
        d * 0.5 + 0.3, 0.15 + Math.abs(r.edge || 0) * 0.10, depth);
    }
    last[0] = x; last[1] = z;
  };

  if (rider.grounded && rider.state !== STATE.WIPEOUT) {
    const cut = clamp01(0.22 + Math.abs(rider.edge) * 0.55 + rider.skidNorm * 0.7)
      * (0.45 + 0.55 * rider.powder + 0.25 * (1 - rider.groomedAmt));
    stroke(rider, clamp01(cut));
  } else {
    rider._trailLast = null;
  }

  if (net) {
    for (const p of net.riders()) {
      if (!p.visible) continue;
      if (p.grounded === false || p.down) { p._trailLast = null; continue; }
      stroke(p, 0.30);
    }
  }
}

requestAnimationFrame(frame);

// デバッグ用の窓口
window.BLUEBIRD = { rider, camera, chunks, renderer, app, particles, audio, trails,
  get net() { return net; }, Terrain };
