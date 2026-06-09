import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, speedKmh, isBestTime, fmtTime } from '../js/score.js';
import { loadBest, saveBest } from '../js/storage.js';
import { createRival, stepRival, rivalLap } from '../js/rival.js';
import { createCourse } from '../js/track.js';
import { config } from '../js/config.js';

test('distanceMeters は s/PX_PER_M', () => {
  assert.equal(distanceMeters({ s: config.PX_PER_M * 10 }), 10);
});

test('speedKmh は時速へ換算', () => {
  assert.ok(Math.abs(speedKmh({ v: config.PX_PER_M }) - 3.6) < 1e-9);
});

test('isBestTime: 記録なし(0)は常にベスト / 速い方がベスト', () => {
  assert.equal(isBestTime(45, 0), true);
  assert.equal(isBestTime(40, 50), true);
  assert.equal(isBestTime(60, 50), false);
});

test('fmtTime', () => {
  assert.equal(fmtTime(0), '--.-');
  assert.equal(fmtTime(12.34), '12.3');
  assert.equal(fmtTime(75.6), '1:15.6');
});

test('rival は前進し、いずれゴールする', () => {
  const track = createCourse(config.SEED, 3);
  const r = createRival();
  let time = 0;
  for (let i = 0; i < 120000 && !r.finished; i++) {
    time += config.DT;
    stepRival(r, track, config.DT, time);
  }
  assert.equal(r.finished, true);
  assert.ok(r.finishTime > 0);
  assert.equal(rivalLap(r, track), track.laps);
});

function stubLocalStorage() {
  const mem = {};
  globalThis.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
  };
}

test('storage: 保存したタイムを読み戻せる / 未保存は0', () => {
  stubLocalStorage();
  assert.equal(loadBest(), 0);
  saveBest(45.6);
  assert.equal(loadBest(), 45.6);
});
