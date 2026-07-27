// ライダーの物理。「丁寧に滑るほど速くなる」というゲームの芯が
// 本当に成立しているかを、シミュレーションで確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rider, STATE, CFG } from '../js/play/rider.js';
import * as T from '../js/world/terrain.js';
import { clamp, clamp01, damp, angleDelta, lerp } from '../js/core/math.js';

const DT = 1 / 120;
const input = () => ({ steer: 0, tuck: 0, brake: 0, ollieHeld: false, olliePressed: false, ollieReleased: false });

/**
 * 落下線のまわりを振り子のようにターンして降りるパイロット。
 * respectGrip = true なら「エッジが受け持てる範囲」を守る＝上手い人。
 */
function pilot(seconds, { respectGrip = true, amp = 0.75, tuck = true } = {}) {
  const r = new Rider();
  const inp = input();
  const fl = [0, 0, 1];
  let t = 0, steer = 0;
  const stats = { wipeouts: 0, maxSpeed: 0, sumFlow: 0, sumSpeed: 0, n: 0, maxFlow: 0, air: 0 };
  r.onWipeout = () => stats.wipeouts++;

  while (t < seconds) {
    T.fallLine(r.pos[0], r.pos[2], fl);
    const fallYaw = Math.atan2(fl[0], fl[2]);
    const off = r.pos[0] - T.trailCenterX(r.pos[2]);
    const hw = T.trailHalfWidth(r.pos[2]);
    const bias = clamp(-off / Math.max(hw, 10) * 0.55, -1, 1);
    const want = fallYaw + amp * Math.sin(t * 0.30 * Math.PI * 2) + bias;
    let target = clamp(angleDelta(r.yaw, want) * 1.5, -1, 1);
    if (respectGrip) {
      const sn = clamp01(r.speed / 32);
      const yawRate = CFG.YAW_RATE * lerp(1, CFG.YAW_RATE_HI, sn * sn);
      const limit = Math.min(1, CFG.GRIP_ACCEL * 0.92 / Math.max(r.speed * yawRate, 1e-3));
      target = clamp(target, -limit, limit);
    }
    steer = damp(steer, target, 5, DT);
    inp.steer = steer;
    inp.tuck = tuck && Math.abs(steer) < 0.25 ? 1 : 0;
    r.step(DT, inp);

    stats.maxSpeed = Math.max(stats.maxSpeed, r.speed);
    stats.maxFlow = Math.max(stats.maxFlow, r.flow);
    stats.sumFlow += r.flow; stats.sumSpeed += r.speed; stats.n++;
    if (r.state === STATE.AIR) stats.air += DT;
    t += DT;
  }
  stats.avgFlow = stats.sumFlow / stats.n;
  stats.avgSpeed = stats.sumSpeed / stats.n;
  stats.rider = r;
  return stats;
}

test('無操作でもコースに沿ってまっすぐ下っていける', () => {
  const r = new Rider();
  const inp = input();
  let maxOff = 0;
  for (let i = 0; i < 120 * 20; i++) {
    r.step(DT, inp);
    maxOff = Math.max(maxOff, Math.abs(r.pos[0] - T.trailCenterX(r.pos[2])));
  }
  assert.ok(r.pos[2] > 260, `20 秒で ${r.pos[2].toFixed(0)}m しか進まない`);
  assert.ok(r.speed > 12, `速度 ${(r.speed * 3.6).toFixed(0)} km/h`);
  // 操作しなければ勝手に横へ流されない（横断勾配で進路が曲がらないこと）
  assert.ok(maxOff < 90, `無操作なのに ${maxOff.toFixed(0)}m も横へ流される`);
  assert.ok(Number.isFinite(r.pos[0] + r.pos[1] + r.pos[2]));
});

test('FLOW が最高速を押し上げる', () => {
  const r = new Rider();
  const base = CFG.V_BASE + CFG.V_BONUS * 0;
  r.flow = 1;
  const full = CFG.V_BASE + CFG.V_BONUS * 1;
  assert.ok(full > base * 2, 'FLOW 満タンで最高速が倍以上にならない');
  assert.ok(full * 3.6 > 110 && full * 3.6 < 145, `上限 ${(full * 3.6).toFixed(0)} km/h`);
});

test('丁寧に滑るほうが FLOW も平均速度も上（ゲームの芯）', () => {
  const good = pilot(150, { respectGrip: true });
  const bad = pilot(150, { respectGrip: false });
  assert.ok(good.avgFlow > bad.avgFlow * 1.6,
    `上手い ${good.avgFlow.toFixed(3)} vs 雑 ${bad.avgFlow.toFixed(3)}`);
  assert.ok(good.avgSpeed > bad.avgSpeed * 1.15,
    `上手い ${(good.avgSpeed * 3.6).toFixed(0)} vs 雑 ${(bad.avgSpeed * 3.6).toFixed(0)} km/h`);
});

test('グリップの限界を超えると横滑りして減速する', () => {
  const r = new Rider();
  const inp = input();
  // まず真っ直ぐ加速
  for (let i = 0; i < 120 * 12; i++) r.step(DT, inp);
  const before = r.speed;
  assert.ok(before > 10, '前提となる速度が出ていない');
  // 一気に切る
  inp.steer = 1;
  for (let i = 0; i < 120 * 1.2; i++) r.step(DT, inp);
  assert.ok(r.skid > 1.5, `横滑りが ${r.skid.toFixed(2)} m/s しか出ない`);
  assert.ok(r.speed < before, '雑に切ったのに減速しない');
});

test('ゆっくり切ればグリップが保たれて削れない', () => {
  const r = new Rider();
  const inp = input();
  for (let i = 0; i < 120 * 12; i++) r.step(DT, inp);
  let maxSkid = 0;
  for (let i = 0; i < 120 * 3; i++) {
    inp.steer = Math.min(0.3, i / (120 * 3));
    r.step(DT, inp);
    maxSkid = Math.max(maxSkid, r.skid);
  }
  assert.ok(maxSkid < 1.6, `丁寧に切ったのに ${maxSkid.toFixed(2)} m/s ずれる`);
});

test('オーリーで飛べて、着地して戻ってくる', () => {
  const r = new Rider();
  const inp = input();
  for (let i = 0; i < 120 * 10; i++) r.step(DT, inp);
  // 溜めて離す
  inp.ollieHeld = true;
  for (let i = 0; i < 120 * 0.5; i++) r.step(DT, inp);
  inp.ollieHeld = false; inp.ollieReleased = true;
  r.step(DT, inp);
  inp.ollieReleased = false;

  let maxH = 0, airFrames = 0;
  for (let i = 0; i < 120 * 3; i++) {
    r.step(DT, inp);
    maxH = Math.max(maxH, r.airHeight);
    if (!r.grounded) airFrames++;
  }
  assert.ok(maxH > 0.7, `飛距離が足りない（最高 ${maxH.toFixed(2)}m）`);
  assert.ok(airFrames > 30, '滞空していない');
  assert.ok(r.grounded, '3 秒経っても着地していない');
});

test('パークのキッカーで実際に飛べる', () => {
  // パークゾーンを探して、1 本目のテーブルトップへ真っ直ぐ入る
  let base = null;
  for (let i = 0; i < 300 && base === null; i++) {
    if (T.zoneAt(i * 380 + 190).kind === T.ZONE.PARK) base = i * 380;
  }
  assert.ok(base !== null, 'パークゾーンが見つからない');

  const r = new Rider();
  const inp = input();
  inp.tuck = 1;
  // キッカーは「トレイル中心からの相対位置」に置かれている。中心に乗せて助走する。
  const cx = T.trailCenterX(base + 74);
  r.pos[0] = cx; r.pos[2] = base + 74 - 30;
  r.pos[1] = T.height(cx, r.pos[2]);
  r.vel[2] = 24;
  r.flow = 0.7;

  let maxH = 0, air = 0, landed = null;
  r.onLand = (impact, clean) => { if (!landed) landed = { impact, clean }; };
  for (let i = 0; i < 120 * 6; i++) {
    r.step(DT, inp);
    maxH = Math.max(maxH, r.airHeight);
    if (!r.grounded) air += DT;
  }
  assert.ok(maxH > 2.0, `キッカーで ${maxH.toFixed(2)}m しか浮かない`);
  assert.ok(air > 0.6, `滞空 ${air.toFixed(2)}s では飛んだと言えない`);
  assert.ok(landed, '着地イベントが起きていない');
  // ランディング斜面が効いていて、まともに着地できること
  assert.ok(landed.impact < 16, `着地の衝撃 ${landed.impact.toFixed(1)} が大きすぎる`);
});

test('ミスは即転倒ではなく、バランスを削る', () => {
  const r = new Rider();
  const inp = input();
  for (let i = 0; i < 120 * 12; i++) r.step(DT, inp);
  const balBefore = r.balance;
  // 速度域でグリップを大きく超える切り方をする
  inp.steer = 1;
  let maxSkid = 0, minBal = 1;
  for (let i = 0; i < 120 * 1.6; i++) {
    r.step(DT, inp);
    maxSkid = Math.max(maxSkid, r.skid);
    minBal = Math.min(minBal, r.balance);
  }
  assert.ok(maxSkid > 3, `横滑りが最大 ${maxSkid.toFixed(2)} m/s（前提が崩れている）`);
  assert.ok(minBal < balBefore - 0.05,
    `バランスが ${balBefore.toFixed(2)} → ${minBal.toFixed(2)} しか減らない`);
  assert.notEqual(r.state, STATE.WIPEOUT, '1.6 秒無茶をしただけで転倒するのは厳しすぎる');
});

test('転倒するとスタートへ戻る', () => {
  const r = new Rider();
  const inp = input();
  for (let i = 0; i < 120 * 15; i++) r.step(DT, inp);
  const far = r.pos[2];
  assert.ok(far > 100);
  r._wipeout('test');
  assert.equal(r.state, STATE.WIPEOUT);
  for (let i = 0; i < 120 * (CFG.WIPEOUT_TIME + 0.5); i++) r.step(DT, inp);
  assert.equal(r.state, STATE.RIDE);
  assert.ok(r.pos[2] < 5, `スタートへ戻っていない (z=${r.pos[2].toFixed(1)})`);
  assert.ok(r.flow < 0.02, 'FLOW がリセットされていない');
  assert.ok(r.bestDistance >= far - 1, 'ベスト記録が残っていない');
});

test('低速でも詰まない（緩斜面やパウダーで動けなくなる状態を作らない）', () => {
  const r = new Rider();
  const inp = input();
  // わざとコースの外の緩い所へ運んで、ほぼ停止させる
  r.pos[2] = 600;
  r.pos[0] = T.trailCenterX(600) + 90;
  r.pos[1] = T.height(r.pos[0], r.pos[2]);
  r.vel[0] = 0; r.vel[1] = 0; r.vel[2] = 0.05;
  const z0 = r.pos[2];
  for (let i = 0; i < 120 * 12; i++) r.step(DT, inp);
  assert.ok(r.pos[2] > z0 + 30, `12 秒で ${(r.pos[2] - z0).toFixed(1)}m しか進まない（詰んでいる）`);
});

test('長時間まわしても数値が壊れない', () => {
  const s = pilot(240, { respectGrip: true });
  const r = s.rider;
  for (const v of [...r.pos, ...r.vel, r.yaw, r.flow, r.balance, r.speed]) {
    assert.ok(Number.isFinite(v), `${v} が有限でない`);
  }
  assert.ok(r.flow >= 0 && r.flow <= 1);
  assert.ok(r.balance >= 0 && r.balance <= 1);
});

test('ネットワークへ送る状態は数値だけで、桁も抑えられている', () => {
  const r = new Rider();
  const inp = input();
  for (let i = 0; i < 600; i++) r.step(DT, inp);
  const s = r.netState();
  assert.equal(Object.keys(s).length, 9);
  for (const [k, v] of Object.entries(s)) {
    assert.ok(Number.isFinite(v), `${k} が有限でない`);
  }
  assert.ok(JSON.stringify(s).length < 130, '1 パケットが大きすぎる');
});
