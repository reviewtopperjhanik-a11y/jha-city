import * as THREE from 'three';
import { Weapons } from './weapons.js';
import { makeRng } from '../util/rng.js';

// Phase 4 — hitscan combat, light auto-aim, simple cover and pooled FX.
// Every hot path writes into objects created in the constructor: no geometry,
// vectors, arrays or state snapshots are allocated while the game is running.

const EMPTY_CTX = Object.freeze({ time: 0, aimYaw: 0, firing: false, aiming: false, autoAim: true });
const CRIME_GAP = 1.5;
const AIM_RANGE = 60;
const AIM_FALLBACK = 80;
const THREAT_CAP = 12;
const NOOP = () => {};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

export class Combat {
  constructor({ scene, look, world, player, police, traffic, wanted, audio, gangs, toast } = {}) {
    this.scene = scene;
    this.look = look;
    this.world = world;
    this.player = player;
    this.police = police;
    this.traffic = traffic;
    this.wanted = wanted;
    this.audio = audio;
    this.gangs = gangs;
    this.toast = typeof toast === 'function' ? toast : () => {};
    // Optional bridges owned by main.js. Neither callback allocates here.
    this.onShot = null;
    this.onHit = NOOP;

    this.weapons = new Weapons();
    this.armed = true;
    this.autoAim = true;
    this.lowQuality = false;
    this.kills = 0;
    this.time = 0;
    this.lastCrimeTime = -99;
    this.lastCover = 1;
    this._triggerHeld = false;
    this._lastShooterX = 0;
    this._lastShooterZ = 0;
    this._hasShooter = false;
    this._hitTarget = null;
    this._hitKind = -1;
    this._hitAlong = 0;
    this._aimDiff = 0;
    this._aimDist = 0;
    this._threatCount = 0;
    this.fireRng = makeRng(51);

    // Reused descriptors for the camera-ray shot and miss tracers. Their
    // identity never changes, even when aim is absent (legacy harnesses).
    this._aimShot = {
      mx: 0, my: 0, mz: 0,
      x: 0, y: 0, z: 0,
      rawX: 0, rawY: 0, rawZ: 0,
      // Normalised ray copied from the caller's pooled descriptor. Hitscan and
      // the tracer both read these fields, so pellets cannot diverge from the
      // drawn line when the camera-ray fallback kicks in.
      ox: 0, oy: 0, oz: 0,
      dx: 0, dy: 0, dz: 1,
      hit: false, range: AIM_FALLBACK,
    };
    // Shotgun pellets use this fixed buffer; no array is built per shot.
    this._pelletOffsets = new Float32Array(8);
    this._shotPoint = { x: 0, z: 0 };

    // Reused output objects — identity is stable across every frame.
    this._state = {
      id: 'pistol', label: 'PISTOL', mag: 0, reserve: 0,
      reloading: false, reloadLeft: 0, cooldown: 0, armed: true, kills: 0,
    };
    this._threatPool = Array.from({ length: THREAT_CAP }, () => ({ x: 0, z: 0 }));
    // Reused view holding references into the pool; its length follows the
    // number of live threats without ever creating a new threat object.
    this._threats = [];

    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._buildFx(scene);
    this.state();
  }

  _buildFx(scene) {
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, toneMapped: false });
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, toneMapped: false });
    const impactMat = new THREE.MeshBasicMaterial({ color: 0x9ff0e8, toneMapped: false });
    const flashGeo = new THREE.ConeGeometry(0.11, 0.46, 5);
    const impactGeo = new THREE.IcosahedronGeometry(0.14, 0);
    this._tracers = [];
    this._flashes = [];
    this._impacts = [];
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.BufferGeometry();
      const arr = new Float32Array(6);
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const line = new THREE.Line(geo, tracerMat);
      line.frustumCulled = false;
      line.visible = false;
      scene?.add?.(line);
      this._tracers.push({ line, arr, geo, life: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(flashGeo, flashMat);
      mesh.visible = false;
      scene?.add?.(mesh);
      this._flashes.push({ mesh, life: 0 });
    }
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(impactGeo, impactMat);
      mesh.visible = false;
      scene?.add?.(mesh);
      this._impacts.push({ mesh, life: 0 });
    }
    this._tracerIndex = 0;
    this._flashIndex = 0;
    this._impactIndex = 0;
  }

  isArmed() {
    return !!this.armed;
  }

  setArmed(armed) {
    this.armed = !!armed;
    if (!this.armed) this._triggerHeld = false;
    return this.armed;
  }

  setAutoAim(on) {
    this.autoAim = !!on;
    return this.autoAim;
  }

  setLowQuality(low) {
    this.lowQuality = !!low;
    if (this.lowQuality) {
      for (let i = 0; i < this._flashes.length; i++) this._flashes[i].mesh.visible = false;
      for (let i = 0; i < this._impacts.length; i++) this._impacts[i].mesh.visible = false;
    }
    this.gangs?.setLowQuality?.(this.lowQuality);
  }

  reset() {
    this.weapons.reset();
    this.kills = 0;
    this.time = 0;
    this.lastCrimeTime = -99;
    this.lastCover = 1;
    this._triggerHeld = false;
    this._hasShooter = false;
    this._hitTarget = null;
    this._hitKind = -1;
    for (let i = 0; i < this._tracers.length; i++) {
      this._tracers[i].life = 0;
      this._tracers[i].line.visible = false;
    }
    for (let i = 0; i < this._flashes.length; i++) {
      this._flashes[i].life = 0;
      this._flashes[i].mesh.visible = false;
    }
    for (let i = 0; i < this._impacts.length; i++) {
      this._impacts[i].life = 0;
      this._impacts[i].mesh.visible = false;
    }
    this.state();
    return this._state;
  }

  serialize() {
    return {
      weapons: this.weapons.serialize(),
      armed: this.armed,
      kills: this.kills,
      autoAim: this.autoAim,
    };
  }

  restore(data) {
    const saved = data && typeof data === 'object' ? data : null;
    this.weapons.restore(saved?.weapons || saved);
    this.armed = saved ? saved.armed !== false : true;
    this.kills = Math.max(0, Math.floor(finite(saved?.kills, 0)));
    this.autoAim = !saved || saved.autoAim !== false;
    this.lastCrimeTime = -99;
    this._triggerHeld = false;
    this.state();
    return this._state;
  }

  update(dt, ctx) {
    const frame = ctx || EMPTY_CTX;
    const step = clamp(finite(dt, 0), 0, 0.1);
    const time = finite(frame.time, this.time);
    this.time = time;
    this.weapons.update(step);
    this._updateFx(step);

    const px = this.player?.pos?.x || 0;
    const pz = this.player?.pos?.z || 0;
    const rawYaw = Number.isFinite(frame.aimYaw) ? frame.aimYaw : finite(this.player?.heading, 0);
    const firing = !!frame.firing;
    const aiming = !!frame.aiming;
    // The caller may already have applied resolveAimYaw (main.js does). Never
    // pull twice; only assist here when a raw camera yaw was supplied.
    const yaw = Number.isFinite(frame.aimYaw)
      ? frame.aimYaw
      : this._resolveYaw(rawYaw, aiming, this.autoAim && frame.autoAim !== false);

    const down = !!(this.player && typeof this.player.isDown === 'function' && this.player.isDown());
    if (!down && firing && this.isArmed() && this.weapons.canFire()) {
      const auto = !!this.weapons.stats.auto;
      if (auto || !this._triggerHeld) this.fireOnce(frame, yaw);
    }
    this._triggerHeld = firing && !down;

    this._policeFire(step, time, px, pz);
    this.state();
    return this._state;
  }

  fireOnce(ctx, yaw = null) {
    const frame = ctx || EMPTY_CTX;
    const time = finite(frame.time, this.time);
    this.time = time;
    if (!this.isArmed() || !this.weapons.beginShot()) return false;

    const stats = this.weapons.stats;
    if (typeof this.onShot === 'function') this.onShot(stats.id);
    const px = this.player?.pos?.x || 0;
    const py = finite(this.player?.pos?.y, 0);
    const pz = this.player?.pos?.z || 0;
    const shotYaw = yaw === null
      ? (Number.isFinite(frame.aimYaw) ? frame.aimYaw : finite(this.player?.heading, 0))
      : yaw;
    const fx = Math.sin(shotYaw);
    const fz = Math.cos(shotYaw);
    // main.js supplies one pooled camera-ray descriptor. Harnesses that call
    // fireOnce/update without it keep the original yaw-cone behaviour.
    const aim = frame.aim && typeof frame.aim === 'object' ? frame.aim : null;
    const shot = aim ? this._prepareAim(px, py, pz, shotYaw, aim) : null;
    this._reportCrime(1, time, px, pz);
    this.audio?.shot?.(stats.id);
    this._spawnShotFx(px, py, pz, fx, fz, stats.range, shot);

    const pellets = Math.max(1, Math.min(this._pelletOffsets.length, Math.floor(stats.pellets) || 1));
    let target = null;
    if (pellets === 1) {
      // Pistol/SMG keep the original single-hitscan arithmetic exactly.
      this._resetHit();
      this._scanTargets(this.police?.officers, 0, shotYaw, stats.range, stats.spread, px, pz, shot);
      this._scanTargets(this.gangs?.actors?.(), 1, shotYaw, stats.range, stats.spread, px, pz, shot);
      this._scanTargets(this.traffic?.peds, 2, shotYaw, stats.range, stats.spread * 0.7, px, pz, shot);
      target = this._applyHit(this._hitTarget, this._hitKind, stats.damage, time, px, pz);
    } else {
      // A shotgun round is a spread of independent pellets. Each pellet may
      // reach a different target and damage falls off with distance, so a
      // point-blank blast is strong without one-shotting across the whole map.
      for (let i = 0; i < pellets; i++) {
        const offset = ((i + 0.5) / pellets - 0.5) * stats.spread * 1.25
          + (this.fireRng() * 2 - 1) * stats.spread * 0.45;
        this._pelletOffsets[i] = offset;
        this._resetHit();
        this._scanTargets(this.police?.officers, 0, shotYaw, stats.range, stats.spread, px, pz, shot, offset);
        this._scanTargets(this.gangs?.actors?.(), 1, shotYaw, stats.range, stats.spread, px, pz, shot, offset);
        this._scanTargets(this.traffic?.peds, 2, shotYaw, stats.range, stats.spread * 0.7, px, pz, shot, offset);
        const damage = stats.damage * this._damageFalloff(this._hitAlong, stats.range);
        const hit = this._applyHit(this._hitTarget, this._hitKind, damage, time, px, pz);
        if (hit && !target) target = hit;
      }
    }

    // The crosshair impact is drawn first so its pooled slot is stable even
    // when the same shot also hits a body.
    if (shot) this._spawnImpact(shot.rawX, shot.rawZ, shot.rawY);
    if (!shot && target) {
      this._spawnImpact(this._hitKind === 2 ? target.x : finite(target.x, px),
        this._hitKind === 2 ? target.z : finite(target.z, pz));
    }
    if (target) {
      this.onHit(target);
      this.audio?.hit?.();
    }
    return true;
  }

  _resetHit() {
    this._hitTarget = null;
    this._hitKind = -1;
    this._hitAlong = 0;
  }

  _damageFalloff(along, range) {
    return clamp(1 - Math.max(0, along) / (Math.max(1, range) * 1.3), 0.42, 1);
  }

  // Returns the target that was actually damaged. All three owner hooks keep
  // their original signature; no target list or damage record is allocated.
  _applyHit(target, kind, damage, time, px, pz) {
    if (!target) return null;
    let downed = false;
    if (kind === 0) {
      downed = typeof this.police?.damageOfficer === 'function'
        ? this.police.damageOfficer(target, damage)
        : this._fallbackDamage(target, damage);
    } else if (kind === 1) {
      downed = typeof this.gangs?.damageActor === 'function'
        ? this.gangs.damageActor(target, damage)
        : this._fallbackDamage(target, damage);
    } else {
      downed = typeof this.traffic?.knockPed === 'function'
        ? this.traffic.knockPed(target, damage)
        : this._fallbackDamage(target, damage);
      if (target.mesh) target.mesh.userData.knocked = true;
      // Shooting a civilian is a much bigger crime than firing into the air.
      this._reportCrime(2, time, px, pz, true);
      this.toast('CIVILIAN SHOT — WITNESSES CALLING');
    }
    if (downed) this.kills++;
    return target;
  }

  reload() {
    const started = this.weapons.reload();
    if (started) this.audio?.reload?.();
    return started;
  }

  cycleWeapon() {
    this.weapons.cycle();
    this.audio?.blip?.(520, 0.05, 'square', 0.04);
    return this.state();
  }

  state() {
    const weapon = this.weapons.state();
    const out = this._state;
    out.id = weapon.id;
    out.label = weapon.label;
    out.mag = weapon.mag;
    out.reserve = weapon.reserve;
    out.reloading = weapon.reloading;
    out.reloadLeft = weapon.reloadLeft;
    out.cooldown = weapon.cooldown;
    out.armed = this.armed;
    out.kills = this.kills;
    return out;
  }

  threats() {
    const out = this._threats;
    out.length = 0;
    this._threatCount = 0;
    const px = this.player?.pos?.x || 0;
    const pz = this.player?.pos?.z || 0;
    const officers = this.police?.officers;
    if (officers) {
      for (let i = 0; i < officers.length; i++) {
        const o = officers[i];
        if (!o || Number.isFinite(o.hp) && o.hp <= 0) continue;
        this._threatPush(o.x, o.z, px, pz);
      }
    }
    const actors = this.gangs?.actors?.();
    if (actors) {
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        if (!a || Number.isFinite(a.hp) && a.hp <= 0) continue;
        this._threatPush(a.x, a.z, px, pz);
      }
    }
    return out;
  }

  coverFactor(source = null) {
    let factor;
    if (source && Number.isFinite(source.x) && Number.isFinite(source.z)) {
      this._lastShooterX = source.x;
      this._lastShooterZ = source.z;
      this._hasShooter = true;
      factor = this._coverFrom(source.x, source.z);
    } else if (this._hasShooter) {
      factor = this._coverFrom(this._lastShooterX, this._lastShooterZ);
    } else {
      factor = this._probeCover();
    }
    this.lastCover = factor;
    return factor;
  }

  resolveAimYaw(baseYaw, options) {
    // No default-options literal here: HUD calls this every frame.
    return this._resolveYaw(baseYaw, options?.aiming === true, options?.autoAim !== false);
  }

  _resolveYaw(baseYaw, aiming, autoAim) {
    const yaw = finite(baseYaw, 0);
    if (!autoAim || !this.autoAim || !this.player?.pos) return yaw;
    const px = this.player.pos.x;
    const pz = this.player.pos.z;
    this._aimDiff = 0;
    this._aimDist = 0;
    this._scanAim(this.police?.officers, yaw, px, pz);
    this._scanAim(this.gangs?.actors?.(), yaw, px, pz);
    if (!this._aimDist) return yaw;
    const pull = Math.min(aiming ? 0.198 : 0.13, 0.045 + (1 - this._aimDist / AIM_RANGE) * 0.15);
    const delta = clamp(this._aimDiff, -pull, pull);
    const result = yaw + delta;
    return Math.atan2(Math.sin(result), Math.cos(result));
  }

  _scanAim(list, yaw, px, pz) {
    if (!list) return;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    for (let i = 0; i < list.length; i++) {
      const target = list[i];
      if (!target || Number.isFinite(target.hp) && target.hp <= 0) continue;
      const dx = target.x - px;
      const dz = target.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < 0.1 || d > AIM_RANGE || (this._aimDist && d >= this._aimDist)) continue;
      const along = dx * fx + dz * fz;
      if (along <= 0) continue;
      const angle = Math.atan2(dx, dz);
      const diff = Math.atan2(Math.sin(angle - yaw), Math.cos(angle - yaw));
      if (Math.abs(diff) > 0.42) continue;
      if (this._lineFraction(px, pz, target.x, target.z) < 0.95) continue;
      this._aimDist = d;
      this._aimDiff = diff;
    }
  }

  _scanTargets(list, kind, yaw, range, spread, px, pz, aim = null, offset = 0) {
    if (!list) return;
    const fx = Math.sin(yaw + offset);
    const fz = Math.cos(yaw + offset);
    const rx = Math.cos(yaw + offset);
    const rz = -Math.sin(yaw + offset);
    const useAim = !!aim;
    let ox = px;
    let oz = pz;
    let adx = fx;
    let adz = fz;
    let wallAlong = Infinity;
    if (useAim) {
      // main.js already raycast geometry. `_aimShot` holds the same normalised
      // direction and endpoint the tracer draws, so shots cannot diverge from
      // the crosshair when the near-camera fallback was used.
      ox = finite(aim.ox, px);
      oz = finite(aim.oz, pz);
      adx = finite(aim.dx, fx);
      adz = finite(aim.dz, fz);
      const al = Math.hypot(adx, adz);
      if (al > 1e-5) {
        adx /= al;
        adz /= al;
      } else {
        adx = fx;
        adz = fz;
      }
      if (offset !== 0) {
        // Rotate the camera forward by the pellet offset: right = (dz, -dx).
        const c = Math.cos(offset);
        const s = Math.sin(offset);
        const bx = adx * c + adz * s;
        adz = adz * c - adx * s;
        adx = bx;
      }
      if (aim.hit && Number.isFinite(aim.x) && Number.isFinite(aim.z)) {
        wallAlong = (aim.x - ox) * adx + (aim.z - oz) * adz;
      }
    }
    const pxRay = -adz;
    const pzRay = adx;
    for (let i = 0; i < list.length; i++) {
      const target = list[i];
      if (!target || Number.isFinite(target.hp) && target.hp <= 0) continue;
      const dx = target.x - px;
      const dz = target.z - pz;
      let along;
      let perp;
      let width;
      if (useAim) {
        const rayX = target.x - ox;
        const rayZ = target.z - oz;
        along = rayX * adx + rayZ * adz;
        if (along <= 0.2 || along > range || along >= wallAlong) continue;
        // Much tighter than the old 0.72 + along * spread yaw cone: the camera
        // crosshair, not the body yaw, decides what the bullet reaches.
        perp = Math.abs(rayX * pxRay + rayZ * pzRay);
        width = 0.4 + along * spread * 0.35;
      } else {
        along = dx * fx + dz * fz;
        if (along <= 0.2 || along > range) continue;
        perp = Math.abs(dx * rx + dz * rz);
        width = (kind === 2 ? 0.5 : 0.72) + along * spread;
      }
      // Prefer armed enemies over civilians standing closer to the muzzle.
      const score = kind === 2 ? along + 25 : along;
      if (this._hitTarget && score >= this._hitAlong) continue;
      if (perp > width) continue;
      if (this._lineFraction(px, pz, target.x, target.z) < 0.9) continue;
      this._hitTarget = target;
      this._hitKind = kind;
      this._hitAlong = score;
    }
  }

  _fallbackDamage(target, amount) {
    if (!target) return false;
    target.hp = finite(target.hp, 1) - amount;
    return target.hp <= 0;
  }

  _reportCrime(amount, time, x, z, force = false) {
    if (typeof this.wanted?.crime !== 'function') return;
    if (!force && this.lastCrimeTime >= 0 && time - this.lastCrimeTime < CRIME_GAP) return;
    this.wanted.crime(amount, time, x, z);
    this.lastCrimeTime = time;
  }

  _policeFire(dt, time, px, pz) {
    const officers = this.police?.officers;
    if (!officers || !this.player?.damage) return;
    // A fatal hit and an arrest can arrive in the same frame. Once the player
    // is down no further police shot may land or spawn a second hit reaction.
    if (typeof this.player.isDown === 'function' && this.player.isDown()) return;
    const stars = Math.max(0, Math.floor(finite(this.wanted?.stars, 0)));
    for (let i = 0; i < officers.length; i++) {
      const officer = officers[i];
      if (!officer || Number.isFinite(officer.hp) && officer.hp <= 0) continue;
      // Police owns its own gunfire when it tracks fireCooldown; don't double
      // damage the player in that case.
      if (Number.isFinite(officer.fireCooldown)) continue;
      officer.combatCooldown = finite(officer.combatCooldown, 0) - dt;
      if (officer.combatCooldown > 0) continue;
      const dx = px - officer.x;
      const dz = pz - officer.z;
      const d = Math.hypot(dx, dz);
      if (d > 38 || this._lineFraction(officer.x, officer.z, px, pz) < 0.95) continue;
      this.coverFactor(officer);
      // 0.55..0.7 hit chance as stars rise. Stars 0 is the offline harness
      // path (police.js never shoots then), so it stays deterministic.
      const chance = stars > 0 ? clamp(0.55 + (Math.min(stars, 5) - 1) * 0.0375, 0.55, 0.7) : 1;
      const hit = chance >= 1 || this.fireRng() < chance;
      const dmg = Math.min(7, Math.max(1, Math.round(
        (5 + Math.min(2, Math.max(0, stars - 2))) * this.lastCover,
      )));
      if (hit) {
        this.player.damage(dmg, officer);
        this._shotPoint.x = px;
        this._shotPoint.z = pz;
      } else {
        const spread = 2.4 + d * 0.05;
        this._shotPoint.x = px + (this.fireRng() * 2 - 1) * spread;
        this._shotPoint.z = pz + (this.fireRng() * 2 - 1) * spread;
      }
      this._tracerTo(officer.x, officer.z, this._shotPoint.x, this._shotPoint.z);
      officer.combatCooldown = 1.35 + (i % 3) * 0.35;
      this._hasShooter = true;
      this._lastShooterX = officer.x;
      this._lastShooterZ = officer.z;
    }
  }

  // Line tracers come from the same eight-slot pool as player shots.
  _tracerTo(ax, az, bx, bz) {
    const tracer = this._tracers[this._tracerIndex++ % this._tracers.length];
    tracer.arr[0] = ax;
    tracer.arr[1] = 1.35;
    tracer.arr[2] = az;
    tracer.arr[3] = bx;
    tracer.arr[4] = 1.35;
    tracer.arr[5] = bz;
    tracer.geo.attributes.position.needsUpdate = true;
    tracer.line.visible = true;
    tracer.life = 0.1;
  }

  _lineFraction(ax, az, bx, bz) {
    if (typeof this.world?.cameraRay === 'function') {
      this._from.set(ax, 1.45, az);
      this._to.set(bx, 1.45, bz);
      return clamp(this.world.cameraRay(this._from, this._to, 0.18), 0, 1);
    }
    if (typeof this.world?.collide === 'function') {
      const dx = bx - ax;
      const dz = bz - az;
      const d = Math.hypot(dx, dz);
      if (d < 2) return 1;
      const steps = Math.max(2, Math.min(16, Math.ceil(d / 4)));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (this.world.collide(ax + dx * t, az + dz * t, 0.14)?.hit) return t;
      }
    }
    return 1;
  }

  _coverFrom(sx, sz) {
    const px = this.player?.pos?.x || 0;
    const pz = this.player?.pos?.z || 0;
    const clear = this._lineFraction(sx, sz, px, pz);
    let factor = clamp(0.25 + clear * 0.75, 0.25, 1);
    // A wall right next to the player still helps even if the ray technically
    // reaches the muzzle.
    const dx = px - sx;
    const dz = pz - sz;
    const d = Math.hypot(dx, dz) || 1;
    const nearX = px + (dx / d) * 1.4;
    const nearZ = pz + (dz / d) * 1.4;
    if (this.world?.collide?.(nearX, nearZ, 0.4)?.hit) factor = Math.min(factor, 0.5);
    return factor;
  }

  _probeCover() {
    if (!this.player?.pos || !this.world) return 1;
    const px = this.player.pos.x;
    const pz = this.player.pos.z;
    const h = finite(this.player.heading, 0);
    const clear = this._lineFraction(px - Math.sin(h) * 3, pz - Math.cos(h) * 3, px, pz);
    let factor = clamp(0.25 + clear * 0.75, 0.25, 1);
    if (this.world?.collide?.(px + Math.sin(h) * 1.3, pz + Math.cos(h) * 1.3, 0.4)?.hit) {
      factor = Math.min(factor, 0.5);
    }
    return factor;
  }

  _threatPush(x, z, px, pz) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (Math.hypot(x - px, z - pz) > 70 || this._threatCount >= THREAT_CAP) return;
    const slot = this._threatPool[this._threatCount];
    slot.x = x;
    slot.z = z;
    this._threats.push(slot);
    this._threatCount++;
  }

  // Fills the reused aim/muzzle descriptor from main's pooled camera ray.
  // Consumes aim.x/y/z (ray endpoint), ox/oy/oz (ray origin), dx/dy/dz
  // (normalised camera forward), hit (geometry flag) and range (far fallback).
  _prepareAim(px, py, pz, yaw, aim) {
    const out = this._aimShot;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    // Right-hand muzzle: player.pos + forward * 0.55 + right * 0.3.
    out.mx = px + fx * 0.55 + rx * 0.3;
    out.my = py + 1.45;
    out.mz = pz + fz * 0.55 + rz * 0.3;

    let ex = finite(aim.x, NaN);
    let ey = finite(aim.y, NaN);
    let ez = finite(aim.z, NaN);
    const rawX = ex;
    const rawY = ey;
    const rawZ = ez;
    let dx = finite(aim.dx, 0);
    let dy = finite(aim.dy, 0);
    let dz = finite(aim.dz, 0);
    const dl = Math.hypot(dx, dy, dz);
    if (dl > 1e-5) {
      dx /= dl;
      dy /= dl;
      dz /= dl;
    } else {
      dx = fx;
      dy = 0;
      dz = fz;
    }
    const valid = Number.isFinite(ex) && Number.isFinite(ey) && Number.isFinite(ez);
    const near = valid && Math.hypot(ex - px, ez - pz) < 2;
    // Copy the ray that will actually be drawn. A sub-2m hit is a camera pull
    // near the player, not a wall in front of the muzzle, so it never blocks
    // hitscan targets downrange.
    out.ox = finite(aim.ox, px);
    out.oy = finite(aim.oy, out.my);
    out.oz = finite(aim.oz, pz);
    out.dx = dx;
    out.dy = dy;
    out.dz = dz;
    out.range = clamp(finite(aim.range, AIM_FALLBACK), 1, AIM_FALLBACK);
    out.hit = valid && !near && !!aim.hit;
    if (!valid || near) {
      const dist = clamp(finite(aim.range, AIM_FALLBACK), 1, AIM_FALLBACK);
      if (near) {
        // Crosshair landed almost on the player: extend camera forward.
        ex = out.mx + dx * dist;
        ey = out.my + dy * dist;
        ez = out.mz + dz * dist;
      } else {
        // No endpoint at all: project the camera origin along its ray.
        ex = finite(aim.ox, out.mx) + dx * dist;
        ey = finite(aim.oy, out.my) + dy * dist;
        ez = finite(aim.oz, out.mz) + dz * dist;
      }
    }
    out.x = ex;
    out.y = ey;
    out.z = ez;
    if (!valid || near) {
      out.rawX = ex;
      out.rawY = ey;
      out.rawZ = ez;
    } else {
      out.rawX = rawX;
      out.rawY = rawY;
      out.rawZ = rawZ;
    }
    return out;
  }

  _spawnShotFx(px, py, pz, fx, fz, range, aim = null) {
    const a = this._aimShot;
    const mx = aim ? a.mx : px + fx * 0.7;
    const my = aim ? a.my : py + 1.45;
    const mz = aim ? a.mz : pz + fz * 0.7;
    const length = Math.min(range, 62);
    const ex = aim ? a.x : px + fx * length;
    const ey = aim ? a.y : my;
    const ez = aim ? a.z : pz + fz * length;
    if (!this.lowQuality) {
      const flash = this._flashes[this._flashIndex++ % this._flashes.length];
      flash.mesh.position.set(mx, my, mz);
      flash.mesh.rotation.set(0, Math.atan2(fx, fz), Math.PI / 2);
      flash.mesh.visible = true;
      flash.life = 0.07;
    }

    // LOW keeps a single cheap tracer; HIGH adds a flash and impacts.
    const tracerCount = this.lowQuality ? 1 : 2;
    for (let k = 0; k < tracerCount; k++) {
      const tracer = this._tracers[this._tracerIndex++ % this._tracers.length];
      tracer.arr[0] = mx;
      tracer.arr[1] = my;
      tracer.arr[2] = mz;
      tracer.arr[3] = ex;
      tracer.arr[4] = ey;
      tracer.arr[5] = ez;
      tracer.geo.attributes.position.needsUpdate = true;
      tracer.line.visible = true;
      tracer.life = 0.1;
    }
  }

  _spawnImpact(x, z, y = 1.45) {
    if (this.lowQuality) return;
    const impact = this._impacts[this._impactIndex++ % this._impacts.length];
    impact.mesh.position.set(x, y, z);
    impact.mesh.scale.setScalar(1);
    impact.mesh.visible = true;
    impact.life = 0.22;
  }

  _updateFx(dt) {
    for (let i = 0; i < this._tracers.length; i++) {
      const fx = this._tracers[i];
      if (fx.life <= 0) continue;
      fx.life -= dt;
      if (fx.life <= 0) fx.line.visible = false;
    }
    for (let i = 0; i < this._flashes.length; i++) {
      const fx = this._flashes[i];
      if (fx.life <= 0) continue;
      fx.life -= dt;
      if (fx.life <= 0) fx.mesh.visible = false;
    }
    for (let i = 0; i < this._impacts.length; i++) {
      const fx = this._impacts[i];
      if (fx.life <= 0) continue;
      fx.life -= dt;
      if (fx.life <= 0) fx.mesh.visible = false;
      else fx.mesh.scale.setScalar(1 + (0.22 - fx.life) * 3);
    }
  }
}
