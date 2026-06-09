// エントリポイント。固定タイムステップで物理を進め、描画とHUDを更新する。
import { config } from './config.js';
import { createGame, stepFixed, restart, playerPlace } from './game.js';
import { createRenderer } from './renderer.js';
import { createInput } from './input.js';
import { speedKmh, fmtTime } from './score.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const input = createInput();
const game = createGame();

const el = (id) => document.getElementById(id);
const elTime = el('time'), elBest = el('best'), elLap = el('lap');
const elSpeed = el('speed'), elPos = el('pos'), elTurbo = el('turbo-fill');
const elCount = el('countdown');
const elResult = el('result'), elResultTitle = el('result-title'), elResultSub = el('result-sub');
const elResultTime = el('result-time'), elResultBest = el('result-best-time'), elNewBest = el('result-new');

window.addEventListener('resize', () => renderer.resize());

let last = performance.now();
let acc = 0;
const MAX_FRAME = 0.1;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;

  if (game.status === 'finished' && input.tap) {
    restart(game);
  }
  input.tap = false; // 1フレームで消費

  const scale = game.slowmo > 0 ? 0.45 : 1;
  acc += dt * scale;
  let steps = 0;
  while (acc >= config.DT && steps < 240) {
    stepFixed(game, config.DT, input);
    acc -= config.DT;
    steps++;
  }

  renderer.render(game);
  updateHud();
  requestAnimationFrame(frame);
}

function updateHud() {
  elTime.textContent = game.time > 0 ? fmtTime(game.time) : '0.0';
  elBest.textContent = 'BEST ' + (game.best > 0 ? fmtTime(game.best) : '--.-');
  elLap.textContent = 'LAP ' + game.lap + '/' + game.laps;
  elSpeed.textContent = Math.round(speedKmh(game.bike)) + ' km/h';

  const place = playerPlace(game);
  elPos.textContent = place === 1 ? '1st' : '2nd';
  elPos.classList.toggle('lead', place === 1);

  const pct = Math.max(0, Math.min(1, game.bike.turbo / config.TURBO_MAX));
  elTurbo.style.width = pct * 100 + '%';
  elTurbo.classList.toggle('empty', pct <= 0.05);

  // カウントダウン
  if (game.status === 'countdown') {
    const c = Math.ceil(game.countdown);
    elCount.textContent = c <= 0 ? 'GO!' : String(c);
    elCount.classList.add('show');
  } else if (game.time < 0.6 && game.status === 'racing') {
    elCount.textContent = 'GO!';
    elCount.classList.add('show');
  } else {
    elCount.classList.remove('show');
  }

  // リザルト
  if (game.status === 'finished') {
    elResult.classList.add('show');
    if (game.dnf) {
      elResultTitle.textContent = 'TIME UP';
      elResultTitle.className = 'result-title lose';
      elResultSub.textContent = 'リタイア';
    } else if (game.win) {
      elResultTitle.textContent = 'WIN!';
      elResultTitle.className = 'result-title win';
      elResultSub.textContent = '1st / ライバルに勝利';
    } else {
      elResultTitle.textContent = 'LOSE';
      elResultTitle.className = 'result-title lose';
      elResultSub.textContent = '2nd / ライバルに先着された';
    }
    elResultTime.textContent = game.dnf ? '--.-' : fmtTime(game.finishTime);
    elResultBest.textContent = game.best > 0 ? fmtTime(game.best) : '--.-';
    elNewBest.style.display = !game.dnf && game.newBest ? 'block' : 'none';
  } else {
    elResult.classList.remove('show');
  }
}

requestAnimationFrame(frame);
