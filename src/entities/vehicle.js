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
const glowMats = new Map();
const glow = (color) => {
  if (!glowMats.has(color)) glowMats.set(color, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  return glowMats.get(color);
};

export class Vehicle {
  constructor(scene, look, type, x, z, heading, color = C.flamingo) {
    this.scene = scene;
    this.look = look;
    this.type = type;
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.color = color;
    this.baseColor = color;
    this.health = 100;
    this.boost = 100;
    this.upgrades = { engine: false, armor: false };
    this.ai = false;
    this.role = 'parked';
    this.stuckTime = 0;
    this.recoverCooldown = 0;
    this.blocked = false;
    this.aiInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    this.mesh = this._build();
    this.bodyMaterial = mat(color, this.look);
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
      const handleGeo = g('carHandle', () => new THREE.BoxGeometry(0.05, 0.06, 0.28));
      const stripeGeo = g('carStripe', () => new THREE.BoxGeometry(0.035, 0.08, 3.4));
      const hubGeo = g('carHub', () => new THREE.CylinderGeometry(0.24, 0.24, 0.07, 10));
      const rim = mat(0xc9d3e8, this.look);
      const trim = mat(0x8ff0e8, this.look);
      for (const x of [-1.26, 1.26]) {
        const m = new THREE.Mesh(mirrorGeo, body);
        m.position.set(x, 1.44, 0.82);
        root.add(m);
        for (const z of [-0.55, 0.65]) {
          const handle = new THREE.Mesh(handleGeo, trim);
          handle.position.set(x * 0.97, 1.06, z);
          root.add(handle);
        }
        const stripe = new THREE.Mesh(stripeGeo, trim);
        stripe.position.set(x * 0.99, 0.93, 0);
        root.add(stripe);
      }
      for (const x of [-1.18, 1.18]) {
        for (const z of [-1.5, 1.5]) {
          const hub = new THREE.Mesh(hubGeo, rim);
          hub.rotation.z = Math.PI / 2;
          hub.position.set(x + Math.sign(x) * 0.17, 0.5, z);
          root.add(hub);
        }
      }
      const grille = new THREE.Mesh(g('carGrille', () => new THREE.BoxGeometry(1.25, 0.16, 0.09)), dark);
      grille.position.set(0, 0.72, 2.34);
      const plate = new THREE.Mesh(g('carPlate', () => new THREE.BoxGeometry(0.62, 0.16, 0.06)), glow(0xf6e6c8));
      plate.position.set(0, 0.55, 2.4);
      root.add(grille, plate);
      root.add(shell, cabin, glassBand, roof, bumperF, bumperR);
      shell.castShadow = cabin.castShadow = roof.castShadow = true;
    } else {
      // A low, forward-leaning sportbike: spoked wheels, tapered nose fairing,
      // sculpted tank, fork, swingarm, exhaust and a tucked-in rider.
      const rim = mat(0x9aa2c4, this.look);
      const steel = mat(0x3a3f5c, this.look);
      const glass = mat(0x17233d, this.look);
      const visor = new THREE.MeshBasicMaterial({ color: 0x1b2b52, toneMapped: false });
      const neon = glow(C.teal);
      const add = (mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
        mesh.position.set(x, y, z);
        mesh.rotation.set(rx, ry, rz);
        mesh.castShadow = true;
        root.add(mesh);
        return mesh;
      };

      const tyreGeo = g('bikeTyre', () => new THREE.CylinderGeometry(0.55, 0.55, 0.2, 14));
      const rimGeo = g('bikeRim', () => new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12));
      const spokeGeo = g('bikeSpoke', () => new THREE.BoxGeometry(0.055, 0.055, 0.58));
      for (const z of [-1.02, 1.08]) {
        const wheel = new THREE.Group();
        wheel.position.set(0, 0.58, z);
        wheel.add(new THREE.Mesh(tyreGeo, dark), new THREE.Mesh(rimGeo, rim));
        wheel.children[0].rotation.z = Math.PI / 2;
        wheel.children[1].rotation.z = Math.PI / 2;
        for (let i = 0; i < 4; i++) {
          const spoke = new THREE.Mesh(spokeGeo, steel);
          spoke.rotation.x = (i * Math.PI) / 4;
          wheel.add(spoke);
        }
        this.wheels.push(wheel);
        root.add(wheel);
      }

      add(new THREE.Mesh(g('bikeSpine', () => new THREE.BoxGeometry(0.34, 0.28, 1.6)), dark), 0, 0.92, 0);
      const nose = add(new THREE.Mesh(g('bikeNose', () => new THREE.CylinderGeometry(0.3, 0.52, 1.0, 6)), body), 0, 1.1, 1.0, Math.PI / 2);
      const tank = add(new THREE.Mesh(g('bikeTank', () => new THREE.SphereGeometry(0.5, 12, 10)), body), 0, 1.14, 0.12);
      tank.scale.set(0.95, 0.56, 1.5);
      const tail = add(new THREE.Mesh(g('bikeTail', () => new THREE.BoxGeometry(0.44, 0.2, 0.8)), body), 0, 1.14, -0.86, -0.12);
      add(new THREE.Mesh(g('bikeSeat', () => new THREE.BoxGeometry(0.42, 0.12, 0.72)), dark), 0, 1.27, -0.48);
      add(new THREE.Mesh(g('bikeScreen', () => new THREE.BoxGeometry(0.48, 0.38, 0.06)), glass), 0, 1.56, 1.28, -0.34);
      for (const x of [-0.16, 0.16]) {
        add(new THREE.Mesh(g('bikeLamp', () => new THREE.BoxGeometry(0.17, 0.13, 0.1)), glow(0xfff1c2)), x, 1.06, 1.5);
        add(new THREE.Mesh(g('bikeFork', () => new THREE.CylinderGeometry(0.055, 0.055, 0.92, 6)), steel), x, 0.94, 1.02, -0.34);
        add(new THREE.Mesh(g('bikeStripe', () => new THREE.BoxGeometry(0.025, 0.035, 0.72)), neon), x * 2.4, 1.18, 0.12);
      }
      add(new THREE.Mesh(g('bikeSwing', () => new THREE.BoxGeometry(0.14, 0.12, 0.95)), steel), 0.2, 0.64, -0.52);
      add(new THREE.Mesh(g('bikeExhaust', () => new THREE.CylinderGeometry(0.1, 0.12, 0.8, 8)), rim), -0.34, 0.7, -0.52, Math.PI / 2);
      add(new THREE.Mesh(g('bikeBar', () => new THREE.BoxGeometry(1.0, 0.08, 0.1)), steel), 0, 1.52, 0.8);
      add(new THREE.Mesh(g('bikeTailLight', () => new THREE.BoxGeometry(0.32, 0.12, 0.08)), glow(0xff4a5e)), 0, 1.2, -1.27);
      void nose;
      void tail;

      // Rider in a racing tuck: helmet with a dark visor, leaning torso,
      // arms on the bars and knees tucked against the tank.
      const skin = mat(0xd9a06b, this.look);
      const jacket = mat(C.orchid, this.look);
      const pants = mat(0x2a3050, this.look);
      const shoes = mat(0x15182a, this.look);
      const helmet = mat(0x141827, this.look);
      add(new THREE.Mesh(g('riderHips', () => new THREE.BoxGeometry(0.42, 0.26, 0.34)), pants), 0, 1.28, -0.32);
      add(new THREE.Mesh(g('riderTorso', () => new THREE.BoxGeometry(0.52, 0.72, 0.36)), jacket), 0, 1.68, -0.08, -0.5);
      add(new THREE.Mesh(g('riderHelmet', () => new THREE.SphereGeometry(0.28, 12, 10)), helmet), 0, 2.05, 0.34);
      add(new THREE.Mesh(g('riderVisor', () => new THREE.BoxGeometry(0.4, 0.14, 0.08)), visor), 0, 2.06, 0.6);
      for (const s of [-1, 1]) {
        add(new THREE.Mesh(g('riderArm', () => new THREE.BoxGeometry(0.13, 0.68, 0.15)), jacket), s * 0.3, 1.66, 0.3, 0.72);
        add(new THREE.Mesh(g('riderHand', () => new THREE.SphereGeometry(0.085, 8, 6)), skin), s * 0.46, 1.48, 0.79);
        add(new THREE.Mesh(g('riderThigh', () => new THREE.BoxGeometry(0.2, 0.56, 0.22)), pants), s * 0.22, 1.14, 0.06, 0.95);
        add(new THREE.Mesh(g('riderShin', () => new THREE.BoxGeometry(0.17, 0.5, 0.19)), pants), s * 0.25, 0.83, 0.24, -0.4);
        add(new THREE.Mesh(g('riderShoe', () => new THREE.BoxGeometry(0.2, 0.13, 0.34)), shoes), s * 0.25, 0.6, 0.42);
      }
    }
    return root;
  }

  setPolice() {
    if (this.policeLights) return;
    const white = mat(0xe8e8f0, this.look);
    const dark = mat(0x141827, this.look);

    // White door panels and a hood stripe make the cruiser read as a police car
    // even when the light bar is off.
    const doorGeo = g('policeDoor', () => new THREE.BoxGeometry(0.035, 0.5, 1.55));
    for (const x of [-1.22, 1.22]) {
      const door = new THREE.Mesh(doorGeo, white);
      door.position.set(x, 1.02, 0.12);
      this.mesh.add(door);
    }
    const hood = new THREE.Mesh(g('policeHood', () => new THREE.BoxGeometry(0.92, 0.035, 1.25)), white);
    hood.position.set(0, 1.245, 1.45);
    const trunk = new THREE.Mesh(g('policeTrunk', () => new THREE.BoxGeometry(0.92, 0.035, 0.8)), white);
    trunk.position.set(0, 1.245, -1.55);
    this.mesh.add(hood, trunk);

    // Push bar.
    const barGeo = g('policePush', () => new THREE.BoxGeometry(1.85, 0.15, 0.15));
    const push = new THREE.Mesh(barGeo, dark);
    push.position.set(0, 0.74, 2.52);
    this.mesh.add(push);
    for (const x of [-0.65, 0.65]) {
      const upright = new THREE.Mesh(g('policePushUp', () => new THREE.BoxGeometry(0.13, 0.62, 0.13)), dark);
      upright.position.set(x, 0.62, 2.52);
      this.mesh.add(upright);
    }

    const barRed = new THREE.Mesh(
      g('policeRed', () => new THREE.BoxGeometry(0.62, 0.18, 0.3)),
      new THREE.MeshBasicMaterial({ color: 0xff2b4d, toneMapped: false }),
    );
    barRed.position.set(-0.34, 2.0, -0.14);
    const barBlue = new THREE.Mesh(
      g('policeBlue', () => new THREE.BoxGeometry(0.62, 0.18, 0.3)),
      new THREE.MeshBasicMaterial({ color: 0x3a7bff, toneMapped: false }),
    );
    barBlue.position.set(0.34, 2.0, -0.14);
    const barBase = new THREE.Mesh(
      g('policeBar', () => new THREE.BoxGeometry(1.55, 0.09, 0.4)),
      new THREE.MeshBasicMaterial({ color: 0x141827 }),
    );
    barBase.position.set(0, 1.9, -0.14);
    this.mesh.add(barBase, barRed, barBlue);
    this.policeLights = [barRed, barBlue];
  }

  get maxHealth() {
    return this.upgrades.armor ? 160 : 100;
  }

  get maxSpeed() {
    const base = this.type === 'bike' ? 38 : 31;
    return base * (this.upgrades.engine ? 1.18 : 1);
  }

  setColor(color) {
    if (color === this.color) return;
    const next = mat(color, this.look);
    for (const child of this.mesh.children) {
      if (child.material === this.bodyMaterial) child.material = next;
    }
    this.bodyMaterial = next;
    this.color = color;
    this.baseColor = color;
  }

  applyUpgrades(flags = {}) {
    this.upgrades.engine = !!flags.engine;
    this.upgrades.armor = !!flags.armor;
    this.health = Math.min(this.maxHealth, Math.max(this.health, this.maxHealth));
    if (flags.color != null) this.setColor(flags.color);
  }

  applyInput(dt, input, world, surfaceGrip = 1) {
    this.blocked = false;
    const boosting = input.boost && this.boost > 1;
    const traction = clamp(surfaceGrip, 0.55, 1);
    const max = this.maxSpeed * (boosting ? 1.35 : 1);
    const accel = (boosting ? 30 : 17) * (this.upgrades.engine ? 1.18 : 1) * (input.throttle || 0) * traction;
    const braking = (input.brake || 0) * 25 * traction;

    this.speed += accel * dt;
    this.speed -= braking * dt;
    this.speed -= this.speed * dt * (input.handbrake ? 1.7 : 0.55);
    if (boosting) this.boost = Math.max(0, this.boost - dt * 22);
    else this.boost = Math.min(100, this.boost + dt * 9);
    this.speed = clamp(this.speed, -8, max);

    const grip = clamp(Math.abs(this.speed) / 9, 0.12, 1);
    const rate = (this.type === 'bike' ? 2.3 : 1.75) * grip * (0.5 + 0.5 * traction) * (input.handbrake ? 1.5 : 1);
    // Screen-right is world -x for a chase camera behind the vehicle: invert steer.
    this.heading = wrapAngle(this.heading - (input.steer || 0) * rate * dt * (this.speed < -0.5 ? -1 : 1));

    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
    const c = world.collide(nx, nz, this.type === 'bike' ? 0.75 : 1.15);
    if (c.hit) {
      this.blocked = true;
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
      if (impact > 5) {
        const resistance = this.upgrades.armor ? 0.55 : 1;
        this.health = Math.max(0, this.health - impact * 0.055 * resistance);
      }
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
