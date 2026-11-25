import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';
import { C } from '../look/palette.js';
import { makeRng, rand, randInt, pick } from '../util/rng.js';
import { clamp, dist2, angleLerp } from '../util/math.js';

const carColors = [C.amber, C.teal, C.coral, C.tangerine, C.dusk, C.flamingo, 0xe8e8f0];

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
    // Two parked bikes available from the start.
    this.vehicles.push(new Vehicle(scene, look, 'bike', 8, 55, 0, C.flamingo));
    this.vehicles.push(new Vehicle(scene, look, 'car', -9, 55, 0, C.teal));

    const bodyGeo = new THREE.CapsuleGeometry(0.24, 0.7, 4, 8);
    const headGeo = new THREE.SphereGeometry(0.21, 8, 6);
    const bodyMat = new THREE.MeshToonMaterial({ color: C.orchid, gradientMap: look.gradientMap });
    const headMat = new THREE.MeshToonMaterial({ color: C.sand, gradientMap: look.gradientMap });
    this.pedBody = new THREE.InstancedMesh(bodyGeo, bodyMat, 30);
    this.pedHead = new THREE.InstancedMesh(headGeo, headMat, 30);
    this.pedBody.castShadow = true;
    scene.add(this.pedBody, this.pedHead);
    for (let i = 0; i < 30; i++) {
      const x = rand(this.rng, -400, 400);
      const z = rand(this.rng, -400, 400);
      this.peds.push({
        x,
        z,
        heading: rand(this.rng, 0, Math.PI * 2),
        speed: rand(this.rng, 1.2, 2.6),
        turn: rand(this.rng, 0, 4),
        fleeing: false,
      });
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._one = new THREE.Vector3(1, 1, 1);
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
    const need = wanted > 0 ? Math.min(wanted + 1, 4) : 0;
    while (this.police.length < need) {
      const p = this.world.randomRoadPoint(this.rng);
      const v = new Vehicle(this.scene, this.look, 'car', player.pos.x + rand(this.rng, -60, 60), player.pos.z + rand(this.rng, -60, 60), 0, C.dusk);
      v.role = 'police';
      v.ai = true;
      v.targetSpeed = 20;
      this.police.push(v);
      this.vehicles.push(v);
      void p;
    }
    while (this.police.length > need) {
      const v = this.police.pop();
      v.setVisible(false);
      const i = this.vehicles.indexOf(v);
      if (i >= 0) this.vehicles.splice(i, 1);
    }
    for (const v of this.police) this._chase(v, dt, player);
  }

  _updatePeds(dt, player, wanted) {
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      const d = dist2(p.x, p.z, player.pos.x, player.pos.z);
      p.fleeing = wanted > 0 && d < 22;
      p.turn -= dt;
      if (p.turn <= 0) {
        p.turn = rand(this.rng, 2, 6);
        p.heading += rand(this.rng, -1.2, 1.2);
      }
      if (p.fleeing) p.heading = Math.atan2(p.x - player.pos.x, p.z - player.pos.z);
      const sp = p.fleeing ? p.speed * 3 : p.speed;
      p.x += Math.sin(p.heading) * sp * dt;
      p.z += Math.cos(p.heading) * sp * dt;
      p.x = clamp(p.x, -440, 440);
      p.z = clamp(p.z, -440, 440);
      this._m.compose(new THREE.Vector3(p.x, 0.7, p.z), this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading), this._one);
      this.pedBody.setMatrixAt(i, this._m);
      this._m.compose(new THREE.Vector3(p.x, 1.45, p.z), this._q, this._one);
      this.pedHead.setMatrixAt(i, this._m);
      if (d < 1.6 && wanted > 0 && this.crimeCooldown <= 0) {
        this.onCrime('ped');
        this.crimeCooldown = 2.5;
      }
    }
    this.pedBody.instanceMatrix.needsUpdate = true;
    this.pedHead.instanceMatrix.needsUpdate = true;
  }

  update(dt, player, wanted) {
    this.crimeCooldown = Math.max(0, this.crimeCooldown - dt);
    for (const v of this.vehicles) {
      if (v === player.vehicle) continue;
      if (v.role === 'police') continue;
      if (v.ai) {
        const d = dist2(v.pos.x, v.pos.z, player.pos.x, player.pos.z);
        if (d < 10 && Math.abs(v.speed - player.speed) > 5) v.targetSpeed = 3;
        else v.targetSpeed = 9 + (v._baseSpeed ||= rand(this.rng, 0, 5));
        this._route(v, dt);
        if (d < 2.4 && player.speed > 8 && this.crimeCooldown <= 0) {
          this.onCrime('traffic');
          this.crimeCooldown = 2.5;
        }
      }
    }
    this._updatePolice(dt, player, wanted);
    this._updatePeds(dt, player, wanted);
  }
}
