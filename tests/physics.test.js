import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBike,
  stepGrounded,
  launch,
  launchSpring,
  stepAirborne,
  landingTangentSpeed,
  loopRequiredSpeed,
  canClearLoop,
} from '../js/physics.js';
import { config } from '../js/config.js';

test('createBike は初期値を持つ', () => {
  const b = createBike();
  assert.equal(b.v, config.V_START);
  assert.equal(b.airborne, false);
  assert.equal(b.s, 0);
  assert.equal(b.turbo, config.TURBO_START);
});

test('下り坂は平地より速くなる(坂で加速)', () => {
  const down = createBike();
  const flat = createBike();
  stepGrounded(down, { slope: 0.3, turbo: false });
  stepGrounded(flat, { slope: 0, turbo: false });
  assert.ok(down.v > flat.v, `下り>平地のはず: flat=${flat.v} down=${down.v}`);
});

test('上り坂は平地より遅くなる(坂で減速)', () => {
  const up = createBike();
  const flat = createBike();
  stepGrounded(up, { slope: -0.3, turbo: false });
  stepGrounded(flat, { slope: 0, turbo: false });
  assert.ok(up.v < flat.v, `上り<平地のはず: flat=${flat.v} up=${up.v}`);
});

test('平地でターボは無噴射より速くなる', () => {
  const on = createBike();
  const off = createBike();
  stepGrounded(on, { slope: 0, turbo: true });
  stepGrounded(off, { slope: 0, turbo: false });
  assert.ok(on.v > off.v, `ターボ有>無のはず: off=${off.v} on=${on.v}`);
  assert.equal(on.firing, true);
});

test('ターボ噴射で残量が減る', () => {
  const b = createBike();
  const t0 = b.turbo;
  stepGrounded(b, { slope: 0, turbo: true });
  assert.ok(b.turbo < t0, `残量が減るべき: ${t0} -> ${b.turbo}`);
});

test('ターボ残量0でもエンジンで前進する(失速しない)', () => {
  const b = createBike();
  b.turbo = 0;
  b.v = 50; // 低速からでもエンジンが加速させる
  stepGrounded(b, { slope: 0, turbo: true });
  assert.equal(b.firing, false);
  assert.ok(b.v > 50, `エンジンで加速するべき: 50 -> ${b.v}`);
});

test('平地巡航速度は ENGINE/DRAG に収束する', () => {
  const cruise = config.ENGINE / config.DRAG;
  const fast = createBike();
  fast.v = cruise + 200; // 速すぎれば抵抗で減速
  stepGrounded(fast, { slope: 0, turbo: false });
  assert.ok(fast.v < cruise + 200);
  const slow = createBike();
  slow.v = 10; // 遅ければエンジンで加速
  stepGrounded(slow, { slope: 0, turbo: false });
  assert.ok(slow.v > 10);
});

test('stepGrounded で弧長 s が進む', () => {
  const b = createBike();
  stepGrounded(b, { slope: 0, turbo: false });
  assert.ok(b.s > 0);
});

test('launch はスカラー速度を接線方向へ分解する(slope=0)', () => {
  const b = createBike();
  b.v = 20;
  launch(b, 0);
  assert.equal(b.airborne, true);
  assert.ok(Math.abs(b.vx - 20) < 1e-9);
  assert.ok(Math.abs(b.vy - 0) < 1e-9);
});

test('launchSpring は真上(vy<0)へ強く打ち上げる', () => {
  const b = createBike();
  b.v = 300;
  launchSpring(b, 0);
  assert.equal(b.airborne, true);
  assert.equal(b.vy, -config.SPRING_VY);
  assert.ok(b.vx > 0, '前進成分は維持されるべき');
});

test('stepAirborne で重力により vy が増え x が進む', () => {
  const b = createBike();
  b.airborne = true;
  b.vx = 20;
  b.vy = 0;
  b.x = 0;
  b.y = 0;
  stepAirborne(b);
  assert.ok(b.vy > 0, '重力でvyが増えるべき');
  assert.ok(b.x > 0, 'xが進むべき');
});

test('landingTangentSpeed は接線方向成分を返す', () => {
  assert.ok(Math.abs(landingTangentSpeed(20, 0, 0) - 20) < 1e-9);
  assert.ok(Math.abs(landingTangentSpeed(0, 20, 0) - 0) < 1e-9);
});

test('loopRequiredSpeed = √(g·r)·安全係数', () => {
  const r = 50;
  const expected = Math.sqrt(config.GRAVITY * r) * config.LOOP_SAFETY;
  assert.ok(Math.abs(loopRequiredSpeed(r) - expected) < 1e-9);
});

test('canClearLoop は必要速度の前後で切り替わる', () => {
  const r = 50;
  const req = loopRequiredSpeed(r);
  assert.equal(canClearLoop(req + 1, r), true);
  assert.equal(canClearLoop(req - 1, r), false);
});
