import './style.css';
import * as THREE from 'three';
import { createLook } from './look/look.js';
import { createCity } from './world/city.js';
import { Input } from './core/input.js';
import { GameAudio } from './core/audio.js';
import { loadSave, saveGame } from './core/save.js';
import { Player } from './entities/player.js';
import { Traffic } from './systems/traffic.js';
import { Wanted } from './systems/wanted.js';
import { Missions } from './systems/missions.js';
import { Hud } from './systems/hud.js';
import { Minimap } from './systems/minimap.js';
import { damp, dist2 } from './util/math.js';

const canvas = document.getElementById('game');
const ui = document.getElementById('ui');
const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || 'ontouchstart' in window;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 2200);
renderer.setSize(window.innerWidth, window.innerHeight);

const look = createLook(scene, camera, renderer, { bloomEnabled: true, dpr: isMobile ? 1.5 : 2 });
look.resize(window.innerWidth, window.innerHeight);

const world = createCity(scene, look);
const save = loadSave();
const sessionStartHours = save.hours;
const currentHours = () => (sessionStartHours + gameTime * 0.03) % 24;
const input = new Input(ui);
const audio = new GameAudio();
const hud = new Hud(ui);
const minimap = new Minimap(ui);
const player = new Player(scene, look, save.x, save.z);

const wanted = new Wanted();
const traffic = new Traffic(scene, look, world, {
  crime: (kind) => {
    wanted.crime(1, gameTime);
    hud.toast(kind === 'ped' ? 'WITNESS CALLED THE COPS!' : 'RECKLESS DRIVING!');
  },
});
const missions = new Missions(scene, world, {
  reward: (amount) => {
    save.money += amount;
    save.missionsDone += 1;
  },
  toast: (msg) => hud.toast(msg),
});

wanted.onChange = (stars) => {
  hud.toast(stars === 0 ? 'YOU LOST THEM' : `${stars} STAR WANTED`);
};

// Start on the bike; E puts you on foot, E again carjacks the nearest car.
const starter = traffic.vehicles.find((v) => v.type === 'bike');
if (starter) player.setVehicle(starter);

let gameTime = 0;
let cameraYaw = player.heading;
let camIndex = 0;
const camDistances = [8.5, 11, 14];
let lowFps = 0;
let frameCount = 0;

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
      player.exitVehicle();
      hud.toast('ON FOOT');
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
  if (input.consume('bribe')) {
    if (wanted.stars > 0 && save.money >= 500) {
      save.money -= 500;
      wanted.clear();
      hud.toast('BRIBE PAID — $500');
    } else if (wanted.stars > 0) {
      hud.toast('NOT ENOUGH CASH');
    }
  }
  if (input.consume('cam')) {
    camIndex = (camIndex + 1) % camDistances.length;
    hud.toast(`CAMERA ${camIndex + 1}`);
  }
}

function updateCamera(dt) {
  cameraYaw = damp(cameraYaw, player.heading, 1.6, dt);
  const dist = camDistances[camIndex];
  const height = player.mode === 'car' ? 4.8 : player.mode === 'bike' ? 3.6 : 3.1;
  const desired = new THREE.Vector3(
    player.pos.x - Math.sin(cameraYaw) * dist,
    player.pos.y + height,
    player.pos.z - Math.cos(cameraYaw) * dist,
  );
  camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
  camera.lookAt(player.pos.x, player.pos.y + 1.5, player.pos.z);
}

function respawn() {
  player.hp = 100;
  wanted.clear();
  player.exitVehicle();
  player.pos.set(0, 0, 40);
  player.heading = 0;
  hud.toast('WASTED — BACK ON THE STREET');
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  gameTime += dt;

  handleActions();
  look.setTime(currentHours());
  player.update(dt, input, world, cameraYaw);

  if (player.hp <= 0) respawn();
  if (player.vehicle && player.vehicle.health <= 0) {
    hud.toast('VEHICLE WRECKED');
    player.exitVehicle();
    player.vehicle.teleport(save.x, save.z + 20);
    player.vehicle.health = 100;
  }

  traffic.update(dt, player, wanted.stars);
  wanted.update(dt, player.pos, traffic.police, gameTime);
  missions.update(dt, player);
  world.update(player.pos);
  updateCamera(dt);
  hud.tick(dt);

  const driving = !!player.vehicle;
  audio.update(dt, {
    speed: player.speed,
    throttle: driving ? input.drivingInput().throttle : 0,
    wanted: wanted.stars,
    driving,
    time: gameTime,
  });

  if (missions.active) {
    const p = missions.active.points[missions.active.index];
    missions.setDistance(dist2(player.pos.x, player.pos.z, p.x, p.z));
  }
  hud.update({
    money: save.money,
    wanted: wanted.stars,
    hours: currentHours(),
    mission: missions.status(),
    hp: player.hp,
    speed: player.speed,
    mode: player.mode,
  });
  if (++frameCount % 3 === 0) minimap.update(player, world, missions, traffic.police);

  save.x = player.pos.x;
  save.z = player.pos.z;
  save.hours = currentHours();
  saveGame(save);

  // Auto quality drop on weak GPUs: first bloom, then pixel ratio.
  const fps = 1 / dt;
  if (fps < 24) lowFps += dt;
  else lowFps = Math.max(0, lowFps - dt * 0.5);
  if (lowFps > 3) {
    lowFps = 0;
    if (look.state.bloomEnabled) {
      look.setBloom(false);
      hud.toast('QUALITY: PERFORMANCE');
    } else {
      look.setDpr(1);
    }
  }

  look.render();
}
requestAnimationFrame(frame);

// Small debug surface for testing in the browser console.
window.__jha = { player, world, traffic, missions, wanted, look, save };
