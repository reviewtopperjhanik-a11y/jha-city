import * as THREE from 'three';
import { C } from '../look/palette.js';
import { clamp, damp, TAU } from '../util/math.js';

const geo = {};
const mats = new Map();
const g = (key, make) => (geo[key] ||= make());
const mat = (color, look) => {
  const key = color;
  if (!mats.has(key)) {
    mats.set(key, new THREE.MeshToonMaterial({ color, gradientMap: look.gradientMap }));
  }
  return mats.get(key);
};
const glow = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });

export class Vehicle {
  constructor(scene, look, type, x, z, heading, color = C.flamingo) {
    this.scene = scene;
    this.look = look;
    this.type = type;
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.color = color;
    this.health = 100;
    this.boost = 100;
    this.ai = false;
    this.role = 'parked';
    this.aiInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    this.mesh = this._build();
    this.scene.add(this.mesh);
    this._sync(0, 0);
  }

  _build() {
    const root = new THREE.Group();
    const body = mat(this.color, this.look);
    const dark = mat(C.ink, this.look);
    this.wheels = [];

    if (this.type === 'car') {
      const shell = new THREE.Mesh(g('carBody', () => new THREE.BoxGeometry(2.4, 0.9, 4.6)), body);
      shell.position.y = 0.78;
      const cabin = new THREE.Mesh(g('carCabin', () => new THREE.BoxGeometry(2.05, 0.78, 2.5)), body);
      cabin.position.set(0, 1.5, -0.15);
      const wheelGeo = g('carWheel', () => new THREE.CylinderGeometry(0.48, 0.48, 0.3, 12));
      for (const x of [-1.18, 1.18]) {
        for (const z of [-1.5, 1.5]) {
          const w = new THREE.Mesh(wheelGeo, dark);
          w.rotation.z = Math.PI / 2;
          w.position.set(x, 0.5, z);
          this.wheels.push(w);
          root.add(w);
        }
      }
      const lampGeo = g('carLamp', () => new THREE.BoxGeometry(0.55, 0.22, 0.12));
      for (const x of [-0.85, 0.85]) {
        const l = new THREE.Mesh(lampGeo, glow(0xfff1c2));
        l.position.set(x, 0.85, 2.33);
        root.add(l);
      }
      root.add(shell, cabin);
      shell.castShadow = cabin.castShadow = true;
    } else {
      const frame = new THREE.Mesh(g('bikeFrame', () => new THREE.BoxGeometry(0.55, 0.5, 1.9)), body);
      frame.position.y = 0.85;
      const wheelGeo = g('bikeWheel', () => new THREE.CylinderGeometry(0.56, 0.56, 0.18, 14));
      for (const z of [-0.98, 0.98]) {
        const w = new THREE.Mesh(wheelGeo, dark);
        w.rotation.z = Math.PI / 2;
        w.position.set(0, 0.58, z);
        this.wheels.push(w);
        root.add(w);
      }
      const bars = new THREE.Mesh(g('bikeBars', () => new THREE.BoxGeometry(1.15, 0.12, 0.14)), dark);
      bars.position.set(0, 1.32, 0.62);
      const rider = new THREE.Mesh(g('rider', () => new THREE.BoxGeometry(0.6, 0.95, 0.45)), mat(C.orchid, this.look));
      rider.position.set(0, 1.45, -0.15);
      rider.rotation.x = -0.35;
      const head = new THREE.Mesh(g('head', () => new THREE.SphereGeometry(0.28, 10, 8)), mat(C.sand, this.look));
      head.position.set(0, 2.1, -0.05);
      const lamp = new THREE.Mesh(g('bikeLamp', () => new THREE.SphereGeometry(0.22, 10, 8)), glow(0xfff1c2));
      lamp.position.set(0, 0.95, 1.02);
      root.add(frame, bars, rider, head, lamp);
      frame.castShadow = rider.castShadow = true;
    }
    return root;
  }

  get maxSpeed() {
    return this.type === 'bike' ? 38 : 31;
  }

  applyInput(dt, input, world) {
    const boosting = input.boost && this.boost > 1;
    const max = this.maxSpeed * (boosting ? 1.35 : 1);
    const accel = (boosting ? 30 : 17) * (input.throttle || 0);
    const braking = (input.brake || 0) * 25;

    this.speed += accel * dt;
    this.speed -= braking * dt;
    this.speed -= this.speed * dt * (input.handbrake ? 1.7 : 0.55);
    if (boosting) this.boost = Math.max(0, this.boost - dt * 22);
    else this.boost = Math.min(100, this.boost + dt * 9);
    this.speed = clamp(this.speed, -8, max);

    const grip = clamp(Math.abs(this.speed) / 9, 0.12, 1);
    const rate = (this.type === 'bike' ? 2.3 : 1.75) * grip * (input.handbrake ? 1.5 : 1);
    this.heading += (input.steer || 0) * rate * dt * (this.speed < -0.5 ? -1 : 1);

    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
    const c = world.collide(nx, nz, this.type === 'bike' ? 0.75 : 1.15);
    if (c.hit) {
      this.speed *= 0.28;
      this.pos.x = c.x;
      this.pos.z = c.z;
      this.health = Math.max(0, this.health - Math.abs(this.speed) * 0.08);
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    const lim = world.GRID.HALF + 30;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);

    this._sync(dt, input.steer || 0, boosting, input.handbrake, input.brake || 0, input.throttle || 0);
  }

  _sync(dt, steer = 0, boosting = false, handbrake = false, brake = 0, throttle = 0) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    const lean = -steer * clamp(Math.abs(this.speed) / 22, 0, 1) * (this.type === 'bike' ? 0.42 : 0.13);
    this.mesh.rotation.z = damp(this.mesh.rotation.z, lean, 8, dt || 0.016);
    const pitch = this.type === 'bike'
      ? (boosting && throttle > 0.4 ? -0.16 : brake > 0.5 ? 0.12 : 0)
      : (brake > 0.5 ? 0.05 : -0.02);
    this.mesh.rotation.x = damp(this.mesh.rotation.x, pitch, 7, dt || 0.016);
    for (const w of this.wheels) w.rotation.x = (w.rotation.x + this.speed * (dt || 0.016) * 2.2) % TAU;
  }

  teleport(x, z, heading = this.heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this._sync(0);
  }

  setVisible(v) {
    this.mesh.visible = v;
  }
}
