// JHA City HUD — rewritten from scratch to the master spec.
// One stylesheet (hud.css), six grid zones, mode-driven action buttons,
// Edit HUD with persistence and overlap checks. No per-button positioning.

const LAYOUT_KEY = 'jha-city-hud-layout-v1';
const MODES = ['foot', 'nearVehicle', 'car', 'bike', 'armed', 'photo', 'menu'];
const clamp100 = (v) => Math.max(0, Math.min(100, Number(v) || 0));
const snap = (v) => Math.round(v / 12) * 12;

const ZONES = [
  ['zone-tl', 'TL · MAP + VITALS', '#2fb6b2'],
  ['zone-tc', 'TC · CLOCK', '#ffd9a0'],
  ['zone-tr', 'TR · CASH + MENU', '#ffa948'],
  ['zone-bl', 'BL · MOVE', '#f76685'],
  ['zone-bc', 'BC · EMPTY', '#8ff0e8'],
  ['zone-br', 'BR · ACTIONS', '#f76685'],
];

// id -> button definition. `action` is what core/input.js listens for.
const BUTTONS = {
  sprint: { action: 'boost', label: 'SPRINT', cls: 'sprint', hideIf: 'autoSprint' },
  e: { action: 'e', label: 'ACTION', cls: 'e' },
  jump: { action: 'jump', label: 'JUMP', cls: 'jump' },
  exit: { action: 'e', label: 'EXIT', cls: 'exit' },
  hornradio: { action: 'horn', holdAction: 'radio', label: '♪ HORN', cls: 'hornradio' },
  hb: { action: 'hb', label: 'DRIFT', cls: 'hb' },
  nitro: { action: 'boost', label: 'NITRO', cls: 'nitro', requires: 'nitro' },
  brake: { action: 'brake', label: 'BRAKE', cls: 'brake' },
  gas: { action: 'gas', label: 'GAS', cls: 'gas' },
  aim: { action: 'aim', label: 'AIM', cls: 'aim' },
  fire: { action: 'fire', label: 'FIRE', cls: 'fire' },
  weapon: { action: 'weapon', label: 'WEAPON', cls: 'weapon' },
  reload: { action: 'reload', label: 'RELOAD', cls: 'reload' },
  snap: { action: 'snap', label: 'SNAP', cls: 'snap' },
};

// Rows are filled in flex order inside BR; empty rows are hidden per mode.
const MODE_ROWS = {
  foot: [['sprint', 'e'], ['jump']],
  nearVehicle: [['e']],
  car: [['exit', 'hornradio'], ['hb', 'nitro'], ['brake', 'gas']],
  bike: [['exit', 'hornradio'], ['hb', 'nitro'], ['brake', 'gas']],
  armed: [['aim', 'fire'], ['weapon', 'reload']],
  photo: [['snap']],
  menu: [],
};

const PRESETS = ['right', 'left', 'claw'];

function blankLayout() {
  return { offsets: {}, sizes: {}, alpha: {}, preset: 'right', steering: 'joystick' };
}

function loadLayout() {
  const base = blankLayout();
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    return {
      offsets: saved.offsets && typeof saved.offsets === 'object' ? saved.offsets : {},
      sizes: saved.sizes && typeof saved.sizes === 'object' ? saved.sizes : {},
      alpha: saved.alpha && typeof saved.alpha === 'object' ? saved.alpha : {},
      preset: PRESETS.includes(saved.preset) ? saved.preset : 'right',
      steering: ['joystick', 'tilt', 'drag'].includes(saved.steering) ? saved.steering : 'joystick',
    };
  } catch {
    return base;
  }
}

export class Hud {
  constructor(root, { onAction = () => {} } = {}) {
    this.root = root;
    this.onAction = onAction;
    this.mode = 'foot';
    this.previousMode = 'foot';
    this.nitro = 0;
    this.autoSprint = false;
    this.editing = false;
    this.selected = null;
    this.layout = loadLayout();
    this.toastTimer = 0;
    this.damageTimer = 0;
    this.flashTimer = 0;
    this.hintTimer = 8;
    this.overlapAt = 0;
    this.overlapCheckAt = 0;
    this.modeKey = '';

    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.className = 'hud';
    this.el.dataset.mode = 'foot';
    this.el.innerHTML = `
      <div id="look-surface" aria-hidden="true"></div>
      <div class="ui-zone" id="zone-tl" data-zone="TL · MAP + VITALS"><div class="vitals" id="hud-vitals">
        <div class="hud-card" id="hud-health"><span id="hud-health-text">HP 100</span><span class="meter"><i id="hud-health-fill"></i></span></div>
        <div class="hud-card" id="hud-armor"><span id="hud-armor-text">ARMOR 0</span><span class="meter"><i id="hud-armor-fill"></i></span></div>
      </div><div class="hud-card hud-heat" id="hud-heat" hidden>SEARCHING</div><div class="hud-card hud-fps" id="hud-fps">60 FPS</div></div>
      <div class="ui-zone" id="zone-tc" data-zone="TC · CLOCK">
        <div class="hud-card" id="hud-clock">08:00</div>
        <div class="hud-card" id="hud-mission" hidden>No active job</div>
      </div>
      <div class="ui-zone" id="zone-tr" data-zone="TR · CASH + MENU">
        <button class="hud-card" id="hud-settings" data-action="menu" aria-label="Open city menu">≡</button>
        <button class="hud-card" id="hud-exit-photo" data-action="photoExit" aria-label="Exit photo mode" hidden>✕</button>
        <div class="hud-card" id="hud-money">$0</div>
        <div class="hud-card" id="hud-stars">☆☆☆☆☆</div>
        <div class="hud-card hud-weather" id="hud-weather">☀ CLEAR</div>
        <div class="hud-card hud-signal" id="hud-signal" hidden>GREEN</div>
        <div class="hud-card hud-radio" id="hud-radio">♪ OFF</div>
        <div class="hud-speedo" id="hud-speedo" hidden>
          <div class="hud-speed-ring" id="hud-speed-ring"></div>
          <div class="hud-speed-needle" id="hud-speed-needle"></div>
          <div class="hud-card hud-speed" id="hud-speed">0 <small>KM/H</small></div>
        </div>
      </div>
      <div class="ui-zone" id="zone-bl" data-zone="BL · MOVE"></div>
      <div class="ui-zone" id="zone-bc" data-zone="BC · EMPTY"></div>
      <div class="ui-zone" id="zone-br" data-zone="BR · ACTIONS"><div class="touch-right" id="touch-right"></div></div>
      <div class="hud-arrow" id="hud-arrow" hidden><div class="hud-arrow-tip" id="hud-arrow-tip"></div><div class="hud-arrow-label" id="hud-arrow-label">OBJECTIVE</div></div>
      <div class="hud-damage" id="hud-damage" hidden></div>
      <div class="hud-photo-flash" id="hud-flash"></div>
      <div class="hud-toast" id="hud-toast"></div>
      <div class="hud-warning" id="hud-warning" hidden>HUD OVERLAP</div>
      <div class="hint keyboard">WASD · J JOBS · G GARAGE · E ENTER · L LOOK · N DAY/NIGHT</div>
      <div class="hint touch">SWIPE RIGHT HALF TO LOOK · TAP ≡ FOR JOBS, SHOP, RADIO &amp; MORE</div>
      <div class="busted" id="hud-busted" role="alert" aria-hidden="true">
        <div class="busted-inner"><div class="busted-kicker">JHA CITY POLICE</div>
        <div class="busted-title">BUSTED</div><div class="busted-sub" id="hud-busted-sub"></div></div>
      </div>
      <div class="edit-overlay" id="hud-edit" aria-hidden="true"><div class="edit-panel">
        <div class="edit-head"><span class="edit-title">EDIT HUD</span><button class="edit-close" id="edit-close" aria-label="Close HUD editor">✕</button></div>
        <p class="edit-note">Drag any button (12px grid snap). Pick a button, then adjust its size and opacity.</p>
        <div class="edit-label">PRESET</div>
        <div class="edit-row">${PRESETS.map((p) => `<button class="edit-btn" data-preset="${p}">${p.toUpperCase()}</button>`).join('')}</div>
        <div class="edit-label">SELECTED: <span class="edit-selected" id="edit-selected">JUMP</span></div>
        <div class="edit-label">SIZE <span class="edit-value" id="edit-size-value">100%</span></div>
        <input class="edit-slider" id="edit-size" type="range" min="75" max="150" step="5" value="100">
        <div class="edit-label">OPACITY <span class="edit-value" id="edit-alpha-value">100%</span></div>
        <input class="edit-slider" id="edit-alpha" type="range" min="35" max="100" step="5" value="100">
        <div class="edit-label">STEERING</div>
        <div class="edit-row">
          <button class="edit-btn" data-steer="joystick">JOYSTICK</button>
          <button class="edit-btn" data-steer="tilt">TILT</button>
          <button class="edit-btn" data-steer="drag">DRAG</button>
        </div>
        <div class="edit-actions"><button class="edit-action" id="edit-reset">RESET</button><button class="edit-action" id="edit-save">SAVE</button></div>
      </div></div>`;
    root.append(this.el);

    const q = (id) => this.el.querySelector(id);
    this.zones = new Map(ZONES.map(([id, label, color]) => {
      const zone = q(`#${id}`);
      zone.dataset.zone = label;
      zone.style.setProperty('--zone-color', color);
      return [id, zone];
    }));
    this.lookZone = q('#look-surface');
    this.vitals = q('#hud-vitals');
    this.money = q('#hud-money');
    this.stars = q('#hud-stars');
    this.clock = q('#hud-clock');
    this.weather = q('#hud-weather');
    this.signal = q('#hud-signal');
    this.mission = q('#hud-mission');
    this.health = q('#hud-health');
    this.armor = q('#hud-armor');
    this.healthText = q('#hud-health-text');
    this.armorText = q('#hud-armor-text');
    this.healthFill = q('#hud-health-fill');
    this.armorFill = q('#hud-armor-fill');
    this.speedo = q('#hud-speedo');
    this.speed = q('#hud-speed');
    this.speedRing = q('#hud-speed-ring');
    this.speedNeedle = q('#hud-speed-needle');
    this.heat = q('#hud-heat');
    this.radio = q('#hud-radio');
    this.fps = q('#hud-fps');
    this.arrow = q('#hud-arrow');
    this.arrowTip = q('#hud-arrow-tip');
    this.arrowLabel = q('#hud-arrow-label');
    this.damageEl = q('#hud-damage');
    this.flashEl = q('#hud-flash');
    this.bustedEl = q('#hud-busted');
    this.bustedSub = q('#hud-busted-sub');
    this.toastEl = q('#hud-toast');
    this.warningEl = q('#hud-warning');
    this.right = q('#touch-right');
    this.editOverlay = q('#hud-edit');

    this.rows = MODE_ROWS.photo.map(() => null); // rebuilt below from the widest mode
    const maxRows = Math.max(...Object.values(MODE_ROWS).map((rows) => rows.length));
    this.rows = [];
    for (let i = 0; i < maxRows; i++) {
      const row = document.createElement('div');
      row.className = 'row';
      this.right.append(row);
      this.rows.push(row);
    }
    this.buttons = new Map();
    for (const [id, def] of Object.entries(BUTTONS)) {
      const btn = document.createElement('button');
      btn.className = `tbtn ${def.cls}`;
      btn.dataset.action = def.action;
      btn.dataset.id = id;
      if (def.holdAction) btn.dataset.holdAction = def.holdAction;
      btn.textContent = def.label;
      btn.setAttribute('aria-label', def.label);
      btn.hidden = true;
      this.buttons.set(id, btn);
    }
    for (const row of this.rows) {
      for (let i = 0; i < 3; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.hidden = true;
        row.append(slot);
      }
    }

    this._buildEditor();
    this._applyLayout();
    this.setMode('foot');

    const coarse = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    root.dataset.pointer = coarse ? 'coarse' : 'fine';
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search || '').get('debug') === '1') {
      document.documentElement.classList.add('debug-ui');
    }
  }

  // Minimap is owned by its own system; this only places its DOM in TL.
  attachMinimap(wrap) {
    if (!wrap) return;
    this.vitals.parentNode.insertBefore(wrap, this.vitals);
  }

  setRadio(label) {
    if (this.radio) this.radio.textContent = label;
  }

  setFps(text, { warn = false, bad = false } = {}) {
    if (!this.fps) return;
    this.fps.textContent = text;
    this.fps.classList.toggle('warn', warn);
    this.fps.classList.toggle('bad', bad);
  }

  setMode(mode, { nitro = this.nitro, autoSprint = this.autoSprint } = {}) {
    if (!MODES.includes(mode)) mode = 'foot';
    this.nitro = nitro;
    this.autoSprint = autoSprint;
    // NITRO only needs a two-state check; avoid touching DOM every frame.
    const key = `${mode}|${nitro > 2 ? 1 : 0}|${autoSprint ? 1 : 0}`;
    if (key === this.modeKey) return;
    this.modeKey = key;
    if (mode !== 'photo' && mode !== 'menu') this.previousMode = mode;
    this.mode = mode;
    this.el.dataset.mode = mode;
    this.right.dataset.mode = mode;
    const visible = {};

    for (const [id, def] of Object.entries(BUTTONS)) {
      const btn = this.buttons.get(id);
      let show = MODE_ROWS[mode].some((row) => row.includes(id));
      if (def.requires === 'nitro' && Number(nitro) <= 2) show = false;
      if (def.hideIf === 'autoSprint' && autoSprint) show = false;
      btn.hidden = !show;
      if (!show) btn.classList.remove('down');
      visible[id] = show;
      if (id === 'e') btn.textContent = mode === 'nearVehicle' ? 'ENTER' : 'ACTION';
      if (id === 'hb') btn.textContent = mode === 'bike' ? 'WHEELIE' : 'DRIFT';
    }

    this.rows.forEach((row, index) => {
      const rowIds = MODE_ROWS[mode][index] || [];
      row.hidden = rowIds.length === 0 || !rowIds.some((id) => visible[id]);
      row.querySelectorAll('.slot').forEach((slot, slotIndex) => {
        const id = rowIds[slotIndex];
        slot.replaceChildren();
        if (id && visible[id]) slot.append(this.buttons.get(id));
      });
    });

    this.el.classList.toggle('photo', mode === 'photo');
    this.el.classList.toggle('photo-mode', mode === 'photo');
    const exit = this.el.querySelector('#hud-exit-photo');
    if (exit) exit.hidden = mode !== 'photo';
    if (mode === 'photo') this.arrow.hidden = true;
  }

  setPhoto(on) {
    if (on) this.setMode('photo');
    else this.setMode(this.previousMode || 'foot');
  }

  update(s = {}) {
    this.money.textContent = `$${Math.round(s.money || 0)}`;
    const stars = Math.max(0, Math.min(5, Math.round(s.wanted || 0)));
    this.stars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    this.stars.style.color = stars > 0 ? '#f76685' : '';
    const hours = Number(s.hours) || 0;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    this.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (s.weather) this.weather.textContent = s.weather;

    if (!s.signal) {
      this.signal.hidden = true;
    } else {
      this.signal.hidden = false;
      this.signal.textContent = s.signal.label;
      this.signal.className = `hud-card hud-signal ${s.signal.tone || ''}`;
    }
    this.mission.textContent = s.mission || '';
    this.mission.hidden = s.missionActive === false || !s.mission;
    this.healthText.textContent = `HP ${Math.round(s.hp ?? 100)}`;
    this.armorText.textContent = `ARMOR ${Math.round(s.armor || 0)}`;
    this.healthFill.style.setProperty('--fill', `${clamp100(s.hp ?? 100)}%`);
    this.armorFill.style.setProperty('--fill', `${clamp100(s.armor || 0)}%`);

    const driving = s.mode === 'car' || s.mode === 'bike';
    this.speedo.hidden = !driving;
    if (driving) {
      const kmh = Math.max(0, Math.min(220, (s.speed || 0) * 3.6));
      this.speed.innerHTML = `${Math.round(kmh)} <small>KM/H</small>`;
      this.speedRing.style.setProperty('--speed', `${(kmh / 220) * 100}%`);
      this.speedNeedle.style.transform = `rotate(${-120 + (kmh / 220) * 240}deg)`;
    }

    if (!s.heat) {
      this.heat.hidden = true;
    } else {
      this.heat.hidden = false;
      this.heat.textContent = s.heat.label;
      this.heat.className = `hud-card hud-heat ${s.heat.tone || ''}`;
      this.heat.style.setProperty('--heat', `${Math.round((s.heat.progress || 0) * 100)}%`);
    }
  }

  updateArrow(marker) {
    if (!marker || !marker.show) {
      this.arrow.hidden = true;
      return;
    }
    this.arrow.hidden = false;
    this.arrow.style.left = `${marker.x}px`;
    this.arrow.style.top = `${marker.y}px`;
    this.arrowTip.style.transform = `rotate(${Math.round(marker.angle * 180 / Math.PI) + 90}deg)`;
    this.arrowLabel.textContent = marker.label || 'OBJECTIVE';
  }

  damage(strength = 1, angle = 0) {
    this.damageEl.hidden = false;
    this.damageEl.style.setProperty('--dmg-angle', `${Math.round(angle * 180 / Math.PI)}deg`);
    this.damageEl.style.opacity = String(Math.max(0.25, Math.min(1, strength)));
    this.damageTimer = 0.85;
  }

  photoFlash(ok = true) {
    this.flashEl.classList.remove('ok', 'fail');
    this.flashEl.classList.add('show', ok ? 'ok' : 'fail');
    this.flashTimer = 0.45;
  }

  showBusted(sub = '') {
    this.bustedSub.textContent = sub;
    this.bustedEl.classList.add('show');
    this.bustedEl.setAttribute('aria-hidden', 'false');
  }

  hideBusted() {
    this.bustedEl.classList.remove('show');
    this.bustedEl.setAttribute('aria-hidden', 'true');
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = 2.6;
  }

  tick(dt) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      if (this.damageTimer <= 0) this.damageEl.hidden = true;
      else this.damageEl.style.opacity = String(Math.max(0, Math.min(1, this.damageTimer / 0.85)));
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flashEl.classList.remove('show', 'ok', 'fail');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.querySelectorAll('.hint').forEach((el) => el.classList.add('fade'));
    }
    const now = performance.now();
    if ((this.editing || document.documentElement.classList.contains('debug-ui'))
      && now - this.overlapCheckAt > 1000) {
      this.overlapCheckAt = now;
      this.checkOverlaps();
    }
  }

  // Any two visible clickable HUD elements sharing pixels is a layout bug.
  checkOverlaps() {
    const nodes = [...this.el.querySelectorAll('.tbtn:not([hidden]), #hud-settings:not([hidden]), #hud-exit-photo:not([hidden])')]
      .filter((el) => el.getClientRects().length > 0);
    const rects = nodes.map((el) => el.getBoundingClientRect());
    let count = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) {
          nodes[i].classList.add('overlap');
          nodes[j].classList.add('overlap');
          count++;
        }
      }
    }
    if (!count) {
      nodes.forEach((el) => el.classList.remove('overlap'));
      this.warningEl.hidden = true;
      return false;
    }
    this.warningEl.hidden = false;
    this.warningEl.textContent = `HUD OVERLAP · ${count}`;
    const now = performance.now();
    if (now - this.overlapAt > 2000) {
      this.overlapAt = now;
      console.warn(`[JHA HUD] ${count} overlapping clickable element pair(s)`);
    }
    return true;
  }

  // -------------------------------------------------------------- Edit HUD
  _buildEditor() {
    this.editSelected = this.el.querySelector('#edit-selected');
    this.sizeSlider = this.el.querySelector('#edit-size');
    this.alphaSlider = this.el.querySelector('#edit-alpha');
    this.sizeValue = this.el.querySelector('#edit-size-value');
    this.alphaValue = this.el.querySelector('#edit-alpha-value');

    this.el.querySelector('#edit-close').addEventListener('click', () => this.closeEdit());
    this.editOverlay.addEventListener('click', (e) => {
      if (e.target === this.editOverlay) this.closeEdit();
    });
    for (const btn of this.editOverlay.querySelectorAll('[data-preset]')) {
      btn.addEventListener('click', () => this.applyPreset(btn.dataset.preset));
    }
    for (const btn of this.editOverlay.querySelectorAll('[data-steer]')) {
      btn.addEventListener('click', () => {
        this.layout.steering = btn.dataset.steer;
        this._applyLayout();
        this.toast(`STEERING: ${this.layout.steering.toUpperCase()}`);
      });
    }
    this.sizeSlider.addEventListener('input', () => {
      if (!this.selected) return;
      this.layout.sizes[this.selected] = Number(this.sizeSlider.value) / 100;
      this.sizeValue.textContent = `${this.sizeSlider.value}%`;
      this._applyLayout();
    });
    this.alphaSlider.addEventListener('input', () => {
      if (!this.selected) return;
      this.layout.alpha[this.selected] = Number(this.alphaSlider.value) / 100;
      this.alphaValue.textContent = `${this.alphaSlider.value}%`;
      this._applyLayout();
    });
    this.el.querySelector('#edit-reset').addEventListener('click', () => {
      this.layout = blankLayout();
      this._applyLayout();
      this.toast('HUD RESET TO DEFAULT');
    });
    this.el.querySelector('#edit-save').addEventListener('click', () => {
      this.saveLayout();
      this.toast('HUD LAYOUT SAVED');
    });

    for (const btn of [...this.buttons.values(), this.el.querySelector('#hud-settings')]) {
      btn.addEventListener('pointerdown', (e) => this._beginDrag(e, btn));
    }
  }

  _beginDrag(e, btn) {
    if (!this.editing) return;
    e.preventDefault();
    e.stopPropagation();
    this._select(btn);
    const id = btn.dataset.id || (btn.id === 'hud-settings' ? 'menu' : 'photoExit');
    const start = this.layout.offsets[id] || [0, 0];
    const origin = { x: e.clientX, y: e.clientY, dx: start[0], dy: start[1] };
    const move = (ev) => {
      this.layout.offsets[id] = [
        snap(origin.dx + ev.clientX - origin.x),
        snap(origin.dy + ev.clientY - origin.y),
      ];
      this._applyLayout();
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      this.checkOverlaps();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  _select(btn) {
    this.selected = btn.dataset.id || (btn.id === 'hud-settings' ? 'menu' : 'photoExit');
    this.editSelected.textContent = (btn.textContent || this.selected).trim().toUpperCase();
    const scale = Math.round((this.layout.sizes[this.selected] ?? 1) * 100);
    const alpha = Math.round((this.layout.alpha[this.selected] ?? 1) * 100);
    this.sizeSlider.value = String(scale);
    this.alphaSlider.value = String(alpha);
    this.sizeValue.textContent = `${scale}%`;
    this.alphaValue.textContent = `${alpha}%`;
  }

  applyPreset(name) {
    if (!PRESETS.includes(name)) return;
    this.layout.preset = name;
    this.layout.offsets = {};
    for (const btn of this.editOverlay.querySelectorAll('[data-preset]')) {
      btn.classList.toggle('active', btn.dataset.preset === name);
    }
    if (name === 'claw') {
      const rise = -(typeof window !== 'undefined' ? Math.round(window.innerHeight / 2) : 180);
      this.layout.offsets.nitro = [0, rise];
      this.layout.offsets.fire = [0, rise];
    }
    this._applyLayout();
    this.toast(`HUD PRESET: ${name.toUpperCase()}`);
  }

  _applyLayout() {
    const preset = PRESETS.includes(this.layout.preset) ? this.layout.preset : 'right';
    this.el.classList.toggle('preset-left', preset === 'left');
    for (const btn of this.buttons.values()) {
      const id = btn.dataset.id;
      const [dx = 0, dy = 0] = this.layout.offsets[id] || [0, 0];
      btn.style.setProperty('--dx', `${dx}px`);
      btn.style.setProperty('--dy', `${dy}px`);
      btn.style.setProperty('--scale', String(this.layout.sizes[id] ?? 1));
      btn.style.setProperty('--alpha', String(this.layout.alpha[id] ?? 1));
    }
    for (const id of ['menu', 'photoExit']) {
      const btn = this.el.querySelector(id === 'menu' ? '#hud-settings' : '#hud-exit-photo');
      const [dx = 0, dy = 0] = this.layout.offsets[id] || [0, 0];
      btn.style.setProperty('--dx', `${dx}px`);
      btn.style.setProperty('--dy', `${dy}px`);
      btn.style.setProperty('--scale', String(this.layout.sizes[id] ?? 1));
      btn.style.setProperty('--alpha', String(this.layout.alpha[id] ?? 1));
    }
    const [jx = 0, jy = 0] = this.layout.offsets.joystick || [0, 0];
    this.root.style.setProperty('--joy-dx', `${jx}px`);
    this.root.style.setProperty('--joy-dy', `${jy}px`);
    for (const btn of this.editOverlay.querySelectorAll('[data-steer]')) {
      btn.classList.toggle('active', btn.dataset.steer === this.layout.steering);
    }
  }

  openEdit() {
    if (this.editing) return;
    this.editing = true;
    this.el.classList.add('editing');
    this.root.dataset.editing = '1';
    this.editOverlay.classList.add('open');
    this.editOverlay.setAttribute('aria-hidden', 'false');
    this.applyPreset(this.layout.preset);
  }

  closeEdit() {
    if (!this.editing) return;
    this.editing = false;
    this.el.classList.remove('editing');
    delete this.root.dataset.editing;
    this.editOverlay.classList.remove('open');
    this.editOverlay.setAttribute('aria-hidden', 'true');
  }

  saveLayout() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout));
      return true;
    } catch {
      return false;
    }
  }
}
