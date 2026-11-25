import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Vehicle } from '../entities/vehicle.js';
import { C } from '../look/palette.js';
import { clamp, angleLerp, wrapAngle, dist2 } from '../util/math.js';
import { makeRng, rand } from '../util/rng.js';

const UNIT_COUNT = [0, 1, 2, 4, 5, 5];
const NAVY = 0x1b2542;
const VEST = 0xffa948;
const SKIN = 0xd9a06b;
const DARK = 0x10131f;

function paintGeo(g, color) {
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function makeOfficerBody() {
  const parts = [];
  const c = (hex) => new THREE.Color(hex);
  const box = (w, h, d, x, y, z, color) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(paintGeo(g, c(color)));
  };
  const sphere = (r, x, y, z, color) => {
    const g = new THREE.SphereGeometry(r, 10, 8);
    g.translate(x, y, z);
    parts.push(paintGeo(g, c(color)));
  };

  // Torso, high-vis vest, belt and shoulders.
  box(0.6, 0.8, 0.4, 0, 1.44, 0, NAVY);
  box(0.64, 0.48, 0.44, 0, 1.42, 0, VEST);
  box(0.58, 0.07, 0.46, 0, 1.18, 0, DARK);
  box(0.74, 0.14, 0.42, 0, 1.82, 0, NAVY);
  box(0.08, 0.48, 0.02, 0, 1.42, 0.225, 0xf7f3e8);
  box(0.08, 0.48, 0.02, 0, 1.42, -0.225, 0xf7f3e8);
  box(0.17, 0.11, 0.03, 0, 1.62, 0.235, 0xffd9a0);
  box(0.1, 0.17, 0.08, -0.22, 1.7, 0.23, DARK);
  box(0.12, 0.14, 0.1, 0.22, 1.82, -0.02, DARK);

  // Arms and hands.
  for (const s of [-1, 1]) {
    box(0.16, 0.6, 0.18, s * 0.4, 1.52, 0, NAVY);
    sphere(0.085, s * 0.4, 1.19, 0.02, SKIN);
  }

  // Neck, head, cap and eyes.
  box(0.15, 0.12, 0.15, 0, 1.9, 0, SKIN);
  sphere(0.24, 0, 2.06, 0, SKIN);
  box(0.34, 0.1, 0.06, 0, 2.18, 0.19, DARK);
  box(0.5, 0.13, 0.34, 0, 2.27, -0.01, NAVY);
  box(0.3, 0.05, 0.16, 0, 2.22, 0.21, NAVY);
  for (const s of [-1, 1]) {
    sphere(0.035, s * 0.085, 2.08, 0.22, 0xf7f3e8);
    sphere(0.021, s * 0.085, 2.08, 0.245, DARK);
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function makeOfficerLeg() {
  const parts = [];
  const c = (hex) => new THREE.Color(hex);
  const box = (w, h, d, x, y, z, color) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(paintGeo(g, c(color)));
  };
  box(0.21, 0.44, 0.24, 0, -0.22, 0, NAVY);
  box(0.18, 0.42, 0.21, 0, -0.63, 0, NAVY);
  box(0.22, 0.13, 0.36, 0, -0.88, 0.06, DARK);
  box(0.235, 0.035, 0.38, 0, -0.955, 0.06, 0x3a3f55);
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function makeBarrier() {
  const parts = [];
  const c = (hex) => new THREE.Color(hex);
  const box = (w, h, d, x, y, z, color) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(paintGeo(g, c(color)));
  };
  box(3.25, 0.78, 0.5, 0, 0.5, 0, C.amber);
  box(3.27, 0.18, 0.52, 0, 0.58, 0, 0x232030);
  box(0.42, 0.16, 0.72, -1.1, 0.08, 0, 0x232030);
  box(0.42, 0.16, 0.72, 1.1, 0.08, 0, 0x232030);
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function lineClear(world, ax, az, bx, bz) {
  if (!world?.collide) return true;
  const dx = bx - ax;
  const dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d < 3) return true;
  const steps = Math.max(2, Math.ceil(d / 7));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (world.collide(ax + dx * t, az + dz * t, 0.15).hit) return false;
  }
  return true;
}

export class Police {
  constructor(scene, look, world, callbacks = {}) {
    this.scene = scene;
    this.look = look;
    this.world = world;
    this.onBusted = callbacks.onBusted || (() => {});
    this.onToast = callbacks.toast || (() => {});
    this.rng = makeRng(90210);

    this.units = [];
    this.cars = [];
    this.officers = [];
    this.roadblocks = [];
    this.heli = null;
    this.active = false;
    this.spawnDelay = 0;
    this.roadblockCooldown = 0;
    this.sirenTime = 0;
    this.arrestLock = 0;
    this.bustedFlag = false;

    this.officerMat = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: look.gradientMap,
    });
    this.officerBodyGeo = makeOfficerBody();
    this.officerLegGeo = makeOfficerLeg();
    this.barrierGeo = makeBarrier();
    this.barrierGlowGeo = new THREE.BoxGeometry(2.8, 0.06, 0.06);
    this.barrierGlowMat = new THREE.MeshBasicMaterial({ color: 0xff3355, toneMapped: false });
    this.heliUp = new THREE.Vector3(0, 1, 0);
    this._tmpV = new THREE.Vector3();
  }

  update(dt, player, wanted, time) {
    this.arrestLock = Math.max(0, this.arrestLock - dt);
    const stars = wanted.stars;

    if (stars <= 0) {
      if (this.active || this.cars.length || this.officers.length) this.clearAll();
      return;
    }

    if (!this.active) {
      this.active = true;
      this.spawnDelay = 1.5;
      this.roadblockCooldown = 4;
      this.bustedFlag = false;
    }

    this.sirenTime += dt;
    this.spawnDelay -= dt;
    const need = UNIT_COUNT[stars] || 1;

    if (this.spawnDelay <= 0) {
      if (this.units.length < need) this._spawnUnit(player);
      this.spawnDelay = stars >= 4 ? 0.9 : 1.35;
    }
    while (this.units.length > need) this._removeUnit(this.units.pop());

    this._updateUnits(dt, player, wanted, stars, time);
    this._updateRoadblocks(dt, player, wanted, stars);
    this._updateOfficers(dt, player, wanted);
    this._updateHeli(dt, player, wanted, stars);
    this._resolveContacts(player);
    this._separateUnits();
    this._flashLights();
  }

  _spawnPoint(player) {
    let best = null;
    let bestScore = -Infinity;
    const hx = player.heading;
    for (let i = 0; i < 18; i++) {
      const p = this.world.randomRoadPoint(this.rng);
      const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
      if (d < 72 || d > 200) continue;
      const behind = -((p.x - player.pos.x) * Math.sin(hx) + (p.z - player.pos.z) * Math.cos(hx)) / d;
      let score = 70 - Math.abs(d - 125) * 0.5 + behind * 24;
      if (this.world.collide(p.x, p.z, 1.4).hit) score -= 1000;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) {
      const snap = this.world.nearestRoad(
        player.pos.x - Math.sin(player.heading) * 115,
        player.pos.z - Math.cos(player.heading) * 115,
      );
      best = { x: snap.x, z: snap.z };
    }
    return best;
  }

  _spawnUnit(player) {
    const p = this._spawnPoint(player);
    const heading = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
    const v = new Vehicle(this.scene, this.look, 'car', p.x, p.z, heading, C.ink);
    v.role = 'police';
    v.ai = true;
    v.setPolice();
    v.stuckTime = 0;
    v.recoverCooldown = 0;
    v.searchAngle = rand(this.rng, 0, Math.PI * 2);
    v.deployCooldown = 1.2;
    v.officers = 0;
    v.sirenPhase = rand(this.rng, 0, 3);
    this.units.push(v);
    this.cars.push(v);
  }

  _removeUnit(v) {
    if (!v) return;
    v.setVisible(false);
    this.scene.remove(v.mesh);
    const i = this.cars.indexOf(v);
    if (i >= 0) this.cars.splice(i, 1);
  }

  _updateUnits(dt, player, wanted, stars, time) {
    const pv = player.vehicle;
    const playerSpeed = Math.abs(pv?.speed || player.speed || 0);

    for (const v of this.units) {
      const dx = player.pos.x - v.pos.x;
      const dz = player.pos.z - v.pos.z;
      const d = Math.hypot(dx, dz) || 1;

      let targetX;
      let targetZ;
      if (wanted.spotted) {
        const lead = pv ? clamp(playerSpeed * 0.35, 0, 14) : 0;
        targetX = player.pos.x + Math.sin(player.heading) * lead;
        targetZ = player.pos.z + Math.cos(player.heading) * lead;
      } else {
        const search = wanted.search || { x: player.pos.x, z: player.pos.z, r: 60 };
        const dc = Math.hypot(search.x - v.pos.x, search.z - v.pos.z);
        if (dc > 32) {
          targetX = search.x;
          targetZ = search.z;
        } else {
          v.searchAngle += dt * (0.42 + (v.sirenPhase % 0.2));
          const r = Math.min(24, Math.max(10, search.r * 0.28));
          targetX = search.x + Math.sin(v.searchAngle) * r;
          targetZ = search.z + Math.cos(v.searchAngle) * r;
        }
      }

      const tdx = targetX - v.pos.x;
      const tdz = targetZ - v.pos.z;
      const targetHeading = Math.atan2(tdx, tdz);
      const look = Math.max(5, Math.abs(v.speed) * 0.3);
      let steerTo = targetHeading;
      for (const off of [0, 0.42, -0.42, 0.86, -0.86, 1.3, -1.3, 1.8, -1.8]) {
        const h = targetHeading + off;
        const px = v.pos.x + Math.sin(h) * look;
        const pz = v.pos.z + Math.cos(h) * look;
        if (this.world.collide(px, pz, 1.15).hit) continue;
        if (this.cars.some((o) => o !== v && dist2(px, pz, o.pos.x, o.pos.z) < 17)) continue;
        steerTo = h;
        break;
      }
      v.heading = wrapAngle(angleLerp(v.heading, steerTo, 1 - Math.exp(-4.1 * dt)));

      const close = d < 20;
      const playerSlow = !pv || playerSpeed < 4.5;
      const deployNow = wanted.spotted && close && playerSlow && d < 14 && v.officers < 2 && v.deployCooldown <= 0;
      if (deployNow) {
        v.deployCooldown = 6;
        v.officers = 2;
        this._deployFromCar(v, player);
      }

      const throttle = deployNow || (close && playerSlow) ? (d > 8 ? 0.22 : 0) : d > 45 ? 1 : 0.72;
      const brake = (close && playerSlow && v.speed > 4) || (d < 7 && v.speed > 16) ? 1 : 0;
      v.applyInput(dt, { throttle, brake, steer: 0, handbrake: false, boost: false }, this.world);
      v.deployCooldown = Math.max(0, v.deployCooldown - dt);
      if (v.officers >= 2 && d > 34) v.officers = 0;

      const blocked = Math.abs(v.speed) < 1.6 && d > 9;
      v.stuckTime = blocked ? v.stuckTime + dt : Math.max(0, v.stuckTime - dt * 2);
      v.recoverCooldown = Math.max(0, v.recoverCooldown - dt);
      if (v.stuckTime > 2.4 && v.recoverCooldown <= 0) {
        v.recover(this.world, Math.atan2(dx, dz));
        v.recoverCooldown = 3;
        v.stuckTime = 0;
      }
    }
  }

  _deployFromCar(v, player) {
    const side = v.heading + (this.rng() > 0.5 ? Math.PI / 2 : -Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const a = side + (i === 0 ? 0 : Math.PI);
      const x = v.pos.x + Math.sin(a) * 2.9;
      const z = v.pos.z + Math.cos(a) * 2.9;
      this._spawnOfficer(x, z, v, player);
    }
  }

  _spawnOfficer(x, z, owner, player) {
    if (this.officers.length >= 9) return null;
    let point = null;
    for (const off of [0, 1.1, -1.1, 2.2, -2.2]) {
      const px = x + Math.cos(owner ? owner.heading : 0) * off;
      const pz = z - Math.sin(owner ? owner.heading : 0) * off;
      if (!this.world.collide(px, pz, 0.45).hit) {
        point = { x: px, z: pz };
        break;
      }
    }
    if (!point) return null;

    const group = new THREE.Group();
    const body = new THREE.Mesh(this.officerBodyGeo, this.officerMat);
    body.castShadow = true;
    const legL = new THREE.Mesh(this.officerLegGeo, this.officerMat);
    const legR = new THREE.Mesh(this.officerLegGeo, this.officerMat);
    legL.castShadow = legR.castShadow = true;
    legL.position.set(-0.16, 1.02, 0);
    legR.position.set(0.16, 1.02, 0);
    group.add(body, legL, legR);
    group.position.set(point.x, 0, point.z);
    group.rotation.y = player ? Math.atan2(player.pos.x - point.x, player.pos.z - point.z) : 0;
    this.scene.add(group);

    const officer = {
      x: point.x,
      z: point.z,
      heading: group.rotation.y,
      phase: rand(this.rng, 0, Math.PI * 2),
      life: 0,
      farTime: 0,
      speed: 9.4 + this.rng() * 0.8,
      owner,
      group,
      legL,
      legR,
    };
    this.officers.push(officer);
    return officer;
  }

  _removeOfficer(o) {
    this.scene.remove(o.group);
    const i = this.officers.indexOf(o);
    if (i >= 0) this.officers.splice(i, 1);
  }

  _updateOfficers(dt, player, wanted) {
    if (wanted.stars <= 0 || this.arrestLock > 0) return;
    for (let i = this.officers.length - 1; i >= 0; i--) {
      const o = this.officers[i];
      o.life += dt;
      const dx = player.pos.x - o.x;
      const dz = player.pos.z - o.z;
      const d = Math.hypot(dx, dz) || 1;
      const pv = player.vehicle;
      const clear = lineClear(this.world, o.x, o.z, player.pos.x, player.pos.z);

      if (clear && ((!pv && d < 2.05) || (pv && Math.abs(pv.speed) < 1.4 && d < 3.3))) {
        this._arrest();
        return;
      }

      if (d > 78) o.farTime += dt;
      else o.farTime = 0;
      if (o.farTime > 5 || o.life > 42) {
        this._removeOfficer(o);
        continue;
      }
      if (!wanted.spotted && d > 45) continue;

      let tx = player.pos.x;
      let tz = player.pos.z;
      if (!wanted.spotted) {
        const search = wanted.search;
        if (search) {
          tx = search.x;
          tz = search.z;
          if (Math.hypot(tx - o.x, tz - o.z) < 4) continue;
        }
      } else if (pv && Math.abs(pv.speed) > 5) {
        const lead = Math.min(9, Math.abs(pv.speed) * 0.28);
        tx += Math.sin(player.heading) * lead;
        tz += Math.cos(player.heading) * lead;
      }

      const targetHeading = Math.atan2(tx - o.x, tz - o.z);
      o.heading = wrapAngle(angleLerp(o.heading, targetHeading, 1 - Math.exp(-9 * dt)));
      let steer = o.heading;
      for (const off of [0, 0.55, -0.55, 1.05, -1.05, 1.6, -1.6]) {
        const h = targetHeading + off;
        if (!this.world.collide(o.x + Math.sin(h) * 3.2, o.z + Math.cos(h) * 3.2, 0.4).hit) {
          steer = h;
          break;
        }
      }
      o.heading = wrapAngle(angleLerp(o.heading, steer, 1 - Math.exp(-6 * dt)));
      const step = o.speed * dt;
      const nx = o.x + Math.sin(o.heading) * step;
      const nz = o.z + Math.cos(o.heading) * step;
      const c = this.world.collide(nx, nz, 0.42);
      if (!c.hit) {
        o.x = nx;
        o.z = nz;
      } else {
        const cx = this.world.collide(nx, o.z, 0.42);
        const cz = this.world.collide(o.x, nz, 0.42);
        if (!cx.hit) o.x = nx;
        else if (!cz.hit) o.z = nz;
        else o.heading += 1.3;
      }

      o.phase += dt * 11;
      const swing = Math.sin(o.phase) * 0.55;
      o.legL.rotation.x = swing;
      o.legR.rotation.x = -swing;
      o.group.position.set(o.x, Math.abs(Math.sin(o.phase)) * 0.03, o.z);
      o.group.rotation.y = o.heading;
    }
  }

  _arrest() {
    if (this.bustedFlag || this.arrestLock > 0) return;
    this.bustedFlag = true;
    this.arrestLock = 4;
    this.onBusted();
  }

  _updateRoadblocks(dt, player, wanted, stars) {
    this.roadblockCooldown = Math.max(0, this.roadblockCooldown - dt);

    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const block = this.roadblocks[i];
      block.age += dt;
      const d = Math.hypot(player.pos.x - block.x, player.pos.z - block.z);
      block.farTime = d > 100 ? block.farTime + dt : 0;
      if (!block.announced && d < 62) {
        block.announced = true;
        this.onToast('POLICE ROADBLOCK AHEAD');
      }
      if (stars < 3 || block.age > 34 || block.farTime > 6) {
        this._removeRoadblock(block);
        this.roadblocks.splice(i, 1);
      }
    }

    if (stars < 3 || !player.vehicle || Math.abs(player.vehicle.speed) < 7) return;
    if (this.roadblockCooldown > 0 || this.roadblocks.length >= (stars >= 5 ? 2 : 1)) return;
    if (this._spawnRoadblock(player)) {
      this.roadblockCooldown = stars >= 5 ? 14 : stars >= 4 ? 18 : 24;
    }
  }

  _spawnRoadblock(player) {
    const ahead = clamp(80 + Math.abs(player.vehicle.speed) * 1.3, 85, 150);
    const tx = player.pos.x + Math.sin(player.heading) * ahead;
    const tz = player.pos.z + Math.cos(player.heading) * ahead;
    const snap = this.world.nearestRoad(tx, tz);
    const G = this.world.GRID;
    const vi = Math.round((snap.x + G.HALF) / G.BLOCK);
    const hi = Math.round((snap.z + G.HALF) / G.BLOCK);
    const axis = Math.abs(snap.x - this.world.roadLine(vi)) < 1 ? 'z' : 'x';
    const x = axis === 'z' ? this.world.roadLine(vi) : snap.x;
    const z = axis === 'x' ? this.world.roadLine(hi) : snap.z;
    const d = Math.hypot(x - player.pos.x, z - player.pos.z);
    if (d < 65 || d > 190) return false;
    if (this.world.collide(x, z, 2.4).hit) return false;

    const approachX = player.pos.x - x;
    const approachZ = player.pos.z - z;
    const al = Math.hypot(approachX, approachZ) || 1;
    const ax = approachX / al;
    const az = approachZ / al;

    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = axis === 'z' ? 0 : Math.PI / 2;
    for (const off of [-5.4, 0, 5.4]) {
      const base = new THREE.Mesh(this.barrierGeo, this.officerMat);
      base.position.set(off, 0, 0);
      base.castShadow = true;
      const glow = new THREE.Mesh(this.barrierGlowGeo, this.barrierGlowMat);
      glow.position.set(off, 0.93, 0);
      group.add(base, glow);
    }
    this.scene.add(group);

    const far = Math.sign(axis === 'z' ? z - player.pos.z : x - player.pos.x) || 1;
    const cars = [];
    for (const side of [-5.1, 5.1]) {
      const cx = axis === 'z' ? x + side : x + far * 6;
      const cz = axis === 'z' ? z + far * 6 : z + side;
      const heading = axis === 'z' ? Math.PI / 2 : 0;
      const v = new Vehicle(this.scene, this.look, 'car', cx, cz, heading + side * 0.035, C.ink);
      v.role = 'police';
      v.ai = false;
      v.setPolice();
      v.sirenPhase = rand(this.rng, 0, 3);
      v.roadblock = true;
      cars.push(v);
      this.cars.push(v);
    }

    const officers = [];
    for (const side of [-2.5, 2.5]) {
      const ox = x + ax * 2.8 + (axis === 'z' ? side : 0);
      const oz = z + az * 2.8 + (axis === 'x' ? side : 0);
      const o = this._spawnOfficer(ox, oz, null, player);
      if (o) officers.push(o);
    }

    this.roadblocks.push({
      x,
      z,
      axis,
      group,
      cars,
      officers,
      age: 0,
      farTime: 0,
      announced: false,
      collider: axis === 'z'
        ? { x, z, hw: 8.8, hd: 0.8 }
        : { x, z, hw: 0.8, hd: 8.8 },
    });
    return true;
  }

  _removeRoadblock(block) {
    for (const v of block.cars) {
      v.setVisible(false);
      this.scene.remove(v.mesh);
      const i = this.cars.indexOf(v);
      if (i >= 0) this.cars.splice(i, 1);
    }
    for (const o of block.officers) this._removeOfficer(o);
    this.scene.remove(block.group);
  }

  _updateHeli(dt, player, wanted, stars) {
    if (stars < 4) {
      this._removeHeli();
      return;
    }
    if (!this.heli) this._spawnHeli();

    const h = this.heli;
    h.angle += dt * 0.42;
    const radius = 27;
    const alt = 29;
    const x = player.pos.x + Math.sin(h.angle) * radius;
    const z = player.pos.z + Math.cos(h.angle) * radius;
    h.group.position.set(x, alt, z);
    h.group.rotation.y = h.angle + Math.PI / 2;
    h.rotor.rotation.y += dt * 22;
    h.tailRotor.rotation.x += dt * 30;

    const focus = wanted.search || { x: player.pos.x, z: player.pos.z };
    const targetX = wanted.spotted ? player.pos.x : focus.x;
    const targetZ = wanted.spotted ? player.pos.z : focus.z;
    const dx = targetX - x;
    const dz = targetZ - z;
    const dist = Math.hypot(dx, alt, dz);
    h.cone.position.set((x + targetX) / 2, alt / 2, (z + targetZ) / 2);
    const dir = this._tmpV.set(-dx, alt, -dz).normalize();
    h.cone.quaternion.setFromUnitVectors(this.heliUp, dir);
    h.cone.scale.set(1, dist / 30, 1);
    h.spot.position.set(targetX, 0.06, targetZ);
    h.spot.material.opacity = 0.14 + 0.08 * (0.5 + 0.5 * Math.sin(performance.now() * 0.004));
  }

  _spawnHeli() {
    const group = new THREE.Group();
    const navy = new THREE.MeshToonMaterial({ color: NAVY, gradientMap: this.look.gradientMap });
    const white = new THREE.MeshToonMaterial({ color: 0xe8e8f0, gradientMap: this.look.gradientMap });
    const dark = new THREE.MeshToonMaterial({ color: DARK, gradientMap: this.look.gradientMap });
    const glass = new THREE.MeshToonMaterial({ color: 0x17233d, gradientMap: this.look.gradientMap });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 3.2), navy);
    body.position.set(0, 0, 0.3);
    const belly = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 2.4), dark);
    belly.position.set(0, -0.55, 0.2);
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 1.1), glass);
    cockpit.position.set(0, 0.1, 1.9);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.16, 2.2), white);
    stripe.position.set(0, 0.08, 0.1);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 3.6), navy);
    tail.position.set(0, 0.18, -3.0);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 0.7), white);
    fin.position.set(0, 0.55, -4.4);
    const skidGeo = new THREE.BoxGeometry(0.12, 0.12, 2.4);
    for (const s of [-1, 1]) {
      const skid = new THREE.Mesh(skidGeo, dark);
      skid.position.set(s * 0.75, -1.0, 0.2);
      group.add(skid);
    }
    const rotor = new THREE.Group();
    rotor.position.set(0, 0.72, 0.1);
    const bladeGeo = new THREE.BoxGeometry(7.0, 0.07, 0.24);
    const blade2 = new THREE.Mesh(bladeGeo, dark);
    blade2.rotation.y = Math.PI / 2;
    rotor.add(new THREE.Mesh(bladeGeo, dark), blade2);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.35, 8), dark);
    mast.position.set(0, 0.55, 0.1);
    const tailRotor = new THREE.Group();
    tailRotor.position.set(0.25, 0.55, -4.4);
    const tailBlade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.2), dark);
    tailRotor.add(tailBlade);
    const lightR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0xff3355, toneMapped: false }));
    lightR.position.set(-0.85, 0.2, -0.4);
    const lightB = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0x3a7bff, toneMapped: false }));
    lightB.position.set(0.85, 0.2, -0.4);
    group.add(body, belly, cockpit, stripe, tail, fin, rotor, mast, tailRotor, lightR, lightB);

    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 4.4, 30, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    cone.renderOrder = 2;
    const spot = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffc677,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    spot.rotation.x = -Math.PI / 2;
    this.scene.add(group, cone, spot);
    this.heli = { group, rotor, tailRotor, cone, spot, angle: 0 };
  }

  _removeHeli() {
    if (!this.heli) return;
    const h = this.heli;
    this.scene.remove(h.group, h.cone, h.spot);
    this.heli = null;
  }

  _flashLights() {
    for (const v of this.cars) {
      if (!v.policeLights) continue;
      const phase = v.sirenPhase || 0;
      const on = Math.floor((this.sirenTime + phase) * 6) % 2 === 0;
      v.policeLights[0].visible = on;
      v.policeLights[1].visible = !on;
    }
    if (this.heli) {
      const on = Math.floor(this.sirenTime * 5) % 2 === 0;
      const lights = this.heli.group.children.slice(-2);
      lights[0].visible = on;
      lights[1].visible = !on;
    }
  }

  _resolveContacts(player) {
    const pv = player.vehicle;
    if (pv) {
      for (const v of this.cars) {
        if (v === pv) continue;
        const r1 = pv.type === 'bike' ? 0.85 : 1.45;
        const r2 = v.type === 'bike' ? 0.85 : 1.45;
        const min = r1 + r2;
        let dx = v.pos.x - pv.pos.x;
        let dz = v.pos.z - pv.pos.z;
        let d = Math.hypot(dx, dz);
        if (d >= min) continue;
        if (d < 0.001) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const nx = dx / d;
        const nz = dz / d;
        const overlap = min - d;
        v.pos.x += nx * overlap * 0.85;
        v.pos.z += nz * overlap * 0.85;
        const c = this.world.collide(v.pos.x, v.pos.z, r2);
        if (c.hit) {
          v.pos.x = c.x;
          v.pos.z = c.z;
        }
        const impact = Math.abs(pv.speed - v.speed);
        pv.speed *= 0.7;
        v.speed *= 0.45;
        if (impact > 6) {
          pv.health = Math.max(0, pv.health - impact * 0.09);
          v.health = Math.max(0, v.health - impact * 0.05);
        }
        v._sync(0);
      }
    } else {
      for (const v of this.cars) {
        const min = 1.35 + 0.5;
        let dx = player.pos.x - v.pos.x;
        let dz = player.pos.z - v.pos.z;
        let d = Math.hypot(dx, dz);
        if (d >= min) continue;
        if (d < 0.001) {
          dx = Math.sin(v.heading + Math.PI / 2);
          dz = Math.cos(v.heading + Math.PI / 2);
          d = 1;
        }
        player.pos.x = v.pos.x + (dx / d) * min;
        player.pos.z = v.pos.z + (dz / d) * min;
        const c = this.world.collide(player.pos.x, player.pos.z, 0.5);
        if (c.hit) {
          player.pos.x = c.x;
          player.pos.z = c.z;
        }
      }
    }

    // Roadblock barriers are solid for the player.
    const radius = pv ? (pv.type === 'bike' ? 0.85 : 1.25) : 0.55;
    for (const block of this.roadblocks) {
      const b = block.collider;
      const px = Math.abs(player.pos.x - b.x) - (b.hw + radius);
      const pz = Math.abs(player.pos.z - b.z) - (b.hd + radius);
      if (px >= 0 || pz >= 0) continue;
      if (px > pz) {
        player.pos.x = b.x + Math.sign(player.pos.x - b.x || 1) * (b.hw + radius);
      } else {
        player.pos.z = b.z + Math.sign(player.pos.z - b.z || 1) * (b.hd + radius);
      }
      if (pv) {
        pv.pos.copy(player.pos);
        pv.speed *= 0.25;
        pv.health = Math.max(0, pv.health - 2);
      }
    }
  }

  _separateUnits() {
    for (let i = 0; i < this.units.length; i++) {
      for (let j = i + 1; j < this.units.length; j++) {
        const a = this.units[i];
        const b = this.units[j];
        let dx = b.pos.x - a.pos.x;
        let dz = b.pos.z - a.pos.z;
        let d = Math.hypot(dx, dz);
        if (d >= 3.2) continue;
        if (d < 0.01) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const push = (3.2 - d) * 0.4;
        a.pos.x -= (dx / d) * push;
        a.pos.z -= (dz / d) * push;
        b.pos.x += (dx / d) * push;
        b.pos.z += (dz / d) * push;
        a._sync(0);
        b._sync(0);
      }
    }
  }

  isSpotted(player, stars) {
    if (!this.cars.length && !this.officers.length && !this.heli) return false;
    const pv = player.vehicle;
    const speed = Math.abs(pv?.speed || player.speed || 0);
    let radius = 40 + stars * 9;
    if (pv && speed > 14) radius += 18;
    if (!pv && speed < 0.5) radius -= 5;

    for (const v of this.cars) {
      const d = Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z);
      if (d > radius) continue;
      if (lineClear(this.world, v.pos.x, v.pos.z, player.pos.x, player.pos.z)) return true;
    }
    for (const o of this.officers) {
      const d = Math.hypot(o.x - player.pos.x, o.z - player.pos.z);
      if (d <= 34 && lineClear(this.world, o.x, o.z, player.pos.x, player.pos.z)) return true;
    }
    if (this.heli) {
      const h = this.heli.group.position;
      const d = Math.hypot(h.x - player.pos.x, h.z - player.pos.z);
      if (d < 85 && lineClear(this.world, h.x, h.z, player.pos.x, player.pos.z)) return true;
    }
    return false;
  }

  audioState(playerPos, cameraYaw = 0) {
    let best = Infinity;
    for (const v of this.cars) {
      const d = Math.hypot(v.pos.x - playerPos.x, v.pos.z - playerPos.z);
      if (d < best) best = d;
    }
    for (const o of this.officers) {
      const d = Math.hypot(o.x - playerPos.x, o.z - playerPos.z);
      if (d < best) best = d;
    }
    let level = 0;
    let pan = 0;
    if (Number.isFinite(best)) {
      level = clamp(1 - best / 150, 0, 1);
      let dx = 0;
      let dz = 0;
      let nearest = null;
      for (const v of this.cars) {
        if (!nearest || dist2(v.pos.x, v.pos.z, playerPos.x, playerPos.z) < dist2(nearest.pos.x, nearest.pos.z, playerPos.x, playerPos.z)) nearest = v;
      }
      if (nearest) {
        dx = nearest.pos.x - playerPos.x;
        dz = nearest.pos.z - playerPos.z;
        const rightX = -Math.cos(cameraYaw);
        const rightZ = Math.sin(cameraYaw);
        pan = clamp((dx * rightX + dz * rightZ) / (Math.hypot(dx, dz) || 1), -1, 1);
      }
    }
    let heli = 0;
    if (this.heli) {
      const h = this.heli.group.position;
      heli = clamp(1 - Math.hypot(h.x - playerPos.x, h.z - playerPos.z) / 190, 0.15, 1);
    }
    return { level, pan, heli };
  }

  clearAll() {
    for (const v of this.cars) {
      v.setVisible(false);
      this.scene.remove(v.mesh);
    }
    for (const o of this.officers) this.scene.remove(o.group);
    for (const block of this.roadblocks) {
      this.scene.remove(block.group);
      for (const v of block.cars) this.scene.remove(v.mesh);
    }
    this._removeHeli();
    this.units.length = 0;
    this.cars.length = 0;
    this.officers.length = 0;
    this.roadblocks.length = 0;
    this.active = false;
    this.spawnDelay = 0;
    this.roadblockCooldown = 0;
    this.arrestLock = 0;
    this.bustedFlag = false;
  }
}
