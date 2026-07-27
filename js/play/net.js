// オンライン。全員が同じシードの同じ山にいる。
//
// 地形が完全に決定論的なので、やり取りするのは座標と姿勢だけでいい。
// サーバは中継するだけ（server/server.js は依存ゼロの Node 実装）。
// 繋がらないときは黙ってソロに落ちる。山には「地元の人たち」がいる。

import { clamp01, lerp, damp, angleDelta, dampAngle } from '../core/math.js';
import { Locals } from './locals.js';
import { STATE } from './rider.js';
import { SEED } from '../world/terrain.js';

const SEND_HZ = 15;
const TIMEOUT = 6000;

const TINTS = [
  [0.94, 0.36, 0.24], [0.24, 0.60, 0.92], [0.98, 0.76, 0.22], [0.40, 0.82, 0.52],
  [0.78, 0.40, 0.90], [0.20, 0.82, 0.80], [0.96, 0.52, 0.66], [0.60, 0.68, 0.24],
];

/** 他プレイヤー。受信は 15Hz なので、描画は補間して滑らかにする。 */
class Peer {
  constructor(id, name, tintIndex) {
    this.id = id;
    this.name = name || '???';
    this.tint = TINTS[tintIndex % TINTS.length];
    this.pos = [0, 0, 0];
    this.up = [0, 1, 0];
    this.yaw = 0; this.roll = 0; this.edge = 0;
    this.crouch = 0.12; this.grab = 0; this.wobble = 0; this.tumble = 0;
    this.wedge = 0; this.tuckAmt = 0; this.poleTimer = 0; this.poleSide = 0;
    this._edgeSign = 0;
    this.spinRate = 0; this.grounded = true;
    this.speed = 0; this.distance = 0; this.flow = 0;
    this.visible = false;
    this.animT = Math.random() * 100;
    this.last = performance.now();
    // 補間の目標
    this.tPos = [0, 0, 0];
    this.tYaw = 0; this.tRoll = 0;
    this.state = 0;
    this._init = false;
  }

  apply(a) {
    // [id, x, y, z, yaw, roll, speed, distance, flow, state]
    this.tPos[0] = a[1]; this.tPos[1] = a[2]; this.tPos[2] = a[3];
    this.tYaw = a[4]; this.tRoll = a[5];
    this.speed = a[6]; this.distance = a[7]; this.flow = a[8];
    this.state = a[9];
    this.last = performance.now();
    if (!this._init) {
      this.pos[0] = this.tPos[0]; this.pos[1] = this.tPos[1]; this.pos[2] = this.tPos[2];
      this.yaw = this.tYaw; this.roll = this.tRoll;
      this._init = true;
    }
  }

  step(dt) {
    this.animT += dt;
    if (this.poleTimer > 0) this.poleTimer = Math.max(0, this.poleTimer - dt / 0.34);
    const r = 9;
    this.pos[0] = damp(this.pos[0], this.tPos[0], r, dt);
    this.pos[1] = damp(this.pos[1], this.tPos[1], r, dt);
    this.pos[2] = damp(this.pos[2], this.tPos[2], r, dt);
    this.yaw = dampAngle(this.yaw, this.tYaw, r, dt);
    this.roll = damp(this.roll, this.tRoll, r, dt);
    this.edge = -this.roll / 0.92;
    // 送られてくるのは姿勢だけなので、ストックワークは受信側で再現する
    const es = Math.abs(this.edge) > 0.16 ? Math.sign(this.edge) : 0;
    if (es !== 0 && es !== this._edgeSign && this.speed > 5 && this.poleTimer <= 0) {
      this.poleSide = -es;
      this.poleTimer = 1;
    }
    if (es !== 0) this._edgeSign = es;
    this.grounded = this.state !== 2;
    this.crouch = this.state === 2 ? 0.4 : 0.12;
    this.tumble = this.state === 1 ? this.tumble + dt * 6 : 0;
    // 姿勢用の法線は端末側で地形から取れるが、遠景なので鉛直で十分
    this.up[0] = damp(this.up[0], 0, 3, dt);
    this.up[1] = 1;
    this.up[2] = damp(this.up[2], 0, 3, dt);
  }
}

export class Net {
  constructor(opts = {}) {
    this.url = opts.url || autoUrl();
    this.name = (opts.name || 'ゲスト').slice(0, 12);
    this.status = 'offline';
    this.id = null;
    this.peers = new Map();
    this.renderList = [];
    this.locals = new Locals(SEED, opts.localCount ?? 7);
    this.ws = null;
    this._acc = 0;
    this._retry = 0;
    this._retryAt = 0;
    this._enabled = opts.enabled !== false;
    this._rows = [];
  }

  connect() {
    if (!this._enabled || !this.url) { this.status = 'offline'; return; }
    if (this.ws) return;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.status = 'offline';
      this._scheduleRetry();
      return;
    }
    this.ws = ws;
    this.status = 'connecting';

    ws.onopen = () => {
      this._retry = 0;
      ws.send(JSON.stringify({ t: 'hi', name: this.name, seed: SEED }));
    };
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onclose = () => {
      this.ws = null;
      this.status = 'offline';
      this.peers.clear();
      this._scheduleRetry();
    };
    ws.onerror = () => { /* onclose が続けて呼ばれる */ };
  }

  disconnect() {
    this._enabled = false;
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.status = 'offline';
    this.peers.clear();
  }

  _scheduleRetry() {
    this._retry = Math.min(this._retry + 1, 6);
    this._retryAt = performance.now() + Math.min(30000, 1500 * 2 ** (this._retry - 1));
  }

  _onMessage(data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.status = 'online';
        break;
      case 'w': {
        // ワールド更新。[[id,x,y,z,yaw,roll,speed,dist,flow,state], ...]
        const seen = new Set();
        for (const a of m.p) {
          const id = a[0];
          if (id === this.id) continue;
          seen.add(id);
          let peer = this.peers.get(id);
          if (!peer) {
            peer = new Peer(id, (m.n && m.n[id]) || `rider${id}`, hashId(id));
            this.peers.set(id, peer);
          }
          peer.apply(a);
        }
        for (const [id, peer] of this.peers) {
          if (!seen.has(id) && performance.now() - peer.last > TIMEOUT) this.peers.delete(id);
        }
        if (m.n) for (const [id, nm] of Object.entries(m.n)) {
          const p = this.peers.get(Number(id) || id);
          if (p) p.name = nm;
        }
        break;
      }
      case 'bye':
        this.peers.delete(m.id);
        break;
    }
  }

  update(dt, rider, camX, camZ) {
    // --- 再接続 ---
    if (this._enabled && !this.ws && performance.now() > this._retryAt) this.connect();

    // --- 送信（15Hz）---
    this._acc += dt;
    const period = 1 / SEND_HZ;
    if (this._acc >= period) {
      this._acc %= period;
      if (this.ws && this.ws.readyState === 1) {
        const s = rider.netState();
        this.ws.send(JSON.stringify({ t: 's', d: [s.x, s.y, s.z, s.a, s.r, s.s, s.d, s.f, s.w] }));
      }
    }

    // --- 他プレイヤーの補間 ---
    this.renderList.length = 0;
    for (const p of this.peers.values()) {
      p.step(dt);
      const dx = p.pos[0] - camX, dz = p.pos[2] - camZ;
      p.visible = dx * dx + dz * dz < 700 * 700;
      this.renderList.push(p);
    }

    // --- 地元の人たち ---
    this.locals.update(dt, rider.pos[2], camX, camZ);
    for (const l of this.locals.list) this.renderList.push(l);
  }

  /** 描画用の他ライダー一覧 */
  riders() { return this.renderList; }

  /** リーダーボードの行。自分も含めて距離順。 */
  leaderboard(rider) {
    const rows = this._rows;
    rows.length = 0;
    rows.push({
      name: this.name, distance: rider.pos[2] > 0 ? rider.pos[2] : 0,
      you: true, local: false, down: rider.state === STATE.WIPEOUT,
    });
    for (const p of this.peers.values()) {
      rows.push({ name: p.name, distance: p.distance, you: false, local: false, down: p.state === 1 });
    }
    for (const l of this.locals.list) {
      rows.push({ name: l.name, distance: l.distance, you: false, local: true, down: l.down });
    }
    rows.sort((a, b) => b.distance - a.distance);
    if (rows.length > 9) rows.length = 9;
    return rows;
  }
}

function hashId(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * サーバの URL を決める。
 * ・?server=wss://... で明示指定
 * ・同じホストで配信されているなら同ホストの /ws
 * ・GitHub Pages のような静的ホストでは指定がない限り繋ぎにいかない
 */
function autoUrl() {
  const q = new URLSearchParams(location.search);
  const explicit = q.get('server');
  if (explicit) return explicit;
  if (q.get('solo') === '1') return null;
  if (location.protocol === 'file:') return null;
  // 静的ホスティング（GitHub Pages 等）にはリレーがないので繋ぎにいかない
  if (/\.github\.io$/i.test(location.hostname)) return null;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
