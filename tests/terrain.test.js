// 山が守っていなければならない性質のテスト。
// 見た目は目で確かめるしかないが、「必ず下っている」「決定論的である」
// といった土台はここで固定しておく。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/world/terrain.js';

test('高さは滑らかに連続している（落下線に段差がない）', () => {
  let maxJump = 0, at = 0;
  for (let z = 0; z < 12000; z += 0.25) {
    const x = T.trailCenterX(z);
    const d = Math.abs(T.height(x, z + 0.25) - T.height(x, z));
    if (d > maxJump) { maxJump = d; at = z; }
  }
  // 0.25m 進んで 1m 以上落ちる場所があれば、それは崖ではなく破綻
  assert.ok(maxJump < 1.0, `z=${at} で ${maxJump.toFixed(2)}m の段差`);
});

test('山は全体として必ず下っている', () => {
  const h0 = T.height(T.trailCenterX(0), 0);
  const h1 = T.height(T.trailCenterX(30000), 30000);
  const slope = (h0 - h1) / 30000;
  assert.ok(slope > 0.25 && slope < 0.45, `平均斜度 ${slope.toFixed(3)}`);
});

test('落下線をたどれば止まらない（窪地に閉じ込められない）', () => {
  const fl = [0, 0, 1];
  let stuck = 0, total = 0, worst = 0;
  for (let z = 40; z < 20000; z += 23) {
    for (const off of [-70, -25, 0, 25, 70]) {
      const x = T.trailCenterX(z) + off;
      T.fallLine(x, z, fl);
      const dh = T.height(x + fl[0] * 2, z + fl[2] * 2) - T.height(x, z);
      total++;
      if (dh > 0.05) { stuck++; worst = Math.max(worst, dh); }
    }
  }
  // コブの谷などは局所的に登る（それがコブなので正しい）。
  // 問題になるのは「抜け出せない窪地」ができることなので、割合と深さの両方を見る。
  assert.ok(stuck / total < 0.03, `${(100 * stuck / total).toFixed(2)}% の地点で登ってしまう`);
  assert.ok(worst < 1.0, `2m 進んで ${worst.toFixed(2)}m 登る場所がある`);
});

test('斜度が想定レンジに収まっている', () => {
  let lo = 9, hi = -9;
  for (let z = 0; z < 20000; z += 7) {
    const p = T.pitchAt(z);
    lo = Math.min(lo, p); hi = Math.max(hi, p);
  }
  assert.ok(lo > 0.15, `最緩 ${lo.toFixed(3)} が緩すぎる（進まなくなる）`);
  assert.ok(hi < 0.60, `最急 ${hi.toFixed(3)} が急すぎる`);
});

test('同じ座標なら必ず同じ高さ（オンラインで山が一致する条件）', () => {
  const pts = [[0, 0], [123.456, 789.012], [-500, 4321], [77, 15000], [1e4, 5e4]];
  const first = pts.map(([x, z]) => T.height(x, z));
  // 途中で別の座標を大量に評価しても結果が変わらないこと（キャッシュの副作用チェック）
  for (let i = 0; i < 5000; i++) T.height(i * 3.7, i * 1.3);
  const second = pts.map(([x, z]) => T.height(x, z));
  assert.deepEqual(second, first);
});

test('sample と height が一致する', () => {
  for (let i = 0; i < 300; i++) {
    const x = (i * 37.3) % 400 - 200;
    const z = (i * 91.7) % 9000;
    const s = T.sample(x, z);
    assert.ok(Math.abs(s.y - T.height(x, z)) < 1e-9);
    assert.ok(s.grip > 0 && s.grip <= 1.2);
    assert.ok(s.mu >= 0 && s.mu < 0.2);
    assert.ok(Math.abs(Math.hypot(s.nx, s.ny, s.nz) - 1) < 1e-6, '法線が正規化されていない');
    assert.ok(s.ny > 0, '法線が下を向いている');
  }
});

test('全ゾーンが十分な頻度で出現する', () => {
  const count = new Array(6).fill(0);
  for (let z = 0; z < 200000; z += 200) count[T.zoneAt(z).kind]++;
  const total = count.reduce((a, b) => a + b, 0);
  for (let k = 0; k < 6; k++) {
    const pct = 100 * count[k] / total;
    assert.ok(pct > 4, `${T.ZONE_NAME[k]} が ${pct.toFixed(1)}% しかない`);
  }
});

test('圧雪路は必ず滑れる幅がある', () => {
  for (let z = 0; z < 30000; z += 13) {
    const hw = T.trailHalfWidth(z);
    assert.ok(hw >= 8 && hw <= 48, `z=${z} で半幅 ${hw.toFixed(1)}m`);
  }
});

test('パークにはキッカーの起伏がある', () => {
  let found = false;
  for (let i = 0; i < 300 && !found; i++) {
    const base = i * 380;
    if (T.zoneAt(base + 190).kind !== T.ZONE.PARK) continue;
    // 1 つ目のキッカー（local z=74, ramp=10）のリップと、その手前を比べる
    const cx = T.trailCenterX(base + 84);
    const lip = T.height(cx, base + 84);
    const before = T.height(T.trailCenterX(base + 60), base + 60);
    const natural = T.baseHeight(base + 84) - T.baseHeight(base + 60);
    const rise = (lip - before) - natural;
    assert.ok(rise > 1.5, `キッカーの盛り上がりが ${rise.toFixed(2)}m しかない`);
    found = true;
  }
  assert.ok(found, 'パークゾーンが見つからない');
});

test('サーフェスの種類が一通り出現する', () => {
  const seen = new Set();
  for (let z = 0; z < 60000; z += 11) {
    for (const off of [0, -18, 30, -60]) {
      seen.add(T.sample(T.trailCenterX(z) + off, z).surface);
    }
  }
  for (const s of [T.SURFACE.GROOMED, T.SURFACE.POWDER, T.SURFACE.ICE, T.SURFACE.PARK]) {
    assert.ok(seen.has(s), `サーフェス ${s} が出現しない`);
  }
});

test('法線は有限で、極端な壁でも壊れない', () => {
  const n = [0, 1, 0];
  for (let i = 0; i < 2000; i++) {
    const x = (i * 13.7) % 900 - 450;
    const z = (i * 7.1) % 20000;
    T.normal(x, z, n);
    assert.ok(Number.isFinite(n[0]) && Number.isFinite(n[1]) && Number.isFinite(n[2]));
    assert.ok(n[1] > 0.03, `z=${z} x=${x} で法線がほぼ水平 (${n[1].toFixed(3)})`);
  }
});
