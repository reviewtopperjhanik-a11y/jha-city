const KEY = 'jha-city-save-v2';

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
};

export function loadSave() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

let lastSave = 0;
export function saveGame(state, force = false) {
  const now = performance.now();
  if (!force && now - lastSave < 2000) return;
  lastSave = now;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage disabled — game still works */
  }
}
