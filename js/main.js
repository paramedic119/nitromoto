// エントリポイント。固定タイムステップで物理を進め、描画とHUD更新を回す。
// 入力(タップ/スペース)で加速し、クラッシュ後の「離して押す」でリスタート。
import { config } from './config.js';
import { createGame, stepFixed, restart } from './game.js';
import { createRenderer } from './renderer.js';
import { createInput } from './input.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const game = createGame();

const elDist = document.getElementById('dist');
const elBest = document.getElementById('best');
const elNitro = document.getElementById('nitro-fill');
const elHint = document.getElementById('hint');
const elCrash = document.getElementById('crash');
const elCrashDist = document.getElementById('crash-dist');
const elCrashBest = document.getElementById('crash-best');
const elNewBest = document.getElementById('new-best');

window.addEventListener('resize', () => renderer.resize());

let prevPressing = false;
let hintShown = true;
let last = performance.now();
let acc = 0;
const MAX_FRAME = 0.1; // タブ復帰などの大きなフレーム飛びを抑える(秒)

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;

  // クラッシュ後、指を離して再度押した立ち上がりでリスタート
  if (game.status === 'crashed' && input.pressing && !prevPressing) {
    restart(game);
  }

  // ループ突破時などのスローモー演出(時間の流れを遅くする)
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
  elDist.textContent = Math.floor(game.dist) + ' m';
  elBest.textContent = 'BEST ' + Math.floor(game.best) + ' m';
  const pct = Math.max(0, Math.min(1, game.bike.nitro / config.NITRO_MAX));
  elNitro.style.width = pct * 100 + '%';
  elNitro.classList.toggle('empty', pct <= 0.05);

  if (game.status === 'crashed') {
    elCrash.classList.add('show');
    elCrashDist.textContent = Math.floor(game.dist) + ' m';
    elCrashBest.textContent = Math.floor(game.best) + ' m';
    elNewBest.style.display = game.newBest ? 'block' : 'none';
  } else {
    elCrash.classList.remove('show');
  }
}

requestAnimationFrame(frame);
