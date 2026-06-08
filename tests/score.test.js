import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, shouldCrash, isBest } from '../js/score.js';
import { loadBest, saveBest } from '../js/storage.js';
import { config } from '../js/config.js';

test('distanceMeters は s/PX_PER_M(メートル換算)', () => {
  assert.equal(distanceMeters({ s: config.PX_PER_M * 10 }), 10);
});

test('shouldCrash: 地上で失速(v_min割れ)', () => {
  assert.equal(shouldCrash({ airborne: false, v: config.V_MIN - 1 }, false), true);
});

test('shouldCrash: 画面下へ落下', () => {
  assert.equal(shouldCrash({ airborne: true, v: 100 }, true), true);
});

test('shouldCrash: 正常走行はクラッシュしない', () => {
  assert.equal(shouldCrash({ airborne: false, v: config.V_MIN + 1 }, false), false);
});

test('isBest は記録更新を判定', () => {
  assert.equal(isBest(100, 50), true);
  assert.equal(isBest(50, 100), false);
  assert.equal(isBest(50, 50), false);
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

test('storage: 保存した値を読み戻せる', () => {
  stubLocalStorage();
  saveBest(123.4);
  assert.equal(loadBest(), 123.4);
});

test('storage: 未保存なら 0 を返す', () => {
  stubLocalStorage();
  assert.equal(loadBest(), 0);
});
