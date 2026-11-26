// JHA City HUD — rewritten from scratch to the master spec.
// One stylesheet (hud.css), six grid zones, mode-driven flex rows,
// Edit HUD with persistence and overlap checks. No per-button positioning.
// Phase 1.5: TR is one right-aligned row, weather/radio chips are retired
// (still updateable), BR owns the GUN/HOLSTER toggle, BC owns the speedo,
// first-launch hint is remembered, and verifyModes() self-checks every mode.

import { normalizeLayout } from '../core/save.js';

const LAYOUT_KEY = 'jha-city-hud-layout-v1';
const HINT_KEY = 'jha-city-look-hint-v1';
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
// GUN and HOLSTER both use 'armed' so Input.setButtonLabel('armed', label)
// can retarget whichever toggle is currently on screen.
const BUTTONS = {
  sprint: { action: 'boost', label: 'SPRINT', cls: 'sprint', hideIf: 'autoSprint' },
  gun: { action: 'armed', label: 'GUN', cls: 'gun' },
  holster: { action: 'armed', label: 'HOLSTER', cls: 'holster' },
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

// Three flex rows in BR, top to bottom. Empty rows are collapsed by setMode.
const MODE_ROWS = {
  foot: [['sprint'], [], ['gun', 'jump']],
  nearVehicle: [['sprint'], [], ['e', 'jump']],
  car: [['hornradio', 'exit', 'hb'], ['nitro'], ['brake', 'gas']],
  bike: [['hornradio', 'exit', 'hb'], ['nitro'], ['brake', 'gas']],
  armed: [['weapon'], ['reload', 'aim'], ['holster', 'fire']],
  photo: [[], [], ['snap']],
  menu: [[], [], []],
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
    return normalizeLayout(JSON.parse(raw)) || base;
  } catch {
    return base;
  }
}

export class Hud {
  constructor(root, { onAction = () => {}, onSaveLayout = () => {}, onSteering = () => {} } = {}) {
    this.root = root;
    this.onAction = onAction;
    this.onSaveLayout = onSaveLayout;
    this.onSteering = onSteering;
    this.mode = 'foot';
    this.previousMode = 'foot';
    this.nitro = 0;
    this.autoSprint = false;
    this.editing = false;
    this.selected = null;
    this._drag = null;
    this._modeBeforeEdit = null;
    this.layout = loadLayout();
    this.toastTimer = 0;
    this.damageTimer = 0;
    this.flashTimer = 0;
    this.hintTimer = 8;
    this.hintKey = HINT_KEY;
    this.overlapAt = 0;
    this.overlapCheckAt = 0;
    this.modeKey = '';
    this._spread = 0;
    this.hitTimer = 0;
    this.edgeTimer = 0;
    this._verifying = false;
    this._verifyResult = null;
    this._verifiedOnBoot = false;

    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.className = 'hud';
    this.el.dataset.mode = 'foot';
    this.el.innerHTML = `
      <div id="look-surface" aria-hidden="true"></div>
      <div class="ui-zone" id="zone-tl" data-zone="TL · MAP + VITALS"><div class="vitals" id="hud-vitals">
        <div class="hud-card" id="hud-health"><span id="hud-health-text">HP 100</span><span class="meter"><i id="hud-health-fill"></i></span></div>
        <div class="hud-card" id="hud-armor"><span id="hud-armor-text">ARMOR 0</span><span class="meter"><i id="hud-armor-fill"></i></span></div>
        <div class="hud-card hud-ammo" id="hud-ammo" hidden><span id="hud-weapon-text">PISTOL</span><span id="hud-ammo-text">12 / 60</span><span class="meter"><i id="hud-reload-fill"></i></span></div>
      </div><div class="hud-card hud-heat" id="hud-heat" hidden>SEARCHING</div><div class="hud-card hud-fps" id="hud-fps">60 FPS</div></div>
      <div class="ui-zone" id="zone-tc" data-zone="TC · CLOCK">
        <div class="hud-card" id="hud-clock">08:00</div>
        <div class="hud-card" id="hud-mission" hidden>No active job</div>
      </div>
      <div class="ui-zone" id="zone-tr" data-zone="TR · CASH + MENU">
        <div class="hud-card" id="hud-money">$0</div>
        <div class="hud-card" id="hud-stars" hidden>★★★★★</div>
        <button class="hud-card" id="hud-settings" data-action="menu" aria-label="Open city menu">≡</button>
        <button class="hud-card" id="hud-exit-photo" data-action="photoExit" aria-label="Exit photo mode" hidden>✕</button>
        <button class="hud-card hud-gun" id="hud-gun" data-action="armed" aria-label="Toggle weapon mode" hidden>GUN</button>
        <div class="hud-card hud-weather" id="hud-weather" hidden>☀ CLEAR</div>
        <div class="hud-card hud-signal" id="hud-signal" hidden>GREEN</div>
        <div class="hud-card hud-radio" id="hud-radio" hidden>♪ OFF</div>
      </div>
      <div class="ui-zone" id="zone-bl" data-zone="BL · MOVE"></div>
      <div class="ui-zone" id="zone-bc" data-zone="BC · EMPTY"><div class="hud-speedo" id="hud-speedo" hidden>
        <div class="hud-speed-ring" id="hud-speed-ring"></div>
        <div class="hud-speed-needle" id="hud-speed-needle"></div>
        <div class="hud-card hud-speed" id="hud-speed">0 <small>KM/H</small></div>
      </div></div>
      <div class="ui-zone" id="zone-br" data-zone="BR · ACTIONS"><div class="touch-right" id="touch-right"></div></div>
      <div class="hud-arrow" id="hud-arrow" hidden><div class="hud-arrow-tip" id="hud-arrow-tip"></div><div class="hud-arrow-label" id="hud-arrow-label">OBJECTIVE</div></div>
      <div class="hud-reticle" id="hud-reticle" hidden><i></i><i></i><i></i><i></i><b></b><span class="hit-mark"></span></div>
      <div class="hud-damage" id="hud-damage" hidden></div>
      <div class="hud-edge" id="hud-edge"></div>
      <div class="hud-photo-flash" id="hud-flash"></div>
      <div class="hud-toast" id="hud-toast"></div>
      <div class="hud-warning" id="hud-warning" hidden>HUD OVERLAP</div>
      <div class="hint keyboard">WASD · F FIRE · Q AIM · Z RELOAD · X WEAPON · J JOBS · G GARAGE · E ENTER · N DAY/NIGHT</div>
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
    this.gun = q('#hud-gun');
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
    this.ammo = q('#hud-ammo');
    this.weaponText = q('#hud-weapon-text');
    this.ammoText = q('#hud-ammo-text');
    this.reloadFill = q('#hud-reload-fill');
    this.reticle = q('#hud-reticle');
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
    this.edgeEl = q('#hud-edge');
    this.flashEl = q('#hud-flash');
    this.bustedEl = q('#hud-busted');
    this.bustedSub = q('#hud-busted-sub');
    this.toastEl = q('#hud-toast');
    this.warningEl = q('#hud-warning');
    this.right = q('#touch-right');
    this.editOverlay = q('#hud-edit');

    const maxRows = Math.max(...Object.values(MODE_ROWS).map((rows) => rows.length));
    this.rows = [];
    for (let i = 0; i < maxRows; i++) {
      const row = document.createElement('div');
      row.className = 'row';
      this.right.append(row);
      this.rows.push(row);
    }
    const slots = this.rows.map((row) => {
      const trio = [];
      for (let i = 0; i < 3; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.hidden = true;
        row.append(slot);
        trio.push(slot);
      }
      return trio;
    });
    this.buttons = new Map();
    this.slotOf = new Map();
    for (const [id, def] of Object.entries(BUTTONS)) {
      const btn = document.createElement('button');
      btn.className = `tbtn ${def.cls}`;
      btn.dataset.action = def.action;
      btn.dataset.id = id;
      if (def.holdAction) btn.dataset.holdAction = def.holdAction;
      btn.textContent = def.label;
      btn.setAttribute('aria-label', def.label);
      btn.hidden = true;
      // Keep every button mounted: Input discovers [data-action] once at boot,
      // so both the GUN and HOLSTER toggles must already be inside #touch-right.
      let placement = null;
      for (const rows of Object.values(MODE_ROWS)) {
        for (let r = 0; r < rows.length && !placement; r++) {
          const s = rows[r].indexOf(id);
          if (s >= 0) placement = [r, s];
        }
      }
      if (placement) {
        slots[placement[0]][placement[1]].append(btn);
        this.slotOf.set(id, `${placement[0]},${placement[1]}`);
      }
      this.buttons.set(id, btn);
    }

    this._buildEditor();
    this._applyLayout();
    this.setMode('foot');

    // First-launch hint: 8s once, then remember it forever (key stays in DOM).
    let hintSeen = false;
    try { hintSeen = localStorage.getItem(HINT_KEY) === '1'; } catch { /* no storage */ }
    if (hintSeen) this._markHintSeen();
    else this.hintTimer = 8;

    const coarse = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    root.dataset.pointer = coarse ? 'coarse' : 'fine';
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search || '').get('debug') === '1') {
      document.documentElement.classList.add('debug-ui');
    }

    // Automated JS layout check; one PASS/FAIL line per mode, once per boot.
    if (!this._verifiedOnBoot) {
      this._verifiedOnBoot = true;
      this.verifyModes();
    }
  }

  _markHintSeen() {
    this.hintTimer = 0;
    this.el.querySelectorAll('.hint').forEach((el) => el.classList.add('fade'));
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* no storage */ }
  }

  // Minimap is owned by its own system; this only places its DOM in TL.
  attachMinimap(wrap) {
    if (!wrap) return;
    this.vitals.parentNode.insertBefore(wrap, this.vitals);
  }

  setRadio(label) {
    if (!this.radio) return;
    this.radio.textContent = label;
    this.radio.hidden = true; // chip retired; state still readable by harnesses
  }

  setFps(text, { warn = false, bad = false } = {}) {
    if (!this.fps) return;
    this.fps.textContent = text;
    this.fps.classList.toggle('warn', warn);
    this.fps.classList.toggle('bad', bad);
  }

  setMode(mode, { nitro = this.nitro, autoSprint = this.autoSprint } = {}) {
    if (!MODES.includes(mode)) mode = 'foot';
    // The game loop keeps reporting "menu" while Settings is open; freezing
    // the mode keeps the draggable buttons on screen for the whole edit session.
    if (this.editing) return;
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

    const occupied = new Set();
    for (const id of Object.keys(visible)) {
      if (visible[id] && this.slotOf.has(id)) occupied.add(this.slotOf.get(id));
    }
    this.rows.forEach((row, index) => {
      const rowIds = MODE_ROWS[mode][index] || [];
      row.hidden = rowIds.length === 0 || !rowIds.some((id) => visible[id]);
      row.querySelectorAll('.slot').forEach((slot, slotIndex) => {
        // Buttons stay mounted (hidden attr when unused); only slots collapse.
        slot.hidden = !occupied.has(`${index},${slotIndex}`);
      });
    });

    // The legacy TR gun node stays in the DOM for compatibility but hidden;
    // the live GUN/HOLSTER toggle is a BR button with data-action="armed".
    if (this.gun) this.gun.textContent = mode === 'armed' ? 'HOLSTER' : 'GUN';
    this.el.classList.toggle('photo', mode === 'photo');
    this.el.classList.toggle('photo-mode', mode === 'photo');
    const exit = this.el.querySelector('#hud-exit-photo');
    if (exit) exit.hidden = mode !== 'photo';
    const settings = this.el.querySelector('#hud-settings');
    if (settings) settings.hidden = mode === 'photo'; // CSS hides it too; keeps overlap checks honest
    if (mode === 'photo') this.arrow.hidden = true;
    // Input keeps its own label overrides; let it retarget them to whichever
    // toggle is visible after a mode swap (e.g. GUN -> HOLSTER).
    if (!this._verifying && typeof window !== 'undefined' && window.CustomEvent) {
      this.el.dispatchEvent(new window.CustomEvent('jha:hudmode', {
        bubbles: true, detail: { mode },
      }));
    }
  }

  setPhoto(on) {
    if (on) this.setMode('photo');
    else this.setMode(this.previousMode || 'foot');
  }

  update(s = {}) {
    this.money.textContent = `$${Math.round(s.money || 0)}`;
    const stars = Math.max(0, Math.min(5, Math.round(s.wanted || 0)));
    this.stars.textContent = stars > 0 ? '★'.repeat(stars) + '☆'.repeat(5 - stars) : '★★★★★';
    this.stars.hidden = stars === 0; // zero wanted = no star chip at all
    this.stars.style.color = stars > 0 ? '#f76685' : '';
    const hours = Number(s.hours) || 0;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    this.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    // Weather and radio are toasted by main.js; their chips stay updated but hidden.
    if (s.weather) this.weather.textContent = s.weather;
    this.weather.hidden = true;
    if (s.signal) {
      this.signal.textContent = s.signal.label;
      this.signal.className = `hud-card hud-signal ${s.signal.tone || ''}`;
    }
    this.signal.hidden = true;
    this.mission.textContent = s.mission || '';
    this.mission.hidden = s.missionActive === false || !s.mission;
    this.healthText.textContent = `HP ${Math.round(s.hp ?? 100)}`;
    this.armorText.textContent = `ARMOR ${Math.round(s.armor || 0)}`;
    this.healthFill.style.setProperty('--fill', `${clamp100(s.hp ?? 100)}%`);
    this.armorFill.style.setProperty('--fill', `${clamp100(s.armor || 0)}%`);

    const weapon = this.mode === 'armed' ? s.weapon : null;
    this.ammo.hidden = !weapon;
    this.reticle.hidden = !weapon;
    if (weapon) {
      const label = String(weapon.label || weapon.id || 'PISTOL').toUpperCase();
      this.weaponText.textContent = label.length > 10 ? label.slice(0, 10) : label;
      this.ammoText.textContent = weapon.reloading
        ? 'RELOADING'
        : `${Math.round(weapon.mag || 0)} / ${Math.round(weapon.reserve || 0)}`;
      this.reloadFill.style.setProperty('--fill', weapon.reloading
        ? `${clamp100(100 - (weapon.reloadLeft || 0) * 65)}%`
        : '100%');
    }

    const driving = s.mode === 'car' || s.mode === 'bike';
    this.speedo.hidden = !driving;
    if (driving) {
      const kmh = Math.max(0, Math.min(220, (s.speed || 0) * 3.6));
      this.speed.innerHTML = `${Math.round(kmh)} <small>KM/H</small>`;
      // Legacy harnesses still read these; CSS keeps ring/needle invisible.
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

  // ------------------------------------------------------ crosshair feedback
  // Public: crosshair state from movement / firing, explicit spread, hit mark.
  reticleActivity(moving = false, firing = false) {
    this.reticle.classList.toggle('moving', !!moving);
    this.reticle.classList.toggle('firing', !!firing);
    this.spread((moving ? 0.35 : 0) + (firing ? 0.65 : 0));
  }

  spread(amount = 0) {
    const value = Math.max(0, Math.min(1, Number(amount) || 0));
    this._spread = value;
    this.reticle.style.setProperty('--reticle-spread', `${(value * 8).toFixed(1)}px`);
    this.reticle.dataset.spread = String(value);
    return value;
  }

  hitMarker() {
    this.reticle.classList.add('hit');
    this.hitTimer = 0.18;
  }

  // ---------------------------------------------------------------- damage UI
  edgeFlash() {
    if (!this.edgeEl) return;
    this.edgeEl.classList.add('show');
    this.edgeTimer = 0.22;
  }

  damage(strength = 1, angle = 0) {
    this.damageEl.hidden = false;
    this.damageEl.style.setProperty('--dmg-angle', `${Math.round(angle * 180 / Math.PI)}deg`);
    this.damageEl.style.opacity = String(Math.max(0.25, Math.min(1, strength)));
    this.damageTimer = 0.85;
    this.edgeFlash();
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

  toast(msg, seconds = 2) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    const n = Number(seconds);
    this.toastTimer = Number.isFinite(n) ? Math.max(0.05, n) : 2;
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
    if (this.edgeTimer > 0) {
      this.edgeTimer -= dt;
      if (this.edgeTimer <= 0) this.edgeEl.classList.remove('show');
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flashEl.classList.remove('show', 'ok', 'fail');
    }
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.reticle.classList.remove('hit');
    }
    if (this._spread > 0) this.spread(this._spread - dt * 1.8);
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this._markHintSeen();
    }
    const now = performance.now();
    if ((this.editing || document.documentElement.classList.contains('debug-ui'))
      && now - this.overlapCheckAt > 1000) {
      this.overlapCheckAt = now;
      this.checkOverlaps();
    }
  }

  // Any two visible clickable HUD elements sharing pixels is a layout bug.
  // jsdom (and stubbed harnesses) may report no rects at all — never throw.
  checkOverlaps() {
    const nodes = [...this.el.querySelectorAll('.tbtn:not([hidden]), #hud-settings:not([hidden]), #hud-exit-photo:not([hidden])')]
      .filter((el) => {
        try { return typeof el.getClientRects === 'function' && el.getClientRects().length > 0; }
        catch { return false; }
      });
    const rects = nodes.map((el) => {
      try { return typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null; }
      catch { return null; }
    });
    const positive = (r) => {
      if (!r || !Number.isFinite(r.left) || !Number.isFinite(r.right)
        || !Number.isFinite(r.top) || !Number.isFinite(r.bottom)) return false;
      return r.right - r.left > 0 && r.bottom - r.top > 0;
    };
    let count = 0;
    for (let i = 0; i < rects.length; i++) {
      if (!positive(rects[i])) continue;
      for (let j = i + 1; j < rects.length; j++) {
        if (!positive(rects[j])) continue;
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

  // ------------------------------------------------------------- JS verify
  // One console PASS/FAIL line per mode. Restores the caller's exact state.
  verifyModes() {
    if (this._verifying) return this._verifyResult === true;
    this._verifying = true;
    const saved = {
      mode: this.mode,
      previousMode: this.previousMode,
      nitro: this.nitro,
      autoSprint: this.autoSprint,
      modeKey: this.modeKey,
    };
    let allPass = true;
    for (const mode of MODES) {
      const nitro = mode === 'car' || mode === 'bike' ? 100 : 0;
      this.setMode(mode, { nitro, autoSprint: false });
      const overlap = this.checkOverlaps();
      const ids = [...this.buttons.values()].filter((b) => !b.hidden).map((b) => b.dataset.id);
      const allowed = new Set(MODE_ROWS[mode].flat());
      const unexpected = ids.filter((id) => !allowed.has(id));
      const duplicate = ids.length !== new Set(ids).size;
      const required = mode === 'car' || mode === 'bike' ? ['nitro', 'gas', 'brake', 'hb']
        : mode === 'armed' ? ['holster', 'fire', 'aim', 'reload', 'weapon']
          : mode === 'foot' ? ['sprint', 'gun', 'jump']
            : mode === 'nearVehicle' ? ['sprint', 'e', 'jump']
              : mode === 'photo' ? ['snap'] : [];
      const missing = required.filter((id) => !ids.includes(id));
      const ok = !overlap && !duplicate && unexpected.length === 0 && missing.length === 0;
      if (ok) {
        console.info(`[JHA HUD] PASS ${mode} — ${ids.length} button(s): ${ids.join(', ') || 'none'}`);
      } else {
        allPass = false;
        console.error(`[JHA HUD] FAIL ${mode} — overlap=${overlap} duplicate=${duplicate}`
          + ` unexpected=[${unexpected.join(',')}] missing=[${missing.join(',')}]`);
      }
    }
    this.modeKey = ''; // force a full DOM refresh back to the caller's mode
    this.setMode(saved.mode, { nitro: saved.nitro, autoSprint: saved.autoSprint });
    this.modeKey = saved.modeKey;
    this.previousMode = saved.previousMode;
    this._verifying = false;
    this._verifyResult = allPass;
    return allPass;
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
        this.onSteering(this.layout.steering);
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

    // The scrim is transparent to pointers now, so Escape is the reliable
    // keyboard way out (the ✕ button stays the touch way out).
    window.addEventListener('keydown', (e) => {
      if (this.editing && e.code === 'Escape') this.closeEdit();
    });

    for (const btn of [...this.buttons.values(), this.el.querySelector('#hud-settings')]) {
      btn.addEventListener('pointerdown', (e) => this._beginDrag(e, btn));
    }
  }

  _beginDrag(e, btn) {
    if (!this.editing || this._drag) return;
    // Ignore extra touches and non-primary mouse buttons: one drag at a time.
    if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // never let the HUD/camera look-drag steal this touch
    this._select(btn);
    const id = btn.dataset.id || (btn.id === 'hud-settings' ? 'menu' : 'photoExit');
    const start = this.layout.offsets[id] || [0, 0];
    const origin = { x: e.clientX, y: e.clientY, dx: start[0], dy: start[1] };
    const pointerId = e.pointerId;
    let captured = false;
    let finished = false;
    // Pointer capture keeps touch drags alive when the finger slides off the
    // small button. Captured events still bubble to window, so the listeners
    // below remain the single source of truth (and work in stub harnesses).
    if (pointerId !== undefined && typeof btn.setPointerCapture === 'function') {
      try { btn.setPointerCapture(pointerId); captured = true; } catch { captured = false; }
    }
    const samePointer = (ev) => !ev || pointerId === undefined || ev.pointerId === undefined
      || ev.pointerId === pointerId;
    const move = (ev) => {
      if (finished || !samePointer(ev)) return;
      this.layout.offsets[id] = [
        snap(origin.dx + ev.clientX - origin.x),
        snap(origin.dy + ev.clientY - origin.y),
      ];
      this._applyLayout();
    };
    const end = (ev) => {
      if (finished || !samePointer(ev)) return;
      finished = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      btn.removeEventListener('lostpointercapture', end);
      if (captured && typeof btn.releasePointerCapture === 'function') {
        try { btn.releasePointerCapture(pointerId); } catch { /* capture already gone */ }
      }
      this._drag = null;
      this.checkOverlaps();
    };
    this._drag = { id, pointerId, btn, end };
    btn.addEventListener('lostpointercapture', end);
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
    // Selecting the already-active preset must not erase hand-dragged offsets;
    // only a real preset switch starts from the preset's own layout.
    const changed = this.layout.preset !== name;
    this.layout.preset = name;
    if (changed) this.layout.offsets = {};
    if (changed && name === 'claw') {
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
    for (const btn of this.editOverlay.querySelectorAll('[data-preset]')) {
      btn.classList.toggle('active', btn.dataset.preset === preset);
    }
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
    this._modeBeforeEdit = {
      mode: this.mode, nitro: this.nitro, autoSprint: this.autoSprint,
    };
    // Settings/photo modes hide the BR buttons; show a workable drag set
    // before freezing the mode below.
    if (this.mode === 'menu' || this.mode === 'photo') {
      this.setMode('foot', { nitro: 100, autoSprint: false });
    }
    this.editing = true;
    this.el.classList.add('editing');
    this.root.dataset.editing = '1';
    this.editOverlay.classList.add('open');
    this.editOverlay.setAttribute('aria-hidden', 'false');
    // Re-apply the saved layout only: applyPreset() here used to wipe every
    // drag offset as soon as the editor opened.
    this._applyLayout();
  }

  closeEdit() {
    if (!this.editing) return;
    if (this._drag && typeof this._drag.end === 'function') this._drag.end();
    this.editing = false;
    this._drag = null;
    this.el.classList.remove('editing');
    delete this.root.dataset.editing;
    this.editOverlay.classList.remove('open');
    this.editOverlay.setAttribute('aria-hidden', 'true');
    const saved = this._modeBeforeEdit;
    this._modeBeforeEdit = null;
    if (saved) this.setMode(saved.mode, { nitro: saved.nitro, autoSprint: saved.autoSprint });
  }

  // Slot saves carry the layout too; localStorage stays as the legacy cache.
  applyLayout(layout) {
    const clean = normalizeLayout(layout);
    this.layout = clean || blankLayout();
    this._applyLayout();
    return this.layout;
  }

  saveLayout() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout));
      this.onSaveLayout(this.layout);
      return true;
    } catch {
      return false;
    }
  }
}
