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
  surfaceYAt,
  createCourse,
} from '../js/track.js';
import { config } from '../js/config.js';

test('heightAt は線形補間する', () => {
  const t = { points: [{ x: 0, y: 100 }, { x: 10, y: 200 }] };
  assert.equal(heightAt(t, 5), 150);
});

test('slopeAt の符号(下り>0, 上り<0)', () => {
  const down = { points: [{ x: 0, y: 100 }, { x: 10, y: 200 }] };
  const up = { points: [{ x: 0, y: 200 }, { x: 10, y: 100 }] };
  assert.ok(slopeAt(down, 5) > 0);
  assert.ok(slopeAt(up, 5) < 0);
});

test('mulberry32 は決定的', () => {
  const a = mulberry32(123), b = mulberry32(123);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('isGap / loopAt / tunnelCeilingAt / springBetween', () => {
  const t = {
    gaps: [[100, 200]],
    loops: [{ enterX: 300, exitX: 400, r: 50 }],
    tunnels: [{ x0: 500, x1: 600, ceilY: 360 }],
    springs: [{ x: 700, _done: false }],
  };
  assert.equal(isGap(t, 150), true);
  assert.equal(isGap(t, 200), false);
  assert.equal(loopAt(t, 350).r, 50);
  assert.equal(loopAt(t, 450), null);
  assert.equal(tunnelCeilingAt(t, 550), 360);
  assert.equal(tunnelCeilingAt(t, 650), null);
  assert.ok(springBetween(t, 690, 710));
  assert.equal(springBetween(t, 710, 720), null);
});

test('surfaceYAt はギャップ上で山なり(リムより上)になる', () => {
  const t = {
    points: [{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 300, y: 500 }, { x: 400, y: 500 }],
    gaps: [[100, 300]],
  };
  const mid = surfaceYAt(t, 200); // y は下正なので「上」は値が小さい
  assert.ok(mid < 500, `ギャップ中央は山なりで上に来るはず: ${mid}`);
});

test('createCourse は決定的で周回・ゴール・難所を備える', () => {
  const a = createCourse(config.SEED, 3);
  const b = createCourse(config.SEED, 3);
  assert.equal(a.finishX, b.finishX);
  assert.equal(a.points.length, b.points.length);
  assert.equal(a.laps, 3);
  assert.equal(a.finishX, a.lapLen * 3);
  assert.ok(a.loops.length >= 3);
  assert.ok(a.springs.length >= 1);
  assert.ok(a.tunnels.length >= 1);
  assert.ok(a.gaps.length >= 1);
});

test('周回境界は同じ高さでシームレスに繋がる', () => {
  const t = createCourse(config.SEED, 3);
  const baseY = heightAt(t, 0);
  for (const bx of t.lapBoundaries) {
    assert.ok(Math.abs(heightAt(t, bx) - baseY) < 1e-6, `境界 x=${bx} で段差`);
  }
});

test('各ループ手前にターボが保証配置される', () => {
  const t = createCourse(config.SEED, 3);
  for (const lp of t.loops) {
    const near = t.turbos.some((n) => n.x >= lp.enterX - 1600 && n.x <= lp.enterX);
    assert.ok(near, `ループ enterX=${lp.enterX} の手前にターボが無い`);
  }
});
