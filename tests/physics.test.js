import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBike,
  stepGroundSpeed,
  launch,
  launchSpring,
  stepAir,
  landingOk,
  landingTangentSpeed,
  loopRequiredSpeed,
  canClearLoop,
  normalizeAngle,
} from '../js/physics.js';
import { config } from '../js/config.js';

test('createBike は初期値を持つ', () => {
  const b = createBike();
  assert.equal(b.v, config.V_START);
  assert.equal(b.airborne, false);
  assert.equal(b.turbo, config.TURBO_START);
  assert.equal(b.av, 0);
});

test('アクセルONは無入力より速くなる', () => {
  const on = createBike(), off = createBike();
  stepGroundSpeed(on, { slope: 0, accel: true, turbo: false });
  stepGroundSpeed(off, { slope: 0, accel: false, turbo: false });
  assert.ok(on.v > off.v);
});

test('ターボはアクセルのみより速く、残量を消費する', () => {
  const t = createBike(), a = createBike();
  const t0 = t.turbo;
  stepGroundSpeed(t, { slope: 0, accel: true, turbo: true });
  stepGroundSpeed(a, { slope: 0, accel: true, turbo: false });
  assert.ok(t.v > a.v);
  assert.ok(t.turbo < t0);
  assert.equal(t.firing, true);
});

test('ターボ残量0では噴射しない', () => {
  const b = createBike();
  b.turbo = 0;
  stepGroundSpeed(b, { slope: 0, accel: true, turbo: true });
  assert.equal(b.firing, false);
});

test('下りは平地より速く、上りは遅い', () => {
  const d = createBike(), f = createBike(), u = createBike();
  stepGroundSpeed(d, { slope: 0.3, accel: true, turbo: false });
  stepGroundSpeed(f, { slope: 0, accel: true, turbo: false });
  stepGroundSpeed(u, { slope: -0.3, accel: true, turbo: false });
  assert.ok(d.v > f.v && f.v > u.v);
});

test('速度は V_MAX を超えない', () => {
  const b = createBike();
  b.v = config.V_MAX;
  stepGroundSpeed(b, { slope: 0.4, accel: true, turbo: true });
  assert.ok(b.v <= config.V_MAX + 1e-9);
});

test('launch はスカラー速度を接線方向へ分解(slope=0)', () => {
  const b = createBike();
  b.v = 200;
  launch(b, 0);
  assert.equal(b.airborne, true);
  assert.ok(Math.abs(b.vx - 200) < 1e-9);
  assert.ok(Math.abs(b.vy) < 1e-9);
  assert.equal(b.av, 0);
});

test('launchSpring は真上(vy<0)へ打ち上げ、前進を維持', () => {
  const b = createBike();
  b.v = 300;
  launchSpring(b, 0);
  assert.equal(b.vy, -config.SPRING_VY);
  assert.ok(b.vx > 0);
});

test('空中は無操作だと前のめり(角度+)になる', () => {
  const b = createBike();
  launch(b, 0);
  for (let i = 0; i < 30; i++) stepAir(b, { up: false, down: false }, config.DT);
  assert.ok(b.angle > 0, `nose-down のはず: ${b.angle}`);
});

test('空中で↑(後傾)は前のめりを打ち消せる', () => {
  const free = createBike(); launch(free, 0);
  const lean = createBike(); launch(lean, 0);
  for (let i = 0; i < 30; i++) {
    stepAir(free, { up: false, down: false }, config.DT);
    stepAir(lean, { up: true, down: false }, config.DT);
  }
  assert.ok(lean.angle < free.angle, `↑で角度が小さく保てるはず: lean=${lean.angle} free=${free.angle}`);
});

test('landingOk は許容角内/外を判定', () => {
  assert.equal(landingOk(0, 0), true);
  assert.equal(landingOk(config.LAND_TOL - 0.01, 0), true);
  assert.equal(landingOk(config.LAND_TOL + 0.2, 0), false);
});

test('landingTangentSpeed は接線方向成分を返す', () => {
  assert.ok(Math.abs(landingTangentSpeed(20, 0, 0) - 20) < 1e-9);
  assert.ok(Math.abs(landingTangentSpeed(0, 20, 0)) < 1e-9);
});

test('loopRequiredSpeed = √(g·r)·安全係数 と canClearLoop', () => {
  const r = 60;
  const req = Math.sqrt(config.GRAVITY * r) * config.LOOP_SAFETY;
  assert.ok(Math.abs(loopRequiredSpeed(r) - req) < 1e-9);
  assert.equal(canClearLoop(req + 1, r), true);
  assert.equal(canClearLoop(req - 1, r), false);
});

test('normalizeAngle は (-π, π] に収める', () => {
  assert.ok(Math.abs(normalizeAngle(Math.PI * 2)) < 1e-9);
  assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < 1e-9);
});
