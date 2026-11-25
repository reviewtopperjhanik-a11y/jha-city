import './style.css';
import * as THREE from 'three';
import { createLook } from './look/look.js';
import { createCity } from './world/city.js';
import { Input } from './core/input.js';
import { GameAudio } from './core/audio.js';
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
import { Hud } from './systems/hud.js';
import { Minimap } from './systems/minimap.js';
import { Settings } from './systems/settings.js';
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
let sessionStartHours = save.hours;
// ~6 min of day followed by ~5 min of night, then repeat.
const currentHours = () => (sessionStartHours + gameTime * 0.0367) % 24;
const input = new Input(ui);
const audio = new GameAudio();
const hud = new Hud(ui);
const menu = new Menu(ui, { toast: (msg) => hud.toast(msg) });
const settings = new Settings(ui, look, save, {
  isMobile,
  toast: (msg) => hud.toast(msg),
  onSaveSlot: (slot) => { save.activeSlot = slot; menu.close(); },
  onLoadSlot: (slot, state) => applySlotState(slot, state),
});
const minimap = new Minimap(ui, { toast: (msg) => hud.toast(msg) });
const player = new Player(scene, look, save.x, save.z, save.armor);
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
const weather = new Weather(scene, look, world, {
  change: (label) => hud.toast(`WEATHER: ${label}`),
});
weather.setMode(save.weather || 'auto');
const traffic = new Traffic(scene, look, world, {
  crime: (kind) => {
    wanted.crime(1, gameTime, player.pos.x, player.pos.z);
    hud.toast(kind === 'ped' ? 'WITNESS CALLED THE COPS!' : 'RECKLESS DRIVING!');
  },
  accident: () => {
    audio.blip(92, 0.32, 'sawtooth', 0.11);
    hud.toast('ACCIDENT — CROWD GATHERING');
  },
  lights,
  weather,
});
const missions = new Missions(scene, world, {
  reward: (amount) => {
    save.money += amount;
    save.missionsDone += 1;
  },
  toast: (msg) => hud.toast(msg),
  dialog: (speaker, lines, done) => menu.showDialog(speaker, lines, done),
  story: (step) => {
    save.storyStep = step;
    saveGame(save, true);
  },
  storyStep: save.storyStep,
}, look, traffic);

wanted.onChange = (stars, before) => {
  if (stars === 0) hud.toast('YOU LOST THEM');
  else if (stars === 5) hud.toast('MAXIMUM WANTED — ALL UNITS');
  else if (stars === 4) hud.toast('4 STAR WANTED — AIR UNIT INBOUND');
  else if (stars > before) hud.toast(`${stars} STAR WANTED`);
  else hud.toast(`WANTED DOWN TO ${stars}`);
};

// Start on the bike; E puts you on foot, E again carjacks the nearest car.
const starter = traffic.vehicles.find((v) => v.type === 'bike');
if (starter) player.setVehicle(starter);

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

// Drag on the canvas (not the controls) to orbit the chase camera.
let dragging = false;
let lastX = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  cameraYaw += (e.clientX - lastX) * 0.006;
  lastX = e.clientX;
  lookHold = 1.5;
});
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointercancel', () => { dragging = false; });

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  look.resize(w, h);
}
window.addEventListener('resize', resize);

function handleActions() {
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
  if (input.consume('weather')) {
    save.weather = weather.cycle();
    hud.toast(`WEATHER: ${weather.labelForTarget(weather.target)}`);
    saveGame(save, true);
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
    sessionStartHours = night ? 23 : 12;
    gameTime = 0;
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
  return (save.owned || []).find((d) => d.type === v.type && d.color === v.color) || null;
}

function rememberVehicle(v) {
  const d = ownedDescriptor(v);
  if (d) d.upgrades = { ...v.upgrades, color: v.color };
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
    const descriptor = { type, color, price, upgrades: { engine: false, armor: false } };
    save.owned = save.owned || [];
    save.owned.push(descriptor);
    const v = economy.spawnVehicle(type, color, descriptor.upgrades);
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
    economy.restore([descriptor]);
    player.setVehicle(economy.ownedVehicles[0]);
    hud.toast('OWNED VEHICLE READY');
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
    const key = action === 'engine' ? 'engine' : 'armor';
    if (v.upgrades[key]) {
      hud.toast('ALREADY INSTALLED');
      return;
    }
    if (!spend(PRICES[key])) return;
    v.applyUpgrades({ ...v.upgrades, [key]: true });
    rememberVehicle(v);
    hud.toast(key === 'engine' ? 'ENGINE TUNED' : 'BODY REINFORCED');
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
  if (player.vehicle) player.exitVehicle(world);
  wanted.clear(true);
  police.clearAll();
  economy.restore(save.owned || []);
  player.hp = 100;
  player.armor = save.armor || 0;
  const spawn = world.nearestRoad(save.x ?? 0, save.z ?? 65);
  player.respawnAt(spawn.x, spawn.z, 0);
  sessionStartHours = save.hours || 8;
  gameTime = 0;
  missions.storyStep = save.storyStep || 0;
  settings.mode = ['auto', 'high', 'medium', 'low'].includes(save.quality) ? save.quality : 'auto';
  settings.autoTier = Number.isFinite(save.autoTier) ? Math.max(0, Math.min(2, Math.round(save.autoTier))) : 1;
  settings.showFps = save.showFps !== false;
  weather.setMode(save.weather || 'auto');
  settings._apply();
  settings._renderSlots?.();
  snapCamera();
  hud.toast(`SLOT ${slot} LOADED`);
  saveGame(save, true, slot);
}

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

  // Pull the camera in when a building is between it and the player.
  let safe = dist;
  for (let t = 1.5; t <= dist; t += 1.2) {
    if (world.collide(player.pos.x + dx * t, player.pos.z + dz * t, 0.4).hit) {
      safe = Math.max(2, t - 1.1);
      break;
    }
  }
  const pull = safe / dist;
  camDesired.set(
    player.pos.x + dx * safe,
    player.pos.y + height * (0.55 + 0.45 * pull),
    player.pos.z + dz * safe,
  );
  camera.position.lerp(camDesired, 1 - Math.exp(-(player.vehicle ? 7 : 9) * dt));
  // Never let the smooth follow trail inside a wall the collision probe found.
  const offX = camera.position.x - player.pos.x;
  const offZ = camera.position.z - player.pos.z;
  const offLen = Math.hypot(offX, offZ);
  if (offLen > safe && offLen > 0.001) {
    const k = safe / offLen;
    camera.position.x = player.pos.x + offX * k;
    camera.position.z = player.pos.z + offZ * k;
  }
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

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.max(0.0001, (now - last) / 1000);
  const dt = Math.min(0.05, Math.max(0.001, rawDt));
  last = now;
  gameTime += dt;
  lights.update(dt);
  weather.update(dt, player);
  look.setTime(currentHours());

  if (busted) {
    bustTimer -= dt;
    audio.update(dt, { speed: 0, throttle: 0, wanted: 0, driving: false, time: -1, siren: 0, sirenPan: 0, heli: 0, rain: weather.level });
    hud.tick(dt);
    settings.update(dt, 1 / rawDt);
    if (bustTimer <= 0) finishBusted();
    look.render();
    return;
  }

  if (menu.isOpen) {
    audio.update(dt, { speed: 0, throttle: 0, wanted: 0, driving: false, time: -1, siren: 0, sirenPan: 0, heli: 0, rain: weather.level });
    hud.tick(dt);
    settings.update(dt, 1 / rawDt);
    look.render();
    return;
  }

  handleActions();
  const healthBefore = player.vehicle ? player.vehicle.health : 0;
  player.update(dt, input, world, cameraYaw, weather.grip);

  if (player.vehicle && player.vehicle.health < healthBefore - 0.4) {
    const impact = (healthBefore - player.vehicle.health) * 0.3;
    player.damage(impact);
    if (impact > 1.5) audio.blip(110, 0.16, 'sawtooth', 0.06);
  }
  if (player.hp <= 0) respawn();
  if (player.vehicle && player.vehicle.health <= 0) {
    const wreck = player.vehicle;
    player.exitVehicle(world);
    wreck.role = 'wrecked';
    wreck.health = 0;
    wreck.speed = 0;
    hud.toast('VEHICLE WRECKED');
  }

  traffic.update(dt, player, wanted.stars, weather.grip);
  police.update(dt, player, wanted, gameTime);
  wanted.update(dt, player, police, gameTime);
  economy.update(dt, player);
  missions.update(dt, player);
  world.update(player.pos);
  updateCamera(dt, world);
  hud.tick(dt);
  settings.update(dt, 1 / rawDt);

  const driving = !!player.vehicle;
  const siren = police.audioState(player.pos, cameraYaw);
  audio.update(dt, {
    speed: player.speed,
    throttle: driving ? input.drivingInput().throttle : 0,
    wanted: wanted.stars,
    driving,
    time: gameTime,
    siren: siren.level,
    sirenPan: siren.pan,
    heli: siren.heli,
    rain: weather.level,
  });

  const target = missions.currentPoint();
  if (target) missions.setDistance(dist2(player.pos.x, player.pos.z, target.x, target.z));
  hud.update({
    money: save.money,
    wanted: wanted.stars,
    hours: currentHours(),
    mission: missions.status(),
    hp: player.hp,
    armor: player.armor,
    speed: player.speed,
    mode: player.mode,
    heat: wanted.hudState(),
    weather: weather.label(),
    signal: lights.status(player),
  });
  if (++frameCount % 3 === 0) {
    minimap.update(player, world, missions, police, wanted, economy, {
      landmarks: world.landmarks,
      incidents: traffic.incidents,
    });
  }

  save.x = player.pos.x;
  save.z = player.pos.z;
  save.hours = currentHours();
  save.armor = player.armor;
  saveGame(save);

  look.render();

  if (!booted) {
    booted = true;
    boot?.classList.add('done');
    setTimeout(() => boot?.remove(), 500);
  }
}
requestAnimationFrame(frame);

// Small debug surface for testing in the browser console.
window.__jha = { player, world, traffic, police, missions, wanted, economy, menu, look, save, settings, minimap, lights, weather };
