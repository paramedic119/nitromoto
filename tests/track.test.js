import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32,
  heightAt,
  slopeAt,
  isGap,
  loopAt,
  createTrack,
  extendTo,
} from '../js/track.js';

test('heightAt は線形補間する', () => {
  const t = { points: [{ x: 0, y: 100 }, { x: 10, y: 200 }] };
  assert.equal(heightAt(t, 5), 150);
  assert.equal(heightAt(t, 0), 100);
  assert.equal(heightAt(t, 10), 200);
});

test('slopeAt の符号(下り>0, 上り<0)', () => {
  const down = { points: [{ x: 0, y: 100 }, { x: 10, y: 200 }] };
  const up = { points: [{ x: 0, y: 200 }, { x: 10, y: 100 }] };
  assert.ok(slopeAt(down, 5) > 0, '下りは正');
  assert.ok(slopeAt(up, 5) < 0, '上りは負');
});

test('mulberry32 は決定的(同seedで同列)', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('createTrack は点を持ち平坦な助走から始まる', () => {
  const t = createTrack(1);
  assert.ok(t.points.length > 1);
  assert.equal(t.points[0].x, 0);
});

test('extendTo は worldX を超えて生成する', () => {
  const t = createTrack(1);
  const beforeLen = t.points.length;
  extendTo(t, 5000);
  assert.ok(t.endX >= 5000, `endX=${t.endX}`);
  assert.ok(t.points.length > beforeLen);
});

test('isGap は範囲[下限含む,上限含まず)を判定', () => {
  const t = { gaps: [[100, 200]] };
  assert.equal(isGap(t, 150), true);
  assert.equal(isGap(t, 100), true);
  assert.equal(isGap(t, 200), false);
  assert.equal(isGap(t, 50), false);
});

test('loopAt は範囲内のループを返す', () => {
  const t = { loops: [{ enterX: 100, exitX: 200, r: 50, cx: 150, cy: 450, baseY: 500 }] };
  assert.equal(loopAt(t, 150).r, 50);
  assert.equal(loopAt(t, 50), null);
  assert.equal(loopAt(t, 250), null);
});

test('平坦/坂区間の傾きはC1連続(隣接サンプルの段差が小さい)', () => {
  const t = createTrack(7);
  extendTo(t, 8000);
  const step = 50;
  let prevClean = null;
  for (let x = 200; x <= 7000; x += step) {
    const dirty = isGap(t, x) || isGap(t, x + step) || loopAt(t, x) || loopAt(t, x + step);
    if (dirty) {
      prevClean = null;
      continue;
    }
    const s = slopeAt(t, x);
    if (prevClean !== null) {
      assert.ok(Math.abs(s - prevClean) < 0.6, `x=${x} で傾きが跳ねた: ${prevClean} -> ${s}`);
    }
    prevClean = s;
  }
});

test('各ループの手前にニトロが保証配置される', () => {
  const t = createTrack(42);
  extendTo(t, 30000);
  assert.ok(t.loops.length > 0, 'ループが生成されていること');
  for (const lp of t.loops) {
    const near = t.nitros.some((n) => n.x >= lp.enterX - 2500 && n.x <= lp.enterX);
    assert.ok(near, `ループ enterX=${lp.enterX} の手前にニトロが無い`);
  }
});
