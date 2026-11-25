const PAD_BUTTONS = [
  [0, 'jump'], [1, 'hb'], [2, 'horn'], [3, 'radio'],
  [5, 'boost'], [6, 'brake'], [7, 'gas'], [8, 'look'], [9, 'photo'],
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
};

export class Input {
  constructor(root) {
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
    this.padNext = {};
    this.padPrev = {};
    for (const [, action] of PAD_BUTTONS) {
      this.padNext[action] = false;
      this.padPrev[action] = false;
    }
    this._build(root);
    this._bind();
  }

  _build(root) {
    const left = document.createElement('div');
    left.className = 'touch-left';
    left.innerHTML = `
      <div class="stick-base" id="stick-base">
        <div class="stick-knob" id="stick-knob"></div>
      </div>`;
    const right = document.createElement('div');
    right.className = 'touch-right';
    // Only the buttons that make sense for the current situation are shown.
    // The joystick is always present; everything else is switched in groups.
    // LOOK is intentionally absent: the right half of the screen is the look
    // surface. Keyboard L and gamepad Back still open the wardrobe.
    const buttons = [
      ['gas', 'GAS', 'gas', 'drive'],
      ['brake', 'BRAKE', 'brake', 'drive'],
      ['hb', 'DRIFT', 'hb', 'drive'],
      ['boost', 'NITRO', 'boost nitro', 'drive'],
      ['boost', 'SPRINT', 'boost sprint', 'foot'],
      ['e', 'ENTER', 'e', 'drive foot mission'],
      ['horn', 'HORN', 'horn', 'drive foot mission'],
      ['radio', 'RADIO', 'radio', 'drive foot'],
      ['photo', 'PHOTO', 'photo', 'drive foot mission photo'],
      ['jump', 'JUMP', 'jump', 'foot'],
      ['jobs', 'JOBS', 'jobs', 'foot mission'],
      ['shop', 'SHOP', 'shop', 'foot mission'],
      ['weather', 'WX', 'weather', 'foot'],
      ['mission', 'START', 'mission', 'mission'],
    ];
    right.innerHTML = buttons
      .map(([action, label, cls, contexts]) => `<button class="tbtn ${cls}" data-action="${action}" data-contexts="${contexts}" aria-label="${label}">${label}</button>`)
      .join('');
    root.append(left, right);
    this.base = left.querySelector('#stick-base');
    this.knob = left.querySelector('#stick-knob');
    this.right = right;
    this.buttons = [...right.querySelectorAll('button')];
    this.context = null;
    this.setContext('foot');
  }

  setContext(context) {
    if (context === this.context) return;
    this.context = context;
    this.right.dataset.context = context;
    for (const btn of this.buttons) {
      const show = (btn.dataset.contexts || '').split(' ').includes(context);
      btn.hidden = !show;
      if (!show) {
        const action = btn.dataset.action;
        this.held[action] = false;
        btn.classList.remove('down');
      }
    }
  }

  setButtonLabel(action, label) {
    const btn = this.buttons.find((b) => b.dataset.action === action);
    if (btn && btn.textContent !== label) btn.textContent = label;
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      const a = KEY_ACTIONS[e.code];
      if (a) {
        if (!this.held[a]) this.pressed[a] = true;
        this.held[a] = true;
      }
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
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.36);
      let y = (e.clientY - (r.top + r.height / 2)) / (r.height * 0.36);
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
      this.stick.active = true;
      this.stick.id = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      moveStick(e);
    });
    this.base.addEventListener('pointermove', (e) => {
      if (this.stick.active && e.pointerId === this.stick.id) moveStick(e);
    });
    const release = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.active = false;
      this.stick.x = 0;
      this.stick.y = 0;
      this.knob.style.transform = 'translate(0, 0)';
    };
    this.base.addEventListener('pointerup', release);
    this.base.addEventListener('pointercancel', release);

    for (const btn of this.buttons) {
      const action = btn.dataset.action;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!this.held[action]) this.pressed[action] = true;
        this.held[action] = true;
        btn.classList.add('down');
      });
      const up = () => {
        this.held[action] = false;
        btn.classList.remove('down');
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  }

  // Standard gamepad mapping: sticks steer/drive, A jump, B handbrake,
  // X horn, Y radio, LB brake, RB boost, Back look, Start photo.
  poll() {
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

  isDown(action) {
    if (this.held[action] || this.padHeld[action]) return true;
    return !!this.keys[action];
  }

  consume(action) {
    const v = !!this.pressed[action];
    this.pressed[action] = false;
    return v;
  }

  drivingInput() {
    const a = this.axis();
    const out = this.driveResult;
    out.throttle = Math.max(a.y > 0 ? a.y : 0, this.isDown('gas') ? 1 : 0);
    out.brake = Math.max(a.y < 0 ? -a.y : 0, this.isDown('brake') ? 1 : 0);
    out.steer = a.x;
    out.handbrake = this.isDown('hb');
    out.boost = this.isDown('boost');
    return out;
  }
}
