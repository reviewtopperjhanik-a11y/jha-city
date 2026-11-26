import './style.css';
import './hud.css';
import * as THREE from 'three';
import { createLook } from './look/look.js';
import { createCity } from './world/city.js';
import { Input } from './core/input.js';
import { GameAudio } from './core/audio.js';
import { createHaptics } from './core/haptics.js';
import { loadSave, saveGame, saveSlot, loadSlot, listSlots, currentSlot } from './core/save.js';
import { Player } from './entities/player.js';
import { Traffic } from './systems/traffic.js';
import { TrafficLights } from './systems/trafficlights.js';
import { Weather } from './systems/weather.js';
import { Menu } from './systems/menu.js';
import { Economy, PRICES, PAINT_COLORS } from './systems/economy.js';
import { Police } from './systems/police.js';
import { Wanted } from './systems/wanted.js';
import { Missions } from './systems/missions.js';
import { MISSION_DATA, storyCount as STORY_COUNT } from './data/missions.js';
import { MissionOverlay } from './systems/missionOverlay.js';
import { SteeringMode } from './systems/steering.js';
import { Hud } from './systems/hud.js';
import { Minimap } from './systems/minimap.js';
import { Settings } from './systems/settings.js';
import { Achievements } from './systems/achievements.js';
import { PhotoMode } from './systems/photo.js';
import { Combat } from './systems/combat.js';
import { Gangs } from './systems/gangs.js';
import { cycleStyle, randomStyle } from './look/wardrobe.js';
import { screenMarker } from './util/screen.js';
import { angleLerp, dist2, wrapAngle } from './util/math.js';

const canvas = document.getElementById('game');
const ui = document.getElementById('ui');
const boot = document.getElementById('boot');
const fatal = document.getElementById('fatal');
const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || 'ontouchstart' in window;

function showFatal(error) {
  const detail = error?.stack || error?.message || String(error || 'Unknown error');
  fatal.textContent = `JHA City hit a problem:\n${detail}`;
  fatal.classList.add('show');
}
window.addEventListener('error', (e) => {
  if (e.error || e.message) showFatal(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showFatal('Graphics context was lost. Restart JHA City.');
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 2200);
renderer.setSize(window.innerWidth, window.innerHeight);

const look = createLook(scene, camera, renderer, { bloomEnabled: true, dpr: isMobile ? 1.5 : 2 });
look.resize(window.innerWidth, window.innerHeight);

const world = createCity(scene, look);
const save = loadSave();
save.activeSlot = currentSlot();
// One full day takes `dayLength` minutes (5/10/20/40 in Settings). The clock
// advances incrementally so changing the length never makes time jump.
let clockHours = save.hours;
const currentHours = () => clockHours;
const audio = new GameAudio();
audio.setEnabled(save.sound !== false);
const haptics = createHaptics({ enabled: save.vibration !== false });
// One bridge keeps shot feedback in sync without touching combat's pooled FX.
const playShot = audio.shot.bind(audio);
audio.shot = (id, ...rest) => {
  const result = playShot(id, ...rest);
  haptics.shot(id);
  return result;
};
const steering = new SteeringMode(save.steering);
const hud = new Hud(ui, {
  onSaveLayout: (layout) => {
    save.hudLayout = layout;
    saveGame(save, true);
  },
  onSteering: (mode) => syncSteeringFromHud(mode),
});
if (save.hudLayout) hud.applyLayout(save.hudLayout);
const input = new Input(ui);
// One adapter feeds every consumer (foot movement and drivingInput). In
// joystick mode this is a pure pass-through, so tactile controls stay intact.
const rawAxis = input.axis.bind(input);
input.axis = () => steering.axisFor(rawAxis(), null);
steering.bindSurface(hud.lookZone);
const achievements = new Achievements(save, { toast: (msg) => hud.toast(msg) });
const photo = new PhotoMode(camera, canvas, {
  hud,
  onCapture: (ok) => { if (ok) achievements.event('shutter'); },
});
audio.setRadio(save.radio || 0);
hud.setRadio(audio.radioLabel());
const menu = new Menu(ui, { toast: (msg) => hud.toast(msg) });
const missionOverlay = new MissionOverlay(ui, { toast: (msg) => hud.toast(msg) });
// Weather is built before settings so the quality callback can disable it on LOW.
const weather = new Weather(scene, look, world, {
  change: (label) => hud.toast(`WEATHER: ${label}`),
});
weather.setMode(save.weather || 'auto');
const qualityListeners = [];
const settings = new Settings(ui, look, save, {
  isMobile,
  toast: (msg) => hud.toast(msg),
  onSaveSlot: (slot) => { save.activeSlot = slot; menu.close(); },
  onLoadSlot: (slot, state) => applySlotState(slot, state),
  onLook: () => openWardrobe(),
  onEditHud: () => hud.openEdit(),
  onQuality: (preset) => {
    const low = preset.key === 'low';
    weather.setLowQuality(low);
    for (const listener of qualityListeners) listener(low);
  },
  onFpsCap: (cap) => { save.fpsCap = cap; },
  onSound: (on) => audio.setEnabled(on),
  onVibration: (on) => haptics.setEnabled(on),
  onSteering: (mode) => applySteeringMode(mode),
});
const minimap = new Minimap(ui, { toast: (msg) => hud.toast(msg) });
hud.attachMinimap(minimap.wrap);
const initialSpawn = world.nearestRoad(save.x ?? 0, save.z ?? 65);
const player = new Player(scene, look, initialSpawn.x, initialSpawn.z, save.armor);
player.applyStyle(save.style);
player.onNotice = (msg) => hud.toast(msg);
const economy = new Economy(scene, look, world, {
  toast: (msg) => hud.toast(msg),
  pickup: (kind, amount) => {
    if (kind === 'health') {
      player.heal(amount);
      hud.toast(`+${amount} HP`);
    } else {
      player.addArmor(amount);
      hud.toast(`+${amount} ARMOR`);
    }
    audio.blip(660, 0.12, 'sine', 0.07);
  },
});

const wanted = new Wanted();
const police = new Police(scene, look, world, {
  onBusted: () => beginBusted(),
  toast: (msg) => hud.toast(msg),
});
const lights = new TrafficLights(scene, look, world);
const traffic = new Traffic(scene, look, world, {
  crime: (kind) => {
    wanted.crime(1, gameTime, player.pos.x, player.pos.z);
    hud.toast(kind === 'ped' ? 'WITNESS CALLED THE COPS!' : 'RECKLESS DRIVING!');
  },
  accident: () => {
    audio.blip(92, 0.32, 'sawtooth', 0.11);
    haptics.collision(0.7);
    hud.toast('ACCIDENT — CROWD GATHERING');
  },
  lights,
  weather,
});
// Phase 4: armed mode, weapons and enemies. The combat system owns its own
// pooled effects; all gameplay systems stay decoupled through this one bridge.
const gangs = new Gangs(scene, look, world, { toast: (msg) => hud.toast(msg) });
const combat = new Combat({
  scene, look, world, player, police, traffic, wanted, audio, gangs,
  toast: (msg) => hud.toast(msg),
});
combat.setAutoAim(save.autoAim !== false);
combat.setArmed(false); // tap GUN (or F/Q on desktop) to draw the weapon
qualityListeners.push((low) => {
  traffic.setLowQuality?.(low);
  police.setLowQuality?.(low);
  gangs.setLowQuality?.(low);
  combat.setLowQuality?.(low);
});
settings._apply();

const missions = new Missions(scene, world, {
  reward: (amount) => {
    save.money += amount;
    save.missionsDone += 1;
  },
  toast: (msg) => hud.toast(msg),
  dialog: (speaker, lines, done) => missionOverlay.dialog(speaker, lines, done),
  story: (step) => {
    save.storyStep = step;
    saveGame(save, true);
  },
  storyStep: save.storyStep,
  data: MISSION_DATA,
  pass: (info) => missionOverlay.showPass(info),
  fail: (info) => {
    missionOverlay.showFail(info);
    haptics.impact('HEAVY');
  },
}, look, traffic);
missions.restoreProgress?.(save.mission || null);

wanted.onChange = (stars, before) => {
  if (stars === 0) hud.toast('YOU LOST THEM');
  else if (stars === 5) hud.toast('MAXIMUM WANTED — ALL UNITS');
  else if (stars === 4) hud.toast('4 STAR WANTED — AIR UNIT INBOUND');
  else if (stars > before) hud.toast(`${stars} STAR WANTED`);
  else hud.toast(`WANTED DOWN TO ${stars}`);
};

// Resume the saved ride when possible; E puts you on foot, E again carjacks
// the nearest car. Fresh saves still start on a bike.
restoreCurrentVehicle();

let gameTime = 0;
let cameraYaw = player.heading;
let camIndex = 0;
const camDistances = [8.5, 11, 14];
let frameCount = 0;
let booted = false;
let lookHold = 0;

const camDesired = new THREE.Vector3();
const camLook = new THREE.Vector3();
const lookNow = new THREE.Vector3();
const camFrom = new THREE.Vector3();
const camTarget = new THREE.Vector3();

// Frame state objects are written in place; the render loop must not churn GC.
const audioFrame = {
  speed: 0, throttle: 0, wanted: 0, driving: false, time: 0,
  siren: 0, sirenPan: 0, heli: 0, rain: 0, skid: 0,
};
const hudFrame = {
  money: 0, wanted: 0, hours: 0, mission: '', missionActive: false, hp: 100,
  armor: 0, speed: 0, mode: 'foot', heat: null, weather: '', signal: null,
};
const achievementFrame = {
  player, hours: 0, wanted: 0, weather: 0, missionsDone: 0, storyStep: 0,
};
const mapOptions = { landmarks: world.landmarks, incidents: [] };
const markerResult = {};

function applySteeringMode(mode) {
  const next = ['joystick', 'tilt', 'drag'].includes(mode) ? mode : 'joystick';
  save.steering = next;
  if (save.hudLayout && typeof save.hudLayout === 'object') save.hudLayout.steering = next;
  if (hud?.layout) {
    hud.layout.steering = next;
    hud._applyLayout();
  }
  steering.setMode(next);
  return next;
}

function syncSteeringFromHud(mode) {
  // The HUD editor and Settings panel share one source of truth.
  if (typeof settings !== 'undefined' && settings && settings.steering !== mode) {
    settings.steering = mode;
    settings._apply();
    return;
  }
  applySteeringMode(mode);
}

function restoreCurrentVehicle() {
  const d = save.vehicle;
  const candidates = traffic.vehicles.filter((v) => v && v.role !== 'police' && v.role !== 'wrecked');
  let v = null;
  if (d && d.type) {
    v = candidates.find((c) => c.type === d.type && (d.color == null || c.color === d.color)) || null;
  }
  if (!v) v = candidates.find((c) => c.type === 'bike') || null;
  if (!v) return;
  if (d?.upgrades) v.applyUpgrades?.(d.upgrades);
  if (Number.isFinite(d?.health)) v.health = Math.max(1, Math.min(v.maxHealth || 100, d.health));
  if (Number.isFinite(d?.boost)) v.boost = Math.max(0, Math.min(100, d.boost));
  player.setVehicle(v);
}

function currentVehicleDescriptor() {
  const v = player.vehicle;
  if (!v || v.role === 'wrecked') return null;
  return {
    type: v.type,
    color: v.color,
    health: v.health,
    boost: v.boost,
    upgrades: { ...v.upgrades, color: v.color },
  };
}

function collectSaveState() {
  save.x = player.pos.x;
  save.z = player.pos.z;
  save.hours = currentHours();
  save.hp = player.hp;
  save.armor = player.armor;
  save.mission = missions.serialize?.() || null;
  save.vehicle = currentVehicleDescriptor();
  save.hudLayout = hud.layout;
  save.waypoint = minimap.waypoint ? { x: minimap.waypoint.x, z: minimap.waypoint.z } : null;
  return save;
}

function flushSave() {
  collectSaveState();
  saveGame(save, true);
}

window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});

function setAudioFrame(speed, throttle, wanted, driving, time, siren, sirenPan, heli, rain, skid = 0) {
  audioFrame.speed = speed;
  audioFrame.throttle = throttle;
  audioFrame.wanted = wanted;
  audioFrame.driving = driving;
  audioFrame.time = time;
  audioFrame.siren = siren;
  audioFrame.sirenPan = sirenPan;
  audioFrame.heli = heli;
  audioFrame.rain = rain;
  audioFrame.skid = skid;
  return audioFrame;
}

function snapCamera() {
  cameraYaw = player.heading;
  const dist = camDistances[camIndex];
  camera.position.set(
    player.pos.x - Math.sin(cameraYaw) * dist,
    player.pos.y + (player.mode === 'car' ? 4.8 : player.mode === 'bike' ? 3.6 : 3.1),
    player.pos.z - Math.cos(cameraYaw) * dist,
  );
  camLook.set(player.pos.x, player.pos.y + 1.5, player.pos.z);
  camera.lookAt(camLook);
}
snapCamera();

function unlockAudio() {
  audio.unlock();
}
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// Dragging the right half of the screen orbits the chase camera. The canvas
// keeps the same behaviour for mouse users on the uncovered left half.
let dragging = false;
let dragPointer = null;
let lastX = 0;
let lastY = 0;
let dragMoved = 0;
function beginLookDrag(e, surface) {
  if (dragPointer !== null) return;
  e.preventDefault();
  dragging = true;
  dragPointer = e.pointerId;
  dragMoved = 0;
  lastX = e.clientX;
  lastY = e.clientY;
  surface.setPointerCapture?.(e.pointerId);
}
function moveLookDrag(e) {
  if (!dragging || e.pointerId !== dragPointer) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  dragMoved += Math.hypot(dx, dy);
  if (photo.active) photo.orbit(dx, dy);
  // Drag right looks right: subtracting keeps the world moving left on screen.
  else cameraYaw -= dx * 0.006;
  lastX = e.clientX;
  lastY = e.clientY;
  lookHold = 1.5;
}
function endLookDrag(e) {
  if (!dragging || (e && e.pointerId !== dragPointer)) return;
  if (photo.active && dragMoved < 8 && photo.requestCapture()) hud.toast('SNAP!');
  dragging = false;
  dragPointer = null;
}
for (const surface of [canvas, hud.lookZone]) {
  surface?.addEventListener('pointerdown', (e) => beginLookDrag(e, surface));
  surface?.addEventListener('pointermove', moveLookDrag);
  surface?.addEventListener('pointerup', endLookDrag);
  surface?.addEventListener('pointercancel', endLookDrag);
}
canvas.addEventListener('wheel', (e) => {
  if (!photo.active) return;
  e.preventDefault();
  photo.zoom(Math.sign(e.deltaY) * 1.5);
}, { passive: false });

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  look.resize(w, h);
}
window.addEventListener('resize', resize);

function openWardrobe() {
  menu.showWardrobe(
    () => save.style,
    (key, delta) => {
      save.style = cycleStyle(save.style, key, delta);
      player.applyStyle(save.style);
      achievements.event('makeover');
      saveGame(save, true);
    },
    () => {
      save.style = randomStyle();
      player.applyStyle(save.style);
      achievements.event('makeover');
      saveGame(save, true);
    },
    () => hud.toast('LOOK SAVED'),
  );
}

const QUALITY_MODES = ['auto', 'high', 'medium', 'low'];

function cycleWeather() {
  save.weather = weather.cycle();
  hud.toast(`WEATHER: ${weather.labelForTarget(weather.target)}`);
  saveGame(save, true);
}

function nextRadio() {
  audio.radioNext();
  save.radio = audio.radioIndex;
  hud.setRadio(audio.radioLabel());
  hud.toast(`RADIO: ${audio.radioStation.label}`);
  saveGame(save, true);
}

function openQuickMenu() {
  menu.showQuick([
    { key: 'jobs', label: 'JOBS', sub: 'Job board and story', run: () => menu.showJobs(
      missions,
      (type) => missions.start(type, player),
      () => missions.startStory(player),
    ) },
    { key: 'shop', label: 'SHOP', sub: 'Nearest business', run: () => {
      const loc = economy.nearest(player.pos);
      if (loc) openBusinessMenu(loc);
      else hud.toast('NO BUSINESS NEARBY — SEE THE MAP');
    } },
    { key: 'photo', label: 'PHOTO', sub: 'Free camera', run: () => {
      photo.enter(player, cameraYaw);
      hud.toast('PHOTO MODE · DRAG TO ORBIT · TAP SNAP · TAP ✕ TO EXIT');
    } },
    { key: 'wx', label: 'WX', sub: `Now: ${weather.label()}`, run: cycleWeather },
    { key: 'radio', label: 'RADIO', sub: audio.radioLabel(), run: nextRadio },
    { key: 'quality', label: 'QUALITY', sub: `Now: ${settings.mode.toUpperCase()} · ${settings._preset().label}`, run: () => {
      const next = QUALITY_MODES[(QUALITY_MODES.indexOf(settings.mode) + 1) % QUALITY_MODES.length];
      settings.setMode(next);
      hud.toast(`QUALITY: ${next.toUpperCase()}`);
    } },
    { key: 'settings', label: 'SETTINGS', sub: 'Graphics, look and saves', run: () => settings.open() },
  ]);
}
function handleActions() {
  if (input.consume('menu')) openQuickMenu();
  // Photo mode takes over the action buttons: SNAP captures, ✕ exits.
  if (photo.active) {
    if (input.consume('photoExit') || input.consume('photo')) {
      photo.exit();
      hud.toast('PHOTO MODE OFF');
    } else if (input.consume('snap') || input.consume('e') || input.consume('horn')) {
      if (photo.requestCapture()) hud.toast('SNAP!');
    }
    return;
  }
  if (!player.vehicle) {
    if (input.consume('armed')) {
      combat.setArmed(!combat.isArmed());
      hud.toast(combat.isArmed() ? `WEAPON DRAWN · ${combat.state().label}` : 'WEAPON HOLSTERED');
    }
    if (input.isDown('fire') || input.isDown('aim')) combat.setArmed(true);
    if (input.consume('weapon')) hud.toast(combat.cycleWeapon().label);
    if (input.consume('reload')) combat.reload();
  }
  if (input.consume('e')) {
    if (player.vehicle) {
      if (Math.abs(player.vehicle.speed) > 8) {
        hud.toast('SLOW DOWN TO GET OUT');
      } else {
        player.exitVehicle(world);
        hud.toast('ON FOOT');
      }
    } else {
      const v = traffic.nearestVehicle(player.pos);
      if (v) {
        player.setVehicle(v);
        hud.toast(v.type === 'bike' ? 'ON THE BIKE' : 'IN THE CAR');
      } else {
        hud.toast('NO VEHICLE NEARBY');
      }
    }
  }
  if (input.consume('mission')) missions.start('delivery', player);
  if (input.consume('race')) missions.start('race', player);
  if (input.consume('taxi')) missions.start('taxi', player);
  if (input.consume('jobs')) {
    menu.showJobs(
      missions,
      (type) => missions.start(type, player),
      () => missions.startStory(player),
    );
    return;
  }
  if (input.consume('shop')) {
    const loc = economy.nearest(player.pos);
    if (loc) openBusinessMenu(loc);
    else hud.toast('NO BUSINESS NEARBY — SEE THE MAP');
    return;
  }
  if (input.consume('horn')) {
    audio.horn();
    traffic.onHorn(player.pos);
  }
  if (input.consume('weather')) cycleWeather();
  if (input.consume('radio')) nextRadio();
  if (input.consume('photo')) {
    photo.enter(player, cameraYaw);
    hud.toast('PHOTO MODE · DRAG TO ORBIT · TAP SNAP · TAP ✕ TO EXIT');
  }
  if (input.consume('look')) {
    openWardrobe();
    return;
  }
  if (input.consume('bribe')) {
    if (wanted.stars > 0 && save.money >= 500) {
      save.money -= 500;
      wanted.clear(true);
      police.clearAll();
      hud.toast('BRIBE PAID — $500');
    } else if (wanted.stars > 0) {
      hud.toast('NOT ENOUGH CASH');
    }
  }
  if (input.consume('cam')) {
    camIndex = (camIndex + 1) % camDistances.length;
    hud.toast(`CAMERA ${camIndex + 1}`);
  }
  if (input.consume('time')) {
    const h = currentHours();
    const night = h >= 7 && h < 19;
    clockHours = night ? 23 : 12;
    hud.toast(night ? 'NIGHT MODE' : 'DAY MODE');
  }
}

function spend(cost) {
  if (save.money < cost) {
    hud.toast('NOT ENOUGH CASH');
    return false;
  }
  save.money -= cost;
  return true;
}

function ownedDescriptor(v) {
  const list = save.owned || [];
  return list.find((d) => d.type === v.type && d.color === v.color)
    || list.find((d) => d.type === v.type)
    || null;
}

function rememberVehicle(v) {
  if (!v) return;
  save.owned = save.owned || [];
  let d = ownedDescriptor(v);
  if (!d) {
    d = economy.serialize(v, PRICES[v.type]);
    save.owned.push(d);
  } else {
    Object.assign(d, economy.serialize(v, d.price));
  }
}

function openBusinessMenu(loc) {
  if (loc.key === 'garage') menu.showGarage(save, save.owned || [], handleGarage);
  else if (loc.key === 'shop') menu.showShop(save, handleShop);
  else menu.showSafehouse({ ...save, hp: player.hp, armor: player.armor, activeSlot: currentSlot() }, listSlots(), handleSafehouse);
}

function handleGarage(action) {
  if (action === 'buy-bike' || action === 'buy-car') {
    const type = action === 'buy-bike' ? 'bike' : 'car';
    const price = PRICES[type];
    if (!spend(price)) return;
    const color = PAINT_COLORS[type === 'bike' ? 0 : 1];
    save.owned = save.owned || [];
    achievements.event('collector');
    const v = economy.spawnVehicle(type, color, {});
    save.owned.push(economy.serialize(v, price));
    player.setVehicle(v);
    hud.toast(`${type === 'bike' ? 'BIKE' : 'COUPE'} BOUGHT — ${v.type.toUpperCase()}`);
    saveGame(save, true);
    return;
  }
  if (action === 'drive') {
    const descriptor = (save.owned || []).slice(-1)[0];
    if (!descriptor) {
      hud.toast('BUY A VEHICLE FIRST');
      return;
    }
    if (player.vehicle) player.exitVehicle(world);
    economy.restore(save.owned || []);
    const spawned = economy.ownedVehicles.find((v) => v.type === descriptor.type && v.color === descriptor.color)
      || economy.ownedVehicles[0];
    if (spawned) player.setVehicle(spawned);
    hud.toast('OWNED VEHICLE READY');
    saveGame(save, true);
    return;
  }
  if (action === 'spray') {
    if (wanted.stars <= 0) {
      hud.toast('NO HEAT TO CLEAR');
      return;
    }
    if (!spend(750)) return;
    wanted.clear(true);
    police.clearAll();
    gangs.clearAll();
    combat.reset();
    if (player.vehicle) player.vehicle.setColor(economy.nextPaint(player.vehicle.color));
    hud.toast('HEAT CLEARED — $750');
    saveGame(save, true);
    return;
  }
  const v = player.vehicle;
  if (!v || v.role === 'police') {
    hud.toast('DRIVE YOUR OWN VEHICLE FIRST');
    return;
  }
  if (action === 'paint') {
    if (!spend(PRICES.paint)) return;
    v.setColor(economy.nextPaint(v.color));
    rememberVehicle(v);
    hud.toast('FRESH PAINT');
  } else {
    const key = action === 'engine' ? 'engine' : action === 'handling' ? 'handling' : 'armor';
    if (v.upgrades[key]) {
      hud.toast('ALREADY INSTALLED');
      return;
    }
    if (!spend(PRICES[key])) return;
    economy.upgrade(v, key);
    rememberVehicle(v);
    hud.toast(key === 'handling' ? 'SPORT SUSPENSION FITTED'
      : key === 'engine' ? 'ENGINE TUNED' : 'BODY REINFORCED');
  }
  saveGame(save, true);
}

function handleShop(action) {
  if (action === 'health') {
    if (!spend(PRICES.health)) return;
    player.heal(35);
    hud.toast('+35 HP');
  } else {
    if (!spend(PRICES.armor)) return;
    player.addArmor(40);
    hud.toast('+40 ARMOR');
  }
  audio.blip(660, 0.12, 'sine', 0.07);
  saveGame(save, true);
}

function handleSafehouse(action) {
  if (action === 'rest') {
    player.hp = 100;
    player.armor = Math.min(100, player.armor + 15);
    hud.toast('RESTED — FULL HEALTH');
  } else if (action.startsWith('save-')) {
    const slot = Number(action.slice(5));
    flushSave();
    saveSlot(slot, { ...save, hp: player.hp, armor: player.armor });
    save.activeSlot = slot;
    settings._renderSlots?.();
    hud.toast(`SLOT ${slot} SAVED`);
  } else if (action.startsWith('load-')) {
    const slot = Number(action.slice(5));
    const state = loadSlot(slot);
    if (!state) {
      hud.toast('SLOT IS EMPTY');
      return;
    }
    applySlotState(slot, state);
    return;
  }
  saveGame(save, true);
}

function applySlotState(slot, state) {
  Object.assign(save, state);
  save.activeSlot = slot;
  menu.close();
  missionOverlay.hide();
  photo.exit();
  if (player.vehicle) player.exitVehicle(world);
  wanted.clear(true);
  police.clearAll();
  gangs.clearAll();
  combat.reset();
  economy.restore(save.owned || []);
  player.hp = Number.isFinite(save.hp) ? save.hp : 100;
  player.armor = save.armor || 0;
  const spawn = world.nearestRoad(save.x ?? 0, save.z ?? 65);
  player.respawnAt(spawn.x, spawn.z, 0);
  clockHours = save.hours || 8;
  gameTime = 0;
  missions.restoreProgress?.(save.mission || null);
  missions.storyStep = save.storyStep || 0;
  minimap.waypoint = save.waypoint ? { x: save.waypoint.x, z: save.waypoint.z } : null;
  minimap._updateWaypointUI?.();
  if (save.hudLayout) hud.applyLayout(save.hudLayout);
  settings.syncFromSave();
  combat.setAutoAim(settings.autoAim);
  weather.setMode(save.weather || 'auto');
  player.applyStyle(save.style);
  restoreCurrentVehicle();
  audio.setRadio(save.radio || 0);
  hud.setRadio(audio.radioLabel());
  achievements.unlocked = new Set(Array.isArray(save.achievements) ? save.achievements : []);
  settings._renderSlots?.();
  snapCamera();
  hud.toast(`SLOT ${slot} LOADED`);
  flushSave();
  saveGame(save, true, slot);
}

// Fraction along from->to where an oriented vehicle box begins (1 = clear).
// Vehicles are small and numerous, so this stays allocation-free.
function vehicleRay(from, to, v) {
  // The camera rides with the player's vehicle; its focus point is inside it.
  if (v === player.vehicle || v.role === 'wrecked') return 1;
  const bike = v.type === 'bike';
  const hx = (bike ? 0.8 : 1.45) + 0.5;
  const hz = (bike ? 1.6 : 2.6) + 0.5;
  const hy = (bike ? 2.5 : 2.2) + 0.3;
  const cos = Math.cos(v.heading);
  const sin = Math.sin(v.heading);
  const ox = from.x - v.pos.x;
  const oz = from.z - v.pos.z;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  let tmin = 0;
  let tmax = 1;
  let t1;
  let t2;
  let lo;
  let hi;

  // Local X side.
  const oxl = ox * cos - oz * sin;
  const dxl = dx * cos - dz * sin;
  if (Math.abs(dxl) < 0.00001) {
    if (oxl < -hx || oxl > hx) return 1;
  } else {
    t1 = (-hx - oxl) / dxl;
    t2 = (hx - oxl) / dxl;
    lo = Math.min(t1, t2);
    hi = Math.max(t1, t2);
    tmin = Math.max(tmin, lo);
    tmax = Math.min(tmax, hi);
    if (tmin > tmax) return 1;
  }

  // Height, measured from the road surface.
  if (Math.abs(to.y - from.y) < 0.00001) {
    if (from.y < -0.2 || from.y > hy) return 1;
  } else {
    t1 = (-0.2 - from.y) / (to.y - from.y);
    t2 = (hy - from.y) / (to.y - from.y);
    lo = Math.min(t1, t2);
    hi = Math.max(t1, t2);
    tmin = Math.max(tmin, lo);
    tmax = Math.min(tmax, hi);
    if (tmin > tmax) return 1;
  }

  // Local Z (forward) side.
  const ozl = ox * sin + oz * cos;
  const dzl = dx * sin + dz * cos;
  if (Math.abs(dzl) < 0.00001) {
    if (ozl < -hz || ozl > hz) return 1;
  } else {
    t1 = (-hz - ozl) / dzl;
    t2 = (hz - ozl) / dzl;
    lo = Math.min(t1, t2);
    hi = Math.max(t1, t2);
    tmin = Math.max(tmin, lo);
    tmax = Math.min(tmax, hi);
    if (tmin > tmax) return 1;
  }
  return Math.max(0, tmin);
}

function clearCameraFraction(from, target) {
  let fraction = world.cameraRay(from, target, 0.6);
  for (const v of traffic.vehicles) fraction = Math.min(fraction, vehicleRay(from, target, v));
  for (const v of police.cars) fraction = Math.min(fraction, vehicleRay(from, target, v));
  for (const v of economy.ownedVehicles) fraction = Math.min(fraction, vehicleRay(from, target, v));
  return fraction;
}
// Free camera obeys the same building/vehicle ray as the chase camera.
photo.raycast = (from, to) => clearCameraFraction(from, to);

function updateCamera(dt, world) {
  lookHold = Math.max(0, lookHold - dt);
  if (lookHold <= 0) {
    const follow = player.vehicle ? 2.8 : 5.2;
    cameraYaw = wrapAngle(angleLerp(cameraYaw, player.heading, 1 - Math.exp(-follow * dt)));
  }
  const baseDist = camDistances[camIndex];
  const dist = baseDist + (player.vehicle ? Math.min(2.4, player.speed * 0.06) : 0);
  const height = player.mode === 'car' ? 4.8 : player.mode === 'bike' ? 3.6 : 3.1;
  const dx = -Math.sin(cameraYaw);
  const dz = -Math.cos(cameraYaw);

  // Ray/segment collision against building bounds and other vehicles. The
  // camera is never allowed to end up inside either, even during smooth follow.
  camFrom.set(player.pos.x, player.pos.y + 1.5, player.pos.z);
  camTarget.set(
    player.pos.x + dx * dist,
    player.pos.y + height,
    player.pos.z + dz * dist,
  );
  const fraction = Math.max(2 / dist, clearCameraFraction(camFrom, camTarget));
  camDesired.copy(camFrom).lerp(camTarget, fraction);
  camera.position.lerp(camDesired, 1 - Math.exp(-(player.vehicle ? 7 : 9) * dt));
  const actual = clearCameraFraction(camFrom, camera.position);
  if (actual < 1) camera.position.lerpVectors(camFrom, camera.position, Math.max(0.04, actual));
  lookNow.set(player.pos.x, player.pos.y + 1.5, player.pos.z);
  camLook.lerp(lookNow, 1 - Math.exp(-12 * dt));
  camera.lookAt(camLook);
}

function respawn() {
  const v = player.vehicle;
  if (v) {
    player.exitVehicle(world);
    v.health = 100;
    v.speed = 0;
  }
  wanted.clear(true);
  police.clearAll();
  gangs.clearAll();
  combat.reset();
  const spawn = world.nearestRoad(0, 65);
  player.respawnAt(spawn.x, spawn.z, 0);
  player.armor = Math.floor(player.armor / 2);
  save.x = spawn.x;
  save.z = spawn.z;
  snapCamera();
  hud.toast('WASTED — BACK ON THE STREET');
}

let busted = false;
let bustTimer = 0;
let bustRelease = null;

function beginBusted() {
  if (busted) return;
  menu.close();
  busted = true;
  bustTimer = 3.6;
  bustRelease = 'DOWNTOWN PRECINCT';
  const stars = Math.max(1, wanted.stars);
  const fine = Math.min(Math.max(0, save.money), 120 + stars * 260);
  save.money = Math.max(0, save.money - fine);
  const v = player.vehicle;
  if (v) {
    player.exitVehicle(world);
    v.speed = 0;
  }
  wanted.clear(true);
  police.clearAll();
  gangs.clearAll();
  combat.reset();
  hud.showBusted(`FINE $${fine}  ·  ${bustRelease}`);
  audio.blip(196, 0.5, 'square', 0.14);
  audio.blip(146, 0.55, 'sawtooth', 0.1);
  saveGame(save, true);
}

function finishBusted() {
  busted = false;
  hud.hideBusted();
  const spawn = world.nearestRoad(-130, 0);
  player.respawnAt(spawn.x, spawn.z, 0);
  save.x = spawn.x;
  save.z = spawn.z;
  snapCamera();
  hud.toast('RELEASED — STAY CLEAN');
  saveGame(save, true);
}

function renderFrame() {
  look.render();
  if (photo.pendingCapture) photo.capture();
}

let threatX = 0;
let threatZ = 0;
let threatDist = Infinity;
function noteThreat(p) {
  const d = dist2(p.x, p.z, player.pos.x, player.pos.z);
  if (d < threatDist) {
    threatDist = d;
    threatX = p.x;
    threatZ = p.z;
  }
}
function threatAngle() {
  threatDist = Infinity;
  for (const v of police.cars) noteThreat(v.pos);
  for (const o of police.officers) noteThreat(o.pos);
  for (const t of combat.threats()) noteThreat(t);
  for (const v of traffic.vehicles) if (v !== player.vehicle) noteThreat(v.pos);
  if (threatDist > 60 ** 2) return Math.random() * Math.PI * 2;
  const dx = threatX - player.pos.x;
  const dz = threatZ - player.pos.z;
  // Screen-right is world -x for the chase camera.
  return Math.atan2(-dx * Math.cos(cameraYaw) + dz * Math.sin(cameraYaw), dx * Math.sin(cameraYaw) + dz * Math.cos(cameraYaw));
}
player.onDamage = (amount) => {
  hud.damage(Math.min(1, amount / 18), threatAngle());
  haptics.hit();
};

let last = performance.now();
let lastDraw = last;
function frame(now) {
  requestAnimationFrame(frame);
  if (settings.fpsCap && now - lastDraw < 1000 / settings.fpsCap - 1) return;
  lastDraw = now;
  const rawDt = Math.max(0.0001, (now - last) / 1000);
  const dt = Math.min(0.05, Math.max(0.001, rawDt));
  last = now;
  gameTime += dt;
  clockHours = (clockHours + dt * (24 / (Math.max(1, save.dayLength || 10) * 60))) % 24;
  input.poll();
  const overlayOpen = missionOverlay.isOpen;
  if ((menu.isOpen || overlayOpen) && photo.active) photo.exit();
  // One mode drives both the button set and the input context. The joystick
  // stays available in every situation; the bottom-centre zone stays empty.
  const nearVehicle = !player.vehicle && !!traffic.nearestVehicle(player.pos);
  const armed = !player.vehicle && !photo.active && !menu.isOpen && !settings.isOpen && !overlayOpen && combat.isArmed();
  const hudMode = photo.active ? 'photo'
    : (menu.isOpen || settings.isOpen || overlayOpen) ? 'menu'
      : player.vehicle ? (player.vehicle.type === 'bike' ? 'bike' : 'car')
        : armed ? 'armed'
          : nearVehicle ? 'nearVehicle' : 'foot';
  input.setContext(hudMode);
  hud.setMode(hudMode, {
    nitro: player.vehicle ? player.vehicle.boost : 0,
    autoSprint: save.autoSprint === true,
  });
  lights.update(dt);
  weather.update(dt, player);
  look.setTime(currentHours());

  if (busted) {
    bustTimer -= dt;
    audio.update(dt, setAudioFrame(0, 0, 0, false, -1, 0, 0, 0, weather.level));
    hud.tick(dt);
    settings.update(dt, 1 / rawDt);
    if (bustTimer <= 0) finishBusted();
    renderFrame();
    return;
  }

  if (menu.isOpen || overlayOpen) {
    audio.update(dt, setAudioFrame(0, 0, 0, false, -1, 0, 0, 0, weather.level));
    hud.tick(dt);
    settings.update(dt, 1 / rawDt);
    renderFrame();
    return;
  }

  handleActions();
  const healthBefore = player.vehicle ? player.vehicle.health : 0;
  player.update(dt, input, world, cameraYaw, weather.grip);

  if (player.vehicle && player.vehicle.health < healthBefore - 0.4) {
    const impact = (healthBefore - player.vehicle.health) * 0.3;
    player.damage(impact);
    if (impact > 1.5) {
      audio.blip(110, 0.16, 'sawtooth', 0.06);
      haptics.collision(Math.min(1, impact / 12));
    }
  }
  if (player.hp <= 0) respawn();
  if (player.vehicle && player.vehicle.health <= 0) {
    const wreck = player.vehicle;
    player.exitVehicle(world);
    if (typeof wreck.explode === 'function') wreck.explode();
    else {
      wreck.role = 'wrecked';
      wreck.health = 0;
      wreck.speed = 0;
    }
    audio.blip(72, 0.7, 'sawtooth', 0.18);
    haptics.collision(1);
    hud.toast('VEHICLE WRECKED');
  }

  if (!photo.active && !menu.isOpen) {
    const aimYaw = combat.resolveAimYaw(cameraYaw, {
      aiming: input.isDown('aim'),
      autoAim: save.autoAim !== false,
    });
    combat.update(dt, {
      time: gameTime,
      aimYaw,
      firing: input.isDown('fire'),
      aiming: input.isDown('aim'),
      autoAim: save.autoAim !== false,
    });
    gangs.update(dt, player, wanted, gameTime);
  }

  traffic.update(dt, player, wanted.stars, weather.grip);
  police.update(dt, player, wanted, gameTime);
  wanted.update(dt, player, police, gameTime);
  economy.update(dt, player);
  missions.update(dt, player);
  world.update(player.pos);
  if (photo.active) photo.update(dt, player);
  else updateCamera(dt, world);
  hud.tick(dt);
  settings.update(dt, 1 / rawDt);

  achievements.noteStars(wanted.stars);
  achievementFrame.hours = currentHours();
  achievementFrame.wanted = wanted.stars;
  achievementFrame.weather = weather.level;
  achievementFrame.missionsDone = save.missionsDone;
  achievementFrame.storyStep = save.storyStep;
  achievementFrame.storyTotal = STORY_COUNT;
  if (achievements.update(dt, achievementFrame)) saveGame(save, true);

  const driving = !!player.vehicle;
  const driveInput = driving ? input.drivingInput() : null;
  const skid = driveInput
    ? (driveInput.handbrake
      ? Math.min(1, player.speed / 16)
      : Math.max(0, Math.abs(driveInput.steer) - 0.6) * Math.min(1, player.speed / 22))
    : 0;
  const siren = police.audioState(player.pos, cameraYaw);
  audio.update(dt, setAudioFrame(
    player.speed,
    driveInput ? driveInput.throttle : 0,
    wanted.stars,
    driving,
    gameTime,
    siren.level,
    siren.pan,
    siren.heli,
    weather.level,
    skid,
  ));

  const missionTarget = missions.currentPoint?.() || null;
  const target = missionTarget || minimap.waypoint;
  if (target) {
    missions.setDistance(dist2(player.pos.x, player.pos.z, target.x, target.z));
    if (!photo.active) {
      const marker = screenMarker(camera, target, window.innerWidth, window.innerHeight, 82, markerResult);
      marker.label = (missionTarget ? (missions.active?.config?.name || 'OBJECTIVE') : 'WAYPOINT').slice(0, 18);
      hud.updateArrow(marker);
    }
  } else {
    hud.updateArrow(null);
  }
  hudFrame.money = save.money;
  hudFrame.wanted = wanted.stars;
  hudFrame.hours = currentHours();
  hudFrame.mission = missions.status();
  hudFrame.missionActive = !!missions.active;
  hudFrame.hp = player.hp;
  hudFrame.armor = player.armor;
  hudFrame.speed = player.speed;
  hudFrame.mode = player.mode;
  hudFrame.weapon = combat.state();
  input.setButtonLabel('weapon', hudFrame.weapon.label);
  hudFrame.heat = wanted.hudState();
  hudFrame.weather = weather.label();
  hudFrame.signal = lights.status(player);
  hud.update(hudFrame);
  if (++frameCount % 3 === 0) {
    mapOptions.incidents = traffic.incidents;
    minimap.update(player, world, missions, police, wanted, economy, mapOptions);
  }

  collectSaveState();
  saveGame(save);

  renderFrame();

  if (!booted) {
    booted = true;
    boot?.classList.add('done');
    setTimeout(() => boot?.remove(), 500);
  }
}
requestAnimationFrame(frame);

// Small debug surface for testing in the browser console.
window.__jha = {
  player, world, traffic, police, missions, wanted, economy, menu, look, save,
  settings, minimap, lights, weather, audio, hud, input, photo, achievements, layout: hud.zones,
  combat, gangs, haptics, steering, missionOverlay, missionData: MISSION_DATA,
  collectSaveState, flushSave,
};
