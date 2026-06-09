import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32,
  heightAt,
  slopeAt,
  isGap,
  loopAt,
  tunnelCeilingAt,
  springBetween,
  createCourse,
} from '../js/track.js';
import { config } from '../js/config.js';

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

test('tunnelCeilingAt は範囲内で天井yを返す', () => {
  const t = { tunnels: [{ x0: 100, x1: 200, ceilY: 370 }] };
  assert.equal(tunnelCeilingAt(t, 150), 370);
  assert.equal(tunnelCeilingAt(t, 50), null);
  assert.equal(tunnelCeilingAt(t, 250), null);
});

test('springBetween は区間を横切る未使用スプリングを返す', () => {
  const t = { springs: [{ x: 150, _done: false }] };
  assert.ok(springBetween(t, 140, 160));
  assert.equal(springBetween(t, 160, 180), null);
  t.springs[0]._done = true;
  assert.equal(springBetween(t, 140, 160), null);
});

test('createCourse は固定シードで決定的（同じ finishX）', () => {
  const a = createCourse(config.SEED, 2);
  const b = createCourse(config.SEED, 2);
  assert.equal(a.finishX, b.finishX);
  assert.equal(a.points.length, b.points.length);
});

test('createCourse は周回・ゴール・難所を備える', () => {
  const t = createCourse(config.SEED, 2);
  assert.ok(t.points.length > 1);
  assert.equal(t.points[0].x, 0);
  assert.equal(t.laps, 2);
  assert.ok(t.finishX > 0);
  assert.equal(t.finishX, t.lapLen * 2);
  assert.ok(t.loops.length >= 2, 'ループが各周に出る');
  assert.ok(t.springs.length >= 1, 'スプリングがある');
  assert.ok(t.tunnels.length >= 1, 'トンネルがある');
  assert.ok(t.gaps.length >= 1, 'ジャンプ(ギャップ)がある');
});

test('周回境界は同じ高さでシームレスに繋がる', () => {
  const t = createCourse(config.SEED, 2);
  // 各ラップ境界で地面高さが基準(=ラップ開始)と一致する
  const baseY = heightAt(t, 0);
  for (const bx of t.lapBoundaries) {
    assert.ok(Math.abs(heightAt(t, bx) - baseY) < 1e-6, `境界 x=${bx} で段差`);
  }
});

test('各ループの手前にターボが保証配置される', () => {
  const t = createCourse(config.SEED, 2);
  assert.ok(t.loops.length > 0, 'ループが生成されていること');
  for (const lp of t.loops) {
    const near = t.turbos.some((n) => n.x >= lp.enterX - 2000 && n.x <= lp.enterX);
    assert.ok(near, `ループ enterX=${lp.enterX} の手前にターボが無い`);
  }
});

test('地形の傾きは難所外でC1連続(隣接サンプルの段差が小さい)', () => {
  const t = createCourse(config.SEED, 2);
  const step = 50;
  let prevClean = null;
  for (let x = 200; x <= t.finishX; x += step) {
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
