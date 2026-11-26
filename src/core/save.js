const KEY = 'jha-city-save-v2';
const SLOT_PREFIX = 'jha-city-slot-';
export const SLOT_COUNT = 3;

const DEFAULTS = {
  money: 2500,
  missionsDone: 0,
  x: 0,
  z: 65,
  bikeUpgraded: false,
  carUpgraded: false,
  hours: 8.0,
  weather: 'auto',
  quality: 'auto',
  autoTier: null,
  showFps: true,
  dayLength: 10,
  autoAim: true,
  armor: 0,
  hp: 100,
  storyStep: 0,
  owned: [],
  completedMissions: [],
  style: { skin: 0xd9a06b, shirt: 0xf76685, hair: 0x2b1a12, pants: 0x2a3050 },
  radio: 0,
  achievements: [],
  fpsCap: 0,
  sound: true,
  vibration: true,
  steering: 'joystick',
  hudLayout: null,
  mission: null,
  vehicle: null,
  waypoint: null,
  autoSprint: false,
};

const STEERING_MODES = ['joystick', 'tilt', 'drag'];
const FPS_CAPS = [0, 30, 60];
const PRESETS = ['right', 'left', 'claw'];
const LIMIT = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));

function normalizeOffsets(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value) && value.length >= 2) {
      out[key] = [LIMIT(value[0], -4000, 4000), LIMIT(value[1], -4000, 4000)];
    }
  }
  return out;
}

function normalizeMap(raw, clamp = (v) => Number(v) || 1) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = clamp(n);
  }
  return out;
}

export function normalizeLayout(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    offsets: normalizeOffsets(value.offsets),
    sizes: normalizeMap(value.sizes, (v) => LIMIT(v, 0.5, 2)),
    alpha: normalizeMap(value.alpha, (v) => LIMIT(v, 0.2, 1)),
    preset: PRESETS.includes(value.preset) ? value.preset : 'right',
    steering: STEERING_MODES.includes(value.steering) ? value.steering : 'joystick',
  };
}

function normalizeRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : null;
}

function normalizeWaypoint(value) {
  if (!Array.isArray(value) && (!value || typeof value !== 'object')) return null;
  const x = Number(Array.isArray(value) ? value[0] : value.x);
  const z = Number(Array.isArray(value) ? value[1] : value.z);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

const normalize = (raw) => {
  const data = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULTS, ...data };
  out.money = LIMIT(out.money, 0, 99999999);
  out.missionsDone = Math.max(0, Math.round(Number(out.missionsDone) || 0));
  out.hp = LIMIT(out.hp, 0, 100);
  out.armor = LIMIT(out.armor, 0, 100);
  out.hours = LIMIT(out.hours, 0, 24);
  out.x = Number(out.x) || 0;
  out.z = Number(out.z) || 0;
  out.storyStep = Math.max(0, Math.round(Number(out.storyStep) || 0));
  out.radio = Math.max(0, Math.round(Number(out.radio) || 0));
  out.style = { ...DEFAULTS.style, ...(normalizeRecord(out.style) || {}) };
  out.owned = Array.isArray(out.owned) ? out.owned.filter((v) => v && typeof v === 'object').map((v) => ({ ...v })) : [];
  out.completedMissions = Array.isArray(out.completedMissions) ? out.completedMissions.slice() : [];
  out.achievements = Array.isArray(out.achievements) ? out.achievements.slice() : [];
  out.hudLayout = normalizeLayout(out.hudLayout);
  out.mission = normalizeRecord(out.mission);
  out.vehicle = normalizeRecord(out.vehicle);
  out.waypoint = normalizeWaypoint(out.waypoint);
  out.fpsCap = FPS_CAPS.includes(Number(out.fpsCap)) ? Number(out.fpsCap) : 0;
  out.dayLength = [5, 10, 20, 40].includes(Number(out.dayLength)) ? Number(out.dayLength) : 10;
  out.sound = out.sound !== false;
  out.vibration = out.vibration !== false;
  out.autoAim = out.autoAim !== false;
  out.showFps = out.showFps !== false;
  out.autoSprint = !!out.autoSprint;
  out.steering = STEERING_MODES.includes(out.steering) ? out.steering : 'joystick';
  return out;
};

export { normalize as normalizeSave };

let activeSlot = 1;

const slotKey = (slot) => `${SLOT_PREFIX}${slot}`;
const validSlot = (slot) => Math.max(1, Math.min(SLOT_COUNT, Math.round(Number(slot) || 1)));

function readSlot(slot) {
  try {
    const raw = localStorage.getItem(slotKey(slot)) || (slot === 1 ? localStorage.getItem(KEY) : null);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function loadSave(slot = activeSlot) {
  activeSlot = validSlot(slot);
  const data = readSlot(activeSlot) || (activeSlot === 1 ? null : readSlot(1));
  return data || normalize(null);
}

let lastSave = 0;
export function saveGame(state, force = false, slot = activeSlot) {
  const now = performance.now();
  if (!force && now - lastSave < 2000) return;
  lastSave = now;
  activeSlot = validSlot(slot);
  const json = JSON.stringify(state);
  try {
    // KEY stays as the live autosave for older installs; slots are manual copies.
    localStorage.setItem(KEY, json);
    localStorage.setItem(slotKey(activeSlot), json);
  } catch {
    /* storage disabled — game still works */
  }
}

export function saveSlot(slot, state) {
  saveGame(state, true, slot);
  return readSlot(validSlot(slot));
}

export function loadSlot(slot) {
  activeSlot = validSlot(slot);
  return loadSave(activeSlot);
}

export function listSlots() {
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const index = i + 1;
    const data = readSlot(index);
    return {
      index,
      exists: !!data,
      money: data?.money || 0,
      missionsDone: data?.missionsDone || 0,
      hours: data?.hours || 0,
      storyStep: data?.storyStep || 0,
    };
  });
}

export function deleteSlot(slot) {
  try {
    localStorage.removeItem(slotKey(validSlot(slot)));
  } catch {
    /* storage disabled */
  }
}

export function currentSlot() {
  return activeSlot;
}
