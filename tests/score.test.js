import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, isBestTime, fmtTime, speedKmh } from '../js/score.js';
import { loadBest, saveBest } from '../js/storage.js';
import { config } from '../js/config.js';

test('distanceMeters は s/PX_PER_M(メートル換算)', () => {
  assert.equal(distanceMeters({ s: config.PX_PER_M * 10 }), 10);
});

test('speedKmh は v を時速へ換算', () => {
  const v = config.PX_PER_M; // 1 m/s
  assert.ok(Math.abs(speedKmh({ v }) - 3.6) < 1e-9);
});

test('isBestTime: 記録なし(0)は常にベスト', () => {
  assert.equal(isBestTime(45.2, 0), true);
});

test('isBestTime: より速いタイムがベスト', () => {
  assert.equal(isBestTime(40, 50), true);
  assert.equal(isBestTime(60, 50), false);
  assert.equal(isBestTime(50, 50), false);
});

test('fmtTime: 60秒未満は秒.小数', () => {
  assert.equal(fmtTime(0), '--.-');
  assert.equal(fmtTime(12.34), '12.3');
});

test('fmtTime: 60秒以上は m:ss.s', () => {
  assert.equal(fmtTime(75.6), '1:15.6');
});

function stubLocalStorage() {
  const mem = {};
  globalThis.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => {
      mem[k] = String(v);
    },
  };
}

test('storage: 保存したタイムを読み戻せる', () => {
  stubLocalStorage();
  saveBest(45.6);
  assert.equal(loadBest(), 45.6);
});

test('storage: 未保存なら 0 を返す', () => {
  stubLocalStorage();
  assert.equal(loadBest(), 0);
});
