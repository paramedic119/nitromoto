import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBike,
  stepGrounded,
  launch,
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
  assert.equal(b.nitro, config.NITRO_START);
});

test('下り坂は平地より速くなる(坂で加速)', () => {
  const down = createBike();
  const flat = createBike();
  stepGrounded(down, { slope: 0.3, nitro: false });
  stepGrounded(flat, { slope: 0, nitro: false });
  assert.ok(down.v > flat.v, `下り>平地のはず: flat=${flat.v} down=${down.v}`);
});

test('上り坂は平地より遅くなる(坂で減速)', () => {
  const up = createBike();
  const flat = createBike();
  stepGrounded(up, { slope: -0.3, nitro: false });
  stepGrounded(flat, { slope: 0, nitro: false });
  assert.ok(up.v < flat.v, `上り<平地のはず: flat=${flat.v} up=${up.v}`);
});

test('平地でタップ(ニトロ)は無噴射より速くなる', () => {
  const on = createBike();
  const off = createBike();
  stepGrounded(on, { slope: 0, nitro: true });
  stepGrounded(off, { slope: 0, nitro: false });
  assert.ok(on.v > off.v, `ニトロ有>無のはず: off=${off.v} on=${on.v}`);
  assert.equal(on.firing, true);
});

test('ニトロ噴射で残量が減る', () => {
  const b = createBike();
  const n0 = b.nitro;
  stepGrounded(b, { slope: 0, nitro: true });
  assert.ok(b.nitro < n0, `残量が減るべき: ${n0} -> ${b.nitro}`);
});

test('ニトロ残量0なら平地で加速しない(抵抗で減速)', () => {
  const b = createBike();
  b.nitro = 0;
  const v0 = b.v;
  stepGrounded(b, { slope: 0, nitro: true });
  assert.equal(b.firing, false);
  assert.ok(b.v <= v0, `残量0では加速しないべき: ${v0} -> ${b.v}`);
});

test('stepGrounded で弧長 s が進む', () => {
  const b = createBike();
  stepGrounded(b, { slope: 0, nitro: false });
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
