import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '../util/rng.js';

// Phase 4 — original neon street crews. Their silhouette (angular jacket,
// visor bar, spiked hair) is deliberately different from the navy/hi-vis
// police officers. Everything is procedural, pooled and low-poly: no texture
// files, no blur and no geometry created after construction.

const MAX_ACTORS = 8;
const LOW_CAP = 5;
const TAU = Math.PI * 2;
const CREW_COLORS = [0xcc46a0, 0x2fb6b2, 0x813dbb];
const ACCENT_COLORS = [0xff885f, 0xf6e6c8, 0xffa948];

function tint(geometry, color) {
  const count = geometry.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

function makeCrewGeometry(color) {
  const parts = [];
  const jacket = new THREE.Color(color);
  const dark = new THREE.Color(0x141327);
  const skin = new THREE.Color(0xc98f63);
  const add = (geo, c) => parts.push(tint(geo, c));
  const box = (w, h, d, x, y, z, c) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    add(g, c);
  };
  const cone = (r, h, x, y, z, c) => {
    const g = new THREE.ConeGeometry(r, h, 6);
    g.translate(x, y, z);
    add(g, c);
  };

  box(0.56, 0.8, 0.38, 0, 1.44, 0, jacket);
  box(0.6, 0.1, 0.4, 0, 1.14, 0, dark);
  box(0.72, 0.14, 0.4, 0, 1.82, 0, dark);
  box(0.07, 0.72, 0.03, 0, 1.46, 0.205, dark);
  for (const s of [-1, 1]) {
    box(0.15, 0.58, 0.17, s * 0.37, 1.48, 0, jacket);
    box(0.19, 0.72, 0.21, s * 0.15, 0.46, 0, dark);
    box(0.21, 0.12, 0.33, s * 0.15, 0.08, 0.05, skin);
  }
  const head = new THREE.SphereGeometry(0.24, 8, 6);
  head.translate(0, 2.08, 0);
  add(head, skin);
  cone(0.26, 0.4, 0, 2.38, -0.03, jacket);
  cone(0.1, 0.3, -0.16, 2.34, -0.06, jacket);
  cone(0.1, 0.26, 0.16, 2.31, -0.06, jacket);

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

export class Gangs {
  constructor(scene, look, world, { toast } = {}) {
    this.scene = scene;
    this.look = look;
    this.world = world;
    this.toast = typeof toast === 'function' ? toast : () => {};
    // Dedicated accuracy stream: one roll per shot, no per-frame allocation.
    this.fireRng = makeRng(51);
    this.lowQuality = false;
    this.cap = MAX_ACTORS;
    this.wave = 0;
    this.spawnTimer = 0.35;
    this.spawnAngle = 0;

    // Preallocated reused views and ray endpoints — updates never construct
    // THREE objects or arrays.
    this._actors = [];
    this._visible = [];
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._bodies = CREW_COLORS.map(makeCrewGeometry);
    this._glowGeo = new THREE.BoxGeometry(0.38, 0.045, 0.04);
    const bodyMat = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: look?.gradientMap || null,
    });
    const glowMats = ACCENT_COLORS.map((color) => new THREE.MeshBasicMaterial({
      color, toneMapped: false,
    }));
    this._bodyMat = bodyMat;
    this._glowMats = glowMats;

    for (let i = 0; i < MAX_ACTORS; i++) {
      const faction = i % CREW_COLORS.length;
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(this._bodies[faction], bodyMat);
      mesh.castShadow = true;
      const glow = new THREE.Mesh(this._glowGeo, glowMats[faction]);
      glow.position.set(0, 1.63, 0.2);
      group.add(mesh, glow);
      group.visible = false;
      scene?.add?.(group);
      this._actors.push({
        x: 0, z: 0, hp: 54, heading: 0, group, mesh, glow,
        faction, slot: i, active: false, cooldown: 0, life: 0, stride: 0, speed: 5.4,
      });
    }
  }

  actors() {
    return this._visible;
  }

  setLowQuality(low) {
    this.lowQuality = !!low;
    this.cap = this.lowQuality ? LOW_CAP : MAX_ACTORS;
    for (let i = 0; i < this._actors.length; i++) {
      const actor = this._actors[i];
      actor.glow.visible = !this.lowQuality;
      if (this.lowQuality && i >= this.cap && actor.active) this._deactivate(actor);
    }
    this._rebuildVisible();
  }

  clearAll() {
    for (let i = 0; i < this._actors.length; i++) this._deactivate(this._actors[i]);
    this._visible.length = 0;
    this.spawnTimer = 0.35;
    this.wave = 0;
  }

  damageActor(actor, amount) {
    if (!actor || !actor.active) return false;
    const damage = Number(amount);
    if (!Number.isFinite(damage) || damage <= 0) return false;
    actor.hp -= damage;
    if (actor.hp > 0) return false;
    this._deactivate(actor);
    this._removeVisible(actor);
    return true;
  }

  update(dt, player, wanted, time) {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    const stars = Number(wanted?.stars) || 0;
    if (stars < 3 || !player?.pos) {
      if (this._visible.length) this.clearAll();
      return;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this._visible.length < this.cap) {
      this._spawnWave(player, stars);
      this.spawnTimer = stars >= 5 ? 5.5 : stars >= 4 ? 7 : 8.5;
    }

    const px = player.pos.x;
    const pz = player.pos.z;
    for (let i = 0; i < this._actors.length; i++) {
      const actor = this._actors[i];
      if (!actor.active) continue;
      actor.life += dt;
      actor.cooldown -= dt;
      const dx = px - actor.x;
      const dz = pz - actor.z;
      const d = Math.hypot(dx, dz);
      if (d > 92 || actor.life > 58) {
        this._deactivate(actor);
        this._removeVisible(actor);
        i--;
        continue;
      }

      actor.heading = Math.atan2(dx, dz);
      if (d > 9) {
        const step = Math.min(actor.speed * dt, d - 8.5);
        let nx = actor.x + Math.sin(actor.heading) * step;
        let nz = actor.z + Math.cos(actor.heading) * step;
        let blocked = this.world?.collide?.(nx, nz, 0.42)?.hit;
        if (blocked) {
          nx = actor.x + Math.cos(actor.heading) * step;
          nz = actor.z - Math.sin(actor.heading) * step;
          blocked = this.world?.collide?.(nx, nz, 0.42)?.hit;
        }
        if (!blocked) {
          actor.x = nx;
          actor.z = nz;
        }
      }

      if (actor.glow.userData.flash > 0) {
        actor.glow.userData.flash -= dt;
        if (actor.glow.userData.flash <= 0) actor.glow.scale.setScalar(1);
      }

      actor.stride += dt * 10;
      actor.group.position.set(actor.x, Math.abs(Math.sin(actor.stride)) * 0.035, actor.z);
      actor.group.rotation.y = actor.heading;
      actor.mesh.rotation.z = Math.sin(actor.stride) * 0.035;

      if (d < 40 && actor.cooldown <= 0 && this._lineClear(actor.x, actor.z, px, pz)) {
        // A wave still flashes on every shot, but only ~55% of shots land.
        // Damage stays <= 6 so two hits cannot drop a healthy player.
        if (this.fireRng() < 0.55) {
          const damage = Math.min(6, 4 + (actor.slot % 3));
          player.damage?.(damage, actor);
        }
        actor.cooldown = 1.05 + (actor.slot % 4) * 0.24;
        this._flash(actor);
      }
    }
  }

  _flash(actor) {
    if (this.lowQuality) return;
    actor.glow.visible = true;
    actor.glow.scale.setScalar(1.8);
    actor.glow.userData.flash = 0.09;
  }

  _spawnWave(player, stars) {
    this.wave++;
    this.spawnAngle = player.heading + (this.wave * 1.73) % TAU;
    const count = Math.min(stars >= 5 ? 3 : 2, this.cap - this._visible.length);
    let spawned = 0;
    for (let slot = 0; slot < this._actors.length && spawned < count; slot++) {
      const actor = this._actors[slot];
      if (actor.active) continue;
      const angle = this.spawnAngle + (spawned / count) * TAU * 0.55;
      const radius = 27 + ((this.wave * 7 + slot * 3) % 13);
      let x = player.pos.x + Math.sin(angle) * radius;
      let z = player.pos.z + Math.cos(angle) * radius;
      if (this.world?.collide?.(x, z, 0.5)?.hit) {
        x = player.pos.x - Math.sin(angle) * radius;
        z = player.pos.z - Math.cos(angle) * radius;
        if (this.world?.collide?.(x, z, 0.5)?.hit) continue;
      }
      actor.x = x;
      actor.z = z;
      actor.hp = 54;
      actor.heading = Math.atan2(player.pos.x - x, player.pos.z - z);
      actor.active = true;
      actor.cooldown = 0.35 + (actor.slot % 3) * 0.2;
      actor.life = 0;
      actor.stride = actor.slot;
      actor.group.position.set(x, 0, z);
      actor.group.rotation.y = actor.heading;
      actor.group.visible = true;
      actor.glow.visible = !this.lowQuality;
      actor.glow.scale.setScalar(1);
      actor.glow.userData.flash = 0;
      this._visible.push(actor);
      spawned++;
    }
    if (spawned) this.toast('GANG SHOOTERS INBOUND');
  }

  _lineClear(ax, az, bx, bz) {
    if (typeof this.world?.cameraRay === 'function') {
      this._from.set(ax, 1.55, az);
      this._to.set(bx, 1.45, bz);
      return this.world.cameraRay(this._from, this._to, 0.2) >= 0.95;
    }
    if (typeof this.world?.collide === 'function') {
      const dx = bx - ax;
      const dz = bz - az;
      const d = Math.hypot(dx, dz);
      const steps = Math.max(2, Math.min(14, Math.ceil(d / 4)));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (this.world.collide(ax + dx * t, az + dz * t, 0.16)?.hit) return false;
      }
    }
    return true;
  }

  _deactivate(actor) {
    if (!actor.active) return;
    actor.active = false;
    actor.group.visible = false;
  }

  _removeVisible(actor) {
    const list = this._visible;
    for (let i = 0; i < list.length; i++) {
      if (list[i] === actor) {
        list.splice(i, 1);
        return;
      }
    }
  }

  _rebuildVisible() {
    const list = this._visible;
    list.length = 0;
    for (let i = 0; i < this._actors.length; i++) {
      if (this._actors[i].active) list.push(this._actors[i]);
    }
  }
}
