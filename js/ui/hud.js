// HUD。数字は少なめに、動きは滑らかに。
// FLOW バーだけは主役なので、伸びるときに気持ちよく見えるよう手をかけてある。

import { clamp01, lerp, damp } from '../core/math.js';
import { ZONE_LABEL, nextZone } from '../world/terrain.js';
import { STATE } from '../play/rider.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      dist: $('dist').querySelector('b'),
      best: $('best'),
      zone: $('zone'),
      zoneNext: $('zone-next'),
      speed: $('speed'),
      flowFill: $('flow-fill'),
      flowCap: $('flow-cap'),
      vmax: $('vmax'),
      balFill: $('bal-fill'),
      trick: $('trick'),
      toast: $('toast'),
      wipe: $('vignette-wipe'),
      list: $('board-list'),
      netDot: $('net-dot'),
      boardTitle: $('board-title'),
    };
    this._speed = 0;
    this._flowPeak = 0;
    this._toastTimer = 0;
    this._lastZone = -1;
    this._lastDist = -1;
    this._lastBest = -1;
    this._rows = [];
  }

  show() { this.el.hud.classList.remove('hidden'); }

  trick(name) {
    const t = this.el.trick;
    t.textContent = name;
    t.classList.remove('show');
    // リフローを挟んでアニメーションを再生させる
    void t.offsetWidth;
    t.classList.add('show');
  }

  toast(msg, seconds = 2.4) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    this._toastTimer = seconds;
  }

  update(dt, rider, net) {
    const e = this.el;

    // --- 速度。数字がガタつかないよう少し均す ---
    this._speed = damp(this._speed, rider.speed * 3.6, 12, dt);
    e.speed.textContent = Math.round(this._speed);

    // --- 距離 ---
    const d = Math.round(rider.pos[2]);
    if (d !== this._lastDist) { e.dist.textContent = d > 0 ? d : 0; this._lastDist = d; }
    const b = Math.round(rider.bestDistance);
    if (b !== this._lastBest) { e.best.textContent = `ベスト ${b}m`; this._lastBest = b; }

    // --- FLOW ---
    const f = clamp01(rider.flow);
    e.flowFill.style.right = `${(1 - f) * 100}%`;
    this._flowPeak = Math.max(f, this._flowPeak - dt * 0.10);
    if (this._flowPeak > f + 0.03) {
      e.flowCap.style.left = `calc(${this._flowPeak * 100}% - 1.5px)`;
      e.flowCap.style.opacity = '0.8';
    } else {
      e.flowCap.style.opacity = '0';
    }
    e.vmax.textContent = `最高速 ${Math.round(rider.vMax * 3.6)} km/h`;

    // --- BALANCE ---
    const bal = clamp01(rider.balance);
    e.balFill.style.width = `${bal * 100}%`;
    e.balFill.className = bal < 0.28 ? 'danger' : bal < 0.55 ? 'warn' : '';

    // --- ゾーン ---
    const zk = rider.surfaceZone;
    if (zk !== this._lastZone) {
      e.zone.textContent = ZONE_LABEL[zk] || '';
      this._lastZone = zk;
    }
    const nz = nextZone(rider.pos[2]);
    e.zoneNext.textContent = nz.distance < 260
      ? `${Math.round(nz.distance)}m先 ▸ ${ZONE_LABEL[nz.kind]}` : '';

    // --- 転倒の白フェード ---
    // 復帰後もしばらく残す。その裏でスタート地点の地形を作り直している。
    if (rider.state === STATE.WIPEOUT && rider.wipeoutTimer > 1.15) {
      this._wipeHold = 0.55;
    } else {
      this._wipeHold = Math.max(0, (this._wipeHold || 0) - dt);
    }
    e.wipe.classList.toggle('show', this._wipeHold > 0);

    // --- トースト ---
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) e.toast.classList.remove('show');
    }

    // --- リーダーボード ---
    if (net) this._leaderboard(net, rider);
  }

  _leaderboard(net, rider) {
    const e = this.el;
    e.netDot.className = `dot ${net.status}`;
    e.netDot.title = { online: 'オンライン', connecting: '接続中', offline: 'オフライン' }[net.status];
    e.boardTitle.textContent = net.status === 'online' ? 'この山にいる人' : 'この山にいる人（ローカル）';

    const rows = net.leaderboard(rider);
    // DOM の作り直しは高くつくので、行を使い回す
    while (this._rows.length < rows.length) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="rank"></span><span class="nm"></span><span class="d"></span>';
      e.list.appendChild(li);
      this._rows.push(li);
    }
    while (this._rows.length > rows.length) {
      e.list.removeChild(this._rows.pop());
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], li = this._rows[i];
      const cls = 'li' + (r.you ? ' you' : '') + (r.local ? ' local' : '') + (r.down ? ' down' : '');
      const want = cls.slice(2);
      if (li.className !== want) li.className = want;
      const rk = `${i + 1}`;
      if (li.children[0].textContent !== rk) li.children[0].textContent = rk;
      if (li.children[1].textContent !== r.name) li.children[1].textContent = r.name;
      const dt = `${Math.round(r.distance)}m`;
      if (li.children[2].textContent !== dt) li.children[2].textContent = dt;
    }
  }
}
