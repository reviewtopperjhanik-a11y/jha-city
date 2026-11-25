import * as THREE from 'three';
import { clamp, damp } from '../util/math.js';
import { makeRng, rand } from '../util/rng.js';

const MODES = ['auto', 'clear', 'rain'];
const AUTO_STATES = [
  { key: 'clear', target: 0, weight: 0.58 },
  { key: 'drizzle', target: 0.42, weight: 0.26 },
  { key: 'rain', target: 1, weight: 0.16 },
];

// Procedural rain: one Points cloud recycled around the player. No textures,
// no particle system allocations per frame, no GPU-heavy post effects.
export class Weather {
  constructor(scene, look, world, callbacks = {}) {
    this.scene = scene;
    this.look = look;
    this.world = world;
    this.rng = makeRng(5522);
    this.onChange = callbacks.change || (() => {});
    this.mode = 'auto';
    this.autoState = 'clear';
    this.timer = 18 + this.rng() * 20;
    this.level = 0;
    this.count = 620;
    this.local = new Float32Array(this.count * 3);
    this.positions = new Float32Array(this.count * 3);
    this.speeds = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) this._respawn(i, true);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xa9d7ff,
      size: 0.19,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.drops = new THREE.Points(geometry, material);
    this.drops.frustumCulled = false;
    this.drops.visible = false;
    scene.add(this.drops);
    look.setWeather?.(0);
  }

  _respawn(i, initial = false) {
    const k = i * 3;
    this.local[k] = rand(this.rng, -30, 30);
    this.local[k + 1] = initial ? rand(this.rng, 0, 22) : rand(this.rng, 18, 22);
    this.local[k + 2] = rand(this.rng, -30, 30);
    this.speeds[i] = rand(this.rng, 17, 28);
  }

  get target() {
    if (this.mode === 'rain') return 1;
    if (this.mode === 'clear') return 0;
    return AUTO_STATES.find((s) => s.key === this.autoState)?.target || 0;
  }

  get grip() {
    return 1 - this.level * 0.2;
  }

  isRaining() {
    return this.level > 0.45;
  }

  label() {
    if (this.level < 0.12) return '☀ CLEAR';
    if (this.level < 0.55) return '☁ DRIZZLE';
    return '☂ RAIN';
  }

  setMode(mode) {
    this.mode = MODES.includes(mode) ? mode : 'auto';
    if (this.mode === 'auto') this.timer = Math.max(this.timer, 6);
    return this.mode;
  }

  cycle() {
    const next = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.setMode(next);
    return next;
  }

  _pickAutoState() {
    const roll = this.rng();
    let acc = 0;
    let chosen = AUTO_STATES[0];
    for (const state of AUTO_STATES) {
      acc += state.weight;
      if (roll <= acc) {
        chosen = state;
        break;
      }
    }
    if (chosen.key === this.autoState) chosen = AUTO_STATES[chosen.key === 'clear' ? 1 : 0];
    this.autoState = chosen.key;
    this.timer = rand(this.rng, 45, 95);
    this.onChange(this.labelForTarget(chosen.target));
  }

  labelForTarget(target) {
    if (target === 0) return '☀ CLEAR';
    if (target < 0.5) return '☁ DRIZZLE';
    return '☂ RAIN';
  }

  update(dt, player) {
    if (this.mode === 'auto') {
      this.timer -= dt;
      if (this.timer <= 0) this._pickAutoState();
    }
    const target = this.target;
    this.level = damp(this.level, target, 0.55, dt);
    if (Math.abs(this.level - target) < 0.008) this.level = target;
    this.look.setWeather?.(this.level);

    const visible = this.level > 0.03;
    this.drops.visible = visible;
    if (!visible) return;
    this.drops.material.opacity = clamp(0.12 + this.level * 0.5, 0, 0.62);
    const px = player.pos.x;
    const pz = player.pos.z;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.local[k + 1] -= this.speeds[i] * dt * (0.45 + this.level * 0.75);
      this.local[k] += dt * 2.5;
      if (this.local[k + 1] < 0 || Math.abs(this.local[k]) > 32) this._respawn(i);
      this.positions[k] = px + this.local[k];
      this.positions[k + 1] = this.local[k + 1];
      this.positions[k + 2] = pz + this.local[k + 2];
    }
    this.drops.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.drops);
    this.drops.geometry.dispose();
    this.drops.material.dispose();
  }
}
