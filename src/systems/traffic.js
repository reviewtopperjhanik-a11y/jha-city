import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Vehicle } from '../entities/vehicle.js';
import { C } from '../look/palette.js';
import { makeRng, rand, randInt, pick } from '../util/rng.js';
import { clamp, dist2, angleLerp } from '../util/math.js';

const carColors = [C.amber, C.teal, C.coral, C.tangerine, C.dusk, C.flamingo, 0xe8e8f0];

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
    this.vehicles = [];
    this.police = [];
    this.peds = [];
    this.crimeCooldown = 0;

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
    const addPed = (x, z) => {
      const mesh = new THREE.Mesh(variants[this.peds.length % variants.length], pedMat);
      mesh.castShadow = true;
      mesh.scale.setScalar(rand(this.rng, 0.92, 1.08));
      scene.add(mesh);
      this.peds.push({
        x,
        z,
        heading: rand(this.rng, 0, Math.PI * 2),
        speed: rand(this.rng, 1.2, 2.6),
        turn: rand(this.rng, 0, 4),
        fleeing: false,
        phase: rand(this.rng, 0, Math.PI * 2),
        mesh,
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
    this.policeDelay = 0;
    this.policeActive = false;
    this.sirenTime = 0;
  }

  get enterables() {
    return this.vehicles.filter((v) => v.role !== 'police');
  }

  nearestVehicle(pos) {
    let best = null;
    let bd = 4.2;
    for (const v of this.enterables) {
      const d = dist2(pos.x, pos.z, v.pos.x, v.pos.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  _route(v, dt) {
    const r = v.route;
    const step = v.speed * dt;
    if (r.axis === 'z') {
      v.pos.z += r.dir * step;
      v.pos.x = this.world.roadLine(r.line);
      v.heading = r.dir > 0 ? 0 : Math.PI;
      if (Math.abs(v.pos.z) > this.world.GRID.HALF - 22) {
        r.axis = 'x';
        r.line = this._nearestLine(v.pos.x);
        r.dir = r.dir > 0 ? -1 : 1;
        v.pos.z = this.world.roadLine(clamp(r.line, 0, this.world.GRID.N));
      }
    } else {
      v.pos.x += r.dir * step;
      v.pos.z = this.world.roadLine(r.line);
      v.heading = r.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (Math.abs(v.pos.x) > this.world.GRID.HALF - 22) {
        r.axis = 'z';
        r.line = this._nearestLine(v.pos.z);
        r.dir = r.dir > 0 ? -1 : 1;
        v.pos.x = this.world.roadLine(clamp(r.line, 0, this.world.GRID.N));
      }
    }
    v.applyInput(dt, { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false }, this.world);
    v.speed += (v.targetSpeed - v.speed) * dt * 1.4;
  }

  _nearestLine(v) {
    const i = Math.round((v + this.world.GRID.HALF) / this.world.GRID.BLOCK);
    return clamp(i, 0, this.world.GRID.N);
  }

  _chase(v, dt, player) {
    const dx = player.pos.x - v.pos.x;
    const dz = player.pos.z - v.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const target = Math.atan2(dx, dz);
    v.heading = angleLerp(v.heading, target, 1 - Math.exp(-3.2 * dt));
    v.applyInput(dt, { throttle: d > 9 ? 1 : 0.25, brake: d < 7 ? 0.4 : 0, steer: 0, handbrake: false, boost: d > 40 }, this.world);
  }

  _updatePolice(dt, player, wanted) {
    // Police only exist after a crime. No patrol cars follow the player at spawn.
    if (wanted <= 0) {
      if (this.policeActive) {
        for (const v of this.police) {
          v.setVisible(false);
          const i = this.vehicles.indexOf(v);
          if (i >= 0) this.vehicles.splice(i, 1);
        }
        this.police.length = 0;
      }
      this.policeActive = false;
      this.policeDelay = 0;
      return;
    }
    if (!this.policeActive) {
      this.policeActive = true;
      this.policeDelay = 2.4;
    }
    this.policeDelay = Math.max(0, this.policeDelay - dt);
    const need = Math.min(wanted + 1, 4);

    if (this.policeDelay <= 0) {
      while (this.police.length < need) {
        let p = this.world.randomRoadPoint(this.rng);
        for (let tries = 0; tries < 10; tries++) {
          if (dist2(p.x, p.z, player.pos.x, player.pos.z) > 95) break;
          p = this.world.randomRoadPoint(this.rng);
        }
        const heading = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
        const v = new Vehicle(this.scene, this.look, 'car', p.x, p.z, heading, C.ink);
        v.role = 'police';
        v.ai = true;
        v.targetSpeed = 20;
        v.setPolice();
        this.police.push(v);
        this.vehicles.push(v);
      }
    }
    while (this.police.length > need) {
      const v = this.police.pop();
      v.setVisible(false);
      const i = this.vehicles.indexOf(v);
      if (i >= 0) this.vehicles.splice(i, 1);
    }
    this.sirenTime += dt;
    const flash = Math.floor(this.sirenTime * 5) % 2 === 0;
    for (const v of this.police) {
      if (v.policeLights) {
        v.policeLights[0].visible = flash;
        v.policeLights[1].visible = !flash;
      }
      this._chase(v, dt, player);
    }
  }

  _updatePeds(dt, player, wanted) {
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      const d = dist2(p.x, p.z, player.pos.x, player.pos.z);
      p.fleeing = wanted > 0 && d < 26;
      p.turn -= dt;
      if (p.turn <= 0) {
        p.turn = rand(this.rng, 2.6, 6.5);
        p.heading += rand(this.rng, -1.1, 1.1);
      }
      if (p.fleeing) p.heading = Math.atan2(p.x - player.pos.x, p.z - player.pos.z);
      const sp = p.fleeing ? p.speed * 3.4 : p.speed;
      const nx = p.x + Math.sin(p.heading) * sp * dt;
      const nz = p.z + Math.cos(p.heading) * sp * dt;
      const c = this.world.collide(nx, nz, 0.32);
      if (c.hit) {
        p.heading += Math.PI * (0.7 + this.rng() * 0.6);
        p.turn = 0.8;
      } else {
        p.x = clamp(nx, -440, 440);
        p.z = clamp(nz, -440, 440);
      }
      // Walk bob and hip sway; pedestrians turn to face the way they walk.
      p.phase += dt * (p.fleeing ? 13 : 7.5);
      const bob = Math.abs(Math.sin(p.phase)) * (p.fleeing ? 0.09 : 0.05);
      p.mesh.position.set(p.x, bob, p.z);
      p.mesh.rotation.y = p.heading;
      p.mesh.rotation.z = Math.sin(p.phase * 0.5) * 0.035;
      if (d < 2.2 && !player.vehicle && wanted > 0 && this.crimeCooldown <= 0 && this.crimeGrace <= 0) {
        this.onCrime('ped');
        this.crimeCooldown = 2.5;
      }
    }
  }

  update(dt, player, wanted) {
    this.crimeCooldown = Math.max(0, this.crimeCooldown - dt);
    this.crimeGrace = Math.max(0, this.crimeGrace - dt);
    for (const v of this.vehicles) {
      if (v === player.vehicle) continue;
      if (v.role === 'police') continue;
      if (v.ai) {
        const d = dist2(v.pos.x, v.pos.z, player.pos.x, player.pos.z);
        if (d < 10 && Math.abs(v.speed - player.speed) > 5) v.targetSpeed = 3;
        else v.targetSpeed = 9 + (v._baseSpeed ||= rand(this.rng, 0, 5));
        this._route(v, dt);
        if (d < 2.4 && player.speed > 8 && this.crimeCooldown <= 0 && this.crimeGrace <= 0) {
          this.onCrime('traffic');
          this.crimeCooldown = 2.5;
        }
      }
    }
    this._updatePolice(dt, player, wanted);
    this._updatePeds(dt, player, wanted);
  }
}
