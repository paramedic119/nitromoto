// 生成音楽。暖かくて、押しつけがましくないもの。
//
// D リディアンをベースにした 4 和音の循環。FLOW が上がるとレイヤーが増えていく。
// 「うまく滑れている」ことが、音の厚みでも分かるようにしている。
// 先読みスケジューラ（25ms ごとに 0.35 秒先まで予約）で、GC の影響を受けない。

import { clamp, clamp01, lerp } from '../core/math.js';

const BPM = 84;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// D=62。リディアンの明るさが「快晴」に合う。
const ROOT = 62;
// I  -  V/vii - vi  -  IV(#11)
const CHORDS = [
  { deg: [0, 4, 7, 11, 14], bass: 0 },      // Dmaj9
  { deg: [-3, 4, 9, 12, 16], bass: -3 },    // Bm11 相当
  { deg: [-5, 2, 7, 11, 14], bass: -5 },    // A6/9
  { deg: [-2, 5, 9, 12, 17], bass: -2 },    // Cmaj7(#11) 的な浮遊
];
// アルペジオ用のペンタトニック
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(engine) {
    this.e = engine;
    this.ctx = engine.ctx;
    this.playing = false;

    const ctx = this.ctx;
    // レイヤーごとのバス
    this.busPad = ctx.createGain(); this.busPad.gain.value = 0.0;
    this.busBell = ctx.createGain(); this.busBell.gain.value = 0.0;
    this.busBass = ctx.createGain(); this.busBass.gain.value = 0.0;
    this.busPerc = ctx.createGain(); this.busPerc.gain.value = 0.0;

    this.out = ctx.createGain();
    this.out.gain.value = 0.62;

    // 曲全体を少し柔らかく
    this.soft = ctx.createBiquadFilter();
    this.soft.type = 'lowpass';
    this.soft.frequency.value = 5200;
    this.soft.Q.value = 0.4;

    for (const b of [this.busPad, this.busBell, this.busBass, this.busPerc]) {
      b.connect(this.soft);
    }
    this.soft.connect(this.out);
    this.out.connect(engine.master);
    // パッドとベルはリバーブに送る
    this.busPad.connect(engine.send);
    this.busBell.connect(engine.send);

    this.step = 0;              // 16分音符の通し番号
    this.nextTime = 0;
    this.flow = 0;
    this.intensity = 0;
    this._duck = 0;
    this._timer = null;
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.15;
    this._timer = setInterval(() => this._schedule(), 25);
  }

  stop() {
    this.playing = false;
    if (this._timer) clearInterval(this._timer);
  }

  duck() {
    // 転倒したときに音楽を少し引かせる
    this._duck = 1;
  }

  update(dt, rider) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.flow = lerp(this.flow, rider.flow, clamp01(dt * 1.4));
    this._duck = Math.max(0, this._duck - dt * 0.55);

    const spd = clamp01(rider.speed / 26);
    // 密度は FLOW 寄り。速度だけで盛り上がると、ゆっくり滑る楽しさが薄れる。
    this.intensity = clamp01(this.flow * 0.78 + spd * 0.22);
    const duck = 1 - this._duck * 0.75;

    const set = (bus, v) => bus.gain.setTargetAtTime(Math.max(0.0001, v * duck), t, 0.5);
    set(this.busPad, 0.13 + this.intensity * 0.10);
    set(this.busBass, 0.055 + smooth(this.intensity, 0.12, 0.45) * 0.11);
    set(this.busBell, smooth(this.intensity, 0.22, 0.62) * 0.115);
    set(this.busPerc, smooth(this.intensity, 0.45, 0.85) * 0.085);

    this.soft.frequency.setTargetAtTime(3200 + this.intensity * 3400, t, 0.6);
  }

  /* ------------------------------------------------ スケジューラ */

  _schedule() {
    if (!this.playing) return;
    const ctx = this.ctx;
    const ahead = 0.35;
    const sixteenth = BEAT / 4;
    while (this.nextTime < ctx.currentTime + ahead) {
      this._playStep(this.step, this.nextTime);
      this.step++;
      this.nextTime += sixteenth;
    }
  }

  _playStep(step, when) {
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const chord = CHORDS[bar % CHORDS.length];
    const I = this.intensity;

    // --- パッド: 小節頭で和音を差し替える ---
    if (inBar === 0) {
      for (let i = 0; i < chord.deg.length; i++) {
        const n = ROOT + chord.deg[i];
        this._pad(mtof(n), when + i * 0.035, BAR * 1.15, 0.20 - i * 0.022);
      }
    }

    // --- ベース ---
    if (inBar === 0 || inBar === 10) {
      this._bass(mtof(ROOT + chord.bass - 24), when, inBar === 0 ? BEAT * 2.4 : BEAT * 1.1);
    }

    // --- ベル / マリンバのアルペジオ ---
    // FLOW が高いほど音数が増える
    const density = 0.18 + I * 0.55;
    const h = hash(step * 2654435761);
    if (h < density && (inBar % 2 === 0 || h < density * 0.35)) {
      const oct = h < 0.12 ? 12 : 0;
      const idx = Math.floor(hash(step * 40503 + 7) * PENTA.length);
      // 和音の構成音へ寄せる
      const near = chord.deg[Math.floor(hash(step * 91 + 3) * chord.deg.length)];
      const n = ROOT + 12 + (hash(step * 17) < 0.5 ? PENTA[idx] : near + 12) + oct;
      this._bell(mtof(n), when, 0.9 + hash(step * 5) * 0.9, 0.16 + I * 0.14);
    }

    // --- パーカッション ---
    if (I > 0.42) {
      if (inBar === 0 || inBar === 8) this._kick(when);
      if (inBar % 4 === 2) this._shaker(when, 0.5 + I * 0.5);
      if (I > 0.7 && inBar === 14) this._shaker(when, 0.8);
    }
  }

  /* ----------------------------------------------------- 音色 */

  _pad(freq, when, dur, gain) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.8);
    g.gain.setValueAtTime(gain, when + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 2.4, when);
    f.frequency.linearRampToValueAtTime(freq * 5.0, when + dur * 0.6);
    f.Q.value = 0.6;

    // 少しずらした 3 声。うねりが暖かさになる。
    for (const det of [-6, 0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq * Math.pow(2, det / 1200);
      o.connect(f);
      o.start(when);
      o.stop(when + dur + 0.1);
    }
    f.connect(g);
    g.connect(this.busPad);
  }

  _bell(freq, when, dur, gain) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    // 倍音を 1 本足すとマリンバらしくなる
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 3.01;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(gain * 0.30, when);
    g2.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.32);
    o2.connect(g2); g2.connect(this.busBell);

    o.connect(g); g.connect(this.busBell);
    o.start(when); o.stop(when + dur + 0.05);
    o2.start(when); o2.stop(when + dur + 0.05);
  }

  _bass(freq, when, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.42, when + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(this.busBass);
    o.start(when); o.stop(when + dur + 0.05);
  }

  _kick(when) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.10);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.7, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    o.connect(g); g.connect(this.busPerc);
    o.start(when); o.stop(when + 0.26);
  }

  _shaker(when, amt) {
    const ctx = this.ctx;
    const src = this.e.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 5200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.30 * amt, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.075);
    src.connect(f); f.connect(g); g.connect(this.busPerc);
    src.start(when, Math.random() * 2.0, 0.12);
    src.stop(when + 0.13);
  }
}

function smooth(x, a, b) { return clamp01((x - a) / (b - a)); }

// 決定論的だが十分にばらける、ステップ番号からの 0..1
function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
}
