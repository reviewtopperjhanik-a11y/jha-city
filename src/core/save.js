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
  quality: 'auto',
  autoTier: null,
  showFps: true,
  armor: 0,
  storyStep: 0,
  owned: [],
};

let activeSlot = 1;

const slotKey = (slot) => `${SLOT_PREFIX}${slot}`;
const validSlot = (slot) => Math.max(1, Math.min(SLOT_COUNT, Math.round(Number(slot) || 1)));
const normalize = (raw) => ({ ...DEFAULTS, ...(raw || {}) });

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
