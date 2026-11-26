// Phase 7 — steering style adapter. The game always receives a pooled
// {x, y} axis (x = steer/strafe, y = forward), no matter whether it came from
// the on-screen stick, device tilt or a drag surface.

const MODES = new Set(['joystick', 'tilt', 'drag']);
const TILT_RANGE = 26; // degrees that map to a full axis
const TILT_MAX_AGE = 600; // ms before tilt data is considered stale
const clampAxis = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
};
const nowMs = () => (typeof performance !== 'undefined' && performance.now
  ? performance.now()
  : Date.now());

export class SteeringMode {
  constructor(mode = 'joystick') {
    this._axis = { x: 0, y: 0 }; // reused on every single call
    this._mode = 'joystick';
    this._surface = null;
    this._detachSurface = null;
    this._tiltBound = false;
    this._tilt = { x: 0, y: 0, at: -Infinity, gamma0: 0, beta0: 0, calibrated: false };
    this._drag = {
      x: 0, y: 0, active: false, id: null, startX: 0, startY: 0, radius: 42,
    };

    this._onOrientation = (e) => {
      const gamma = Number(e && e.gamma);
      const beta = Number(e && e.beta);
      if (!Number.isFinite(gamma) || !Number.isFinite(beta)) return;
      if (!this._tilt.calibrated) {
        this._tilt.gamma0 = gamma;
        this._tilt.beta0 = beta;
        this._tilt.calibrated = true;
      }
      this._tilt.x = clampAxis((gamma - this._tilt.gamma0) / TILT_RANGE);
      this._tilt.y = clampAxis(-(beta - this._tilt.beta0) / TILT_RANGE);
      this._tilt.at = nowMs();
    };

    this._moveDrag = (e) => {
      if (!this._drag.active) return;
      if (this._drag.id !== null && e.pointerId != null && e.pointerId !== this._drag.id) return;
      this._drag.x = clampAxis((Number(e.clientX) - this._drag.startX) / this._drag.radius);
      this._drag.y = clampAxis(-(Number(e.clientY) - this._drag.startY) / this._drag.radius);
    };
    this._onPointerDown = (e) => {
      if (this._mode !== 'drag' || this._drag.active) return;
      // HUD action buttons keep their own pointer semantics (fire/aim/reload).
      if (e.target?.closest?.('[data-action]') || this._surface?.dataset?.editing === '1') return;
      this._drag.active = true;
      this._drag.id = e.pointerId ?? null;
      this._drag.startX = Number(e.clientX) || 0;
      this._drag.startY = Number(e.clientY) || 0;
      const rect = typeof this._surface?.getBoundingClientRect === 'function'
        ? this._surface.getBoundingClientRect()
        : null;
      const width = Number(rect?.width) || 120;
      const height = Number(rect?.height) || 120;
      this._drag.radius = Math.max(24, Math.min(width, height) * 0.35);
      this._moveDrag(e);
    };
    this._onPointerUp = (e) => {
      if (!this._drag.active) return;
      if (this._drag.id !== null && e.pointerId != null && e.pointerId !== this._drag.id) return;
      this._drag.active = false;
      this._drag.id = null;
      this._drag.x = 0;
      this._drag.y = 0;
    };

    this.setMode(mode);
  }

  get mode() {
    return this._mode;
  }

  // True when tilt/drag currently owns the axis instead of the joystick.
  get active() {
    if (this._mode === 'tilt') return nowMs() - this._tilt.at < TILT_MAX_AGE;
    if (this._mode === 'drag') return this._drag.active;
    return false;
  }

  setMode(mode) {
    const next = MODES.has(mode) ? mode : 'joystick';
    if (next === this._mode) return this._mode;
    this._mode = next;

    if (next === 'tilt') {
      this._tilt.calibrated = false;
      this._tilt.x = 0;
      this._tilt.y = 0;
      this._tilt.at = -Infinity;
      if (!this._tiltBound && typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('deviceorientation', this._onOrientation);
        this._tiltBound = true;
      }
    } else if (this._tiltBound) {
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('deviceorientation', this._onOrientation);
      }
      this._tiltBound = false;
    }

    if (next !== 'drag') {
      this._drag.active = false;
      this._drag.id = null;
      this._drag.x = 0;
      this._drag.y = 0;
    }
    return this._mode;
  }

  // Pointer source for drag mode. Passing null detaches the old surface.
  bindSurface(el) {
    if (this._detachSurface) {
      this._detachSurface();
      this._detachSurface = null;
    }
    this._surface = null;
    if (!el || typeof el.addEventListener !== 'function') return this;
    this._surface = el;
    const handlers = {
      pointerdown: this._onPointerDown,
      pointermove: this._moveDrag,
      pointerup: this._onPointerUp,
      pointercancel: this._onPointerUp,
      pointerleave: this._onPointerUp,
    };
    for (const [name, handler] of Object.entries(handlers)) el.addEventListener(name, handler);
    this._detachSurface = () => {
      for (const [name, handler] of Object.entries(handlers)) el.removeEventListener(name, handler);
      this._drag.active = false;
      this._drag.id = null;
      this._drag.x = 0;
      this._drag.y = 0;
    };
    return this;
  }

  /**
   * @param {{x:number,y:number}} joystickAxis the normal Input.axis() frame axis
   * @param {{x:number,y:number}|null} pointerAxis optional external drag axis
   * @returns {{x:number,y:number}} the SAME reused object every frame
   */
  axisFor(joystickAxis = null, pointerAxis = null) {
    const out = this._axis;
    const jx = Number(joystickAxis?.x);
    const jy = Number(joystickAxis?.y);
    const passthrough = () => {
      out.x = Number.isFinite(jx) ? jx : 0;
      out.y = Number.isFinite(jy) ? jy : 0;
    };

    if (this._mode === 'tilt') {
      if (nowMs() - this._tilt.at < TILT_MAX_AGE) {
        out.x = this._tilt.x;
        out.y = this._tilt.y;
      } else {
        passthrough();
      }
      return out;
    }

    if (this._mode === 'drag') {
      if (this._drag.active) {
        out.x = this._drag.x;
        out.y = this._drag.y;
      } else if (pointerAxis && Number.isFinite(Number(pointerAxis.x)) && Number.isFinite(Number(pointerAxis.y))) {
        out.x = clampAxis(pointerAxis.x);
        out.y = clampAxis(pointerAxis.y);
      } else {
        passthrough();
      }
      return out;
    }

    passthrough();
    return out;
  }

  // Optional teardown for hot-reload / tests.
  destroy() {
    this.bindSurface(null);
    this.setMode('joystick');
    return this;
  }
}

export default SteeringMode;
