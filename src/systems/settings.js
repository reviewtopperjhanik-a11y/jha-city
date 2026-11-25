import { clamp } from '../util/math.js';
import { saveGame } from '../core/save.js';

// Each tier trades pixel density, bloom and shadows to hold a playable frame rate.
const TIERS = [
  { key: 'high', label: 'HIGH', dpr: 1.5, bloom: true, shadows: true, shadowSize: 1024 },
  { key: 'medium', label: 'MEDIUM', dpr: 1.15, bloom: true, shadows: true, shadowSize: 512 },
  { key: 'low', label: 'LOW', dpr: 1, bloom: false, shadows: false, shadowSize: 512 },
];
const MODES = ['auto', 'high', 'medium', 'low'];

export class Settings {
  constructor(root, look, save, { isMobile = false, toast = () => {} } = {}) {
    this.look = look;
    this.save = save;
    this.toast = toast;
    this.mode = MODES.includes(save.quality) ? save.quality : 'auto';
    const fallbackTier = isMobile ? 1 : 0;
    this.autoTier = clamp(Number.isFinite(save.autoTier) ? Math.round(save.autoTier) : fallbackTier, 0, 2);
    this.showFps = save.showFps !== false;
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
        <div class="settings-stat" id="settings-stat">60 FPS · AUTO · MEDIUM</div>
        <div class="settings-tip">Settings are saved automatically.</div>
      </div>`;
    root.append(this.overlay);

    this.gear = root.querySelector('#hud-settings');
    this.fpsEl = root.querySelector('#hud-fps');
    this.stat = this.overlay.querySelector('#settings-stat');
    this.fpsToggle = this.overlay.querySelector('#fps-toggle');
    this.qualityButtons = [...this.overlay.querySelectorAll('.quality-btn')];
    this.overlay.querySelector('.settings-close').addEventListener('click', () => this.close());

    this.gear?.addEventListener('click', () => this.open());
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

    this._apply();
    this._renderFps();
  }

  _preset() {
    if (this.mode === 'auto') return TIERS[this.autoTier];
    return TIERS.find((t) => t.key === this.mode) || TIERS[1];
  }

  _apply() {
    const preset = this._preset();
    this.look.applyQuality(preset);
    this.save.quality = this.mode;
    this.save.autoTier = this.autoTier;
    this.save.showFps = this.showFps;

    for (const btn of this.qualityButtons) {
      const on = btn.dataset.mode === this.mode;
      btn.classList.toggle('active', on);
    }
    this.fpsToggle.textContent = `FPS METER: ${this.showFps ? 'ON' : 'OFF'}`;
    this.fpsToggle.classList.toggle('active', this.showFps);
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
    if (this.stat) this.stat.textContent = text;
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

    if (this.fpsSmooth < 27) this.lowTime += dt;
    else this.lowTime = Math.max(0, this.lowTime - dt * 0.7);
    if (this.fpsSmooth > 56) this.highTime += dt;
    else this.highTime = Math.max(0, this.highTime - dt * 0.8);

    if (this.lowTime > 2.5 && this.autoTier < 2 && this.cooldown <= 0) {
      if (this.elapsed - this.lastUpgrade < 25) {
        this.upgradeLocked = true;
        this.upgradeLockUntil = this.elapsed + 180;
      }
      this.autoTier++;
      this.lowTime = 0;
      this.highTime = 0;
      this.cooldown = 8;
      this._apply();
      if (!this.isOpen) this.toast(`QUALITY: ${this._preset().label}`);
      return;
    }

    if (
      this.highTime > 12 &&
      this.autoTier > 0 &&
      !this.upgradeLocked &&
      this.cooldown <= 0 &&
      this.elapsed - this.lastUpgrade > 20
    ) {
      this.autoTier--;
      this.lastUpgrade = this.elapsed;
      this.highTime = 0;
      this.lowTime = 0;
      this.cooldown = 10;
      this._apply();
      if (!this.isOpen) this.toast(`QUALITY: ${this._preset().label}`);
    }
  }
}
