// 効果音。すべてノイズとオシレータから合成する。
//
// 雪の上を滑る音は「ノイズをバンドパスに通したもの」で、
// カットオフを速度で、Q をエッジ角で動かすと、驚くほどそれらしく聞こえる。
//   パウダー = 低くて柔らかい / 圧雪 = 中域でざらつく / アイス = 高くて硬い

import { clamp, clamp01, lerp } from '../core/math.js';
import { SURFACE } from '../world/terrain.js';

export class Sfx {
  constructor(engine) {
    const ctx = engine.ctx;
    this.e = engine;
    this.ctx = ctx;

    /* ---------------- 雪面（常時鳴っている層）---------------- */
    this.snowSrc = engine.noiseSource();
    this.snowFilter = ctx.createBiquadFilter();
    this.snowFilter.type = 'bandpass';
    this.snowFilter.frequency.value = 800;
    this.snowFilter.Q.value = 0.8;
    this.snowLow = ctx.createBiquadFilter();     // 体に来る低域
    this.snowLow.type = 'lowpass';
    this.snowLow.frequency.value = 260;
    this.snowGain = ctx.createGain();
    this.snowGain.gain.value = 0;
    this.snowLowGain = ctx.createGain();
    this.snowLowGain.gain.value = 0;

    this.snowSrc.connect(this.snowFilter);
    this.snowFilter.connect(this.snowGain);
    this.snowGain.connect(engine.master);
    this.snowGain.connect(engine.send);
    this.snowSrc.connect(this.snowLow);
    this.snowLow.connect(this.snowLowGain);
    this.snowLowGain.connect(engine.master);
    this.snowSrc.start();

    /* ---------------- エッジの唸り（カービング）---------------- */
    // 高い Q のバンドパス。深く倒すほど「シャーッ」から「ズオーッ」へ変わる。
    this.edgeSrc = engine.noiseSource();
    this.edgeFilter = ctx.createBiquadFilter();
    this.edgeFilter.type = 'bandpass';
    this.edgeFilter.frequency.value = 1800;
    this.edgeFilter.Q.value = 7;
    this.edgeGain = ctx.createGain();
    this.edgeGain.gain.value = 0;
    this.edgeSrc.connect(this.edgeFilter);
    this.edgeFilter.connect(this.edgeGain);
    this.edgeGain.connect(engine.master);
    this.edgeGain.connect(engine.send);
    this.edgeSrc.start();

    /* ---------------- 風 ---------------- */
    this.windSrc = engine.noiseSource();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.55;
    this.windHi = ctx.createBiquadFilter();
    this.windHi.type = 'highpass';
    this.windHi.frequency.value = 200;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windHi);
    this.windHi.connect(this.windGain);
    this.windGain.connect(engine.master);
    this.windSrc.start();

    /* ---------------- 板のバタつき ---------------- */
    // 低い周波数の振幅変調で「ガガガ」を作る
    this.chatterLfo = ctx.createOscillator();
    this.chatterLfo.type = 'square';
    this.chatterLfo.frequency.value = 26;
    this.chatterDepth = ctx.createGain();
    this.chatterDepth.gain.value = 0;
    this.chatterLfo.connect(this.chatterDepth);
    this.chatterDepth.connect(this.snowGain.gain);
    this.chatterLfo.start();

    this._t = 0;
    this._lastCarveTone = 0;
  }

  update(dt, rider, wind) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const k = 0.05;   // setTargetAtTime の時定数

    const air = !rider.grounded;
    const sp = rider.speed;
    const sn = clamp01(sp / 30);
    const edge = Math.abs(rider.edge);
    const skid = rider.skidNorm;

    /* --- 雪面 --- */
    // 空中では消える。地面に着いた瞬間に戻ってくるのが気持ちいい。
    const contact = air ? 0 : 1;
    const level = contact * clamp01(sp / 3.5) * (0.055 + edge * 0.10 + skid * 0.30) * (0.5 + 0.5 * sn);
    this.snowGain.gain.setTargetAtTime(level, t, k);
    this.snowLowGain.gain.setTargetAtTime(contact * clamp01(sp / 6) * (0.03 + skid * 0.10), t, k);

    // 雪質でカットオフが変わる
    let base;
    if (rider.surface === SURFACE.ICE) base = 2600;
    else if (rider.surface === SURFACE.POWDER) base = 420;
    else base = 1150;
    base = lerp(base, base * 0.55, rider.powder * 0.6);
    const freq = clamp(base * (0.55 + sn * 1.1) * (1 + skid * 0.5), 120, 9000);
    this.snowFilter.frequency.setTargetAtTime(freq, t, k);
    this.snowFilter.Q.setTargetAtTime(0.6 + edge * 1.4 + rider.ice * 2.0, t, k);

    /* --- エッジの唸り --- */
    // 「削っていない、きれいに乗っている」ときに一番よく鳴る。
    const carveClean = edge * (1 - clamp01(skid * 1.6));
    const edgeLevel = contact * carveClean * clamp01(sp / 8) * 0.075;
    this.edgeGain.gain.setTargetAtTime(edgeLevel, t, 0.07);
    this.edgeFilter.frequency.setTargetAtTime(
      clamp(420 + sp * 62 + edge * 620, 200, 6000), t, 0.09);
    this.edgeFilter.Q.setTargetAtTime(4 + edge * 12, t, 0.09);

    /* --- 風 --- */
    const windLevel = (0.006 + sn * sn * 0.085) * (air ? 1.35 : 1) + wind * 0.0035;
    this.windGain.gain.setTargetAtTime(windLevel, t, 0.12);
    this.windFilter.frequency.setTargetAtTime(300 + sn * 900, t, 0.15);

    /* --- バタつき --- */
    this.chatterDepth.gain.setTargetAtTime(rider.chatter * level * 1.4, t, 0.06);
    this.chatterLfo.frequency.setTargetAtTime(18 + sp * 1.4, t, 0.1);

    /* --- 空中はリバーブが増えて、世界が遠くなる --- */
    this.e.send.gain.setTargetAtTime(air ? 0.24 : 0.10, t, 0.2);
  }

  /* -------------------------------------------------- 単発の音 */

  _burst({ dur = 0.25, freq = 800, q = 1, type = 'bandpass', gain = 0.3, sweep = 0, curve = 3 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.e.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    g.connect(this.e.master);
    g.connect(this.e.send);
    // バッファのランダムな位置から鳴らして、毎回違う音にする
    src.start(t, Math.random() * 2.5, dur + 0.05);
    src.stop(t + dur + 0.08);
    return g;
  }

  _tone({ freq = 220, to = 60, dur = 0.2, gain = 0.2, type = 'sine', delay = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.e.master);
    o.start(t); o.stop(t + dur + 0.05);
    return g;
  }

  /** オーリー。板が撓んで、雪をパッと蹴る。 */
  pop(power) {
    this._burst({ dur: 0.10, freq: 1900 + power * 1300, q: 1.1, gain: 0.10 + power * 0.13, sweep: 0.35 });
    this._tone({ freq: 320 + power * 260, to: 110, dur: 0.13, gain: 0.05 + power * 0.05, type: 'triangle' });
  }

  /** 着地。決まった着地は「トン」、失敗は「ドサッ」。 */
  land(impact, clean, rider) {
    const p = clamp01(impact / 15);
    this._burst({
      dur: 0.16 + p * 0.30,
      freq: clean ? 900 + p * 900 : 420 + p * 400,
      q: clean ? 0.9 : 0.55,
      gain: 0.10 + p * 0.30,
      sweep: 0.25,
    });
    this._tone({ freq: 92 + p * 55, to: 34, dur: 0.20 + p * 0.22, gain: 0.10 + p * 0.26, type: 'sine' });
    if (clean && impact > 6) {
      // 決まったときだけ、小さく鳴るご褒美
      this._tone({ freq: 1180, to: 1180, dur: 0.20, gain: 0.045, type: 'triangle', delay: 0.02 });
      this._tone({ freq: 1760, to: 1760, dur: 0.28, gain: 0.030, type: 'sine', delay: 0.05 });
    }
  }

  /** 木を掠める。枝を叩く高い音と、落ちてくる雪。 */
  treeHit(glancing, speed) {
    const p = clamp01(speed / 18);
    this._burst({ dur: 0.13, freq: 2600, q: 2.2, gain: 0.10 + p * 0.14, sweep: 0.30 });
    this._burst({ dur: 0.55, freq: 700, q: 0.6, gain: 0.05 + p * 0.09, sweep: 0.35 });
    if (!glancing) this._tone({ freq: 130, to: 45, dur: 0.32, gain: 0.26, type: 'sine' });
  }

  /** 転倒。ざらついた音が転がっていく。 */
  wipeout() {
    this._burst({ dur: 1.15, freq: 620, q: 0.5, gain: 0.30, sweep: 0.22, });
    this._tone({ freq: 150, to: 38, dur: 0.55, gain: 0.30, type: 'sine' });
    // 転がる感じを出すために、少しずらして何度か鳴らす
    for (let i = 1; i < 4; i++) {
      setTimeout(() => {
        if (!this.e.ready) return;
        this._burst({ dur: 0.22, freq: 900 - i * 140, q: 1.1, gain: 0.13 - i * 0.025, sweep: 0.4 });
      }, 150 + i * 165);
    }
  }
}
