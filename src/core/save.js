const KEY = 'jha-city-save-v2';

const DEFAULTS = {
  money: 2500,
  missionsDone: 0,
  x: 0,
  z: 40,
  bikeUpgraded: false,
  carUpgraded: false,
  hours: 8.0,
};

export function loadSave() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

let pending = 0;
export function saveGame(state) {
  const now = performance.now();
  if (now - pending < 2000) return;
  pending = now;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage disabled — game still works */
  }
}
