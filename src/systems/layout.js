// Builds the fixed landscape zones and moves existing widgets into them.
// The game systems stay decoupled: this only rearranges DOM they already own.

const ZONES = [
  ['zone-map', 'MAP · VITALS', '#2fb6b2'],
  ['zone-time', 'CLOCK · OBJECTIVE', '#ffd9a0'],
  ['zone-status', 'MENU · CASH', '#ffa948'],
  ['zone-look', 'SWIPE LOOK', '#813dbb'],
  ['zone-stick', 'MOVE', '#f76685'],
  ['zone-actions', 'ACTIONS', '#f76685'],
  ['zone-center', 'TOASTS', '#8ff0e8'],
];

function zone(id, label, color) {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'ui-zone';
  el.dataset.zone = label;
  el.style.setProperty('--zone-color', color);
  return el;
}

export function createLayout(ui, { input, hud, minimap } = {}) {
  const byId = new Map(ZONES.map(([id, label, color]) => [id, zone(id, label, color)]));
  for (const el of byId.values()) ui.append(el);

  const map = byId.get('zone-map');
  const time = byId.get('zone-time');
  const status = byId.get('zone-status');
  const stick = byId.get('zone-stick');
  const actions = byId.get('zone-actions');
  const center = byId.get('zone-center');

  if (minimap?.wrap) map.append(minimap.wrap);
  for (const sel of ['#hud-health', '#hud-armor', '#hud-heat', '#hud-fps']) {
    const el = ui.querySelector(sel);
    if (el) map.append(el);
  }
  for (const sel of ['#hud-clock', '#hud-mission']) {
    const el = ui.querySelector(sel);
    if (el) time.append(el);
  }
  for (const sel of ['#hud-settings', '#hud-money', '#hud-stars', '#hud-weather', '#hud-signal', '#hud-radio', '#hud-mode']) {
    const el = ui.querySelector(sel);
    if (el) status.append(el);
  }
  if (input?.base?.parentElement) stick.append(input.base.parentElement);
  if (input?.right) actions.append(input.right);
  if (hud.speedo) actions.append(hud.speedo);
  for (const sel of ['#hud-toast', '#hud-arrow']) {
    const el = ui.querySelector(sel);
    if (el) center.append(el);
  }
  if (ui.querySelector('.hint')) center.append(ui.querySelector('.hint'));

  // Give the vitals a predictable stack under the circular minimap.
  const vitals = document.createElement('div');
  vitals.className = 'vitals';
  const health = ui.querySelector('#hud-health');
  const armor = ui.querySelector('#hud-armor');
  if (health) vitals.append(health);
  if (armor) vitals.append(armor);
  map.insertBefore(vitals, map.children[1] || null);

  const coarse = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
  ui.dataset.pointer = coarse ? 'coarse' : 'fine';
  if (new URLSearchParams(window.location.search || '').get('debug') === '1') {
    document.documentElement.classList.add('debug-ui');
  }

  return { zones: byId, lookZone: byId.get('zone-look'), coarse };
}
