# モトクロス エンドレスラン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ニトロを温存して難所で放つ駆け引きを核にした、スマホ特化の横視点エンドレスラン・モトクロスを、バニラJS + Canvas 2D で作りGitHub Pages公開する。

**Architecture:** バイクを「地形ライン上を弧長 `s` で進む点」として扱う軽量物理。地上(GROUNDED)は弧長追従、空中(AIRBORNE)は放物運動の状態機械。物理は固定タイムステップ(1/120秒)、描画は `requestAnimationFrame` の可変フレーム。純ロジック(physics/track/score/storage)はDOM非依存にして `node --test` で単体テストし、描画・入力・統合はスマホ実機で確認する。

**Tech Stack:** Vanilla JavaScript (ES Modules)、HTML5 Canvas 2D、`localStorage`、テストは Node標準 `node:test` + `node:assert`（外部依存ゼロ・ビルド工程なし）。

---

## 前提: git ローカル識別情報（コミット前に1回だけ）

このリポジトリでコミットするには著者情報が必要。**`--global` は使わない**（ユーザー方針）。このリポジトリ内だけのローカル設定にする。`<NAME>` と `<EMAIL>` はユーザーのGitHub公開用の値に置き換える（実行前にユーザーへ確認する）。

```bash
cd "/home/mihara/開発/モトクロス"
git config --local user.name "<NAME>"
git config --local user.email "<EMAIL>"
git config --local --get user.name   # 確認
```

Expected: 設定した名前が表示される。これが済むまで `git commit` は exit 128（Author identity unknown）で失敗する。

---

## テスト方針

- **純ロジック（physics.js / track.js / score.js / storage.js）**: `node:test` で単体テスト。ブラウザAPIに依存させない。各タスクで「失敗するテストを書く→失敗を確認→最小実装→成功を確認→コミット」。
- **storage.js のテスト**: `localStorage` が無いNode環境では、テスト冒頭で `globalThis.localStorage` に最小スタブを差し込む（後述）。
- **描画(renderer.js) / 入力(input.js) / 統合(main.js, game.jsの一部)**: 単体テストせず、各マイルストーン末に**スマホ実機で「触って楽しいか」を目視確認**する。確認できない項目は「確認できない」と明示する。
- テスト実行コマンド: `node --test`（プロジェクト直下、`tests/` 配下の `*.test.js` を自動収集）。

---

## ファイル構成（責務）

```
index.html              # エントリ。Canvas + UI要素(HUD)
css/style.css           # 全画面Canvas、HUD、縦持ち案内
js/
  config.js             # 調整パラメータ定数（物理・スコア・ニトロ）
  physics.js            # バイク物理と GROUNDED⇄AIRBORNE 状態機械（純ロジック）
  track.js              # コース自動生成（契約ベース・C1連続）と地形クエリ（純ロジック）
  score.js              # 距離スコア・クラッシュ判定・ベスト判定（純ロジック）
  storage.js            # ベスト距離の localStorage 保存（薄いラッパ）
  input.js              # タッチ／マウス入力 → {pressing, justTapped}
  renderer.js           # 描画（地形・バイク・マーカー・予告・エフェクト・HUD）
  game.js               # 状態管理（PLAY/CRASH/READY、距離、リスタート）
  main.js               # 初期化＋ゲームループ（固定ステップのアキュムレータ）
tests/
  physics.test.js
  track.test.js
  score.test.js
```

**依存方向**: `config` ← 全員。`physics`/`track`/`score`/`storage` は互いに独立した純ロジック。`game` は physics/track/score/storage を束ねる。`renderer`/`input` はDOM依存。`main` が全部を配線。

---

## データ形（共通の約束）

座標系は **Canvas準拠で y は下が正**（画面下に行くほど y が大きい）。

```js
// バイクの状態（physics.createBike() が返す）
Bike = {
  s,        // 走行弧長(m相当)。距離スコアの源。地上で前進すると増える
  v,        // 道のりに沿ったスカラー速度
  airborne, // false=GROUNDED, true=AIRBORNE
  x, y,     // ワールド座標(px)。GROUNDEDでは地形から算出、AIRBORNEで放物運動
  vx, vy,   // AIRBORNE中の速度成分(px/s 相当)
  angle,    // 車体の傾き(rad)。地上は地形傾き、ループ中は0→2πに補間
  nitro,    // ニトロ残量 0..NITRO_MAX
}

// 地形の点（y下正）。track.points は x昇順の折れ線
TrackPoint = { x, y }

// 生成セグメント（契約ベース）。接続点で高さと傾きが連続(C1)
Segment = {
  type,      // 'flat' | 'hill' | 'up' | 'down' | 'gap' | 'loop'
  points,    // TrackPoint[]（このセグメントの折れ線。先頭は前セグメント終端に一致）
  endHeight, // 終端の y（次セグメントの startHeight）
  endSlope,  // 終端の傾き rad（次セグメントの startSlope）
  nitros,    // {x, y}[] ニトロカプセル位置（M6で使用、それ以前は空配列）
  loop,      // type==='loop' のとき {cx, cy, r, sEnter, sApex} それ以外は null
}
```

**傾きの符号（重要・全タスク共通）**: `slopeAt` は `Math.atan2(dy, dx)` を返す。y下正なので **右へ下る下り坂は slope > 0、上り坂は slope < 0**。重力の道のり成分は `+GRAVITY*sin(slope)` とし、**下り(slope>0)で加速・上り(slope<0)で減速**する。設計書3.1の `a=-g·sinθ` は y上正(θ=登り正)の表記。本実装は y下正なので符号が `+` になる。テストは符号ではなく**挙動（下りで速くなる／上りで遅くなる）**で固定する。

---

## Task 0: プロジェクト雛形 + ゲームループ + タップ (M0)

四角が右に動き、タップで速くなる。ゲームループとタッチ動作の確認だけ。純ロジックがほぼ無いので**実機目視確認**が中心。

**Files:**
- Create: `index.html`
- Create: `css/style.css`
- Create: `js/config.js`
- Create: `js/input.js`
- Create: `js/main.js`

- [ ] **Step 1: `js/config.js` を作成（調整パラメータ）**

```js
// 調整パラメータ。M1とリスク検証(設計書11章)でここを触って手触りを詰める。
export const config = {
  // 物理
  GRAVITY: 18,       // 重力(道のり成分の基準)
  SLOPE_GAIN: 0.5,   // 坂の加減速の効き(控えめ＝ニトロ主役)
  NITRO_THRUST: 26,  // ニトロ推進加速度(主役なので坂より強い)
  DRAG: 0.08,        // 速度比例の抵抗
  V_MIN: 4,          // これを下回ると失速クラッシュ
  V_START: 14,       // リスタート時の初速
  DT: 1 / 120,       // 物理の固定タイムステップ(秒)
  // 表示・スコア
  PX_PER_M: 12,      // 1メートルあたりのピクセル
  // ニトロ(M6)
  NITRO_MAX: 100,
  NITRO_BURN: 40,    // タップ中の毎秒消費
  NITRO_PICKUP: 35,  // カプセル1個の回復量
};
```

- [ ] **Step 2: `index.html` を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>NITRO MOTO</title>
  <link rel="stylesheet" href="css/style.css" />
</head>
<body>
  <canvas id="game"></canvas>
  <div id="hud">
    <div id="distance">0 m</div>
    <div id="best">BEST 0 m</div>
    <div id="nitrobar"><div id="nitrofill"></div></div>
  </div>
  <div id="rotate-notice">横向きにしてください</div>
  <div id="message"></div>
  <script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 3: `css/style.css` を作成**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #1a1f2b; touch-action: none; }
#game { display: block; width: 100vw; height: 100vh; }
#hud {
  position: fixed; top: env(safe-area-inset-top, 8px); left: 12px; right: 12px;
  display: flex; align-items: center; gap: 12px;
  font-family: system-ui, sans-serif; color: #fff; pointer-events: none;
  text-shadow: 0 1px 2px rgba(0,0,0,.6);
}
#distance { font-size: 28px; font-weight: 800; }
#best { font-size: 14px; opacity: .85; }
#nitrobar { flex: 1; height: 10px; background: rgba(255,255,255,.2); border-radius: 6px; overflow: hidden; }
#nitrofill { height: 100%; width: 0%; background: linear-gradient(90deg,#ffb020,#ff5a2c); transition: width .05s linear; }
#message {
  position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
  flex-direction: column; gap: 8px; color: #fff; font-family: system-ui, sans-serif;
  font-size: 24px; font-weight: 700; text-align: center; pointer-events: none;
  background: rgba(0,0,0,.45);
}
#rotate-notice {
  position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
  color: #fff; font-family: system-ui, sans-serif; font-size: 22px; background: #1a1f2b; z-index: 10;
}
@media (orientation: portrait) { #rotate-notice { display: flex; } #game { opacity: .25; } }
```

- [ ] **Step 4: `js/input.js` を作成（タッチ／マウス→押下状態）**

```js
// 画面全体をタップ領域にする。pressing=押している間true、justTapped=この瞬間に押し始めた
export function createInput(target) {
  const state = { pressing: false, justTapped: false };
  const down = (e) => { e.preventDefault(); if (!state.pressing) state.justTapped = true; state.pressing = true; };
  const up = (e) => { e.preventDefault(); state.pressing = false; };
  target.addEventListener('touchstart', down, { passive: false });
  target.addEventListener('touchend', up, { passive: false });
  target.addEventListener('touchcancel', up, { passive: false });
  target.addEventListener('mousedown', down);
  window.addEventListener('mouseup', up);
  // 毎フレーム末に main から呼ぶ。justTapped を1フレームだけ立てる
  state.endFrame = () => { state.justTapped = false; };
  return state;
}
```

- [ ] **Step 5: `js/main.js` を作成（M0版：四角が右に動く＋タップで加速）**

```js
import { config } from './config.js';
import { createInput } from './input.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const input = createInput(canvas);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// M0の仮状態：xだけ進む四角
let x = 50, v = 80;
let last = performance.now();
let acc = 0;

function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  while (acc >= config.DT) {
    v += (input.pressing ? 400 : -120) * config.DT;
    if (v < 80) v = 80;
    if (v > 600) v = 600;
    x += v * config.DT;
    acc -= config.DT;
  }
  const w = window.innerWidth, h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#2b3346'; ctx.fillRect(0, h * 0.7, w, h * 0.3);
  ctx.fillStyle = input.pressing ? '#ff5a2c' : '#7fd1ff';
  const drawX = (x % (w + 40)) - 20;
  ctx.fillRect(drawX, h * 0.7 - 30, 30, 30);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 6: ローカルHTTPサーバーで起動して実機確認**

Run: `cd "/home/mihara/開発/モトクロス" && python3 -m http.server 8000`
スマホで `http://<PCのLAN IP>:8000/` を開く。確認: 四角が右へ流れ、画面を押している間だけ速くなり、離すと遅くなる。横向き案内が縦持ちで出る。

- [ ] **Step 7: コミット**

```bash
cd "/home/mihara/開発/モトクロス"
git add index.html css/style.css js/config.js js/input.js js/main.js docs/
git commit -m "feat: M0 ゲームループとタップ加速の雛形"
```
（識別情報未設定なら「前提」節を先に実施）

---

## Task 1: 坂の地形ライン上を走る (M1 ★MVP)

**企画全体の生死を決める最重要タスク。** 直線＋坂の地形ライン上を走り、坂で加減速＋タップで加速。手触りを実機で検証する。ニトロはこの段階では仮（無限）でよい。

**Files:**
- Create: `js/physics.js`
- Create: `js/track.js`（M1版：固定の起伏地形）
- Create: `js/renderer.js`（M1版：地形＋バイク）
- Modify: `js/main.js`（M0仮実装を物理＋地形に差し替え）
- Test: `tests/physics.test.js`
- Test: `tests/track.test.js`

- [ ] **Step 1: 失敗するテストを書く（physics: 下りで加速・上りで減速・タップで加速）**

`tests/physics.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBike, stepGrounded } from '../js/physics.js';

test('createBike は初期状態を返す', () => {
  const b = createBike();
  assert.equal(b.airborne, false);
  assert.equal(b.s, 0);
  assert.ok(b.v >= 0);
});

test('下り坂(slope>0)では速度が上がる', () => {
  const b = createBike(); b.v = 10;
  stepGrounded(b, { slope: 0.3, nitro: false });
  assert.ok(b.v > 10, `expected >10, got ${b.v}`);
});

test('上り坂(slope<0)では速度が下がる', () => {
  const b = createBike(); b.v = 10;
  stepGrounded(b, { slope: -0.3, nitro: false });
  assert.ok(b.v < 10, `expected <10, got ${b.v}`);
});

test('タップ(nitro=true)は平地でも加速する', () => {
  const b = createBike(); b.v = 10;
  stepGrounded(b, { slope: 0, nitro: true });
  assert.ok(b.v > 10, `expected >10, got ${b.v}`);
});

test('前進すると弧長 s が増える', () => {
  const b = createBike(); b.v = 10;
  const before = b.s;
  stepGrounded(b, { slope: 0, nitro: false });
  assert.ok(b.s > before);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: FAIL（`Cannot find module '../js/physics.js'` または `createBike is not a function`）

- [ ] **Step 3: `js/physics.js` を最小実装（GROUNDEDのみ）**

```js
import { config } from './config.js';

export function createBike() {
  return {
    s: 0, v: config.V_START, airborne: false,
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, nitro: config.NITRO_MAX,
  };
}

// env = { slope, nitro }。slopeはrad(下り正)、nitroはタップ中フラグ
export function stepGrounded(bike, env) {
  const dt = config.DT;
  // 下り(slope>0)で加速・上り(slope<0)で減速。y下正のため符号は+（データ形の注記参照）
  const aGravity = config.GRAVITY * Math.sin(env.slope) * config.SLOPE_GAIN;
  const aNitro = env.nitro ? config.NITRO_THRUST : 0;
  const aDrag = -config.DRAG * bike.v;
  bike.v += (aGravity + aNitro + aDrag) * dt;
  if (bike.v < 0) bike.v = 0;
  bike.s += bike.v * dt;
  bike.angle = env.slope;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（physics 5件）

- [ ] **Step 5: 失敗するテストを書く（track: 高さ・傾きクエリ）**

`tests/track.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFlatHill, heightAt, slopeAt } from '../js/track.js';

test('makeFlatHill は x昇順の点列を返す', () => {
  const t = makeFlatHill();
  assert.ok(t.points.length > 1);
  for (let i = 1; i < t.points.length; i++) {
    assert.ok(t.points[i].x > t.points[i - 1].x);
  }
});

test('heightAt は点間を線形補間する', () => {
  const t = { points: [{ x: 0, y: 100 }, { x: 10, y: 200 }] };
  assert.equal(heightAt(t, 0), 100);
  assert.equal(heightAt(t, 10), 200);
  assert.equal(heightAt(t, 5), 150);
});

test('slopeAt は下り(yが増える方向)で正を返す', () => {
  const t = { points: [{ x: 0, y: 100 }, { x: 10, y: 200 }] };
  assert.ok(slopeAt(t, 5) > 0);
});

test('slopeAt は上り(yが減る方向)で負を返す', () => {
  const t = { points: [{ x: 0, y: 200 }, { x: 10, y: 100 }] };
  assert.ok(slopeAt(t, 5) < 0);
});
```

- [ ] **Step 6: テストを実行して失敗を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: FAIL（`Cannot find module '../js/track.js'`）

- [ ] **Step 7: `js/track.js` を最小実装（M1版：固定起伏 + クエリ）**

```js
// M1版。固定の「平坦→ゆるい起伏→上り→下り」を1本作る。M3で無限生成に置き換える。
export function makeFlatHill() {
  const points = [];
  const step = 20; // x方向の刻み(px)
  const baseY = 500;
  for (let i = 0; i <= 400; i++) {
    const x = i * step;
    // 平坦→sin起伏（振幅を後半で増やす）
    const amp = 30 + i * 0.4;
    const y = baseY + Math.sin(i * 0.12) * Math.min(amp, 180);
    points.push({ x, y });
  }
  return { points };
}

// x に対応する折れ線インデックス（x以下の最大点）を二分探索
export function indexAt(track, x) {
  const p = track.points;
  let lo = 0, hi = p.length - 1;
  if (x <= p[0].x) return 0;
  if (x >= p[hi].x) return hi - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid].x <= x) lo = mid; else hi = mid;
  }
  return lo;
}

export function heightAt(track, x) {
  const p = track.points;
  const i = indexAt(track, x);
  const a = p[i], b = p[Math.min(i + 1, p.length - 1)];
  if (b.x === a.x) return a.y;
  const t = (x - a.x) / (b.x - a.x);
  return a.y + (b.y - a.y) * t;
}

export function slopeAt(track, x) {
  const p = track.points;
  const i = indexAt(track, x);
  const a = p[i], b = p[Math.min(i + 1, p.length - 1)];
  return Math.atan2(b.y - a.y, b.x - a.x);
}
```

- [ ] **Step 8: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（physics 5件 + track 4件）

- [ ] **Step 9: `js/renderer.js` を作成（M1版：地形＋バイク）**

```js
import { config } from './config.js';
import { heightAt, slopeAt } from './track.js';

export function createRenderer(ctx) {
  return { ctx };
}

// camX = カメラ左端のワールドx
export function draw(r, game) {
  const ctx = r.ctx;
  const w = window.innerWidth, h = window.innerHeight;
  const bike = game.bike;
  const camX = bike.x - w * 0.3;
  const camY = bike.y - h * 0.55;
  ctx.clearRect(0, 0, w, h);

  // 地形（見えている範囲だけ塗る）
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let sx = 0; sx <= w; sx += 6) {
    const wx = camX + sx;
    const wy = heightAt(game.track, wx);
    ctx.lineTo(sx, wy - camY);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = '#2b3346';
  ctx.fill();
  ctx.strokeStyle = '#5b6b8c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let sx = 0; sx <= w; sx += 6) {
    const wx = camX + sx;
    const wy = heightAt(game.track, wx) - camY;
    if (sx === 0) ctx.moveTo(sx, wy); else ctx.lineTo(sx, wy);
  }
  ctx.stroke();

  // バイク（簡易：車体＋2輪、地形の傾きに合わせて回転）
  const bx = bike.x - camX, by = bike.y - camY;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(bike.angle);
  ctx.fillStyle = bike.pressing ? '#ff5a2c' : '#7fd1ff';
  ctx.fillRect(-18, -22, 36, 14);
  ctx.fillStyle = '#222';
  for (const wheelX of [-13, 13]) {
    ctx.beginPath(); ctx.arc(wheelX, -6, 8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function updateHud(game) {
  document.getElementById('distance').textContent = `${Math.floor(game.distance)} m`;
  const fill = document.getElementById('nitrofill');
  if (fill) fill.style.width = `${(game.bike.nitro / config.NITRO_MAX) * 100}%`;
}
```

- [ ] **Step 10: `js/main.js` をM1版に差し替え（物理＋地形を配線）**

```js
import { config } from './config.js';
import { createInput } from './input.js';
import { createBike, stepGrounded } from './physics.js';
import { makeFlatHill, heightAt, slopeAt } from './track.js';
import { createRenderer, draw, updateHud } from './renderer.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const input = createInput(canvas);
const renderer = createRenderer(ctx);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const game = {
  track: makeFlatHill(),
  bike: createBike(),
  distance: 0,
};
// バイクの初期ワールド座標を地形に合わせる
game.bike.x = 100;
game.bike.y = heightAt(game.track, game.bike.x);

let last = performance.now();
let acc = 0;

function fixedStep() {
  const slope = slopeAt(game.track, game.bike.x);
  stepGrounded(game.bike, { slope, nitro: input.pressing });
  // 弧長 s の前進を x にほぼ等価とみなし、x を s 方向へ動かす（M1簡略）
  game.bike.x += game.bike.v * Math.cos(slope) * config.DT;
  game.bike.y = heightAt(game.track, game.bike.x);
  game.bike.pressing = input.pressing;
  game.distance = game.bike.x / config.PX_PER_M;
}

function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  while (acc >= config.DT) { fixedStep(); acc -= config.DT; }
  draw(renderer, game);
  updateHud(game);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 11: 実機確認（最重要・手触り検証）**

Run: `cd "/home/mihara/開発/モトクロス" && python3 -m http.server 8000`
スマホで開く。確認:
- 起伏のラインに沿ってバイクが走り、下りで自然に速く・上りで遅くなる。
- 押している間だけ明確に加速し、離すと坂と抵抗で減速する。
- **「指に気持ちよく馴染むか」**を最優先で体感する。退屈なら config の `NITRO_THRUST` / `SLOPE_GAIN` / `DRAG` / `V_START` を調整して詰める（設計書11章リスク1）。

- [ ] **Step 12: コミット**

```bash
cd "/home/mihara/開発/モトクロス"
git add js/physics.js js/track.js js/renderer.js js/main.js tests/physics.test.js tests/track.test.js
git commit -m "feat: M1 坂の地形ライン上を走るMVP"
```

---

## Task 2: 即終了・距離スコア・リスタート (M2)

落下／失速で即クラッシュ、距離スコア確定、タップで即リスタート。ゲームとして成立させる。

**Files:**
- Create: `js/score.js`
- Create: `js/game.js`
- Modify: `js/main.js`（状態管理とクラッシュ／リスタートを配線）
- Modify: `js/renderer.js`（クラッシュ表示）
- Test: `tests/score.test.js`

- [ ] **Step 1: 失敗するテストを書く（score: 距離・クラッシュ・ベスト）**

`tests/score.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, shouldCrash, isBest } from '../js/score.js';

test('distanceMeters は弧長 s を m に変換する', () => {
  // PX_PER_M=12 のとき s=120px → 10m
  assert.equal(distanceMeters({ s: 120 }), 10);
});

test('shouldCrash: 速度が下限未満なら true（失速）', () => {
  assert.equal(shouldCrash({ v: 1, airborne: false, y: 0 }, false), true);
});

test('shouldCrash: 画面下端より下に落ちたら true（落下）', () => {
  assert.equal(shouldCrash({ v: 20, airborne: true, y: 9999 }, true), true);
});

test('shouldCrash: 通常走行中は false', () => {
  assert.equal(shouldCrash({ v: 20, airborne: false, y: 0 }, false), false);
});

test('isBest: 新記録なら true', () => {
  assert.equal(isBest(100, 80), true);
  assert.equal(isBest(80, 100), false);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: FAIL（`Cannot find module '../js/score.js'`）

- [ ] **Step 3: `js/score.js` を最小実装**

```js
import { config } from './config.js';

export function distanceMeters(bike) {
  return bike.s / config.PX_PER_M;
}

// fellBelowY = カメラ下端より下に落ちたか（main から渡す）
export function shouldCrash(bike, fellBelowY) {
  if (!bike.airborne && bike.v < config.V_MIN) return true; // 失速即クラッシュ
  if (fellBelowY) return true;                              // 落下
  return false;
}

export function isBest(dist, prevBest) {
  return dist > prevBest;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（physics 5 + track 4 + score 5）

- [ ] **Step 5: `js/game.js` を作成（状態管理）**

```js
import { createBike } from './physics.js';
import { heightAt } from './track.js';

// state: 'READY' | 'PLAY' | 'CRASH'
export function createGame(track) {
  const game = { track, bike: createBike(), distance: 0, best: 0, state: 'READY' };
  resetBike(game);
  return game;
}

function resetBike(game) {
  const b = game.bike;
  b.s = 0; b.airborne = false; b.angle = 0;
  b.x = 100; b.y = heightAt(game.track, b.x);
}

export function start(game) {
  game.bike = createBike();
  resetBike(game);
  game.distance = 0;
  game.state = 'PLAY';
}

export function crash(game) {
  game.state = 'CRASH';
}

export function restart(game) {
  start(game);
}
```

- [ ] **Step 6: `js/renderer.js` にクラッシュ／待機メッセージ表示を追加**

`renderer.js` の末尾に追加:
```js
export function showMessage(game) {
  const el = document.getElementById('message');
  if (!el) return;
  if (game.state === 'CRASH') {
    el.style.display = 'flex';
    el.innerHTML = `<div>CRASH</div><div>${Math.floor(game.distance)} m</div><div style="font-size:16px;opacity:.8">タップでリスタート</div>`;
  } else if (game.state === 'READY') {
    el.style.display = 'flex';
    el.innerHTML = `<div>NITRO MOTO</div><div style="font-size:16px;opacity:.8">タップでスタート</div>`;
  } else {
    el.style.display = 'none';
  }
}
```

- [ ] **Step 7: `js/main.js` をM2版に差し替え（状態機械を配線）**

`main.js` の `game` 定義以降を差し替え:
```js
import { config } from './config.js';
import { createInput } from './input.js';
import { stepGrounded } from './physics.js';
import { makeFlatHill, heightAt, slopeAt } from './track.js';
import { createRenderer, draw, updateHud, showMessage } from './renderer.js';
import { createGame, start, crash, restart } from './game.js';
import { distanceMeters, shouldCrash } from './score.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const input = createInput(canvas);
const renderer = createRenderer(ctx);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const game = createGame(makeFlatHill());

let last = performance.now();
let acc = 0;

function fixedStep() {
  const slope = slopeAt(game.track, game.bike.x);
  stepGrounded(game.bike, { slope, nitro: input.pressing });
  game.bike.x += game.bike.v * Math.cos(slope) * config.DT;
  game.bike.y = heightAt(game.track, game.bike.x);
  game.bike.pressing = input.pressing;
  game.distance = distanceMeters(game.bike);

  // 落下判定：地形より十分下（画面1.5枚分）に落ちたら落下扱い
  const fellBelowY = game.bike.y > heightAt(game.track, game.bike.x) + window.innerHeight * 1.5;
  if (shouldCrash(game.bike, fellBelowY)) crash(game);
}

function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;

  if (game.state === 'PLAY') {
    acc += dt;
    while (acc >= config.DT) { fixedStep(); if (game.state !== 'PLAY') break; acc -= config.DT; }
  } else if (input.justTapped) {
    // READY/CRASH 中のタップで開始／リスタート
    if (game.state === 'READY') start(game); else restart(game);
    acc = 0;
  }

  draw(renderer, game);
  updateHud(game);
  showMessage(game);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

注: `score.js` の `shouldCrash` の落下判定は弧長ベースではなく「地形より大きく下」を main 側で計算して渡す。M1の `makeFlatHill` には谷が無いので、M2では主に**失速クラッシュ**が発火する。落下はM4のギャップ導入後に本格化する。

- [ ] **Step 8: 実機確認**

確認: 上り坂で減速し `V_MIN` を割ると即CRASH表示＋距離が出る。タップでREADYからスタート、CRASHから即リスタートできる。

- [ ] **Step 9: コミット**

```bash
cd "/home/mihara/開発/モトクロス"
git add js/score.js js/game.js js/main.js js/renderer.js tests/score.test.js
git commit -m "feat: M2 失速クラッシュ・距離スコア・即リスタート"
```

---

## Task 3: 無限生成 + ベスト距離保存 (M3)

右へ無限生成（平坦・起伏・上り・下りのみ）。接続点で高さと傾きを連続(C1)させる。ベスト距離を `localStorage` に保存。エンドレス成立。

**Files:**
- Modify: `js/track.js`（`makeFlatHill` を契約ベース無限生成に置き換え）
- Create: `js/storage.js`
- Modify: `js/game.js`（ベスト読み込み・保存）
- Modify: `js/main.js`（生成の延長・過去破棄を配線）
- Modify: `tests/track.test.js`（生成の不変条件テストを追加）

- [ ] **Step 1: 失敗するテストを書く（track: 乱数・契約・連続性）**

`tests/track.test.js` の末尾に追加:
```js
import { mulberry32, createTrack, extendTo, slopeAt as _slopeAt } from '../js/track.js';

test('mulberry32 は同じ種で同じ列を返す（決定的）', () => {
  const a = mulberry32(123), b = mulberry32(123);
  assert.equal(a(), b());
  assert.equal(a(), b());
});

test('createTrack は十分な長さの点列を持つ', () => {
  const t = createTrack(1);
  assert.ok(t.points.length > 10);
});

test('extendTo は指定ワールドxを超えるまで点を伸ばす', () => {
  const t = createTrack(1);
  const targetX = t.points[t.points.length - 1].x + 5000;
  extendTo(t, targetX);
  assert.ok(t.points[t.points.length - 1].x >= targetX);
});

test('接続点で傾きが連続（隣接区間の傾き差が小さい＝C1）', () => {
  const t = createTrack(7);
  extendTo(t, 8000);
  // セグメント境界付近で傾きが不連続に跳ねていないことを抜き取り確認
  let maxJump = 0;
  for (let x = 200; x < 7000; x += 50) {
    const j = Math.abs(_slopeAt(t, x + 20) - _slopeAt(t, x));
    maxJump = Math.max(maxJump, j);
  }
  assert.ok(maxJump < 0.6, `傾きの跳ねが大きすぎ: ${maxJump}`);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: FAIL（`createTrack` 等が未定義）

- [ ] **Step 3: `js/track.js` を契約ベース無限生成に書き換え**

`heightAt` / `slopeAt` / `indexAt` は残し、`makeFlatHill` を削除して以下を追加（`makeFlatHill` を import している箇所はStep5/6で差し替える）:
```js
// 決定的擬似乱数（種から同じ列）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEP = 20;     // x刻み(px)
const BASE_Y = 500;  // 基準の高さ
const SEG_DIFF_START = 0; // 難易度の起点(進行距離で増やす)

// 契約: generate(startX, startY, startSlope, rng, difficulty)
//   → 点を track.points に push し、{endY, endSlope} を返す。
// 接続点は前区間終端の (startY, startSlope) から始め、傾きを連続させる。

// 種別ごとの生成。すべて開始傾き startSlope から滑らかに目標傾きへ補間してC1連続を保つ。
function genSegment(track, startX, startY, startSlope, type, len, rng) {
  const pts = track.points;
  let targetSlope;
  switch (type) {
    case 'flat': targetSlope = 0; break;
    case 'up':   targetSlope = -(0.25 + rng() * 0.25); break; // 上り(負)
    case 'down': targetSlope =  (0.25 + rng() * 0.25); break; // 下り(正)
    case 'hill': targetSlope = startSlope; break;             // sin起伏は別処理
    default:     targetSlope = 0;
  }
  let x = startX, y = startY, slope = startSlope;
  const n = Math.max(2, Math.floor(len / STEP));
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    if (type === 'hill') {
      // 既存の傾きを保ちつつ、緩やかなsin起伏を重ねる
      slope = startSlope + Math.sin(u * Math.PI * 2) * 0.18;
    } else {
      // startSlope → targetSlope を滑らかに補間（cosイージング）
      slope = startSlope + (targetSlope - startSlope) * (0.5 - 0.5 * Math.cos(u * Math.PI));
    }
    x += STEP;
    y += Math.tan(slope) * STEP;
    pts.push({ x, y });
  }
  return { endY: y, endSlope: slope };
}

const TYPES = ['flat', 'hill', 'up', 'down'];

// 進行距離→出現重み（進むほど坂を増やす）。難易度カーブはこのテーブル1枚に集約。
function pickType(rng, worldX) {
  const hard = Math.min(worldX / 20000, 1); // 0→1
  const weights = {
    flat: 3 - hard * 1.5,
    hill: 2 + hard,
    up:   1 + hard,
    down: 1 + hard,
  };
  const total = TYPES.reduce((s, t) => s + weights[t], 0);
  let r = rng() * total;
  for (const t of TYPES) { r -= weights[t]; if (r <= 0) return t; }
  return 'flat';
}

export function createTrack(seed = 1) {
  const track = {
    points: [{ x: 0, y: BASE_Y }],
    rng: mulberry32(seed),
    endX: 0, endY: BASE_Y, endSlope: 0,
    headDropX: -Infinity, // ここより左は破棄済み
  };
  // 序盤は必ず平坦から（手触りの導入）
  const r0 = genSegment(track, 0, BASE_Y, 0, 'flat', 600, track.rng);
  track.endX = track.points[track.points.length - 1].x;
  track.endY = r0.endY; track.endSlope = r0.endSlope;
  return track;
}

// worldX を超えるまでセグメントを足し続ける
export function extendTo(track, worldX) {
  while (track.endX < worldX) {
    const type = pickType(track.rng, track.endX);
    const len = 300 + track.rng() * 500;
    const res = genSegment(track, track.endX, track.endY, track.endSlope, type, len, track.rng);
    track.endX = track.points[track.points.length - 1].x;
    track.endY = res.endY; track.endSlope = res.endSlope;
  }
}

// worldX より十分左の古い点を捨ててメモリ節約（indexAt が壊れないよう先頭のみ削る）
export function dropBehind(track, worldX) {
  const keepFrom = worldX - 2000;
  let cut = 0;
  while (cut < track.points.length - 2 && track.points[cut + 1].x < keepFrom) cut++;
  if (cut > 0) track.points.splice(0, cut);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（track の新規4件を含む）

- [ ] **Step 5: 失敗するテストを書く（storage: スタブ経由の保存・読込）**

`tests/score.test.js` の末尾に追加（`localStorage` をNodeにスタブ）:
```js
import { loadBest, saveBest } from '../js/storage.js';

test('saveBest/loadBest はベスト距離を往復できる', () => {
  // Node環境用の最小 localStorage スタブ
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  assert.equal(loadBest(), 0);     // 未保存は0
  saveBest(123.4);
  assert.equal(loadBest(), 123.4);
});
```

- [ ] **Step 6: テストを実行して失敗を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: FAIL（`Cannot find module '../js/storage.js'`）

- [ ] **Step 7: `js/storage.js` を最小実装**

```js
const KEY = 'nitromoto.best';

export function loadBest() {
  const raw = localStorage.getItem(KEY);
  const n = raw == null ? 0 : parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

export function saveBest(dist) {
  localStorage.setItem(KEY, String(dist));
}
```

- [ ] **Step 8: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（storage 1件追加）

- [ ] **Step 9: `js/game.js` にベスト読込・保存・新記録判定を配線**

`game.js` を修正:
```js
import { createBike } from './physics.js';
import { heightAt } from './track.js';
import { distanceMeters, isBest } from './score.js';
import { loadBest, saveBest } from './storage.js';

export function createGame(track) {
  const game = { track, bike: createBike(), distance: 0, best: loadBest(), state: 'READY' };
  resetBike(game);
  return game;
}

function resetBike(game) {
  const b = game.bike;
  b.s = 0; b.airborne = false; b.angle = 0;
  b.x = 100; b.y = heightAt(game.track, b.x);
}

export function start(game) {
  game.bike = createBike();
  resetBike(game);
  game.distance = 0;
  game.state = 'PLAY';
}

export function crash(game) {
  game.state = 'CRASH';
  const d = distanceMeters(game.bike);
  if (isBest(d, game.best)) { game.best = d; saveBest(d); }
}

export function restart(game) {
  start(game);
}
```

- [ ] **Step 10: `js/main.js` で無限生成の延長・破棄を配線し、距離を弧長 s に統一**

`main.js` を修正（`makeFlatHill` → `createTrack`、`fixedStep` に `s` 更新と延長/破棄を追加）:
```js
import { createTrack, extendTo, dropBehind, heightAt, slopeAt } from './track.js';
// （createGame は createTrack を渡すよう変更）
const game = createGame(createTrack(Date.now() >>> 0));
```
`fixedStep` を修正:
```js
function fixedStep() {
  const b = game.bike;
  const slope = slopeAt(game.track, b.x);
  stepGrounded(b, { slope, nitro: input.pressing });
  const dx = b.v * Math.cos(slope) * config.DT;
  b.x += dx;
  b.s += b.v * config.DT; // 距離スコアの源は弧長
  b.y = heightAt(game.track, b.x);
  b.pressing = input.pressing;
  game.distance = distanceMeters(b);

  extendTo(game.track, b.x + window.innerWidth);
  dropBehind(game.track, b.x);

  const fellBelowY = b.y > heightAt(game.track, b.x) + window.innerHeight * 1.5;
  if (shouldCrash(b, fellBelowY)) crash(game);
}
```
`updateHud` でベスト表示するため `renderer.js` の `updateHud` に追記:
```js
  const bestEl = document.getElementById('best');
  if (bestEl) bestEl.textContent = `BEST ${Math.floor(game.best)} m`;
```

- [ ] **Step 11: 実機確認**

確認: 右へ無限に地形が続く（途切れない・大きく跳ねない）。距離が伸び続け、CRASH後にベストが更新・保持される（リロードしても残る）。進むほど坂が増える体感がある。

- [ ] **Step 12: コミット**

```bash
cd "/home/mihara/開発/モトクロス"
git add js/track.js js/storage.js js/game.js js/main.js js/renderer.js tests/track.test.js tests/score.test.js
git commit -m "feat: M3 無限生成とベスト距離保存"
```

---

## Task 4: ジャンプ／ギャップ（離陸・着地・着地点マーカー）(M4)

ジャンプ台の終端やギャップで離陸(AIRBORNE)、放物運動、地形と交差で着地。着地角度が過大ならクラッシュ。飛ぶ前に**着地点マーカー**を出して理不尽死を防ぐ。

**Files:**
- Modify: `js/physics.js`（`launch` / `stepAirborne` / `landingTangentSpeed` を追加）
- Modify: `js/track.js`（`gap` 種別と `isGap` を追加）
- Modify: `js/main.js`（GROUNDED⇄AIRBORNE 遷移・着地走査を配線）
- Modify: `js/renderer.js`（着地点マーカー描画）
- Modify: `tests/physics.test.js`（空中物理・着地のテストを追加）
- Modify: `tests/track.test.js`（ギャップ判定のテストを追加）

- [ ] **Step 1: `js/physics.js` の冒頭に状態遷移の擬似コードを明記**

`physics.js` の先頭（import の直後）にコメントを追加:
```js
// === GROUNDED ⇄ AIRBORNE 状態遷移（設計書3.2）===
// GROUNDED: 弧長 s で地形に追従。x,y は地形から算出。
//   離陸条件: ギャップに入った / 地形が急に落ちて追従しきれない
//   → launch(bike, slope): スカラー v を (vx, vy) に分解して AIRBORNE へ。
// AIRBORNE: (x,y,vx,vy) で放物運動。重力で vy が増える(y下正)。
//   着地: 1フレームをサブステップ走査し、放物線が地形ラインを下に跨いだ点で着地。
//   → landingTangentSpeed(vx, vy, slope): (vx,vy) を地形接線へ射影して v に戻す。
//   着地角度: 進行方向と着地地形傾きの差が大きすぎるとクラッシュ。
```

- [ ] **Step 2: 失敗するテストを書く（physics: 離陸・空中・着地速度）**

`tests/physics.test.js` の末尾に追加:
```js
import { launch, stepAirborne, landingTangentSpeed } from '../js/physics.js';

test('launch は GROUNDED から AIRBORNE にして速度を分解する', () => {
  const b = createBike(); b.v = 20; b.airborne = false;
  launch(b, 0); // 水平に離陸
  assert.equal(b.airborne, true);
  assert.ok(Math.abs(b.vx - 20) < 1e-6);
  assert.ok(Math.abs(b.vy) < 1e-6);
});

test('stepAirborne は重力で vy を増やし落下させる（y下正）', () => {
  const b = createBike(); b.airborne = true; b.vx = 20; b.vy = 0; b.x = 0; b.y = 0;
  const vy0 = b.vy;
  stepAirborne(b);
  assert.ok(b.vy > vy0, '重力でvyが増える');
  assert.ok(b.x > 0, '前進する');
});

test('landingTangentSpeed は速度ベクトルを接線へ射影する', () => {
  // 水平移動(vx=20,vy=0)が平坦(slope=0)に着地 → v≈20
  assert.ok(Math.abs(landingTangentSpeed(20, 0, 0) - 20) < 1e-6);
  // 真下落下(vx=0,vy=20)が平坦に着地 → 接線成分0
  assert.ok(Math.abs(landingTangentSpeed(0, 20, 0)) < 1e-6);
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: FAIL（`launch` 等が未定義）

- [ ] **Step 4: `js/physics.js` に空中物理を実装**

`physics.js` の末尾に追加:
```js
// スカラー速度 v を接線(slope)方向の (vx, vy) に分解して離陸
export function launch(bike, slope) {
  bike.airborne = true;
  bike.vx = bike.v * Math.cos(slope);
  bike.vy = bike.v * Math.sin(slope);
}

// 放物運動。重力で vy 増加（y下正）。s も水平移動分だけ進める
export function stepAirborne(bike) {
  const dt = config.DT;
  bike.vy += config.GRAVITY * dt;
  bike.x += bike.vx * dt;
  bike.y += bike.vy * dt;
  bike.s += Math.hypot(bike.vx, bike.vy) * dt;
  bike.angle = Math.atan2(bike.vy, bike.vx); // 進行方向に機首を向ける
}

// 着地時、速度ベクトルを地形接線へ射影したスカラー速度を返す
export function landingTangentSpeed(vx, vy, slope) {
  const tx = Math.cos(slope), ty = Math.sin(slope);
  return vx * tx + vy * ty;
}
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（physics に3件追加）

- [ ] **Step 6: 失敗するテストを書く（track: ギャップ判定）**

`tests/track.test.js` の末尾に追加:
```js
import { isGap } from '../js/track.js';

test('isGap: ギャップ区間内の x で true、地形上で false', () => {
  // gaps に [x0,x1] の穴を持つ簡易トラック
  const t = { points: [{ x: 0, y: 100 }, { x: 100, y: 100 }], gaps: [[40, 60]] };
  assert.equal(isGap(t, 50), true);
  assert.equal(isGap(t, 10), false);
});

test('isGap: gaps 未定義でも安全に false', () => {
  const t = { points: [{ x: 0, y: 100 }] };
  assert.equal(isGap(t, 10), false);
});
```

- [ ] **Step 7: テストを実行して失敗を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: FAIL（`isGap` 未定義）

- [ ] **Step 8: `js/track.js` にギャップを実装**

`track.js` を修正。`createTrack` の戻り値に `gaps: []` を追加し、`isGap` と gap 生成を追加:
```js
export function isGap(track, x) {
  const gaps = track.gaps;
  if (!gaps) return false;
  for (const [x0, x1] of gaps) { if (x >= x0 && x <= x1) return true; }
  return false;
}
```
`genSegment` に `'gap'` ケースを追加（ジャンプ台＝上り→途切れ→着地台）:
```js
// 'gap': 短い上りキッカーの後にギャップ。track.gaps に穴を登録。
function genGap(track, startX, startY, startSlope, rng) {
  const pts = track.points;
  // (a) 上りキッカー
  let x = startX, y = startY, slope = startSlope;
  const kicker = 6;
  for (let i = 1; i <= kicker; i++) {
    slope = startSlope + (-(0.4 + rng() * 0.2) - startSlope) * (i / kicker);
    x += STEP; y += Math.tan(slope) * STEP;
    pts.push({ x, y });
  }
  const liftSlope = slope, liftX = x, liftY = y;
  // (b) ギャップ（穴）。幅はランダム
  const gapW = 120 + rng() * 160;
  track.gaps.push([liftX, liftX + gapW]);
  // (c) 着地台（少し下、ほぼ平坦から再開）
  const landX = liftX + gapW;
  const landY = liftY + (20 + rng() * 80);
  pts.push({ x: landX, y: landY });
  return { endY: landY, endSlope: 0, endX: landX };
}
```
`extendTo` / `pickType` を gap 対応に修正:
```js
const TYPES = ['flat', 'hill', 'up', 'down', 'gap'];
// pickType の weights に gap を追加（序盤は出さない）
//   gap: worldX < 6000 ? 0 : hard * 1.2,
```
`extendTo` 内で `type === 'gap'` のときは `genGap` を呼び、それ以外は従来の `genSegment` を呼ぶ分岐にする。`createTrack` の初期化に `track.gaps = [];` を追加。

- [ ] **Step 9: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（track にギャップ2件追加）

- [ ] **Step 10: `js/main.js` で GROUNDED⇄AIRBORNE 遷移と着地走査を配線**

`fixedStep` を空中対応に書き換え:
```js
import { stepGrounded, launch, stepAirborne, landingTangentSpeed } from './physics.js';
import { createTrack, extendTo, dropBehind, heightAt, slopeAt, isGap } from './track.js';

function fixedStep() {
  const b = game.bike;
  extendTo(game.track, b.x + window.innerWidth * 2);

  if (!b.airborne) {
    const slope = slopeAt(game.track, b.x);
    stepGrounded(b, { slope, nitro: input.pressing });
    const dx = b.v * Math.cos(slope) * config.DT;
    const nextX = b.x + dx;
    // 離陸判定: 次の位置がギャップ、または地形が急落して追従できない
    const groundNext = heightAt(game.track, nextX);
    const fallGap = isGap(game.track, nextX);
    b.x = nextX;
    if (fallGap) {
      launch(b, slope);
    } else {
      // 地形が下に大きく逃げた場合も離陸（段差ジャンプ）
      const predicted = b.y + Math.tan(slope) * dx;
      if (groundNext - predicted > 6) { launch(b, slope); }
      else { b.y = groundNext; b.angle = slope; }
    }
  } else {
    // 空中：サブステップで地形交差を走査（トンネリング防止）
    const SUB = 4;
    for (let i = 0; i < SUB; i++) {
      const prevY = b.y;
      b.vy += config.GRAVITY * (config.DT / SUB);
      b.x += b.vx * (config.DT / SUB);
      b.y += b.vy * (config.DT / SUB);
      b.s += Math.hypot(b.vx, b.vy) * (config.DT / SUB);
      const ground = heightAt(game.track, b.x);
      if (!isGap(game.track, b.x) && b.y >= ground && prevY <= ground + 40) {
        // 着地
        const slope = slopeAt(game.track, b.x);
        const newV = landingTangentSpeed(b.vx, b.vy, slope);
        const approach = Math.atan2(b.vy, b.vx);
        if (Math.abs(approach - slope) > 0.9) { crash(game); return; } // 着地角度過大
        b.airborne = false; b.v = Math.max(newV, 0); b.y = ground; b.angle = slope;
        break;
      }
    }
    b.angle = Math.atan2(b.vy, b.vx);
  }

  b.pressing = input.pressing;
  game.distance = distanceMeters(b);
  dropBehind(game.track, b.x);

  const fellBelowY = b.y > heightAt(game.track, b.x) + window.innerHeight * 1.5;
  if (shouldCrash(b, fellBelowY)) crash(game);
}
```

- [ ] **Step 11: `js/renderer.js` に着地点マーカーを追加**

`renderer.js` に追加し、`draw` の末尾で空中時に呼ぶ:
```js
import { heightAt, slopeAt, isGap } from './track.js';

export function drawLandingMarker(r, game, camX, camY) {
  const b = game.bike;
  if (!b.airborne) return;
  // 現在の (x,y,vx,vy) から着地予測点を前方走査
  let px = b.x, py = b.y, pvy = b.vy;
  const dt = config.DT;
  for (let i = 0; i < 600; i++) {
    pvy += config.GRAVITY * dt;
    px += b.vx * dt;
    py += pvy * dt;
    const g = heightAt(game.track, px);
    if (!isGap(game.track, px) && py >= g) {
      const ctx = r.ctx;
      const sx = px - camX, sy = g - camY;
      ctx.save();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 18, sy); ctx.lineTo(sx + 18, sy); ctx.stroke();
      ctx.restore();
      return;
    }
  }
}
```
`draw` の中で `camX, camY` を算出している箇所の直後に `drawLandingMarker(r, game, camX, camY);` を追加（バイク描画の前）。

- [ ] **Step 12: 実機確認**

確認: ジャンプ台で離陸して放物線を描き、着地台に着地して走行継続。空中で**着地予測マーカー**が出る。速度不足でギャップに届かず谷に落ちるとCRASH。着地角度が急すぎるとCRASH。

- [ ] **Step 13: コミット**

```bash
cd "/home/mihara/開発/モトクロス"
git add js/physics.js js/track.js js/main.js js/renderer.js tests/physics.test.js tests/track.test.js
git commit -m "feat: M4 ジャンプ・ギャップ・着地点マーカー"
```

---

## Task 5: 360度ループ（判定ゲート＋演出）(M5)

厳密な連続物理はしない。**進入時に必要速度を1回判定**し、成功なら姿勢を0→360度に補間して回す演出、失敗なら頂点付近で離脱→放物落下→クラッシュ。M1〜M4が完成してから最後に挑む。

**Files:**
- Modify: `js/config.js`（`LOOP_SAFETY` 追加）
- Modify: `js/physics.js`（`loopRequiredSpeed` / `canClearLoop` 追加）
- Modify: `js/track.js`（`loop` セグメントと `loopAt` 追加）
- Modify: `js/main.js`（ループ進入判定・回転演出・失敗離脱を配線）
- Modify: `js/renderer.js`（ループ曲線の描画・難所予告）
- Modify: `tests/physics.test.js`（必要速度・通過可否のテスト追加）

- [ ] **Step 1: `js/config.js` に `LOOP_SAFETY` を追加**

`config` オブジェクトに1行追加:
```js
  LOOP_SAFETY: 1.15, // ループ必要速度の安全係数（難易度はこの1つで調整）
```

- [ ] **Step 2: 失敗するテストを書く（physics: ループ必要速度・通過可否）**

`tests/physics.test.js` の末尾に追加:
```js
import { loopRequiredSpeed, canClearLoop } from '../js/physics.js';
import { config } from '../js/config.js';

test('loopRequiredSpeed は √(g·r)·安全係数', () => {
  const r = 50;
  const expected = Math.sqrt(config.GRAVITY * r) * config.LOOP_SAFETY;
  assert.ok(Math.abs(loopRequiredSpeed(r) - expected) < 1e-6);
});

test('canClearLoop: 必要速度以上で true、未満で false', () => {
  const r = 50;
  const need = loopRequiredSpeed(r);
  assert.equal(canClearLoop(need + 1, r), true);
  assert.equal(canClearLoop(need - 1, r), false);
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: FAIL（`loopRequiredSpeed` 未定義）

- [ ] **Step 4: `js/physics.js` にループ判定を実装**

`physics.js` の末尾に追加:
```js
// ループ頂点を保つのに必要な最低速度（円運動 v=√(g·r) に安全係数）
export function loopRequiredSpeed(r) {
  return Math.sqrt(config.GRAVITY * r) * config.LOOP_SAFETY;
}

export function canClearLoop(v, r) {
  return v >= loopRequiredSpeed(r);
}
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（physics に2件追加）

- [ ] **Step 6: `js/track.js` にループセグメントと `loopAt` を実装**

`createTrack` 初期化に `track.loops = [];` を追加。`loopAt` を追加:
```js
// x がいずれかのループの進入点〜退出点の範囲内ならそのループ情報を返す
export function loopAt(track, x) {
  if (!track.loops) return null;
  for (const lp of track.loops) {
    if (x >= lp.enterX && x <= lp.exitX) return lp;
  }
  return null;
}
```
`genLoop`（平坦な助走→ループ→平坦に再開。位置はループ円に拘束）:
```js
function genLoop(track, startX, startY, startSlope, rng) {
  const pts = track.points;
  // (a) 平坦な助走（傾きを0に戻す）
  let x = startX, y = startY, slope = startSlope;
  const run = 8;
  for (let i = 1; i <= run; i++) {
    slope = startSlope + (0 - startSlope) * (i / run);
    x += STEP; y += Math.tan(slope) * STEP;
    pts.push({ x, y });
  }
  // (b) ループ：進入点を記録。地形ライン自体は平坦のまま通し、描画と判定で円を扱う
  const r = 60 + rng() * 30;
  const enterX = x;
  const exitX = x + r * 2.2; // ループの水平占有
  track.loops.push({ enterX, exitX, r, cx: enterX + r * 1.1, cy: y - r, baseY: y });
  // ループ区間の地形は平坦に通す（成功時は円に拘束、失敗時のみ落下）
  for (let i = 1; x < exitX; i++) { x += STEP; pts.push({ x, y }); }
  return { endY: y, endSlope: 0, endX: x };
}
```
`extendTo` に `type === 'loop'` 分岐を追加して `genLoop` を呼ぶ。`pickType` の `TYPES` に `'loop'` を追加し重みは `loop: worldX < 10000 ? 0 : hard * 0.5`（序盤は出さない・低頻度）。

- [ ] **Step 7: 失敗するテストを書く（track: loopAt 範囲判定）**

`tests/track.test.js` の末尾に追加:
```js
import { loopAt } from '../js/track.js';

test('loopAt: ループ範囲内でループ情報、範囲外で null', () => {
  const t = { loops: [{ enterX: 100, exitX: 220, r: 55 }] };
  assert.ok(loopAt(t, 150));
  assert.equal(loopAt(t, 50), null);
  assert.equal(loopAt(t, 300), null);
});
```

- [ ] **Step 8: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（track に loopAt 1件追加。physics/track 全件緑）

- [ ] **Step 9: `js/main.js` にループ進入判定・回転演出・失敗離脱を配線**

`fixedStep` の GROUNDED 分岐の先頭で、ループ進入を検出して専用処理に入る。`game` に `loopAnim` 状態を持たせる:
```js
import { loopAt } from './track.js';
import { canClearLoop } from './physics.js';

// fixedStep の GROUNDED 処理の前に挿入
const lp = loopAt(game.track, b.x);
if (lp && !b.inLoop && !b.airborne) {
  // 進入の瞬間に1回だけ判定
  if (canClearLoop(b.v, lp.r)) {
    b.inLoop = true; b.loopT = 0; b.loopRef = lp; // 成功：回転演出へ
  } else {
    // 失敗：頂点付近で接線方向へ離脱して落下
    b.inLoop = false;
    launch(b, -1.3); // 上向き斜めに飛び出す（負＝上方向）
    b.failLoop = true;
  }
}
if (b.inLoop) {
  // 成功演出：位置をループ円に拘束し、角度を0→2πに補間
  const lpr = b.loopRef;
  b.loopT += (b.v / (2 * Math.PI * lpr.r)) * config.DT * Math.PI * 2;
  const ang = b.loopT; // 0→2π
  b.x = lpr.cx + Math.sin(ang) * lpr.r;     // 進入から円を1周
  b.y = lpr.cy + Math.cos(ang) * lpr.r;
  b.angle = -ang;                            // 車体も1回転
  b.s += b.v * config.DT;
  if (b.loopT >= Math.PI * 2) {
    // 退出：平坦へ復帰
    b.inLoop = false; b.x = lpr.exitX; b.y = lpr.baseY; b.angle = 0;
  }
  // ループ中は通常のGROUNDED処理をスキップ
  b.pressing = input.pressing;
  game.distance = distanceMeters(b);
  return;
}
```
`createBike()`（physics.js）の戻り値に `inLoop: false, loopT: 0, loopRef: null, failLoop: false` を追加。

- [ ] **Step 10: `js/renderer.js` にループ曲線描画と難所予告を追加**

地形描画の後にループ円を描く。`draw` 内、地形ストロークの直後に追加:
```js
import { loopAt } from './track.js';
// draw 内、camX/camY 既知の場所で：
if (game.track.loops) {
  for (const lp of game.track.loops) {
    if (lp.exitX < camX || lp.enterX > camX + window.innerWidth) continue;
    ctx.save();
    ctx.strokeStyle = '#8aa0c8'; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(lp.cx - camX, lp.cy - camY, lp.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
```
難所予告（画面右端アイコン）: 前方一定距離にループ／大ギャップがあれば右端に「⟳」を出す。`draw` の末尾に追加:
```js
const aheadLoop = (game.track.loops || []).find(l => l.enterX > game.bike.x && l.enterX < game.bike.x + 1400);
if (aheadLoop) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,210,63,.9)'; ctx.font = 'bold 34px system-ui';
  ctx.textAlign = 'right'; ctx.fillText('⟳', window.innerWidth - 16, 90);
  ctx.restore();
}
```

- [ ] **Step 11: 実機確認**

確認: ループ手前でアイコン予告が出る。十分な速度で進入すると360度回って通過（姿勢が1回転、位置が円に拘束）。速度不足だと頂点付近で飛び出して落下→CRASH。`config.LOOP_SAFETY` を上下して難易度の手応えを調整する（設計書11章リスク2）。

- [ ] **Step 12: コミット**

```bash
cd "/home/mihara/開発/モトクロス"
git add js/config.js js/physics.js js/track.js js/main.js js/renderer.js tests/physics.test.js tests/track.test.js
git commit -m "feat: M5 360度ループ（判定ゲート＋回転演出）"
```

---

## Task 6: ニトロゲージ＆カプセル＆配置保証 (M6)

ゲームの主役。ニトロを消費しながら推進、空だと噴射不可。各難所の手前にはクリアに足りるニトロを**必ず**配置（運ゲー防止）。温存の駆け引きを最後に重ねる。

**Files:**
- Modify: `js/physics.js`（`stepGrounded` をニトロ残量で制御・消費に変更）
- Modify: `js/track.js`（`nitros` 配置と難所前の保証配置 `guaranteeNitrosBeforeHazards`）
- Modify: `js/main.js`（カプセル取得＝弧長区間跨ぎ判定、ニトロ受け渡し）
- Modify: `js/renderer.js`（カプセル描画）
- Modify: `tests/physics.test.js`（ニトロ消費・空時不噴射のテスト追加）
- Modify: `tests/track.test.js`（難所前のニトロ保証のテスト追加）

- [ ] **Step 1: 失敗するテストを書く（physics: ニトロ消費・空で不噴射）**

`tests/physics.test.js` の末尾に追加:
```js
test('ニトロ残量があるタップは加速し、ニトロを消費する', () => {
  const b = createBike(); b.v = 10; b.nitro = 50;
  stepGrounded(b, { slope: 0, nitro: true });
  assert.ok(b.v > 10, '加速する');
  assert.ok(b.nitro < 50, 'ニトロが減る');
});

test('ニトロが空ならタップしても噴射しない（加速しない）', () => {
  const b = createBike(); b.v = 10; b.nitro = 0;
  stepGrounded(b, { slope: 0, nitro: true });
  assert.ok(b.v <= 10, '平地・空タップでは加速しない');
  assert.equal(b.nitro, 0);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: FAIL（現状の `stepGrounded` は `nitro` 残量を見ずに加速するため新テストが落ちる）

- [ ] **Step 3: `js/physics.js` の `stepGrounded` をニトロ制御に変更**

`stepGrounded` を差し替え:
```js
export function stepGrounded(bike, env) {
  const dt = config.DT;
  const aGravity = config.GRAVITY * Math.sin(env.slope) * config.SLOPE_GAIN;
  // ニトロは「タップ中 かつ 残量あり」のときだけ噴射し、残量を消費する
  const firing = env.nitro && bike.nitro > 0;
  const aNitro = firing ? config.NITRO_THRUST : 0;
  if (firing) {
    bike.nitro -= config.NITRO_BURN * dt;
    if (bike.nitro < 0) bike.nitro = 0;
  }
  const aDrag = -config.DRAG * bike.v;
  bike.v += (aGravity + aNitro + aDrag) * dt;
  if (bike.v < 0) bike.v = 0;
  bike.s += bike.v * dt;
  bike.angle = env.slope;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（physics にニトロ2件追加。既存の「タップで加速」テストは `createBike` が `nitro=NITRO_MAX` で始まるため通る）

- [ ] **Step 5: 失敗するテストを書く（track: 難所前のニトロ保証）**

`tests/track.test.js` の末尾に追加:
```js
import { createTrack as _ct, extendTo as _ext } from '../js/track.js';

test('ループの手前に十分なニトロが配置される（運ゲー防止）', () => {
  const t = _ct(42);
  _ext(t, 30000); // ループが出る距離まで生成
  if (!t.loops || t.loops.length === 0) return; // ループ未出現なら検証スキップ
  for (const lp of t.loops) {
    // 進入点の手前 2500px 以内に最低1個のニトロがある
    const near = (t.nitros || []).filter(n => n.x < lp.enterX && n.x > lp.enterX - 2500);
    assert.ok(near.length >= 1, `ループ手前にニトロ無し @${lp.enterX}`);
  }
});
```

- [ ] **Step 6: テストを実行して失敗を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: FAIL（`t.nitros` 未定義、または保証配置が無い）

- [ ] **Step 7: `js/track.js` にニトロ配置と難所前の保証を実装**

`createTrack` 初期化に `track.nitros = [];` を追加。`extendTo` の各セグメント生成後に通常配置と保証配置を行う。以下を追加し、`extendTo` のループ末尾で呼ぶ:
```js
// 通常配置：平坦・起伏・坂の上に、地形に沿って散らす（余剰分・取りに行く位置）
function scatterNitros(track, fromX, toX, rng) {
  for (let x = fromX; x < toX; x += 220 + rng() * 260) {
    if (isGap(track, x) || loopAt(track, x)) continue;
    const y = heightAt(track, x) - (24 + rng() * 60); // 地面の少し上
    track.nitros.push({ x, y, taken: false });
  }
}

// 保証配置：ループ進入の手前に、クリアに必要な数のニトロを必ず置く
export function guaranteeNitrosBeforeHazards(track) {
  if (!track.loops) return;
  for (const lp of track.loops) {
    if (lp._guaranteed) continue;
    lp._guaranteed = true;
    // 必要速度に届くだけの個数を手前に階段状に置く（最低3個保証）
    const n = 4;
    for (let i = 0; i < n; i++) {
      const x = lp.enterX - 1800 + i * 300;
      if (x <= 0) continue;
      const y = heightAt(track, x) - 30;
      track.nitros.push({ x, y, taken: false, guaranteed: true });
    }
  }
}
```
`extendTo` の `while` ループ内、セグメント追加後に:
```js
  scatterNitros(track, prevEndX, track.endX, track.rng); // prevEndX は追加前の endX
  guaranteeNitrosBeforeHazards(track);
```
（`prevEndX` は各反復の先頭で `const prevEndX = track.endX;` として退避）。`dropBehind` に古いニトロの破棄も追加:
```js
  if (track.nitros) {
    let c = 0;
    while (c < track.nitros.length && track.nitros[c].x < worldX - 2000) c++;
    if (c > 0) track.nitros.splice(0, c);
  }
```

- [ ] **Step 8: テストを実行して成功を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（track にニトロ保証1件追加。全件緑）

- [ ] **Step 9: `js/main.js` でカプセル取得（弧長/位置の区間跨ぎ判定）を配線**

`fixedStep` の末尾（距離更新の後）にカプセル取得判定を追加。トンネリング防止のため「前フレームのxと今のxの間を跨いだ未取得カプセル」を取得扱いにする:
```js
// カプセル取得：bike が通り過ぎた未取得カプセルを回収
const prevX = b._prevX ?? b.x;
for (const cap of game.track.nitros || []) {
  if (cap.taken) continue;
  if (cap.x >= Math.min(prevX, b.x) - 20 && cap.x <= Math.max(prevX, b.x) + 20) {
    // y方向も近ければ取得（バイクの上下40px以内）
    if (Math.abs(cap.y - b.y) < 70) {
      cap.taken = true;
      b.nitro = Math.min(config.NITRO_MAX, b.nitro + config.NITRO_PICKUP);
    }
  }
}
b._prevX = b.x;
```
`game.bike` の HUD 反映は既存 `updateHud`（`nitrofill`）がそのまま使える。`createBike` は `nitro: config.NITRO_MAX` で始まるが、M6では**開始時のニトロを抑える**ため `start(game)` 後に `game.bike.nitro = config.NITRO_MAX * 0.4;` を設定（温存の駆け引きを成立させる初期値。実機で調整）。

- [ ] **Step 10: `js/renderer.js` にカプセル描画を追加**

`draw` 内、地形の後・バイクの前に追加:
```js
for (const cap of game.track.nitros || []) {
  if (cap.taken) continue;
  if (cap.x < camX - 40 || cap.x > camX + window.innerWidth + 40) continue;
  const sx = cap.x - camX, sy = cap.y - camY;
  ctx.save();
  ctx.fillStyle = cap.guaranteed ? '#ff5a2c' : '#ffb020';
  ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}
```

- [ ] **Step 11: 実機確認（駆け引きの検証）**

確認: カプセルを拾うとゲージが増える。タップ中はゲージが減り、空だと噴射できない。ループ手前には必ず拾えるニトロがある。**「温存→難所で放って突破」が現実的なパラメータで成立するか**を体感し、`NITRO_THRUST` / `NITRO_BURN` / `NITRO_PICKUP` / `LOOP_SAFETY` / 開始ニトロ量を調整（設計書11章リスク2）。

- [ ] **Step 12: コミット**

```bash
cd "/home/mihara/開発/モトクロス"
git add js/physics.js js/track.js js/main.js js/renderer.js tests/physics.test.js tests/track.test.js
git commit -m "feat: M6 ニトロゲージ・カプセル・難所前の配置保証"
```

---

## Task 7: 演出・ベスト距離マーカー・公開 (M7)

成功体験を厚くする演出と、自己ベスト地点マーカー。最後にGitHub Pagesで公開。演出は純ロジックを持たないため**実機目視**で確認する。

**Files:**
- Modify: `js/renderer.js`（ニトロ炎パーティクル、着地砂埃、画面シェイク、ゲージ発光、ベスト距離マーカー）
- Modify: `js/main.js`（演出トリガの受け渡し）
- Create: `README.md`（公開用の簡単な説明）

- [ ] **Step 1: `js/renderer.js` にベスト距離マーカーを追加**

`draw` 内、地形の後に追加（自己ベスト地点に旗）:
```js
import { config } from './config.js';
// best(m) を px に戻して旗を立てる
if (game.best > 0) {
  const bestX = game.best * config.PX_PER_M;
  if (bestX > camX && bestX < camX + window.innerWidth) {
    const gy = heightAt(game.track, bestX) - camY;
    const sx = bestX - camX;
    ctx.save();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, gy); ctx.lineTo(sx, gy - 40); ctx.stroke();
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(sx, gy - 40, 22, 14);
    ctx.fillStyle = '#222'; ctx.font = 'bold 10px system-ui'; ctx.fillText('BEST', sx + 2, gy - 30);
    ctx.restore();
  }
}
```

- [ ] **Step 2: ニトロ噴射の炎パーティクルと画面シェイクを追加**

`renderer.js` に簡易パーティクル配列を持たせ、噴射中・着地時に生成。`createRenderer` を拡張:
```js
export function createRenderer(ctx) {
  return { ctx, particles: [], shake: 0 };
}
export function emitNitro(r, x, y) {
  r.particles.push({ x, y, vx: -60 - Math.random() * 60, vy: (Math.random() - 0.5) * 40, life: 0.4, kind: 'fire' });
}
export function emitDust(r, x, y) {
  for (let i = 0; i < 8; i++) r.particles.push({ x, y, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 80, life: 0.5, kind: 'dust' });
  r.shake = 8;
}
export function stepParticles(r, dt) {
  for (const p of r.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  r.particles = r.particles.filter(p => p.life > 0);
  if (r.shake > 0) r.shake = Math.max(0, r.shake - dt * 30);
}
```
`draw` の冒頭でシェイクを適用（`ctx.translate(rand, rand)` を `r.shake` 量で）、末尾でパーティクルを描画（fire=橙、dust=灰）。

- [ ] **Step 3: `js/main.js` で演出トリガを配線**

- 噴射中（`firing` 相当：`input.pressing && b.nitro > 0` かつ GROUNDED）に毎フレーム `emitNitro(renderer, b.x - camX相当, ...)` ではなく、`draw` 側でバイク後方に生成するため `game` に `b.firing` フラグを持たせ、`draw` 内で参照して `emitNitro` を呼ぶ。
- 着地確定時（main の着地分岐内）に `emitDust(renderer, b.x, b.y)`。
- `frame` の描画前に `stepParticles(renderer, dt)` を呼ぶ。
- ゲージ発光: HUD の `#nitrofill` に、満タン時 `box-shadow` を付ける（`updateHud` で `nitro>=MAX*0.99` のときクラス付与）。

- [ ] **Step 4: 実機確認（演出）**

確認: 噴射で炎が出る。着地で砂埃＋軽いシェイク。ニトロ満タンでゲージが光る。自己ベスト地点に旗が見え「あと少し」が分かる。フレームレートが落ちないこと（落ちるなら粒子数・層を減らす）。

- [ ] **Step 5: `README.md` を作成**

```markdown
# NITRO MOTO

スマホ特化の横視点エンドレスラン・モトクロス。ニトロを溜めて、難所でタップして放ち、可能な限り遠くまで走る。

## 遊び方
- 画面をタップしている間、ニトロを噴射して加速。
- ニトロはコース上のカプセルで補充。空だと噴射できない。
- コースから落ちる／失速で止まるとクラッシュ。タップで即リスタート。
- スコアは走行距離(m)。ベストは端末に保存される。

## 開発
- バニラJS + HTML5 Canvas（ビルド不要）。
- ローカル起動: `python3 -m http.server 8000` → ブラウザで `localhost:8000`。
- テスト: `node --test`。
```

- [ ] **Step 6: 全テストを実行して緑を確認**

Run: `cd "/home/mihara/開発/モトクロス" && node --test`
Expected: PASS（physics / track / score / storage 全件）

- [ ] **Step 7: コミット**

```bash
cd "/home/mihara/開発/モトクロス"
git add js/renderer.js js/main.js README.md
git commit -m "feat: M7 演出・ベスト距離マーカー・README"
```

- [ ] **Step 8: GitHub に公開（※ユーザー確認のうえ実行）**

外部に公開するアクションのため、実行前にユーザーへ確認する。`gh` 認証済み前提:
```bash
cd "/home/mihara/開発/モトクロス"
gh repo create nitro-moto --public --source=. --remote=origin --push
```
GitHub Pages を有効化（リポジトリ Settings → Pages → Branch: main / root）、または:
```bash
gh api -X POST repos/{owner}/nitro-moto/pages -f source[branch]=main -f source[path]=/
```
公開URL（`https://<user>.github.io/nitro-moto/`）をスマホで開いて最終確認。ES Modules は http 配信で動作する。

---

## 自己レビュー（writing-plans）

**1. 仕様カバレッジ（設計書の各節 → タスク対応）**
- §2 ルール（エンドレス・距離スコア・即リスタート） → Task 2, 3 ✓
- §3.0 固定タイムステップ → Task 0/1 のアキュムレータ ✓
- §3.1 速度（坂控えめ・ニトロ主役・抵抗・失速即クラッシュ） → Task 1（坂/抵抗/タップ）、Task 2（失速）、Task 6（ニトロ消費） ✓
- §3.2 GROUNDED⇄AIRBORNE → Task 4（launch/stepAirborne/着地走査） ✓
- §3.3 ジャンプ/ギャップ → Task 4 ✓
- §3.4 360度ループ（判定ゲート＋演出） → Task 5 ✓
- §3.5 クラッシュ条件 → Task 2（失速/落下）、Task 4（着地角度）、Task 5（ループ失敗） ✓
- §4 ニトロ（ゲージ・消費・配置保証） → Task 6 ✓
- §5 コース生成（契約ベース・C1・難易度カーブ・破棄） → Task 3（genSegment/extendTo/dropBehind/pickType） ✓
- §6 描画（着地マーカー・難所予告・ベスト距離マーカー・演出・dpr上限） → Task 4/5/7、dpr上限は Task 0 ✓
- §7 技術構成（ファイル分割） → ファイル構成節 ✓
- §8 スマホ対応（viewport・全画面・縦持ち案内） → Task 0（index.html/css） ✓
- §9 公開（GitHub Pages） → Task 7 Step 8 ✓
- §10 マイルストーン M0–M7 → Task 0–7 が1対1 ✓
- §11 リスク（M1手触り／ニトロ駆け引き） → Task 1 Step11、Task 6 Step11 で明示検証 ✓

**2. プレースホルダ走査:** 「TBD/後で実装/適切に処理」等は無し。各コードステップに実体コードを記載。GitHub の `<NAME>/<EMAIL>` と公開リポジトリ名はユーザー入力待ちと明示（前提節・Task7）。

**3. 型・名称の整合:**
- `createBike()` の戻り値フィールド（`s,v,airborne,x,y,vx,vy,angle,nitro` + Task5で `inLoop,loopT,loopRef,failLoop`）はデータ形節と一致。
- `stepGrounded(bike, {slope, nitro})`、`launch(bike, slope)`、`stepAirborne(bike)`、`landingTangentSpeed(vx,vy,slope)`、`loopRequiredSpeed(r)`、`canClearLoop(v,r)` は宣言とテストで一致。
- track: `heightAt/slopeAt/indexAt/createTrack/extendTo/dropBehind/isGap/loopAt/mulberry32` と保証配置 `guaranteeNitrosBeforeHazards` が呼び出し側（main/renderer）と一致。`makeFlatHill` は Task1 で作成→Task3 で `createTrack` に置換（import 差し替えを明記）。
- score: `distanceMeters/shouldCrash/isBest`、storage: `loadBest/saveBest`（KEY=`nitromoto.best`）、game: `createGame/start/crash/restart` 整合。
- 傾き符号: 「下り正・`+GRAVITY*sin(slope)`」をデータ形節で統一し、テストは挙動で固定（設計書の `-g·sinθ` は座標系差として注記）。

**結論:** 仕様を網羅し、プレースホルダ無し、型整合済み。M1（手触り）とM6（駆け引き）にリスク検証ステップを明示。実装可能。

