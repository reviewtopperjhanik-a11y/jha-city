import * as THREE from 'three';
import { C } from '../look/palette.js';
import { DEFAULT_STYLE, normalizeStyle } from '../look/wardrobe.js';
import { angleLerp, wrapAngle } from '../util/math.js';
import { createBlobShadow } from './blobshadow.js';

const matCache = new Map();
const toon = (color, look) => {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap: look.gradientMap }));
  return matCache.get(color);
};

export class Player {
  constructor(scene, look, x, z, armor = 0) {
    this.scene = scene;
    this.look = look;
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = 0;
    this.vy = 0;
    this.onGround = true;
    this.hp = 100;
    this.armor = Math.max(0, Math.min(100, armor || 0));
    this.invulnerable = 0;
    // Down-state flags are owned by the player so every system can see the
    // same truth. `dead` is set the instant HP reaches zero, which lets the
    // game layer give death priority over an arrest in the same frame.
    // `busted` is set by the game layer while the BUSTED overlay is up.
    this.dead = false;
    this.busted = false;
    // Reused by onDamage so a hit never allocates an object per frame.
    this._damageSource = { x: 0, z: 0, valid: false, dx: 0, dz: 0, distance: 0 };
    this.vehicle = null;
    // One reused state object drives the short crouch/hop enter/exit pose.
    // No vectors or arrays are allocated while the transition runs.
    this.transition = { mode: 'idle', t: 0, duration: 0.26, vehicle: null, amount: 0 };
    this.walkPhase = 0;
    // Customisable materials are cloned per player so recolouring the avatar
    // never leaks into the cached materials shared with pedestrians.
    this.style = normalizeStyle(DEFAULT_STYLE);
    this.foot = this._buildFoot();
    this.onNotice = () => {};
    this.onDamage = () => {};
    scene.add(this.foot);
    this.shadow = createBlobShadow(0.62);
    this.shadow.position.set(x, 0.045, z);
    scene.add(this.shadow);
  }

  applyStyle(style) {
    this.style = normalizeStyle(style);
    for (const [key, material] of Object.entries(this.styleMats)) {
      material.color.setHex(this.style[key]);
    }
    return this.style;
  }

  _buildFoot() {
    const root = new THREE.Group();
    const skin = toon(DEFAULT_STYLE.skin, this.look).clone();
    const shirt = toon(DEFAULT_STYLE.shirt, this.look).clone();
    const pants = toon(DEFAULT_STYLE.pants, this.look).clone();
    const shoes = toon(0x15182a, this.look);
    const sole = toon(0xe8e3d8, this.look);
    const hair = toon(DEFAULT_STYLE.hair, this.look).clone();
    this.styleMats = { skin, shirt, pants, hair };
    const trim = toon(C.lane, this.look);
    const belt = toon(0x171a28, this.look);
    const white = new THREE.MeshBasicMaterial({ color: 0xf7f3e8 });
    const eye = new THREE.MeshBasicMaterial({ color: 0x10111c });
    const add = (mesh, x, y, z) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      root.add(mesh);
      return mesh;
    };

    // Hips, belt and a shaped torso so the silhouette is not a single box.
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.36), pants), 0, 1.02, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.09, 0.39), belt), 0, 1.18, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.76, 0.4), shirt), 0, 1.56, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.18, 0.38), shirt), 0, 1.86, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.42), shirt), 0, 1.9, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.025), trim), 0, 1.56, 0.213);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.03), trim), 0, 1.8, 0.213);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.42), shirt), 0, 1.21, 0);

    // Neck and head.
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 8), skin), 0, 1.98, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.255, 14, 12), skin), 0, 2.16, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.268, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair), 0, 2.17, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.15), hair), 0, 2.11, -0.19);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.1), hair), -0.09, 2.34, 0.19);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.1), hair), 0.1, 2.33, 0.18);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.19, 0.07), hair), -0.248, 2.1, -0.04);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.19, 0.07), hair), 0.248, 2.1, -0.04);
    for (const s of [-1, 1]) {
      add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skin), s * 0.26, 2.15, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 6), white), s * 0.095, 2.19, 0.226);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 4), eye), s * 0.095, 2.19, 0.262);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.026, 0.035), hair), s * 0.095, 2.245, 0.24);
    }
    add(new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.1, 0.1), skin), 0, 2.12, 0.255);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.02), new THREE.MeshBasicMaterial({ color: 0x9a4d4d })), 0, 2.075, 0.252);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin), 0, 2.02, 0.18);

    this.legs = [];
    this.knees = [];
    this.arms = [];
    this.elbows = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.16, 1.0, 0);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.42, 0.24), pants);
      thigh.position.y = -0.21;
      thigh.castShadow = true;
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.21), pants);
      shin.position.y = -0.2;
      shin.castShadow = true;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.36), shoes);
      shoe.position.set(0, -0.43, 0.06);
      shoe.castShadow = true;
      const shoeSole = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.045, 0.39), sole);
      shoeSole.position.set(0, -0.5, 0.065);
      shoeSole.castShadow = true;
      knee.add(shin, shoe, shoeSole);
      leg.add(thigh, knee);
      this.legs.push(leg);
      this.knees.push(knee);
      root.add(leg);

      const arm = new THREE.Group();
      arm.position.set(s * 0.41, 1.84, 0);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.38, 0.18), shirt);
      upper.position.y = -0.19;
      upper.castShadow = true;
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.19), trim);
      cuff.position.y = -0.39;
      const elbow = new THREE.Group();
      elbow.position.y = -0.4;
      const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.34, 0.15), skin);
      forearm.position.y = -0.17;
      forearm.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), skin);
      hand.position.y = -0.38;
      hand.castShadow = true;
      elbow.add(forearm, hand);
      arm.add(upper, cuff, elbow);
      this.arms.push(arm);
      this.elbows.push(elbow);
      root.add(arm);
    }
    return root;
  }

  get mode() {
    return this.vehicle ? this.vehicle.type : 'foot';
  }

  get speed() {
    return this.vehicle ? Math.abs(this.vehicle.speed) : this._footSpeed || 0;
  }

  get vehicleTransition() {
    return this.transition.mode;
  }

  get transitionProgress() {
    return this.transition.amount;
  }

  get isTransitioning() {
    return this.transition.mode !== 'idle';
  }

  // One read for every caller that must not act on a downed player. Checking
  // hp as well keeps legacy direct assignments to player.hp safe.
  isDown() {
    return this.dead || this.busted || this.hp <= 0;
  }

  // Set by the game layer when the BUSTED overlay opens. It never touches
  // world, save, HUD or clock state — that is the caller's responsibility.
  setBusted(on) {
    this.busted = !!on;
    if (this.busted) this._footSpeed = 0;
    return this.busted;
  }

  _resetTransitionVisuals() {
    const tr = this.transition;
    this.foot.scale.set(1, 1, 1);
    if (tr.vehicle?.mesh) {
      tr.vehicle.mesh.scale.y = 1;
      tr.vehicle.mesh.position.y = 0;
    }
  }

  _startTransition(mode, vehicle = null) {
    this._resetTransitionVisuals();
    const tr = this.transition;
    tr.mode = mode;
    tr.t = 0;
    tr.amount = 0;
    tr.vehicle = mode === 'enter' ? vehicle : null;
  }

  // A tiny weight-shift on the car when getting in, and a crouch-to-hop pose
  // when stepping out. Purely visual: pos/collision and return values stay
  // exactly as they were before the animation existed.
  _applyTransition(dt) {
    const tr = this.transition;
    if (tr.mode === 'idle') return;
    tr.t += dt;
    const p = Math.min(1, tr.t / tr.duration);
    const wave = Math.sin(p * Math.PI);
    tr.amount = wave;
    if (tr.mode === 'enter') {
      const v = tr.vehicle;
      if (v?.mesh) {
        v.mesh.scale.y = 1 - wave * 0.075;
        v.mesh.position.y = -wave * 0.05;
      }
    } else {
      this.foot.scale.set(1 + wave * 0.05, 1 - wave * 0.16, 1 + wave * 0.05);
      this.foot.position.y += wave * 0.3;
      const bend = wave * 0.55;
      this.legs[0].rotation.x += bend;
      this.legs[1].rotation.x -= bend;
      this.knees[0].rotation.x += bend * 0.6;
      this.knees[1].rotation.x += bend * 0.6;
      this.arms[0].rotation.x -= bend * 0.4;
      this.arms[1].rotation.x += bend * 0.4;
      this.shadow.scale.x *= 1 - wave * 0.18;
      this.shadow.scale.z *= 1 - wave * 0.18;
    }
    if (p >= 1) {
      this._resetTransitionVisuals();
      tr.mode = 'idle';
      tr.vehicle = null;
      tr.amount = 0;
    }
  }

  // Optional aliases: setVehicle/exitVehicle already drive the animation.
  enterAnimated(v) {
    return this.setVehicle(v);
  }

  exitAnimated(world) {
    return this.exitVehicle(world);
  }

  setVehicle(v) {
    const previous = this.vehicle;
    if (previous && previous !== v) {
      // Switching cars (including a carjack) leaves the old one parked.
      previous.role = 'parked';
      previous.speed = 0;
    }
    this.vehicle = v;
    if (v) {
      v.ai = false;
      v.role = 'player';
      v.stuckTime = 0;
      this.pos.copy(v.pos);
      this.heading = v.heading;
      this.vy = 0;
      this.onGround = true;
    }
    this.foot.visible = !v;
    this.shadow.visible = !v;
    this._startTransition(v ? 'enter' : 'idle', v);
  }

  exitVehicle(world) {
    if (!this.vehicle) return null;
    const v = this.vehicle;
    // Try both sides, then behind and in front, so the player never steps into a wall.
    let point = null;
    for (const angle of [v.heading + Math.PI / 2, v.heading - Math.PI / 2, v.heading + Math.PI, v.heading]) {
      const x = v.pos.x + Math.sin(angle) * 2.9;
      const z = v.pos.z + Math.cos(angle) * 2.9;
      const c = world?.collide ? world.collide(x, z, 0.55) : { x, z, hit: false };
      if (!c.hit) {
        point = { x, z };
        break;
      }
    }
    if (!point) point = world?.nearestRoad ? world.nearestRoad(v.pos.x, v.pos.z) : { x: v.pos.x, z: v.pos.z };

    v.ai = false;
    v.role = 'parked';
    v.speed = 0;
    v.stuckTime = 0;
    this.pos.set(point.x, 0, point.z);
    this.vehicle = null;
    this.vy = 0;
    this.onGround = true;
    this.heading = v.heading;
    this.foot.visible = true;
    this.foot.position.copy(this.pos);
    this.foot.rotation.set(0, this.heading, 0);
    this.shadow.visible = true;
    this.shadow.position.set(this.pos.x, 0.045, this.pos.z);
    this._startTransition('exit');
    return v;
  }

  damage(amount, source = null) {
    // Once down, later hits in the same frame are ignored. That prevents a
    // police shot arriving after a fatal hit from producing a second overlay.
    if (this.dead || this.hp <= 0 || this.busted || this.invulnerable > 0) return 0;
    const raw = Math.max(0, amount || 0);
    if (raw <= 0) return 0;
    const absorbed = Math.min(this.armor, raw);
    this.armor -= absorbed;
    const toHealth = raw - absorbed;
    this.hp = Math.max(0, this.hp - toHealth);
    const info = this._readDamageSource(source);
    if (this.hp <= 0) this.dead = true;
    this.onDamage(toHealth || raw * 0.15, absorbed > 0, info);
    return toHealth;
  }

  // Every caller describes "who hit me" differently. Fold all of the shapes
  // into one reused object; never dereference a source before checking it.
  _readDamageSource(source) {
    const info = this._damageSource;
    info.x = 0;
    info.z = 0;
    info.valid = false;
    info.dx = 0;
    info.dz = 0;
    info.distance = 0;
    if (!source || (typeof source !== 'object' && typeof source !== 'function')) return info;
    let x;
    let z;
    // Plain {x,z}: actors and THREE.Vector3 both land here.
    if (typeof source.x === 'number' && typeof source.z === 'number') {
      x = source.x;
      z = source.z;
    } else {
      // Vehicles expose .pos; Object3D-ish actors expose .position.
      const pos = source.pos || source.position;
      if (pos && typeof pos === 'object') {
        x = pos.x;
        z = pos.z;
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(z)) return info;
    info.x = x;
    info.z = z;
    info.valid = true;
    const dx = this.pos.x - x;
    const dz = this.pos.z - z;
    const distance = Math.hypot(dx, dz);
    info.distance = distance;
    if (distance > 1e-6) {
      info.dx = dx / distance;
      info.dz = dz / distance;
    }
    return info;
  }

  heal(amount = 35) {
    this.hp = Math.min(100, this.hp + amount);
    // A revive through a health pickup or a safehouse is also a player-state
    // reset; the game layer still owns any overlay that was showing.
    if (this.hp > 0) this.dead = false;
    return this.hp;
  }

  addArmor(amount = 35) {
    this.armor = Math.min(100, this.armor + amount);
    return this.armor;
  }

  // The only reset a death/bust respawn performs: player state and the
  // player's own ride. World, traffic, missions, save, HUD and clock are
  // deliberately untouched here.
  respawnAt(x, z, heading = 0) {
    const previous = this.vehicle;
    if (previous) {
      previous.ai = false;
      previous.role = 'parked';
      previous.speed = 0;
      previous.stuckTime = 0;
    }
    this.vehicle = null;
    this.pos.set(x, 0, z);
    this.heading = wrapAngle(heading);
    this.vy = 0;
    this.onGround = true;
    this.hp = 100;
    this.dead = false;
    this.busted = false;
    this.walkPhase = 0;
    this._footSpeed = 0;
    // Invulnerability is intentionally preserved: the game layer grants respawn
    // grace after calling this method.
    this.foot.position.copy(this.pos);
    this.foot.rotation.set(0, this.heading, 0);
    this.foot.visible = true;
    this.shadow.visible = true;
    this.shadow.position.set(x, 0.045, z);
    this._startTransition('idle');
  }

  update(dt, input, world, cameraYaw, surfaceGrip = 1, aimYaw = null, aiming = false) {
    // Respawn protection (set by the game layer) ticks in both foot and car modes.
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.dead || this.busted) {
      this._footSpeed = 0;
      this._applyTransition(dt);
      return;
    }
    const aimingNow = !!aiming && Number.isFinite(aimYaw) && !this.vehicle;
    if (this.vehicle) {
      const v = this.vehicle;
      const drive = input.drivingInput();
      const px = v.pos.x;
      const pz = v.pos.z;
      v.applyInput(dt, drive, world, surfaceGrip);
      const moved = Math.hypot(v.pos.x - px, v.pos.z - pz);
      const radius = v.type === 'bike' ? 0.75 : 1.15;
      const wedged = world.collide(v.pos.x, v.pos.z, radius).hit;
      const flipped = Math.abs(v.mesh.rotation.x) > 1.15 || Math.abs(v.mesh.rotation.z) > 1.15;
      const expected = Math.abs(v.speed) * dt;
      v.recoverCooldown = Math.max(0, v.recoverCooldown - dt);
      if (Math.abs(drive.throttle) > 0.45 && v.blocked && Math.abs(v.speed) < 2.5 && moved < Math.max(0.004, expected * 0.35)) {
        v.stuckTime += dt;
      } else {
        v.stuckTime = Math.max(0, v.stuckTime - dt * 2);
      }
      if ((v.stuckTime > 2.2 || wedged || flipped) && v.recoverCooldown <= 0) {
        v.recover(world, v.heading);
        v.recoverCooldown = 2;
        this.onNotice(wedged ? 'CLEARED THE WALL' : flipped ? 'VEHICLE RIGHTED' : 'VEHICLE RECOVERED');
      }
      this.pos.copy(v.pos);
      this.heading = v.heading;
      this.foot.visible = false;
      this.shadow.visible = false;
      this._applyTransition(dt);
      return;
    }

    const a = input.axis();
    const len = Math.hypot(a.x, a.y);
    const ax = len > 1 ? a.x / len : a.x;
    const az = len > 1 ? a.y / len : a.y;
    const fx = Math.sin(cameraYaw);
    const fz = Math.cos(cameraYaw);
    // Screen-right is world -x for this chase camera, so strafe uses the flipped right vector.
    const rx = -fz;
    const rz = fx;
    const mx = fx * az + rx * ax;
    const mz = fz * az + rz * ax;
    const moving = Math.hypot(mx, mz) > 0.05;
    const sprint = input.isDown('boost');
    this._footSpeed = moving ? (sprint ? 12 : 7) : 0;

    if (moving) {
      const c = world.collide(this.pos.x + mx * this._footSpeed * dt, this.pos.z + mz * this._footSpeed * dt, 0.6);
      this.pos.x = c.x;
      this.pos.z = c.z;
      // A hard shove into a corner can leave the resolved point still inside a
      // building. That strands the model in unlit geometry (it looks black)
      // and the bad coordinates get auto-saved. Recover to the road at once.
      if (world.collide(this.pos.x, this.pos.z, 0.6).hit) {
        const safe = world.nearestRoad ? world.nearestRoad(this.pos.x, this.pos.z) : null;
        if (safe) {
          this.pos.x = safe.x;
          this.pos.z = safe.z;
          this.onNotice('BACK ON THE STREET');
        }
      }
      if (!aimingNow) {
        this.heading = wrapAngle(angleLerp(this.heading, Math.atan2(mx, mz), 1 - Math.exp(-12 * dt)));
      }
    }
    if (aimingNow) {
      // Full-body aim owns the heading; the movement vector above is still
      // camera-relative, so strafing does not depend on where we look.
      this.heading = wrapAngle(angleLerp(this.heading, aimYaw, 1 - Math.exp(-24 * dt)));
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
    const swing = moving ? Math.sin(this.walkPhase) * 0.58 : 0;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.knees[0].rotation.x = Math.max(0, -swing) * 0.9;
    this.knees[1].rotation.x = Math.max(0, swing) * 0.9;
    this.arms[0].rotation.x = -swing * 0.75;
    this.arms[1].rotation.x = swing * 0.75;
    this.elbows[0].rotation.x = -Math.max(0, swing) * 0.35;
    this.elbows[1].rotation.x = -Math.max(0, -swing) * 0.35;

    this.foot.position.copy(this.pos);
    if (moving && this.onGround) this.foot.position.y += Math.abs(Math.sin(this.walkPhase)) * 0.035;
    this.foot.rotation.y = this.heading;
    this.foot.rotation.z = moving ? Math.sin(this.walkPhase * 0.5) * 0.015 : 0;
    if (aimingNow) {
      // Arms up in a simple two-handed aim pose; no extra geometry or assets.
      this.arms[0].rotation.x = -1.15;
      this.arms[1].rotation.x = -1.15;
      this.elbows[0].rotation.x = -0.2;
      this.elbows[1].rotation.x = -0.2;
    }
    this.foot.visible = true;
    // Jump height shrinks the blob; running stretches it slightly along travel.
    const lift = Math.max(0, this.pos.y);
    const spread = 0.62 * (1 - Math.min(0.5, lift * 0.12));
    const run = moving ? Math.min(0.22, this._footSpeed * 0.014) : 0;
    this.shadow.visible = true;
    this.shadow.position.set(this.pos.x, 0.045, this.pos.z);
    this.shadow.scale.set(spread + run * 0.25, 1, spread * 0.74 + run);
    this._applyTransition(dt);
  }
}
