import * as THREE from 'three';
import { C } from '../look/palette.js';
import { clamp, damp, TAU, wrapAngle } from '../util/math.js';

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
    this.stuckTime = 0;
    this.recoverCooldown = 0;
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
      const glassBand = new THREE.Mesh(g('carGlass', () => new THREE.BoxGeometry(2.09, 0.34, 2.54)), mat(0x17233d, this.look));
      glassBand.position.set(0, 1.55, -0.15);
      const roof = new THREE.Mesh(g('carRoof', () => new THREE.BoxGeometry(2.1, 0.1, 2.56)), body);
      roof.position.set(0, 1.9, -0.15);
      const bumperGeo = g('carBumper', () => new THREE.BoxGeometry(2.36, 0.22, 0.2));
      const bumperF = new THREE.Mesh(bumperGeo, dark);
      bumperF.position.set(0, 0.56, 2.28);
      const bumperR = new THREE.Mesh(bumperGeo, dark);
      bumperR.position.set(0, 0.56, -2.28);
      const lampGeo = g('carLamp', () => new THREE.BoxGeometry(0.55, 0.22, 0.12));
      for (const x of [-0.85, 0.85]) {
        const l = new THREE.Mesh(lampGeo, glow(0xfff1c2));
        l.position.set(x, 0.85, 2.33);
        root.add(l);
      }
      for (const x of [-0.85, 0.85]) {
        const t = new THREE.Mesh(g('carTail', () => new THREE.BoxGeometry(0.48, 0.18, 0.12)), glow(0xff4a5e));
        t.position.set(x, 0.86, -2.33);
        root.add(t);
      }
      const mirrorGeo = g('carMirror', () => new THREE.BoxGeometry(0.16, 0.1, 0.24));
      for (const x of [-1.26, 1.26]) {
        const m = new THREE.Mesh(mirrorGeo, body);
        m.position.set(x, 1.44, 0.82);
        root.add(m);
      }
      root.add(shell, cabin, glassBand, roof, bumperF, bumperR);
      shell.castShadow = cabin.castShadow = roof.castShadow = true;
    } else {
      const frame = new THREE.Mesh(g('bikeFrame', () => new THREE.BoxGeometry(0.48, 0.46, 1.95)), body);
      frame.position.y = 0.82;
      const tank = new THREE.Mesh(g('bikeTank', () => new THREE.BoxGeometry(0.52, 0.34, 0.8)), body);
      tank.position.set(0, 1.08, 0.18);
      const seat = new THREE.Mesh(g('bikeSeat', () => new THREE.BoxGeometry(0.48, 0.16, 0.62)), dark);
      seat.position.set(0, 1.02, -0.48);
      const wheelGeo = g('bikeWheel', () => new THREE.CylinderGeometry(0.56, 0.56, 0.18, 14));
      for (const z of [-0.98, 0.98]) {
        const w = new THREE.Mesh(wheelGeo, dark);
        w.rotation.z = Math.PI / 2;
        w.position.set(0, 0.58, z);
        this.wheels.push(w);
        root.add(w);
      }
      const bars = new THREE.Mesh(g('bikeBars', () => new THREE.BoxGeometry(1.15, 0.1, 0.12)), dark);
      bars.position.set(0, 1.36, 0.64);
      const lamp = new THREE.Mesh(g('bikeLamp', () => new THREE.SphereGeometry(0.2, 10, 8)), glow(0xfff1c2));
      lamp.position.set(0, 0.95, 1.04);
      root.add(frame, tank, seat, bars, lamp);

      // Detailed seated rider: head, hair, eyes, hands, bent legs, shoes.
      const skin = mat(0xd9a06b, this.look);
      const hair = mat(0x2b1a12, this.look);
      const jacket = mat(C.orchid, this.look);
      const pants = mat(0x2a3050, this.look);
      const shoes = mat(0x15182a, this.look);
      const eye = new THREE.MeshBasicMaterial({ color: 0x0c0d1b });
      const part = (mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
        mesh.position.set(x, y, z);
        mesh.rotation.set(rx, ry, rz);
        mesh.castShadow = true;
        root.add(mesh);
        return mesh;
      };
      part(new THREE.Mesh(g('riderHips', () => new THREE.BoxGeometry(0.5, 0.3, 0.36)), pants), 0, 1.18, -0.28);
      part(new THREE.Mesh(g('riderTorso', () => new THREE.BoxGeometry(0.56, 0.76, 0.38)), jacket), 0, 1.58, -0.18, -0.22);
      const head = part(new THREE.Mesh(g('riderHead', () => new THREE.SphereGeometry(0.26, 12, 10)), skin), 0, 2.1, 0.02);
      part(new THREE.Mesh(g('riderHair', () => new THREE.SphereGeometry(0.272, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)), hair), 0, 2.12, 0.0);
      part(new THREE.Mesh(g('riderEye', () => new THREE.SphereGeometry(0.032, 6, 4)), eye), -0.09, 2.14, 0.245);
      part(new THREE.Mesh(g('riderEye', () => new THREE.SphereGeometry(0.032, 6, 4)), eye), 0.09, 2.14, 0.245);
      part(new THREE.Mesh(g('riderNose', () => new THREE.BoxGeometry(0.06, 0.07, 0.08)), skin), 0, 2.05, 0.27);
      // Arms reaching the handlebars.
      for (const s of [-1, 1]) {
        part(new THREE.Mesh(g('riderArm', () => new THREE.BoxGeometry(0.14, 0.72, 0.16)), jacket), s * 0.31, 1.6, 0.0, 0.55);
        part(new THREE.Mesh(g('riderHand', () => new THREE.SphereGeometry(0.09, 8, 6)), skin), s * 0.31, 1.33, 0.56);
        // Bent legs on the pegs.
        part(new THREE.Mesh(g('riderThigh', () => new THREE.BoxGeometry(0.22, 0.62, 0.24)), pants), s * 0.21, 1.03, 0.02, 1.0);
        part(new THREE.Mesh(g('riderShin', () => new THREE.BoxGeometry(0.18, 0.55, 0.2)), pants), s * 0.24, 0.72, 0.3, -0.35);
        part(new THREE.Mesh(g('riderShoe', () => new THREE.BoxGeometry(0.22, 0.14, 0.36)), shoes), s * 0.24, 0.52, 0.48);
      }
      void head;
    }
    return root;
  }

  setPolice() {
    if (this.policeLights) return;
    const barRed = new THREE.Mesh(
      g('policeRed', () => new THREE.BoxGeometry(0.5, 0.16, 0.24)),
      new THREE.MeshBasicMaterial({ color: 0xff2b4d, toneMapped: false }),
    );
    barRed.position.set(-0.28, 1.98, -0.18);
    const barBlue = new THREE.Mesh(
      g('policeBlue', () => new THREE.BoxGeometry(0.5, 0.16, 0.24)),
      new THREE.MeshBasicMaterial({ color: 0x3a7bff, toneMapped: false }),
    );
    barBlue.position.set(0.28, 1.98, -0.18);
    const barBase = new THREE.Mesh(
      g('policeBar', () => new THREE.BoxGeometry(1.3, 0.08, 0.34)),
      new THREE.MeshBasicMaterial({ color: 0x141827 }),
    );
    barBase.position.set(0, 1.9, -0.18);
    this.mesh.add(barBase, barRed, barBlue);
    this.policeLights = [barRed, barBlue];
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
    // Screen-right is world -x for a chase camera behind the vehicle: invert steer.
    this.heading = wrapAngle(this.heading - (input.steer || 0) * rate * dt * (this.speed < -0.5 ? -1 : 1));

    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
    const c = world.collide(nx, nz, this.type === 'bike' ? 0.75 : 1.15);
    if (c.hit) {
      // Slide along a wall instead of stopping dead against it.
      const slideX = world.collide(nx, this.pos.z, this.type === 'bike' ? 0.75 : 1.15);
      const slideZ = world.collide(this.pos.x, nz, this.type === 'bike' ? 0.75 : 1.15);
      if (!slideX.hit) this.pos.x = nx;
      else if (!slideZ.hit) this.pos.z = nz;
      else {
        this.pos.x = c.x;
        this.pos.z = c.z;
      }
      const impact = Math.abs(this.speed);
      this.speed *= 0.55;
      if (impact > 5) this.health = Math.max(0, this.health - impact * 0.055);
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    const lim = world.GRID.HALF;
    const cx = clamp(this.pos.x, -lim, lim);
    const cz = clamp(this.pos.z, -lim, lim);
    if (cx !== this.pos.x || cz !== this.pos.z) {
      this.pos.x = cx;
      this.pos.z = cz;
      this.speed *= 0.4;
    }

    this._sync(dt, input.steer || 0, boosting, input.handbrake, input.brake || 0, input.throttle || 0);
  }

  _sync(dt, steer = 0, boosting = false, handbrake = false, brake = 0, throttle = 0) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    const lean = steer * clamp(Math.abs(this.speed) / 22, 0, 1) * (this.type === 'bike' ? 0.42 : 0.13);
    this.mesh.rotation.z = damp(this.mesh.rotation.z, lean, 8, dt || 0.016);
    const pitch = this.type === 'bike'
      ? (boosting && throttle > 0.4 ? -0.16 : brake > 0.5 ? 0.12 : 0)
      : (brake > 0.5 ? 0.05 : -0.02);
    this.mesh.rotation.x = damp(this.mesh.rotation.x, pitch, 7, dt || 0.016);
    for (const w of this.wheels) w.rotation.x = (w.rotation.x + this.speed * (dt || 0.016) * 2.2) % TAU;
  }

  teleport(x, z, heading = this.heading) {
    this.pos.set(x, 0, z);
    this.heading = wrapAngle(heading);
    this.speed = 0;
    this.stuckTime = 0;
    this.mesh.rotation.x = 0;
    this.mesh.rotation.z = 0;
    this._sync(0);
  }

  recover(world, heading = this.heading) {
    const r = this.type === 'bike' ? 0.75 : 1.15;
    const h = wrapAngle(heading);
    const base = world?.nearestRoad ? world.nearestRoad(this.pos.x, this.pos.z) : { x: this.pos.x, z: this.pos.z };
    // nearestRoad can land inside a wall after odd collisions, so test a few
    // points around it and pick the first clear one.
    const spots = [
      base,
      { x: base.x + Math.sin(h) * 9, z: base.z + Math.cos(h) * 9 },
      { x: base.x - Math.sin(h) * 9, z: base.z - Math.cos(h) * 9 },
      { x: base.x + Math.cos(h) * 9, z: base.z - Math.sin(h) * 9 },
      { x: base.x - Math.cos(h) * 9, z: base.z + Math.sin(h) * 9 },
    ];
    let spot = base;
    for (const s of spots) {
      const inCity = world?.GRID ? Math.abs(s.x) < world.GRID.HALF - 4 && Math.abs(s.z) < world.GRID.HALF - 4 : true;
      if (inCity && (!world?.collide || !world.collide(s.x, s.z, r).hit)) {
        spot = s;
        break;
      }
    }
    this.pos.set(spot.x, 0, spot.z);
    this.heading = h;
    this.speed = 0;
    this.stuckTime = 0;
    this.mesh.rotation.x = 0;
    this.mesh.rotation.z = 0;
    this._sync(0);
  }

  setVisible(v) {
    this.mesh.visible = v;
  }
}
