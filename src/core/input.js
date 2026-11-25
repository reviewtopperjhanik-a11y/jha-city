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
};

export class Input {
  constructor(root) {
    this.keys = {};
    this.held = {};
    this.pressed = {};
    this.stick = { x: 0, y: 0, active: false, id: null };
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
    const buttons = [
      ['boost', '⚡', 'boost'],
      ['hb', 'DRIFT', 'hb'],
      ['brake', 'BRAKE', 'brake'],
      ['gas', 'GAS', 'gas'],
      ['jump', 'JUMP', 'jump'],
      ['e', 'E', 'e'],
      ['cam', 'CAM', 'cam'],
      ['time', 'D/N', 'time'],
      ['jobs', 'JOBS', 'jobs'],
      ['shop', 'SHOP', 'shop'],
      ['horn', 'HORN', 'horn'],
      ['weather', 'WX', 'weather'],
    ];
    right.innerHTML = buttons
      .map(([action, label, cls]) => `<button class="tbtn ${cls}" data-action="${action}">${label}</button>`)
      .join('');
    root.append(left, right);
    this.base = left.querySelector('#stick-base');
    this.knob = left.querySelector('#stick-knob');
    this.buttons = [...right.querySelectorAll('button')];
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

  // Movement axis: x = steering / strafe, y = forward (+1) / back (-1).
  axis() {
    if (this.stick.active) return { x: this.stick.x, y: -this.stick.y };
    const x = (this.keys.KeyD || this.keys.ArrowRight ? 1 : 0) - (this.keys.KeyA || this.keys.ArrowLeft ? 1 : 0);
    const y = (this.keys.KeyW || this.keys.ArrowUp ? 1 : 0) - (this.keys.KeyS || this.keys.ArrowDown ? 1 : 0);
    return { x, y };
  }

  isDown(action) {
    if (this.held[action]) return true;
    return !!this.keys[action];
  }

  consume(action) {
    const v = !!this.pressed[action];
    this.pressed[action] = false;
    return v;
  }

  drivingInput() {
    const a = this.axis();
    return {
      throttle: Math.max(a.y > 0 ? a.y : 0, this.isDown('gas') ? 1 : 0),
      brake: Math.max(a.y < 0 ? -a.y : 0, this.isDown('brake') ? 1 : 0),
      steer: a.x,
      handbrake: this.isDown('hb'),
      boost: this.isDown('boost'),
    };
  }
}
