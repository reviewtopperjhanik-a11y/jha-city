import { clamp } from '../util/math.js';
import { saveGame, saveSlot, listSlots, loadSlot, currentSlot } from '../core/save.js';

// Each tier trades pixel density, bloom and shadows to hold a playable frame rate.
const TIERS = [
  { key: 'high', label: 'HIGH', dpr: 1.5, bloom: true, shadows: true, shadowSize: 1024 },
  { key: 'medium', label: 'MEDIUM', dpr: 1.35, bloom: true, shadows: true, shadowSize: 512 },
  { key: 'low', label: 'LOW', dpr: 1.25, bloom: false, shadows: false, shadowSize: 512 },
];
const MODES = ['auto', 'high', 'medium', 'low'];
const DAY_LENGTHS = [5, 10, 20, 40];
const FPS_CAPS = [0, 30, 60];
const STEERING_MODES = ['joystick', 'tilt', 'drag'];
const STORY_TOTAL = 5;

export class Settings {
  constructor(root, look, save, {
    isMobile = false,
    toast = () => {},
    onSaveSlot = () => {},
    onLoadSlot = () => {},
    onLook = () => {},
    onEditHud = () => {},
    onQuality = () => {},
    onFpsCap = () => {},
    onSound = () => {},
    onVibration = () => {},
    onSteering = () => {},
  } = {}) {
    this.look = look;
    this.save = save;
    this.toast = toast;
    this.onSaveSlot = onSaveSlot;
    this.onLoadSlot = onLoadSlot;
    this.onLook = onLook;
    this.onEditHud = onEditHud;
    this.onQuality = onQuality;
    this.onFpsCap = onFpsCap;
    this.onSound = onSound;
    this.onVibration = onVibration;
    this.onSteering = onSteering;
    this.mode = MODES.includes(save.quality) ? save.quality : 'auto';
    const fallbackTier = isMobile ? 1 : 0;
    this.autoTier = clamp(Number.isFinite(save.autoTier) ? Math.round(save.autoTier) : fallbackTier, 0, 2);
    this.showFps = save.showFps !== false;
    this.dayLength = DAY_LENGTHS.includes(Number(save.dayLength)) ? Number(save.dayLength) : 10;
    this.autoAim = save.autoAim !== false;
    this.fpsCap = FPS_CAPS.includes(Number(save.fpsCap)) ? Number(save.fpsCap) : 0;
    this.sound = save.sound !== false;
    this.vibration = save.vibration !== false;
    this.steering = STEERING_MODES.includes(save.steering) ? save.steering : 'joystick';
    this.isOpen = false;
    this.fpsSmooth = 60;
    this.fpsTimer = 0;
    this.elapsed = 0;
    this.lowTime = 0;
    this.highTime = 0;
    this.cooldown = 0;
    this.lastUpgrade = -999;
    this.upgradeLocked = false;
    this.upgradeLockUntil = 0;

    this.overlay = document.createElement('div');
    this.overlay.className = 'settings-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.innerHTML = `
      <div class="settings-panel">
        <div class="settings-head">
          <span class="settings-title">SETTINGS</span>
          <button class="settings-close" aria-label="Close settings">✕</button>
        </div>
        <div class="settings-label">GRAPHICS QUALITY</div>
        <div class="quality-row">
          ${MODES.map((mode) => `<button class="quality-btn" data-mode="${mode}">${mode.toUpperCase()}</button>`).join('')}
        </div>
        <p class="settings-note">AUTO lowers effects when the frame rate drops. Pick a fixed level if you prefer a steady look.</p>
        <button class="settings-toggle" id="fps-toggle">FPS METER: ON</button>
        <button class="settings-toggle" id="look-button">CHARACTER LOOK</button>
        <button class="settings-toggle" id="edit-hud-button">EDIT HUD</button>
        <button class="settings-toggle" id="day-length-button">DAY LENGTH: 10 MIN</button>
        <button class="settings-toggle" id="auto-aim-button">AUTO-AIM: ON</button>
        <button class="settings-toggle" id="fps-cap-button">FPS CAP: OFF</button>
        <button class="settings-toggle" id="sound-button">SOUND: ON</button>
        <button class="settings-toggle" id="vibration-button">VIBRATION: ON</button>
        <button class="settings-toggle" id="steering-button">STEERING: JOYSTICK</button>
        <div class="settings-stat" id="settings-stat">60 FPS · AUTO · MEDIUM</div>
        <div class="settings-tip">Settings are saved automatically.</div>
        <div class="settings-label" style="padding-top:10px">SAVE SLOTS</div>
        <div class="slot-row" id="slot-row"></div>
      </div>`;
    root.append(this.overlay);

    this.fpsEl = root.querySelector('#hud-fps');
    this.stat = this.overlay.querySelector('#settings-stat');
    this.slotRow = this.overlay.querySelector('#slot-row');
    this.fpsToggle = this.overlay.querySelector('#fps-toggle');
    this.lookButton = this.overlay.querySelector('#look-button');
    this.editHudButton = this.overlay.querySelector('#edit-hud-button');
    this.dayLengthButton = this.overlay.querySelector('#day-length-button');
    this.autoAimButton = this.overlay.querySelector('#auto-aim-button');
    this.fpsCapButton = this.overlay.querySelector('#fps-cap-button');
    this.soundButton = this.overlay.querySelector('#sound-button');
    this.vibrationButton = this.overlay.querySelector('#vibration-button');
    this.steeringButton = this.overlay.querySelector('#steering-button');
    this.qualityButtons = [...this.overlay.querySelectorAll('.quality-btn')];
    this.overlay.querySelector('.settings-close').addEventListener('click', () => this.close());

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) this.close();
    });
    for (const btn of this.qualityButtons) {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    }
    this.fpsToggle.addEventListener('click', () => {
      this.showFps = !this.showFps;
      this._apply();
    });
    this.lookButton.addEventListener('click', () => {
      this.close();
      this.onLook();
    });
    this.editHudButton.addEventListener('click', () => {
      this.close();
      this.onEditHud();
    });
    this.dayLengthButton.addEventListener('click', () => {
      const index = DAY_LENGTHS.indexOf(this.dayLength);
      this.dayLength = DAY_LENGTHS[(index + 1) % DAY_LENGTHS.length];
      this._apply();
      this.toast(`DAY LENGTH: ${this.dayLength} MIN`);
    });
    this.autoAimButton.addEventListener('click', () => {
      this.autoAim = !this.autoAim;
      this._apply();
      this.toast(`AUTO-AIM: ${this.autoAim ? 'ON' : 'OFF'}`);
    });
    this.fpsCapButton.addEventListener('click', () => {
      this.fpsCap = FPS_CAPS[(FPS_CAPS.indexOf(this.fpsCap) + 1) % FPS_CAPS.length];
      this._apply();
      this.toast(`FPS CAP: ${this.fpsCap || 'OFF'}`);
    });
    this.soundButton.addEventListener('click', () => {
      this.sound = !this.sound;
      this._apply();
      this.toast(`SOUND: ${this.sound ? 'ON' : 'OFF'}`);
    });
    this.vibrationButton.addEventListener('click', () => {
      this.vibration = !this.vibration;
      this._apply();
      this.toast(`VIBRATION: ${this.vibration ? 'ON' : 'OFF'}`);
    });
    this.steeringButton.addEventListener('click', () => {
      this.steering = STEERING_MODES[(STEERING_MODES.indexOf(this.steering) + 1) % STEERING_MODES.length];
      this._apply();
      this.toast(`STEERING: ${this.steering.toUpperCase()}`);
    });
    this._renderSlots();

    this._apply();
    this._renderFps();
  }

  _renderSlots() {
    if (!this.slotRow) return;
    const active = currentSlot();
    const slots = listSlots();
    this.slotRow.innerHTML = slots.map((s) => `
      <div class="slot-item ${s.index === active ? 'active' : ''}">
        <span>S${s.index}<small>${s.exists ? `$${s.money} · ${s.storyStep}/${STORY_TOTAL}` : 'EMPTY'}</small></span>
        <button data-slot="save-${s.index}">SAVE</button>
        <button data-slot="load-${s.index}">LOAD</button>
      </div>`).join('');
    for (const btn of this.slotRow.querySelectorAll('button')) {
      btn.addEventListener('click', () => {
        const [action, index] = btn.dataset.slot.split('-');
        const slot = Number(index);
        if (action === 'save') {
          saveSlot(slot, this.save);
          this.onSaveSlot(slot);
          this.toast(`SLOT ${slot} SAVED`);
          this._renderSlots();
        } else {
          const found = listSlots().find((s) => s.index === slot);
          if (!found?.exists) {
            this.toast(`SLOT ${slot} IS EMPTY`);
            return;
          }
          const state = loadSlot(slot);
          this.onLoadSlot(slot, state);
          this._renderSlots();
        }
      });
    }
  }

  _preset() {
    if (this.mode === 'auto') return TIERS[this.autoTier];
    return TIERS.find((t) => t.key === this.mode) || TIERS[1];
  }

  _apply() {
    const preset = this._preset();
    this.look.applyQuality(preset);
    this.onQuality(preset);
    this.save.quality = this.mode;
    this.save.autoTier = this.autoTier;
    this.save.showFps = this.showFps;
    this.save.dayLength = this.dayLength;
    this.save.autoAim = this.autoAim;
    this.save.fpsCap = this.fpsCap;
    this.save.sound = this.sound;
    this.save.vibration = this.vibration;
    this.save.steering = this.steering;
    this.onFpsCap(this.fpsCap);
    this.onSound(this.sound);
    this.onVibration(this.vibration);
    this.onSteering(this.steering);

    for (const btn of this.qualityButtons) {
      const on = btn.dataset.mode === this.mode;
      btn.classList.toggle('active', on);
    }
    this.fpsToggle.textContent = `FPS METER: ${this.showFps ? 'ON' : 'OFF'}`;
    this.fpsToggle.classList.toggle('active', this.showFps);
    this.dayLengthButton.textContent = `DAY LENGTH: ${this.dayLength} MIN`;
    this.dayLengthButton.classList.toggle('active', this.dayLength !== 10);
    this.autoAimButton.textContent = `AUTO-AIM: ${this.autoAim ? 'ON' : 'OFF'}`;
    this.autoAimButton.classList.toggle('active', this.autoAim);
    this.fpsCapButton.textContent = `FPS CAP: ${this.fpsCap || 'OFF'}`;
    this.fpsCapButton.classList.toggle('active', this.fpsCap > 0);
    this.soundButton.textContent = `SOUND: ${this.sound ? 'ON' : 'OFF'}`;
    this.soundButton.classList.toggle('active', this.sound);
    this.vibrationButton.textContent = `VIBRATION: ${this.vibration ? 'ON' : 'OFF'}`;
    this.vibrationButton.classList.toggle('active', this.vibration);
    this.steeringButton.textContent = `STEERING: ${this.steering.toUpperCase()}`;
    this.steeringButton.classList.toggle('active', this.steering !== 'joystick');
    if (this.fpsEl) this.fpsEl.style.display = this.showFps ? 'block' : 'none';
    this._renderFps();
    saveGame(this.save, true);
  }

  _renderFps() {
    const preset = this._preset();
    const tag = this.mode === 'auto' ? `AUTO ${preset.label}` : preset.label;
    const text = `${Math.round(this.fpsSmooth)} FPS · ${tag}`;
    if (this.fpsEl) {
      this.fpsEl.textContent = text;
      this.fpsEl.classList.toggle('warn', this.fpsSmooth < 45 && this.fpsSmooth >= 28);
      this.fpsEl.classList.toggle('bad', this.fpsSmooth < 28);
    }
    if (this.stat) {
      const mem = typeof performance !== 'undefined' ? performance.memory?.usedJSHeapSize : 0;
      this.stat.textContent = mem ? `${text} · ${Math.round(mem / 1048576)} MB` : text;
    }
  }

  // Called after a slot load so the panel and all callback consumers follow the save.
  syncFromSave() {
    const s = this.save;
    this.mode = MODES.includes(s.quality) ? s.quality : 'auto';
    const fallbackTier = 1;
    this.autoTier = clamp(Number.isFinite(s.autoTier) ? Math.round(s.autoTier) : fallbackTier, 0, 2);
    this.showFps = s.showFps !== false;
    this.dayLength = DAY_LENGTHS.includes(Number(s.dayLength)) ? Number(s.dayLength) : 10;
    this.autoAim = s.autoAim !== false;
    this.fpsCap = FPS_CAPS.includes(Number(s.fpsCap)) ? Number(s.fpsCap) : 0;
    this.sound = s.sound !== false;
    this.vibration = s.vibration !== false;
    this.steering = STEERING_MODES.includes(s.steering) ? s.steering : 'joystick';
    this.lowTime = 0;
    this.highTime = 0;
    this.cooldown = 2;
    this._apply();
  }

  setMode(mode) {
    if (!MODES.includes(mode)) return;
    if (mode === 'auto') {
      const current = this._preset();
      this.autoTier = clamp(TIERS.findIndex((t) => t.key === current.key), 0, 2);
      this.upgradeLocked = false;
      this.upgradeLockUntil = 0;
      this.lowTime = 0;
      this.highTime = 0;
      this.cooldown = 4;
    }
    this.mode = mode;
    this._apply();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.overlay.classList.add('open');
    this.overlay.setAttribute('aria-hidden', 'false');
    this._renderSlots();
    this._renderFps();
  }

  close() {
    this.isOpen = false;
    this.overlay.classList.remove('open');
    this.overlay.setAttribute('aria-hidden', 'true');
  }

  update(dt, fps) {
    const safeFps = clamp(fps || 60, 1, 144);
    this.fpsSmooth += (safeFps - this.fpsSmooth) * (1 - Math.exp(-5 * dt));
    this.elapsed += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);

    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.3) {
      this.fpsTimer = 0;
      this._renderFps();
    }

    if (this.mode !== 'auto' || this.elapsed < 4) return;
    if (this.upgradeLocked && this.elapsed > this.upgradeLockUntil) this.upgradeLocked = false;

    if (this.fpsSmooth < 28) this.lowTime += dt;
    else this.lowTime = Math.max(0, this.lowTime - dt * 0.7);
    if (this.fpsSmooth > 45) this.highTime += dt;
    else this.highTime = Math.max(0, this.highTime - dt * 0.8);

    // Spec: drop after 3s below 28 FPS, rise after 5s above 45 FPS.
    // A 12s cooldown plus an anti-flap lock keeps the tier from oscillating.
    if (this.lowTime >= 3 && this.autoTier < 2 && this.cooldown <= 0) {
      if (this.elapsed - this.lastUpgrade < 60) {
        this.upgradeLocked = true;
        this.upgradeLockUntil = this.elapsed + 60;
      }
      this.autoTier++;
      this.lastUpgrade = this.elapsed;
      this.lowTime = 0;
      this.highTime = 0;
      this.cooldown = 12;
      this._apply();
      if (!this.isOpen) this.toast(`QUALITY: ${this._preset().label}`);
      return;
    }

    if (
      this.highTime >= 5 &&
      this.autoTier > 0 &&
      !this.upgradeLocked &&
      this.cooldown <= 0 &&
      this.elapsed - this.lastUpgrade > 20
    ) {
      this.autoTier--;
      this.lastUpgrade = this.elapsed;
      this.highTime = 0;
      this.lowTime = 0;
      this.cooldown = 12;
      this._apply();
      if (!this.isOpen) this.toast(`QUALITY: ${this._preset().label}`);
    }
  }
}
