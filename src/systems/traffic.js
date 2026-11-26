import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Vehicle } from '../entities/vehicle.js';
import { C, CAR_COLORS } from '../look/palette.js';
import { makeRng, rand, randInt, pick } from '../util/rng.js';
import { clamp, damp, dist2 } from '../util/math.js';

const carColors = CAR_COLORS;
// Shared, read-only input frame: AI cars must not allocate a literal per frame.
const AI_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };

function paintGeo(g, color, variance = 0.08) {
  const c = color.clone().multiplyScalar(0.94 + Math.random() * variance);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function makePedGeometry(rng, variant = 0) {
  const shirts = [C.teal, C.coral, C.amber, C.orchid, C.flamingo, C.tangerine, 0x6f86d6, 0xe8e8f0, 0x8fbf7a, 0xd9a15c];
  const skins = [0xd9a06b, 0xb87a52, 0x8a5a3b, 0xf0c9a0, 0x6b432c, 0xc98f63];
  const hairs = [0x2b1a12, 0x3d2a1c, 0x101018, 0x5a3a22, 0xd8b26a, 0x7a4a28];
  const shirt = new THREE.Color(pick(rng, shirts));
  const skin = new THREE.Color(pick(rng, skins));
  const hair = new THREE.Color(pick(rng, hairs));
  const pants = new THREE.Color(pick(rng, [0x2a3050, 0x3a3a4a, 0x4a3a32, 0x252a40, 0x55607a]));
  const shoes = new THREE.Color(pick(rng, [0x15182a, 0x2a1d18, 0xe4ddce]));
  const accent = new THREE.Color(pick(rng, [C.lane, C.amber, C.teal, C.coral]));
  const parts = [];
  const box = (w, h, d, x, y, z, color) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(paintGeo(g, color));
  };
  const sphere = (r, x, y, z, color, sy = 1) => {
    const g = new THREE.SphereGeometry(r, 10, 8);
    g.scale(1, sy, 1);
    g.translate(x, y, z);
    parts.push(paintGeo(g, color));
  };
  const cyl = (rt, rb, h, x, y, z, color, seg = 8) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(x, y, z);
    parts.push(paintGeo(g, color));
  };
  const style = variant % 6;
  const shorts = style === 3 || variant % 7 === 5;

  box(0.52, 0.26, 0.36, 0, 0.92, 0, pants);
  box(0.56, 0.07, 0.38, 0, 1.06, 0, new THREE.Color(0x1b1e2c));
  box(0.6, 0.78, 0.4, 0, 1.42, 0, shirt);
  box(0.7, 0.13, 0.4, 0, 1.79, 0, shirt);
  box(0.05, 0.62, 0.02, 0, 1.42, 0.21, accent);
  box(0.24, 0.06, 0.02, 0, 1.2, 0.205, accent);
  // Neck and head.
  cyl(0.09, 0.1, 0.12, 0, 1.85, 0, skin);
  for (const s of [-1, 1]) {
    box(0.2, 0.72, 0.22, s * 0.15, 0.46, 0, shorts ? skin : pants);
    box(0.22, 0.14, 0.36, s * 0.15, 0.08, 0.06, shoes);
    box(0.235, 0.04, 0.38, s * 0.15, 0.015, 0.06, new THREE.Color(0xe8e3d8));
    box(0.15, 0.64, 0.17, s * 0.38, 1.42, 0, shirt);
    sphere(0.085, s * 0.38, 1.06, 0, skin);
    sphere(0.055, s * 0.245, 1.93, 0, skin);
    sphere(0.046, s * 0.085, 1.95, 0.221, new THREE.Color(0xf7f3e8));
    sphere(0.023, s * 0.085, 1.95, 0.256, new THREE.Color(0x0c0d1b));
    box(0.09, 0.022, 0.02, s * 0.09, 1.997, 0.235, hair);
  }
  sphere(0.25, 0, 1.93, 0, skin);
  sphere(0.262, 0, 1.95, -0.01, hair, 0.72);
  box(0.34, 0.26, 0.14, 0, 1.9, -0.17, hair);
  box(0.06, 0.07, 0.08, 0, 1.88, 0.245, skin);
  box(0.1, 0.02, 0.02, 0, 1.8, 0.235, new THREE.Color(0x9a4d4d));

  if (style === 0) {
    cyl(0.17, 0.18, 0.09, 0, 2.13, 0, accent);
    box(0.3, 0.03, 0.16, 0, 2.09, 0.17, accent);
  } else if (style === 1) {
    box(0.32, 0.42, 0.13, 0, 1.78, -0.19, hair);
  } else if (style === 2) {
    box(0.34, 0.4, 0.2, 0, 1.48, -0.27, accent);
    box(0.06, 0.3, 0.03, -0.16, 1.46, 0.22, accent);
    box(0.06, 0.3, 0.03, 0.16, 1.46, 0.22, accent);
  } else if (style === 3) {
    cyl(0.28, 0.36, 0.3, 0, 1.0, 0, accent);
  } else if (style === 4) {
    box(0.27, 0.11, 0.1, 0, 1.79, 0.19, hair);
    box(0.1, 0.15, 0.05, 0, 1.87, 0.23, hair);
  } else if (style === 5) {
    box(0.3, 0.055, 0.035, 0, 1.96, 0.245, new THREE.Color(0x10111c));
  }
  if (variant % 7 === 6) {
    sphere(0.13, 0, 2.18, -0.06, hair);
    box(0.24, 0.12, 0.16, 0, 2.06, -0.24, hair);
  }
  if (variant % 5 === 4) {
    box(0.26, 0.04, 0.02, 0, 2.025, 0.252, new THREE.Color(0xe8e3d8));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

export class Traffic {
  constructor(scene, look, world, callbacks = {}) {
    this.scene = scene;
    this.look = look;
    this.world = world;
    this.rng = makeRng(7712);
    this.onCrime = callbacks.crime || (() => {});
    this.onAccident = callbacks.accident || (() => {});
    this.lights = callbacks.lights || null;
    this.weather = callbacks.weather || null;
    this.incidents = [];
    this.hornTime = 0;
    this.vehicles = [];
    // Kept as an empty array for save/debug callers that expect the old shape;
    // pursuit vehicles now live in systems/police.js.
    this.police = [];
    this.peds = [];
    this.crimeCooldown = 0;
    this.lowQuality = false;
    this.activeVehicles = 0;
    this.activePeds = 0;
    this._playerVehicle = null;

    for (let i = 0; i < 16; i++) {
      const p = world.randomRoadPoint(this.rng);
      const dir = this.rng() > 0.5 ? 1 : -1;
      const v = new Vehicle(scene, look, 'car', p.x, p.z, p.axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2), pick(this.rng, carColors));
      v.ai = true;
      v.role = 'traffic';
      v.route = { axis: p.axis, line: p.line, dir };
      v.targetSpeed = rand(this.rng, 9, 14);
      v.speed = v.targetSpeed;
      this.vehicles.push(v);
    }
    // Two parked vehicles on the kerb lane, clear of the sidewalk and buildings.
    this.vehicles.push(new Vehicle(scene, look, 'bike', 16, 70, Math.PI / 2, C.flamingo));
    this.vehicles.push(new Vehicle(scene, look, 'car', -18, 70, Math.PI / 2, C.teal));

    // Detailed low-poly pedestrians (head, hair, eyes, hands, legs, shoes).
    const pedRng = makeRng(2468);
    const variants = [];
    for (let i = 0; i < 12; i++) variants.push(makePedGeometry(pedRng, i));
    const pedMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: look.gradientMap });
    const umbrellaGeo = new THREE.ConeGeometry(0.82, 0.32, 8);
    const stickGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.5, 5);
    const stickMat = new THREE.MeshBasicMaterial({ color: 0x2a3050 });
    const umbrellaMats = [C.coral, C.teal, C.amber, C.flamingo, C.lane]
      .map((color) => new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    const addPed = (x, z) => {
      const mesh = new THREE.Mesh(variants[this.peds.length % variants.length], pedMat);
      mesh.castShadow = true;
      const baseScale = rand(this.rng, 0.92, 1.08);
      mesh.scale.setScalar(baseScale);
      const umbrella = new THREE.Group();
      const canopy = new THREE.Mesh(umbrellaGeo, umbrellaMats[this.peds.length % umbrellaMats.length]);
      canopy.position.y = 2.42;
      const stick = new THREE.Mesh(stickGeo, stickMat);
      stick.position.y = 1.95;
      umbrella.add(canopy, stick);
      umbrella.visible = false;
      mesh.add(umbrella);
      scene.add(mesh);
      this.peds.push({
        x,
        z,
        heading: rand(this.rng, 0, Math.PI * 2),
        speed: rand(this.rng, 1.2, 2.6),
        turn: rand(this.rng, 0, 4),
        fleeing: false,
        gawk: null,
        phase: rand(this.rng, 0, Math.PI * 2),
        umbrella,
        mesh,
        // Phase 3: all state is allocated once. Downed pedestrians keep this
        // same record and mesh through their fall and respawn.
        baseScale,
        hp: 100,
        downed: false,
        downTimer: 0,
        dodge: 0,
        crossing: { active: false, axis: 'x', line: 0, coord: 0, side: 1 },
      });
    };
    // A crowd near the start so the first street feels alive.
    for (let i = 0; i < 22; i++) {
      if (this.rng() > 0.5) addPed(rand(this.rng, -85, 85), (this.rng() > 0.5 ? 1 : -1) * 52);
      else addPed((this.rng() > 0.5 ? 1 : -1) * 52, rand(this.rng, -85, 85));
    }
    for (let i = 0; i < 42; i++) {
      const p = world.randomRoadPoint(this.rng);
      const off = (this.rng() > 0.5 ? 1 : -1) * (world.GRID.ROAD / 2 + 3);
      const x = p.axis === 'z' ? p.x + off : p.x;
      const z = p.axis === 'x' ? p.z + off : p.z;
      addPed(x, z);
    }
    this.crimeGrace = 6;
  }

  // Quality switches only toggle a flag: every vehicle, pedestrian, mesh and
  // geometry stays in place. update() decides which ones actually run.
  setLowQuality(isLow) {
    this.lowQuality = !!isLow;
  }

  // Combat/gameplay hook: 0 when still standing, true on the hit that drops a
  // pedestrian. No geometry, material or mesh is created here.
  knockPed(ped, amount = 100) {
    if (!ped || ped.downed || ped.hp <= 0) return false;
    ped.hp -= Math.max(0, amount || 0);
    if (ped.hp > 0) return false;
    ped.hp = 0;
    ped.downed = true;
    ped.downTimer = 3.4;
    ped.dodge = 0;
    if (ped.crossing) ped.crossing.active = false;
    ped.mesh.rotation.set(Math.PI / 2, ped.heading, 0);
    ped.mesh.position.y = 0.16;
    ped.mesh.scale.setScalar(ped.baseScale * 0.92);
    return true;
  }

  // Reuse the fallen pedestrian's own record and mesh; pick a kerbside point
  // clear of buildings so the crowd does not respawn inside a wall.
  _respawnPed(p) {
    const G = this.world.GRID;
    const off = G.ROAD / 2 + 3.2;
    const vi = this._nearestLine(p.x);
    const zi = this._nearestLine(p.z);
    const vx = this.world.roadLine(vi);
    const hz = this.world.roadLine(zi);
    const alongV = clamp(p.z, -G.HALF + 20, G.HALF - 20);
    const alongH = clamp(p.x, -G.HALF + 20, G.HALF - 20);
    if (Math.abs(p.x - vx) <= Math.abs(p.z - hz)) {
      let side = p.x >= vx ? 1 : -1;
      let c = this.world.collide(vx + side * off, alongV, 0.5);
      if (c.hit) {
        side = -side;
        c = this.world.collide(vx + side * off, alongV, 0.5);
      }
      p.x = c.hit ? clamp(p.x, -G.HALF + 20, G.HALF - 20) : c.x;
      p.z = c.hit ? alongV : c.z;
      p.heading = side > 0 ? 0 : Math.PI;
    } else {
      let side = p.z >= hz ? 1 : -1;
      let c = this.world.collide(alongH, hz + side * off, 0.5);
      if (c.hit) {
        side = -side;
        c = this.world.collide(alongH, hz + side * off, 0.5);
      }
      p.x = c.hit ? alongH : c.x;
      p.z = c.hit ? clamp(p.z, -G.HALF + 20, G.HALF - 20) : c.z;
      p.heading = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    p.hp = 100;
    p.downed = false;
    p.downTimer = 0;
    p.dodge = 0;
    p.crossing.active = false;
    p.turn = 0.8;
    p.mesh.rotation.set(0, p.heading, 0);
    p.mesh.scale.setScalar(p.baseScale);
    p.mesh.position.set(p.x, 0, p.z);
  }

  get enterables() {
    return this.vehicles.filter((v) => !['police', 'wrecked', 'suspect'].includes(v.role));
  }

  nearestVehicle(pos) {
    let best = null;
    let bd = 5.0;
    for (const v of this.enterables) {
      const d = dist2(pos.x, pos.z, v.pos.x, v.pos.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  _laneOffset(axis, dir) {
    const lane = this.world.GRID.ROAD * 0.22;
    if (axis === 'z') return dir > 0 ? -lane : lane;
    return dir > 0 ? lane : -lane;
  }

  _vehicleAhead(v) {
    const r = v.route;
    const coord = r.axis === 'z' ? v.pos.z : v.pos.x;
    let best = null;
    let bestGap = 13;
    for (const other of this.vehicles) {
      if (other === v) continue;
      let axis = r.axis;
      let dir = r.dir;
      if (other.ai && other.route) {
        if (other.route.axis !== r.axis || other.route.dir !== r.dir) continue;
      } else if (other === this._playerVehicle || other.role === 'player' || (!other.ai && other.heading != null)) {
        const h = other.heading || 0;
        axis = Math.abs(Math.sin(h)) > 0.5 ? 'x' : 'z';
        dir = axis === 'z' ? (Math.cos(h) >= 0 ? 1 : -1) : (Math.sin(h) >= 0 ? 1 : -1);
      } else continue;
      if (axis !== r.axis) continue;
      const oc = axis === 'z' ? other.pos.z : other.pos.x;
      const cross = axis === 'z' ? Math.abs(other.pos.x - v.pos.x) : Math.abs(other.pos.z - v.pos.z);
      if (cross > 5.2) continue;
      const gap = (oc - coord) * dir;
      if (gap > 0.6 && gap < bestGap) {
        bestGap = gap;
        best = other;
      }
    }
    const out = this._aheadResult || (this._aheadResult = { vehicle: null, gap: 0 });
    out.vehicle = best;
    out.gap = bestGap;
    return out.vehicle ? out : null;
  }

  // Pedestrians standing in the lane (typically at a zebra crossing) are hard
  // obstacles. Squared distances keep this scan allocation-free.
  _pedOnPath(v) {
    if (!this.peds) return false;
    const r = v.route;
    const coord = r.axis === 'z' ? v.pos.z : v.pos.x;
    const lateral = r.axis === 'z' ? v.pos.x : v.pos.z;
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      if (p.downed) continue;
      const along = (r.axis === 'z' ? p.z - coord : p.x - coord) * r.dir;
      if (along < 1 || along > 10) continue;
      const across = r.axis === 'z' ? Math.abs(p.x - lateral) : Math.abs(p.z - lateral);
      if (across < 2.4) return true;
    }
    return false;
  }

  _route(v, dt, surfaceGrip = 1) {
    const r = v.route;
    v.heading = r.axis === 'z' ? (r.dir > 0 ? 0 : Math.PI) : (r.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    let target = 9 + (v._baseSpeed ||= rand(this.rng, 0, 5));
    if (v.yieldToPlayer) target = Math.min(target, 3);
    if (v.honkBoost > 0) {
      target += v.honkBoost;
      v.honkBoost = Math.max(0, v.honkBoost - dt * 1.1);
    }
    if (this.lights) {
      const stop = this.lights.nextStop(v.pos, r.axis, r.dir);
      if (stop && stop.dist > -0.5 && stop.dist < 15) {
        if (!this.lights.canGo(r.axis)) target = 0;
        else if (this.lights.caution(r.axis) && stop.dist > 3) target = Math.min(target, 4);
      }
    }
    for (const incident of this.incidents) {
      const along = (r.axis === 'z' ? incident.z - v.pos.z : incident.x - v.pos.x) * r.dir;
      const across = r.axis === 'z' ? Math.abs(incident.x - v.pos.x) : Math.abs(incident.z - v.pos.z);
      if (along > 0 && along < 16 && across < 12) target = Math.min(target, 3);
    }
    const ahead = this._vehicleAhead(v);
    if (ahead) {
      // Hold a safe gap behind stopped traffic instead of nudging through it.
      target = Math.min(target, Math.max(0, ahead.vehicle.speed + (ahead.gap - 6) * 0.55 - 0.6));
      if (ahead.gap < 6) target = 0;
    }
    if (this._pedOnPath(v)) target = Math.min(target, 0.8);
    v.targetSpeed = clamp(target, 0, 16);

    v.applyInput(dt, AI_INPUT, this.world, surfaceGrip);
    v.speed += (v.targetSpeed - v.speed) * dt * 1.4;
    const desired = this._laneOffset(r.axis, r.dir);
    v.laneOffset = v.laneOffset == null ? desired : damp(v.laneOffset, desired, 2.6, dt);

    if (r.axis === 'z') {
      v.pos.x = this.world.roadLine(r.line) + v.laneOffset;
      if (Math.abs(v.pos.z) > this.world.GRID.HALF - 22) {
        r.axis = 'x';
        r.line = this._nearestLine(v.pos.x);
        r.dir = -r.dir;
        v.pos.z = this.world.roadLine(clamp(r.line, 0, this.world.GRID.N)) + this._laneOffset('x', r.dir);
      }
    } else {
      v.pos.z = this.world.roadLine(r.line) + v.laneOffset;
      if (Math.abs(v.pos.x) > this.world.GRID.HALF - 22) {
        r.axis = 'z';
        r.line = this._nearestLine(v.pos.z);
        r.dir = -r.dir;
        v.pos.x = this.world.roadLine(clamp(r.line, 0, this.world.GRID.N)) + this._laneOffset('z', r.dir);
      }
    }
  }

  _nearestLine(v) {
    const i = Math.round((v + this.world.GRID.HALF) / this.world.GRID.BLOCK);
    return clamp(i, 0, this.world.GRID.N);
  }

  // Final positional pass: two cars sharing a lane never overlap, so a car can
  // not drive through a queue that has already stopped.
  _separateTraffic() {
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.ai || !a.route || a._phase3Active === false) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.ai || !b.route || b._phase3Active === false) continue;
        const ar = a.route;
        const br = b.route;
        if (ar.axis !== br.axis || ar.line !== br.line || ar.dir !== br.dir) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d >= 3.2) continue;
        const push = (3.2 - d) * 0.5;
        const along = ar.axis === 'z' ? (dz >= 0 ? 1 : -1) : (dx >= 0 ? 1 : -1);
        if (ar.axis === 'z') {
          a.pos.z -= along * push;
          b.pos.z += along * push;
        } else {
          a.pos.x -= along * push;
          b.pos.x += along * push;
        }
        if (a.speed > b.speed) a.speed = Math.min(a.speed, b.speed + 0.4);
        else b.speed = Math.min(b.speed, a.speed + 0.4);
      }
    }
  }

  onHorn(pos) {
    this.hornTime = 1.3;
    let reacted = 0;
    for (const p of this.peds) {
      if (dist2(p.x, p.z, pos.x, pos.z) > 26) continue;
      p.heading = Math.atan2(p.x - pos.x, p.z - pos.z);
      p.turn = rand(this.rng, 0.3, 0.9);
      reacted++;
    }
    for (const v of this.vehicles) {
      if (!v.ai || v.role !== 'traffic') continue;
      if (dist2(v.pos.x, v.pos.z, pos.x, pos.z) < 34) v.honkBoost = 2.4;
    }
    return reacted;
  }

  triggerAccident(x, z, severity = 12) {
    const incident = { x, z, life: 28, total: 28, severity };
    this.incidents.push(incident);
    if (this.incidents.length > 6) this.incidents.shift();
    let gathered = 0;
    for (const p of this.peds) {
      if (gathered >= 7 || dist2(p.x, p.z, x, z) > 48) continue;
      const angle = rand(this.rng, 0, Math.PI * 2);
      const radius = rand(this.rng, 3.5, 7);
      p.gawk = { incident, x: x + Math.sin(angle) * radius, z: z + Math.cos(angle) * radius, life: rand(this.rng, 10, 18) };
      p.fleeing = false;
      gathered++;
    }
    this.onAccident(incident, gathered);
    return incident;
  }

  _resolvePlayerCollision(v, player) {
    const pv = player.vehicle;
    if (!pv) {
      // On foot: a vehicle nudges the player aside instead of passing through.
      const min = (v.type === 'bike' ? 0.75 : 1.35) + 0.5;
      let dx = player.pos.x - v.pos.x;
      let dz = player.pos.z - v.pos.z;
      let d = Math.hypot(dx, dz);
      if (d >= min) return;
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
      return;
    }
    if (v === pv) return;
    const r1 = pv.type === 'bike' ? 0.85 : 1.45;
    const r2 = v.type === 'bike' ? 0.85 : 1.45;
    const min = r1 + r2;
    let dx = v.pos.x - pv.pos.x;
    let dz = v.pos.z - pv.pos.z;
    let d = Math.hypot(dx, dz);
    if (d >= min) return;
    if (d < 0.001) {
      dx = 1;
      dz = 0;
      d = 1;
    }
    const nx = dx / d;
    const nz = dz / d;
    const overlap = min - d;
    v.pos.x += nx * overlap * 0.9;
    v.pos.z += nz * overlap * 0.9;
    const c = this.world.collide(v.pos.x, v.pos.z, r2);
    if (c.hit) {
      v.pos.x = c.x;
      v.pos.z = c.z;
    }
    const impact = Math.abs(pv.speed - v.speed);
    pv.speed *= 0.72;
    v.speed *= 0.55;
    if (impact > 6) {
      pv.health = Math.max(0, pv.health - impact * 0.09);
      v.health = Math.max(0, v.health - impact * 0.06);
    }
    if (impact > 11 && (v.accidentCooldown || 0) <= 0) {
      v.accidentCooldown = 7;
      this.triggerAccident(v.pos.x, v.pos.z, impact);
    }
    v._sync(0);
  }

  // Start a crossing only from the kerb beside an intersection. The zebra
  // coordinate is snapped to one of the stripes drawn by the city.
  _tryCross(p) {
    if (p.crossing.active || p.downed || p.fleeing || p.gawk || p.dodge > 0) return false;
    const G = this.world.GRID;
    const off = G.ROAD / 2 + 2.6;
    const vi = this._nearestLine(p.x);
    const zi = this._nearestLine(p.z);
    const vx = this.world.roadLine(vi);
    const hz = this.world.roadLine(zi);
    const dx = p.x - vx;
    const dz = p.z - hz;
    const alongZ = Math.abs(Math.cos(p.heading)) >= Math.abs(Math.sin(p.heading));
    if (alongZ) {
      if (Math.abs(Math.abs(dx) - off) > 5 || Math.abs(dz) > off + 7) return false;
      p.crossing.axis = 'x';
      p.crossing.line = zi;
      p.crossing.coord = hz + clamp(Math.round(dz / 2.2), -3, 3) * 2.2;
      p.crossing.side = dx >= 0 ? 1 : -1;
      p.heading = p.crossing.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      if (Math.abs(Math.abs(dz) - off) > 5 || Math.abs(dx) > off + 7) return false;
      p.crossing.axis = 'z';
      p.crossing.line = vi;
      p.crossing.coord = vx + clamp(Math.round(dx / 2.2), -3, 3) * 2.2;
      p.crossing.side = dz >= 0 ? 1 : -1;
      p.heading = p.crossing.side > 0 ? Math.PI : 0;
    }
    p.crossing.active = true;
    p.turn = 1.4;
    return true;
  }

  // Returns a speed multiplier: 0 while waiting for cross traffic to go red.
  _crossStep(p, dt) {
    const c = p.crossing;
    const G = this.world.GRID;
    const line = this.world.roadLine(c.line);
    if (c.axis === 'x') {
      p.z += (c.coord - p.z) * Math.min(1, dt * 8);
      const side = p.x - line;
      if (this.lights && (this.lights.canGo('x') || this.lights.caution('x')) && side * c.side > 3.5) {
        p.heading = c.side > 0 ? -Math.PI / 2 : Math.PI / 2;
        return 0;
      }
      if (side * -c.side > G.ROAD / 2 + 1.4) {
        c.active = false;
        return 1;
      }
      p.heading = c.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      p.x += (c.coord - p.x) * Math.min(1, dt * 8);
      const side = p.z - line;
      if (this.lights && (this.lights.canGo('z') || this.lights.caution('z')) && side * c.side > 3.5) {
        p.heading = c.side > 0 ? Math.PI : 0;
        return 0;
      }
      if (side * -c.side > G.ROAD / 2 + 1.4) {
        c.active = false;
        return 1;
      }
      p.heading = c.side > 0 ? Math.PI : 0;
    }
    return 1;
  }

  // Gentle pull back to the kerb line so walkers stay on the pavement.
  _alignSidewalk(p, dt) {
    if (p.crossing.active || p.fleeing || p.gawk || p.dodge > 0 || p.downed) return;
    const G = this.world.GRID;
    const off = G.ROAD / 2 + 2.6;
    const vi = this._nearestLine(p.x);
    const zi = this._nearestLine(p.z);
    const vx = this.world.roadLine(vi);
    const hz = this.world.roadLine(zi);
    const dx = p.x - vx;
    const dz = p.z - hz;
    const t = Math.min(1, dt * 2.4);
    const alongZ = Math.abs(Math.cos(p.heading)) >= Math.abs(Math.sin(p.heading));
    if (alongZ) {
      if (Math.abs(Math.abs(dx) - off) > 4.5) return;
      p.x += (vx + (dx >= 0 ? off : -off) - p.x) * t;
    } else {
      if (Math.abs(Math.abs(dz) - off) > 4.5) return;
      p.z += (hz + (dz >= 0 ? off : -off) - p.z) * t;
    }
  }

  // Step off the path of any moving vehicle, including the player's car.
  _dodgeOne(p, v, dt) {
    if (!v || !v.pos) return false;
    const speed = Math.abs(v.speed || 0);
    if (speed < 2.5) return false;
    const dx = p.x - v.pos.x;
    const dz = p.z - v.pos.z;
    if (dx * dx + dz * dz > 56) return false;
    const h = v.heading || 0;
    const along = dx * Math.sin(h) + dz * Math.cos(h);
    if (along < -3 || along > 7) return false;
    const sx = Math.cos(h);
    const sz = -Math.sin(h);
    let sign = sx * dx + sz * dz >= 0 ? 1 : -1;
    const step = Math.min(2.4, 1.3 + speed * 0.08) * dt * 6;
    let nx = p.x + sx * sign * step;
    let nz = p.z + sz * sign * step;
    let c = this.world.collide(nx, nz, 0.32);
    if (c.hit) {
      sign = -sign;
      nx = p.x + sx * sign * step;
      nz = p.z + sz * sign * step;
      c = this.world.collide(nx, nz, 0.32);
    }
    if (!c.hit) {
      p.x = nx;
      p.z = nz;
    }
    p.heading = Math.atan2(sx * sign, sz * sign);
    p.dodge = 0.32;
    return true;
  }

  _updatePeds(dt, player, wanted) {
    this.activePeds = 0;
    const low = this.lowQuality;
    const px = player.pos.x;
    const pz = player.pos.z;
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      const d = dist2(p.x, p.z, px, pz);
      let active = true;
      if (low) {
        active = p.downTimer > 0 || (d < 85 * 85 && (d < 32 * 32 || (i & 1) === 0));
        if (active && this.activePeds >= 24 && p.downTimer <= 0) active = false;
      }
      p.mesh.visible = active;
      if (!active) continue;
      this.activePeds++;

      if (p.downTimer > 0) {
        p.downTimer -= dt;
        if (p.downTimer > 0) continue;
        this._respawnPed(p);
      }
      p.umbrella.visible = !!this.weather?.isRaining();
      if (p.gawk) {
        p.gawk.life -= dt;
        if (p.gawk.life <= 0) p.gawk = null;
      }
      p.fleeing = !p.gawk && wanted > 0 && d < 26;
      if (p.dodge > 0) p.dodge -= dt;
      if (!p.gawk && !p.crossing.active && p.dodge <= 0) {
        p.turn -= dt;
        if (p.turn <= 0) {
          p.turn = rand(this.rng, 2.6, 6.5);
          if (!this._tryCross(p)) p.heading += rand(this.rng, -1.1, 1.1);
        }
      }
      if (p.fleeing) p.heading = Math.atan2(p.x - px, p.z - pz);
      if (p.gawk) {
        const gd = dist2(p.x, p.z, p.gawk.x, p.gawk.z);
        const cx = gd > 0.9 ? p.gawk.x : p.gawk.incident.x;
        const cz = gd > 0.9 ? p.gawk.z : p.gawk.incident.z;
        p.heading = Math.atan2(cx - p.x, cz - p.z);
      }
      let crossSpeed = 1;
      if (p.crossing.active) crossSpeed = this._crossStep(p, dt);
      if (p.dodge <= 0) {
        for (let vi = 0; vi < this.vehicles.length; vi++) this._dodgeOne(p, this.vehicles[vi], dt);
        if (player.vehicle) this._dodgeOne(p, player.vehicle, dt);
      }
      const sp = (p.fleeing ? p.speed * 3.4 : p.gawk ? p.speed * 1.2 : p.speed * (this.weather?.isRaining() ? 1.15 : 1)) * crossSpeed;
      const nx = p.x + Math.sin(p.heading) * sp * dt;
      const nz = p.z + Math.cos(p.heading) * sp * dt;
      const c = this.world.collide(nx, nz, 0.32);
      if (c.hit) {
        p.heading += Math.PI * (0.7 + this.rng() * 0.6);
        p.turn = 0.8;
        if (p.crossing.active) p.crossing.active = false;
      } else {
        p.x = clamp(nx, -440, 440);
        p.z = clamp(nz, -440, 440);
        this._alignSidewalk(p, dt);
      }
      // Pedestrians step aside instead of clipping through the player.
      const rr = player.vehicle ? 2.4 : 1.05;
      const near = dist2(p.x, p.z, px, pz);
      if (near < rr) {
        let ox = p.x - px;
        let oz = p.z - pz;
        if (Math.abs(ox) < 0.001 && Math.abs(oz) < 0.001) {
          ox = Math.sin(player.heading + Math.PI);
          oz = Math.cos(player.heading + Math.PI);
        }
        const pd = Math.hypot(ox, oz) || 1;
        const safe = this.world.collide(px + (ox / pd) * rr, pz + (oz / pd) * rr, 0.32);
        p.x = safe.x;
        p.z = safe.z;
      }
      // Walk bob and hip sway; pedestrians turn to face the way they walk.
      p.phase += dt * (p.fleeing ? 13 : 7.5);
      const bob = Math.abs(Math.sin(p.phase)) * (p.fleeing ? 0.09 : 0.05);
      p.mesh.position.set(p.x, bob, p.z);
      p.mesh.rotation.y = p.heading;
      p.mesh.rotation.z = Math.sin(p.phase * 0.5) * 0.035;
      if (d < 1.7 && !player.vehicle && player.speed > 3 && this.crimeCooldown <= 0 && this.crimeGrace <= 0) {
        this.onCrime('ped');
        this.crimeCooldown = 6;
      }
    }
  }

  update(dt, player, wanted, surfaceGrip = 1) {
    this.crimeCooldown = Math.max(0, this.crimeCooldown - dt);
    this.crimeGrace = Math.max(0, this.crimeGrace - dt);
    this.hornTime = Math.max(0, this.hornTime - dt);
    this._playerVehicle = player.vehicle;
    this.activeVehicles = 0;
    for (let i = this.incidents.length - 1; i >= 0; i--) {
      this.incidents[i].life -= dt;
      if (this.incidents[i].life <= 0) this.incidents.splice(i, 1);
    }
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      v.accidentCooldown = Math.max(0, (v.accidentCooldown || 0) - dt);
      if (v === player.vehicle) {
        v._phase3Active = true;
        continue;
      }
      const d = dist2(v.pos.x, v.pos.z, player.pos.x, player.pos.z);
      let active = true;
      if (this.lowQuality) {
        // Keep nearby parked cars for collision, the closest moving cars and
        // half of the mid-range ones; hide the rest without removing them.
        active = v.ai
          ? d < 120 * 120 && (d < 45 * 45 || (i & 1) === 0) && this.activeVehicles < 8
          : d < 120 * 120;
      }
      v._phase3Active = active;
      v.mesh.visible = active;
      if (!active) continue;
      this.activeVehicles++;
      if (v.role === 'police' || v.role === 'suspect') continue;
      if (v.ai) {
        v.yieldToPlayer = d < 10 && Math.abs(v.speed - player.speed) > 5;
        this._route(v, dt, surfaceGrip);
        if (d < 2.4 && player.speed > 8 && this.crimeCooldown <= 0 && this.crimeGrace <= 0) {
          this.onCrime('traffic');
          this.crimeCooldown = 2.5;
        }
      }
    }
    this._updatePeds(dt, player, wanted);
    // Resolve car-to-car contact after everyone has moved, so a parked car is
    // also shoved and its mesh follows the new position.
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v === player.vehicle || v._phase3Active === false) continue;
      this._resolvePlayerCollision(v, player);
    }
    this._separateTraffic();
  }
}
