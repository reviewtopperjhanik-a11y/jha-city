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
    for (const m of this.markers) {
      m.ring.rotation.z += dt * 0.9;
      m.ring.scale.setScalar(1 + Math.sin(performance.now() * 0.003) * 0.04);
    }
    for (const p of this.pickups) {
      p.core.rotation.y += dt * 1.6;
      p.core.position.y = 1.1 + Math.sin(performance.now() * 0.004 + p.x) * 0.14;
      if (!p.active) {
        p.respawn -= dt;
        if (p.respawn <= 0) {
          p.active = true;
          p.group.visible = true;
        }
        continue;
      }
      if (dist2(player.pos.x, player.pos.z, p.x, p.z) > 3.2) continue;
      const full = p.kind === 'health' ? player.hp >= 100 : player.armor >= 100;
      if (full) continue;
      p.active = false;
      p.respawn = 22;
      p.group.visible = false;
      this.onPickup(p.kind, p.amount);
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
    if (typeof vehicle.descriptor === 'function') {
      return vehicle.descriptor(price ?? PRICES[vehicle.type] ?? 0);
    }
    return {
      type: vehicle.type,
      color: vehicle.color,
      price: price ?? PRICES[vehicle.type] ?? 0,
      upgrades: {
        engine: !!vehicle.upgrades?.engine,
        armor: !!vehicle.upgrades?.armor,
        handling: !!vehicle.upgrades?.handling,
        color: vehicle.color,
      },
    };
  }

  // One place for garage-upgrade side effects; spending/toasts stay in main.
  // Returns false when the tune is already installed or the key is unknown.
  upgrade(vehicle, key) {
    if (!vehicle || (key !== 'engine' && key !== 'armor' && key !== 'handling')) return false;
    if (vehicle.upgrades?.[key]) return false;
    vehicle.applyUpgrades({ ...vehicle.upgrades, [key]: true });
    return true;
  }

  spawnVehicle(type, color, upgrades = {}) {
    const z = 65 + this.ownedVehicles.length * 6;
    const spot = this.world.nearestRoad ? this.world.nearestRoad(-195, z) : { x: -195, z };
    const v = new Vehicle(this.scene, this.look, type, spot.x, spot.z, Math.PI / 2, color);
    v.role = 'owned';
    v.applyUpgrades(upgrades);
    this.ownedVehicles.push(v);
    return v;
  }

  restore(descriptors = []) {
    for (const v of this.ownedVehicles) this.scene.remove(v.mesh);
    this.ownedVehicles.length = 0;
    for (const d of descriptors) this.spawnVehicle(d.type, d.color, d.upgrades);
    return this.ownedVehicles;
  }

  clearAll() {
    for (const v of this.ownedVehicles) this.scene.remove(v.mesh);
    this.ownedVehicles.length = 0;
  }
}
