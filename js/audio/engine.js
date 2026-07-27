// オーディオの土台。ファイルは 1 つも読み込まない。全部その場で作る。
//
//   マスター →  コンプレッサ → 出力
//   リバーブは畳み込み。インパルス応答もノイズから生成する。

import { clamp, clamp01, lerp } from '../core/math.js';
import { Sfx } from './sfx.js';
import { Music } from './music.js';

/** 白色ノイズのループバッファ */
export function makeNoise(ctx, seconds = 2.5, seed = 12345) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  let s = seed >>> 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const w = (s / 2147483648) - 1;
      // ほんの少しだけ低域寄りにして、耳に刺さらないようにする
      last = last * 0.22 + w * 0.78;
      d[i] = last;
    }
    // 継ぎ目を消すためのクロスフェード
    const fade = Math.min(2048, n >> 3);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[i] = d[i] * t + d[n - fade + i] * (1 - t);
    }
  }
  return buf;
}

/**
 * インパルス応答を作る。
 * 開けた斜面 = 長くて明るい。樹林帯 = 短くて丸い。
 */
export function makeIR(ctx, { seconds = 2.4, decay = 2.6, damp = 0.35, seed = 991 } = {}) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  let s = seed >>> 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const w = (s / 2147483648) - 1;
      const t = i / n;
      // 高域から先に減衰する（雪と木は高い音をよく吸う）
      lp += (w - lp) * (1 - damp * t);
      let env = Math.pow(1 - t, decay);
      // 初期反射をいくつか置く
      const ms = (i / ctx.sampleRate) * 1000;
      if (ms < 90) env *= 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(ms * 0.9 + c));
      d[i] = lp * env;
    }
  }
  return buf;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.sfx = null;
    this.music = null;
    this._masterTarget = 1;
  }

  start() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // --- マスターバス ---
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 3.2;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.22;

    // 全体をほんの少しだけ丸める
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'highshelf';
    this.tone.frequency.value = 6200;
    this.tone.gain.value = -2.5;

    this.master.connect(this.tone);
    this.tone.connect(this.comp);
    this.comp.connect(ctx.destination);

    // --- リバーブ ---
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeIR(ctx, { seconds: 2.6, decay: 2.4, damp: 0.42 });
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.9;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    // 送り用のバス
    this.send = ctx.createGain();
    this.send.gain.value = 0.11;
    this.send.connect(this.reverb);

    // --- 共有ノイズ ---
    this.noise = makeNoise(ctx, 3.1, 20260727);

    this.sfx = new Sfx(this);
    this.music = new Music(this);

    this.ready = true;
    this.resume();

    // フェードイン
    this.master.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.master.gain.exponentialRampToValueAtTime(0.85, ctx.currentTime + 2.2);

    this.music.start();

    // タブが戻ってきたら再開する
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.ctx.suspend?.();
      else this.resume();
    });
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 0.85, t, 0.08);
    }
    return this.muted;
  }

  /** ノイズ源を 1 本作る（呼び出し側で start / stop する）。 */
  noiseSource(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  update(dt, rider, wind) {
    if (!this.ready) return;
    this.sfx.update(dt, rider, wind);
    this.music.update(dt, rider);
  }

  land(impact, clean, rider) { if (this.ready) this.sfx.land(impact, clean, rider); }
  pop(power) { if (this.ready) this.sfx.pop(power); }
  treeHit(glancing, speed) { if (this.ready) this.sfx.treeHit(glancing, speed); }
  wipeout() { if (this.ready) { this.sfx.wipeout(); this.music.duck(); } }
}
