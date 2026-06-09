// エントリポイント。固定タイムステップで物理を進め、描画とHUD更新を回す。
// 入力(タップ/スペース)でターボ加速。ゴール/タイムアップ後の「離して押す」で再挑戦。
import { config } from './config.js';
import { createGame, stepFixed, restart } from './game.js';
import { createRenderer } from './renderer.js';
import { createInput } from './input.js';
import { speedKmh, fmtTime } from './score.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const game = createGame();

const elTime = document.getElementById('time');
const elBest = document.getElementById('best');
const elLap = document.getElementById('lap');
const elSpeed = document.getElementById('speed');
const elTurbo = document.getElementById('turbo-fill');
const elHint = document.getElementById('hint');
const elResult = document.getElementById('result');
const elResultTitle = document.getElementById('result-title');
const elResultTime = document.getElementById('result-time');
const elResultBest = document.getElementById('result-best-time');
const elNewBest = document.getElementById('result-new');

window.addEventListener('resize', () => renderer.resize());

let prevPressing = false;
let hintShown = true;
let last = performance.now();
let acc = 0;
const MAX_FRAME = 0.1;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;

  // ゴール/タイムアップ後、指を離して再度押した立ち上がりで再挑戦
  const finished = game.status === 'cleared' || game.status === 'timeup';
  if (finished && input.pressing && !prevPressing) {
    restart(game);
    hintShown = true;
    elHint.classList.remove('hide');
  }

  // ループ突破時などのスローモー演出
  const scale = game.slowmo > 0 ? 0.4 : 1;
  acc += dt * scale;
  let steps = 0;
  while (acc >= config.DT && steps < 240) {
    stepFixed(game, config.DT, input.pressing);
    acc -= config.DT;
    steps++;
  }

  renderer.render(game);
  updateHud();

  if (hintShown && input.pressing) {
    elHint.classList.add('hide');
    hintShown = false;
  }

  prevPressing = input.pressing;
  requestAnimationFrame(frame);
}

function updateHud() {
  const left = Math.max(0, config.TIME_LIMIT - game.time);
  elTime.textContent = left.toFixed(1);
  elTime.classList.toggle('danger', left <= 10);
  elBest.textContent = 'BEST ' + (game.best > 0 ? fmtTime(game.best) : '--.-');
  elLap.textContent = 'LAP ' + game.lap + '/' + game.laps;
  elSpeed.textContent = Math.round(speedKmh(game.bike)) + ' km/h';

  const pct = Math.max(0, Math.min(1, game.bike.turbo / config.TURBO_MAX));
  elTurbo.style.width = pct * 100 + '%';
  elTurbo.classList.toggle('empty', pct <= 0.05);

  if (game.status === 'cleared' || game.status === 'timeup') {
    elResult.classList.add('show');
    const cleared = game.status === 'cleared';
    elResultTitle.textContent = cleared ? 'GOAL!' : 'TIME UP';
    elResultTitle.classList.toggle('timeup', !cleared);
    elResultTime.textContent = cleared ? fmtTime(game.finishTime) : '--.-';
    elResultBest.textContent = game.best > 0 ? fmtTime(game.best) : '--.-';
    elNewBest.style.display = cleared && game.newBest ? 'block' : 'none';
  } else {
    elResult.classList.remove('show');
  }
}

requestAnimationFrame(frame);
