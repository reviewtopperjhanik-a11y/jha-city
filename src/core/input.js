// Input owns event handling and reusable frame state. HUD owns the buttons.
// Every touch target is a [data-action] element inside #hud; the joystick is
// created here and placed by the HUD into the BL zone.

import { SteeringMode } from '../systems/steering.js';

const PAD_BUTTONS = [
  [0, 'jump'], [1, 'hb'], [2, 'horn'], [3, 'radio'],
  [5, 'boost'], [6, 'brake'], [7, 'gas'], [8, 'look'], [9, 'photo'],
  // L3/R3 are unused by driving; they become fire/aim in armed mode.
  [10, 'fire'], [11, 'aim'],
];

const KEY_ACTIONS = {
  Space: 'hb',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  KeyE: 'e',
  KeyC: 'cam',
  KeyM: 'mission',
  KeyR: 'race',
  KeyT: 'taxi',
  KeyJ: 'jobs',
  KeyG: 'shop',
  KeyP: 'bribe',
  KeyN: 'time',
  KeyH: 'horn',
  KeyV: 'weather',
  KeyB: 'radio',
  KeyK: 'photo',
  KeyL: 'look',
  KeyF: 'fire',
  KeyQ: 'aim',
  KeyZ: 'reload',
  KeyX: 'weapon',
};

export class Input {
  constructor(root) {
    this.root = root;
    // Death/respawn screens freeze gameplay actions while raw events continue.
    this.blocked = false;
    this.keys = {};
    this.held = {};
    this.pressed = {};
    this.padHeld = {};
    this.padPrev = {};
    this.pad = null;
    this.stick = { x: 0, y: 0, active: false, id: null };
    // Reused every frame so the input layer never creates GC pressure.
    this.axisResult = { x: 0, y: 0 };
    this.driveResult = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    // Phase 7: optional steering adapter. Null until a mode is chosen, so the
    // default axis()/drivingInput() behaviour is byte-for-byte unchanged.
    this.steering = null;
    this.padNext = {};
    this.padPrev = {};
    this.holdTimers = new Map();
    for (const [, action] of PAD_BUTTONS) {
      this.padNext[action] = false;
      this.padPrev[action] = false;
    }
    this._build(root);
    this._bind();
  }

  // While blocked, every gameplay-facing read is neutralised. The pooled
  // axisResult/driveResult objects are never replaced, so callers keep their
  // references. Raw keyboard/pointer listeners may still run, but press() is
  // inert, so they cannot queue actions.
  setBlocked(on) {
    this.blocked = !!on;
    if (!this.blocked) return this.blocked;
    this.keys = {};
    this.held = {};
    this.pressed = {};
    this.padHeld = {};
    this.padPrev = {};
    this.padNext = {};
    this.pad = null;
    this.stick.x = 0;
    this.stick.y = 0;
    this.stick.active = false;
    this.stick.id = null;
    if (this.knob) this.knob.style.transform = 'translate(0, 0)';
    for (const [, action] of PAD_BUTTONS) {
      this.padPrev[action] = false;
      this.padNext[action] = false;
    }
    if (typeof window !== 'undefined') {
      for (const timer of this.holdTimers.values()) window.clearTimeout(timer);
    }
    this.holdTimers.clear();
    if (this.buttons) {
      for (const btn of this.buttons) {
        btn.classList.remove('down');
        delete btn.dataset.held;
      }
    }
    const out = this.axisResult;
    out.x = 0;
    out.y = 0;
    const drive = this.driveResult;
    drive.throttle = 0;
    drive.brake = 0;
    drive.steer = 0;
    drive.handbrake = false;
    drive.boost = false;
    return this.blocked;
  }

  _build(root) {
    const left = document.createElement('div');
    left.className = 'touch-left';
    left.innerHTML = `
      <div class="stick-base" id="stick-base">
        <div class="stick-knob" id="stick-knob"></div>
      </div>`;
    const zone = root.querySelector('#zone-bl');
    (zone || root).append(left);
    this.base = left.querySelector('#stick-base');
    this.knob = left.querySelector('#stick-knob');
    this.right = root.querySelector('#touch-right');
    this.buttons = this.right ? [...this.right.querySelectorAll('.tbtn')] : [];
    this.context = 'foot';
  }

  setContext(context) {
    this.context = context;
    if (this.right) this.right.dataset.context = context;
  }

  setButtonLabel(action, label) {
    const btn = this.buttons.find((b) => b.dataset.action === action);
    if (btn && btn.textContent !== label) btn.textContent = label;
  }

  // Programmatic presses share the same edge detection as touch and keyboard.
  press(action) {
    if (this.blocked) return;
    if (!this.held[action]) this.pressed[action] = true;
    this.held[action] = true;
  }

  release(action) {
    this.held[action] = false;
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      const a = KEY_ACTIONS[e.code];
      if (a) this.press(a);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      const a = KEY_ACTIONS[e.code];
      if (a) this.held[a] = false;
    });
    window.addEventListener('blur', () => {
      this.keys = {};
      this.held = {};
    });

    const moveStick = (e) => {
      const r = this.base.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.36 || 1);
      let y = (e.clientY - (r.top + r.height / 2)) / (r.height * 0.36 || 1);
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      this.stick.x = x;
      this.stick.y = y;
      this.knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
    };
    this.base.addEventListener('pointerdown', (e) => {
      if (this.blocked || this.root.dataset.editing === '1') return;
      this.stick.active = true;
      this.stick.id = e.pointerId;
      this.base.setPointerCapture?.(e.pointerId);
      moveStick(e);
    });
    this.base.addEventListener('pointermove', (e) => {
      if (this.stick.active && e.pointerId === this.stick.id) moveStick(e);
    });
    const releaseStick = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.active = false;
      this.stick.x = 0;
      this.stick.y = 0;
      this.knob.style.transform = 'translate(0, 0)';
    };
    this.base.addEventListener('pointerup', releaseStick);
    this.base.addEventListener('pointercancel', releaseStick);

    // Delegation means HUD buttons can be replaced or moved freely.
    this.root.addEventListener('pointerdown', (e) => {
      if (this.blocked || this.root.dataset.editing === '1') return;
      const btn = e.target.closest?.('[data-action]');
      if (!btn || btn.hidden) return;
      e.preventDefault();
      const action = btn.dataset.action;
      this.press(action);
      btn.classList.add('down');
      const holdAction = btn.dataset.holdAction;
      if (holdAction) {
        const timer = window.setTimeout(() => {
          this.holdTimers.delete(btn);
          btn.dataset.held = '1';
          this.press(holdAction);
        }, 450);
        this.holdTimers.set(btn, timer);
      }
    });
    const releaseButton = (e) => {
      const btn = e.target.closest?.('[data-action]');
      if (!btn) return;
      const timer = this.holdTimers.get(btn);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        this.holdTimers.delete(btn);
      }
      const action = btn.dataset.action;
      this.held[action] = false;
      btn.classList.remove('down');
      if (btn.dataset.held === '1') {
        this.held[btn.dataset.holdAction] = false;
        delete btn.dataset.held;
      }
    };
    this.root.addEventListener('pointerup', releaseButton);
    this.root.addEventListener('pointercancel', releaseButton);
    this.root.addEventListener('pointerleave', releaseButton);
  }

  // Standard gamepad mapping: sticks steer/drive, A jump, B handbrake,
  // X horn, Y radio, LB brake, RB boost, Back look, Start photo.
  poll() {
    if (this.blocked) return null;
    const nav = typeof window !== 'undefined' ? window.navigator : null;
    const pads = nav?.getGamepads ? nav.getGamepads() : null;
    let pad = null;
    if (pads) {
      for (let i = 0; i < pads.length; i++) {
        if (pads[i] && pads[i].connected) {
          pad = pads[i];
          break;
        }
      }
    }
    this.pad = pad || null;
    const next = this.padNext;
    for (const [, action] of PAD_BUTTONS) next[action] = false;
    if (!pad) {
      this.padHeld = next;
      for (const [, action] of PAD_BUTTONS) this.padPrev[action] = false;
      return null;
    }
    const prev = this.padPrev;
    for (const [index, action] of PAD_BUTTONS) {
      const btn = pad.buttons[index];
      const on = !!(btn && (btn.pressed || btn.value > 0.5));
      next[action] = on;
      if (on && !prev[action]) this.pressed[action] = true;
      prev[action] = on;
    }
    this.padHeld = next;
    return pad;
  }

  _padButton(index) {
    const btn = this.pad?.buttons?.[index];
    return !!(btn && (btn.pressed || btn.value > 0.5));
  }

  // Movement axis: x = steering / strafe, y = forward (+1) / back (-1).
  axis() {
    const out = this.axisResult;
    if (this.blocked) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    if (this.stick.active) {
      out.x = this.stick.x;
      out.y = -this.stick.y;
      return out;
    }
    if (this.pad) {
      const axes = this.pad.axes || [];
      const clamp = (v) => Math.max(-1, Math.min(1, v || 0));
      const x = clamp(axes[0]) + (this._padButton(14) ? 1 : 0) - (this._padButton(12) ? 1 : 0);
      const y = -clamp(axes[1]) + (this._padButton(13) ? 1 : 0) - (this._padButton(15) ? 1 : 0);
      if (Math.abs(x) > 0.12 || Math.abs(y) > 0.12) {
        out.x = clamp(x);
        out.y = clamp(y);
        return out;
      }
    }
    out.x = (this.keys.KeyD || this.keys.ArrowRight ? 1 : 0) - (this.keys.KeyA || this.keys.ArrowLeft ? 1 : 0);
    out.y = (this.keys.KeyW || this.keys.ArrowUp ? 1 : 0) - (this.keys.KeyS || this.keys.ArrowDown ? 1 : 0);
    return out;
  }

  // Optional Phase 7 hooks. They never change axis() or drivingInput():
  // callers that want tilt/drag steering read steeringAxis() and copy its
  // `steer`/x value into their own drive frame.
  setSteering(mode = 'joystick') {
    if (!this.steering) this.steering = new SteeringMode(mode);
    else this.steering.setMode(mode);
    return this.steering;
  }

  bindSteeringSurface(el) {
    if (!this.steering) this.setSteering('drag');
    return this.steering.bindSurface(el);
  }

  steeringAxis(pointerAxis = null) {
    if (!this.steering) return this.axis();
    return this.steering.axisFor(this.axis(), pointerAxis);
  }

  isDown(action) {
    if (this.blocked) return false;
    if (this.held[action] || this.padHeld[action]) return true;
    return !!this.keys[action];
  }

  consume(action) {
    if (this.blocked) return false;
    const v = !!this.pressed[action];
    this.pressed[action] = false;
    return v;
  }

  drivingInput() {
    const out = this.driveResult;
    if (this.blocked) {
      out.throttle = 0;
      out.brake = 0;
      out.steer = 0;
      out.handbrake = false;
      out.boost = false;
      return out;
    }
    const a = this.axis();
    out.throttle = Math.max(a.y > 0 ? a.y : 0, this.isDown('gas') ? 1 : 0);
    out.brake = Math.max(a.y < 0 ? -a.y : 0, this.isDown('brake') ? 1 : 0);
    out.steer = a.x;
    out.handbrake = this.isDown('hb');
    out.boost = this.isDown('boost');
    return out;
  }
}
