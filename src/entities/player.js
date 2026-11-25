import * as THREE from 'three';
import { C } from '../look/palette.js';
import { clamp, damp } from '../util/math.js';

const matCache = new Map();
const toon = (color, look) => {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap: look.gradientMap }));
  return matCache.get(color);
};

export class Player {
  constructor(scene, look, x, z) {
    this.scene = scene;
    this.look = look;
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = 0;
    this.vy = 0;
    this.onGround = true;
    this.hp = 100;
    this.vehicle = null;
    this.walkPhase = 0;
    this.foot = this._buildFoot();
    scene.add(this.foot);
  }

  _buildFoot() {
    const root = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.0, 0.42), toon(C.coral, this.look));
    torso.position.y = 1.25;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), toon(C.sand, this.look));
    head.position.y = 1.98;
    this.legs = [];
    this.arms = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, 0.24), toon(C.ink, this.look));
      leg.position.set(s * 0.18, 0.45, 0);
      this.legs.push(leg);
      root.add(leg);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.82, 0.19), toon(C.orchid, this.look));
      arm.position.set(s * 0.44, 1.28, 0);
      this.arms.push(arm);
      root.add(arm);
    }
    torso.castShadow = true;
    root.add(torso, head);
    return root;
  }

  get mode() {
    return this.vehicle ? this.vehicle.type : 'foot';
  }

  get speed() {
    return this.vehicle ? Math.abs(this.vehicle.speed) : this._footSpeed || 0;
  }

  setVehicle(v) {
    this.vehicle = v;
    if (v) {
      v.ai = false;
      v.role = 'player';
      this.pos.copy(v.pos);
      this.heading = v.heading;
    }
    this.foot.visible = !v;
  }

  exitVehicle() {
    if (!this.vehicle) return null;
    const v = this.vehicle;
    const side = v.heading + Math.PI / 2;
    v.ai = false;
    v.role = 'parked';
    v.speed = 0;
    this.pos.set(v.pos.x + Math.sin(side) * 2.6, 0, v.pos.z + Math.cos(side) * 2.6);
    this.vehicle = null;
    this.foot.visible = true;
    this.heading = v.heading;
    return v;
  }

  update(dt, input, world, cameraYaw) {
    if (this.vehicle) {
      this.vehicle.applyInput(dt, input.drivingInput(), world);
      this.pos.copy(this.vehicle.pos);
      this.heading = this.vehicle.heading;
      this.foot.visible = false;
      return;
    }

    const a = input.axis();
    const len = Math.hypot(a.x, a.y);
    const ax = len > 1 ? a.x / len : a.x;
    const az = len > 1 ? a.y / len : a.y;
    const fx = Math.sin(cameraYaw);
    const fz = Math.cos(cameraYaw);
    const rx = fz;
    const rz = -fx;
    const mx = fx * az + rx * ax;
    const mz = fz * az + rz * ax;
    const moving = Math.hypot(mx, mz) > 0.05;
    const sprint = input.isDown('boost');
    this._footSpeed = moving ? (sprint ? 12 : 7) : 0;

    if (moving) {
      const c = world.collide(this.pos.x + mx * this._footSpeed * dt, this.pos.z + mz * this._footSpeed * dt, 0.6);
      this.pos.x = c.x;
      this.pos.z = c.z;
      this.heading = damp(this.heading, Math.atan2(mx, mz), 12, dt);
    }
    if ((input.consume('jump') || input.consume('hb')) && this.onGround) {
      this.vy = 9.5;
      this.onGround = false;
    }
    if (!this.onGround) {
      this.vy -= 23 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.vy = 0;
        this.onGround = true;
      }
    }
    this.walkPhase += dt * (moving ? (sprint ? 15 : 10) : 0);
    const swing = moving ? Math.sin(this.walkPhase) * 0.55 : 0;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.7;
    this.arms[1].rotation.x = swing * 0.7;

    this.foot.position.copy(this.pos);
    this.foot.rotation.y = this.heading;
    this.foot.visible = true;
  }
}
