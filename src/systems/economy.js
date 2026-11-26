import * as THREE from 'three';
import { C, CAR_COLORS } from '../look/palette.js';
import { Vehicle } from '../entities/vehicle.js';
import { makeRng } from '../util/rng.js';
import { dist2 } from '../util/math.js';

export const PAINT_COLORS = CAR_COLORS;

export const PRICES = {
  bike: 4200,
  car: 7800,
  engine: 2800,
  body: 2200,
  handling: 2400,
  paint: 650,
  health: 350,
  armor: 600,
};

export const LOCATIONS = [
  { key: 'garage', label: 'GARAGE', x: -195, z: 65, color: C.teal },
  { key: 'shop', label: 'SUPPLY SHOP', x: 195, z: 65, color: C.amber },
  { key: 'safehouse', label: 'SAFEHOUSE', x: 0, z: -195, color: C.orchid },
];

const MONEY_LIMIT = 99999999;
const VEHICLE_TYPES = new Set(['bike', 'car']);
const UPGRADE_KEYS = new Set(['engine', 'armor', 'handling']);
const num = (value, fallback, lo = -Infinity, hi = Infinity) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const colorOf = (value, fallback = CAR_COLORS[0]) => num(value, fallback, 0, 0xffffff);

// Money is owned by the save record, but the economy is the single place that
// defines its range. main.js can call these helpers so NaN/negative cash can
// never survive a purchase, fine or payout.
export function clampMoney(value) {
  return Math.round(num(value, 0, 0, MONEY_LIMIT));
}

export function spendMoney(state, cost) {
  if (!state || typeof state !== 'object') return false;
  const price = num(cost, Infinity, 0, MONEY_LIMIT);
  const money = clampMoney(state.money);
  if (!Number.isFinite(price) || money < price) {
    state.money = money;
    return false;
  }
  state.money = money - price;
  return true;
}

// The garage menu shows a reinforced body at PRICES.body, while the shop's
// body-armor refill uses PRICES.armor. Keep the two distinct in one lookup.
export function garagePrice(action) {
  if (action === 'body') return PRICES.body;
  if (action === 'spray') return 750;
  return num(PRICES[action], 0, 0, MONEY_LIMIT);
}

const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color,
  transparent: opacity < 1,
  opacity,
  toneMapped: false,
});

export class Economy {
  constructor(scene, look, world, callbacks = {}) {
    this.scene = scene;
    this.look = look;
    this.world = world;
    this.onToast = callbacks.toast || (() => {});
    this.onPickup = callbacks.pickup || (() => {});
    this.rng = makeRng(9137);
    this.locations = LOCATIONS.map((loc) => {
      const spot = world.nearestRoad ? world.nearestRoad(loc.x, loc.z) : loc;
      return { ...loc, x: spot.x, z: spot.z };
    });
    this.markers = [];
    this.pickups = [];
    this.ownedVehicles = [];
    this._buildMarkers();
    this._spawnPickups();
  }

  _buildMarkers() {
    for (const loc of this.locations) {
      const group = new THREE.Group();
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(2.1, 2.1, 32, 10, 1, true),
        glow(loc.color, 0.16),
      );
      beam.position.y = 16;
      beam.material.side = THREE.DoubleSide;
      beam.material.depthWrite = false;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.22, 8, 22), glow(loc.color));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.5;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.4, 0.4), glow(loc.color));
      post.position.y = 1.7;
      group.add(beam, ring, post);
      group.position.set(loc.x, 0, loc.z);
      this.scene.add(group);
      this.markers.push({ group, ring });
    }
  }

  _spawnPickups() {
    const spots = [
      { x: -205, z: 65, kind: 'health' },
      { x: 205, z: 65, kind: 'armor' },
      { x: 0, z: -205, kind: 'health' },
    ];
    for (let i = 0; i < 4; i++) {
      const p = this.world.randomRoadPoint ? this.world.randomRoadPoint(this.rng) : { x: i * 90 - 135, z: 195 };
      spots.push({ x: p.x, z: p.z, kind: i % 2 ? 'health' : 'armor' });
    }
    for (const spot of spots) {
      const point = this.world.nearestRoad ? this.world.nearestRoad(spot.x, spot.z) : spot;
      const color = spot.kind === 'health' ? C.coral : C.teal;
      const group = new THREE.Group();
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 1.3), glow(0x121627));
      crate.position.y = 0.32;
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.68), glow(color));
      core.position.y = 1.1;
      group.add(crate, core);
      group.position.set(point.x, 0, point.z);
      this.scene.add(group);
      this.pickups.push({
        kind: spot.kind,
        amount: spot.kind === 'health' ? 35 : 40,
        x: point.x,
        z: point.z,
        group,
        core,
        active: true,
        respawn: 0,
      });
    }
  }

  nearest(pos, radius = 16) {
    let best = null;
    let bd = radius;
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return null;
    for (const loc of this.locations) {
      const d = dist2(pos.x, pos.z, loc.x, loc.z);
      if (d < bd) {
        bd = d;
        best = loc;
      }
    }
    return best;
  }

  update(dt, player) {
    const step = num(dt, 0, 0);
    for (const m of this.markers) {
      m.ring.rotation.z += step * 0.9;
      m.ring.scale.setScalar(1 + Math.sin(performance.now() * 0.003) * 0.04);
    }
    const px = player?.pos?.x;
    const pz = player?.pos?.z;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) return;
    for (const p of this.pickups) {
      p.core.rotation.y += step * 1.6;
      p.core.position.y = 1.1 + Math.sin(performance.now() * 0.004 + p.x) * 0.14;
      if (!p.active) {
        p.respawn -= step;
        if (p.respawn <= 0) {
          p.active = true;
          p.group.visible = true;
        }
        continue;
      }
      if (dist2(px, pz, p.x, p.z) > 3.2) continue;
      const current = p.kind === 'health' ? player.hp : player.armor;
      if (!Number.isFinite(current) || current >= 100) continue;
      // Announce and grant only what was actually gained, so a pickup at 98 HP
      // cannot claim +35 and a full-health pass cannot waste the respawn timer.
      const granted = Math.max(0, Math.min(num(p.amount, 35, 0, 100), 100 - current));
      if (granted <= 0) continue;
      p.active = false;
      p.respawn = 22;
      p.group.visible = false;
      this.onPickup(p.kind, granted);
    }
  }

  nextPaint(color) {
    const i = PAINT_COLORS.indexOf(color);
    return PAINT_COLORS[(i + 1 + PAINT_COLORS.length) % PAINT_COLORS.length];
  }

  // Save/garage descriptor shape: { type, color, price, upgrades }.
  // upgrades always includes color so restore() can reapply a paint job.
  serialize(vehicle, price) {
    if (!vehicle) return null;
    const type = VEHICLE_TYPES.has(vehicle.type) ? vehicle.type : 'car';
    const color = colorOf(vehicle.color, CAR_COLORS[0]);
    const cost = num(price, num(PRICES[type], 0, 0), 0, MONEY_LIMIT);
    let base = null;
    try {
      if (typeof vehicle.descriptor === 'function') base = vehicle.descriptor(cost);
    } catch {
      base = null;
    }
    const upgrades = base?.upgrades && typeof base.upgrades === 'object' ? base.upgrades : {};
    return {
      type,
      color: colorOf(base?.color ?? color, color),
      price: cost,
      upgrades: {
        engine: !!upgrades.engine,
        armor: !!upgrades.armor,
        handling: !!upgrades.handling,
        color: colorOf(upgrades.color ?? base?.color ?? color, color),
      },
    };
  }

  // One place for garage-upgrade side effects; spending/toasts stay in main.
  // Returns false when the tune is already installed or the key is unknown.
  upgrade(vehicle, key) {
    if (!vehicle || !UPGRADE_KEYS.has(key)) return false;
    const current = vehicle.upgrades && typeof vehicle.upgrades === 'object' ? vehicle.upgrades : {};
    if (current[key]) return false;
    const flags = { ...current, [key]: true };
    if (flags.color == null && vehicle.color != null) flags.color = vehicle.color;
    if (typeof vehicle.applyUpgrades === 'function') vehicle.applyUpgrades(flags);
    else vehicle.upgrades = flags;
    return true;
  }

  spawnVehicle(type, color, upgrades = {}) {
    const kind = VEHICLE_TYPES.has(type) ? type : 'car';
    const paint = colorOf(color, kind === 'bike' ? CAR_COLORS[0] : CAR_COLORS[1]);
    const flags = upgrades && typeof upgrades === 'object' ? upgrades : {};
    const z = 65 + this.ownedVehicles.length * 6;
    const spot = this.world.nearestRoad ? this.world.nearestRoad(-195, z) : { x: -195, z };
    const v = new Vehicle(this.scene, this.look, kind, spot.x, spot.z, Math.PI / 2, paint);
    v.role = 'owned';
    v.applyUpgrades({
      engine: !!flags.engine,
      armor: !!flags.armor,
      handling: !!flags.handling,
      color: colorOf(flags.color, paint),
    });
    this.ownedVehicles.push(v);
    return v;
  }

  _removeOwned(v) {
    if (!v) return;
    this.scene.remove(v.mesh);
    // Vehicle owns a separate blob shadow; leaving it behind grows the scene
    // every time the garage restores or rebuilds the fleet.
    if (v.shadow) this.scene.remove(v.shadow);
  }

  restore(descriptors = []) {
    this.clearAll();
    if (!Array.isArray(descriptors)) return this.ownedVehicles;
    for (const d of descriptors) {
      if (!d || typeof d !== 'object') continue;
      this.spawnVehicle(d.type, d.color ?? d.upgrades?.color, d.upgrades);
    }
    return this.ownedVehicles;
  }

  clearAll() {
    for (const v of this.ownedVehicles) this._removeOwned(v);
    this.ownedVehicles.length = 0;
  }
}
