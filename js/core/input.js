// 入力。キーボード・ゲームパッド・タッチを 1 つの正規化された状態にまとめる。
// ステアリングはアナログ値。キーボードでも「じわっと入れる」感触が出るように
// 押している時間でランプさせ、離すと素早く戻す。

import { clamp, damp } from './math.js';

const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  tuck: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  ollie: ['Space'],
  reset: ['KeyR'],
  camera: ['KeyC'],
  mute: ['KeyM'],
};

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.pressed = new Set();   // このフレームで押された
    this.released = new Set();

    // 正規化済みの出力
    this.steer = 0;        // -1..1
    this.steerRaw = 0;
    this.tuck = 0;         // 0..1
    this.brake = 0;        // 0..1
    this.ollieHeld = false;
    this.olliePressed = false;
    this.ollieReleased = false;
    this.anyInput = false;

    this._padIndex = null;
    this._touch = { steer: 0, tuck: 0, brake: 0, ollie: false };
    this._prevOllie = false;

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      // ブラウザのスクロールを止める
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
      this.pressed.add(e.code);
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    };
    this._onBlur = () => { this.keys.clear(); };

    target.addEventListener('keydown', this._onKeyDown, { passive: false });
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('blur', this._onBlur);
    window.addEventListener('gamepadconnected', (e) => { this._padIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this._padIndex = null; });
  }

  down(action) {
    const codes = KEYMAP[action];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  justPressed(action) {
    const codes = KEYMAP[action];
    if (!codes) return false;
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  /** タッチ UI から呼ぶ。値は -1..1 / 0..1。 */
  setTouch(part, value) {
    this._touch[part] = value;
  }

  update(dt) {
    // --- ゲームパッド ---
    let padSteer = 0, padTuck = 0, padBrake = 0, padOllie = false;
    if (this._padIndex != null && navigator.getGamepads) {
      const gp = navigator.getGamepads()[this._padIndex];
      if (gp) {
        const ax = gp.axes[0] ?? 0;
        padSteer = Math.abs(ax) > 0.12 ? ax : 0;
        padTuck = gp.buttons[7] ? gp.buttons[7].value : 0;   // RT
        padBrake = gp.buttons[6] ? gp.buttons[6].value : 0;  // LT
        padOllie = !!(gp.buttons[0] && gp.buttons[0].pressed); // A
      }
    }

    // --- ステアリングのランプ ---
    // キーは「入れ始めがゆっくり、戻しは速い」。丁寧に入れるほど気持ちよくなるように。
    let targetSteer = 0;
    if (this.down('left')) targetSteer -= 1;
    if (this.down('right')) targetSteer += 1;
    targetSteer = clamp(targetSteer + padSteer + this._touch.steer, -1, 1);

    const towardZero = Math.abs(targetSteer) < Math.abs(this.steer) ||
      Math.sign(targetSteer) !== Math.sign(this.steer);
    const rate = towardZero ? 15 : 4.3;
    this.steer = damp(this.steer, targetSteer, rate, dt);
    if (Math.abs(this.steer) < 1e-4) this.steer = 0;
    this.steerRaw = targetSteer;

    // --- タック / ブレーキ ---
    const tuckTarget = clamp((this.down('tuck') ? 1 : 0) + padTuck + this._touch.tuck, 0, 1);
    const brakeTarget = clamp((this.down('brake') ? 1 : 0) + padBrake + this._touch.brake, 0, 1);
    this.tuck = damp(this.tuck, tuckTarget, 9, dt);
    this.brake = damp(this.brake, brakeTarget, 14, dt);

    // --- オーリー ---
    const ollie = this.down('ollie') || padOllie || this._touch.ollie;
    this.olliePressed = ollie && !this._prevOllie;
    this.ollieReleased = !ollie && this._prevOllie;
    this.ollieHeld = ollie;
    this._prevOllie = ollie;

    this.anyInput = targetSteer !== 0 || tuckTarget > 0 || brakeTarget > 0 || ollie;
  }

  /** フレーム末に呼ぶ。エッジ検出用のセットをクリアする。 */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }
}
