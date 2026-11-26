import * as THREE from 'three';
import { clamp, damp } from '../util/math.js';
import { makeRng, rand } from '../util/rng.js';

const MODES = ['auto', 'clear', 'rain', 'snow'];
const AUTO_STATES = [
  { key: 'clear', target: 0, weight: 0.54 },
  { key: 'drizzle', target: 0.42, weight: 0.24 },
  { key: 'rain', target: 1, weight: 0.14 },
  { key: 'snow', target: 0.68, weight: 0.08 },
];
const SNOW_TARGET = 0.68;

// Two recycled batches: rain reads as short line streaks, snow as a preallocated
// Points batch with a procedural soft dot. No textures or per-frame allocations.
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
    this.lowQuality = false;
    this.count = 560;
    this.local = new Float32Array(this.count * 3);
    this.positions = new Float32Array(this.count * 6);
    this.snowPositions = new Float32Array(this.count * 3);
    this.speeds = new Float32Array(this.count);
    this.drifts = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) this._respawn(i, true);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xbfe3ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.drops = new THREE.LineSegments(geometry, material);
    this.drops.frustumCulled = false;
    this.drops.visible = false;
    scene.add(this.drops);

    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(this.snowPositions, 3));
    const snowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(0xe8f2ff) },
        opacity: { value: 0 },
        size: { value: 4 },
      },
      vertexShader: `
        uniform float size;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * clamp(34.0 / -mv.z, 0.6, 1.6);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float opacity;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float a = 1.0 - smoothstep(0.18, 0.5, length(d));
          if (a < 0.01) discard;
          gl_FragColor = vec4(color, a * opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.snowPoints = new THREE.Points(snowGeometry, snowMaterial);
    this.snowPoints.frustumCulled = false;
    this.snowPoints.visible = false;
    scene.add(this.snowPoints);
    look.setWeather?.(0);
  }

  _respawn(i, initial = false) {
    const k = i * 3;
    this.local[k] = rand(this.rng, -30, 30);
    this.local[k + 1] = initial ? rand(this.rng, 0, 22) : rand(this.rng, 18, 22);
    this.local[k + 2] = rand(this.rng, -30, 30);
    this.speeds[i] = rand(this.rng, 17, 28);
    this.drifts[i] = rand(this.rng, 0.4, 1.6);
  }

  get snowing() {
    return this.mode === 'snow' || (this.mode === 'auto' && this.autoState === 'snow');
  }

  get target() {
    if (this.mode === 'rain') return 1;
    if (this.mode === 'snow') return SNOW_TARGET;
    if (this.mode === 'clear') return 0;
    return AUTO_STATES.find((s) => s.key === this.autoState)?.target || 0;
  }

  get grip() {
    return 1 - this.level * (this.snowing ? 0.28 : 0.2);
  }

  isRaining() {
    return this.level > 0.45;
  }

  label() {
    if (this.level < 0.12) return '☀ CLEAR';
    if (this.snowing && this.level > 0.25) return '❄ SNOW';
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

  setLowQuality(low) {
    this.lowQuality = !!low;
    if (this.lowQuality) {
      this.drops.visible = false;
      this.snowPoints.visible = false;
    }
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
    if (chosen.key === this.autoState) chosen = AUTO_STATES[(AUTO_STATES.indexOf(chosen) + 1) % AUTO_STATES.length];
    this.autoState = chosen.key;
    this.timer = rand(this.rng, 45, 95);
    this.onChange(this.labelForState(chosen));
  }

  labelForTarget(target) {
    return this.labelForState({ target });
  }

  labelForState(state) {
    if (state.key === 'snow' || this.mode === 'snow') return '❄ SNOW';
    if (state.target === 0) return '☀ CLEAR';
    if (state.target < 0.5) return '☁ DRIZZLE';
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
    this.world?.setWetness?.(this.level);
    this.look.setWeather?.(this.level);

    const snow = this.snowing;
    const visible = !this.lowQuality && this.level > 0.03;
    this.drops.visible = visible && !snow;
    this.snowPoints.visible = visible && snow;
    if (!visible) return;
    this.drops.material.color.setHex(snow ? 0xe8f2ff : 0xbfe3ff);
    this.drops.material.opacity = clamp(0.16 + this.level * (snow ? 0.44 : 0.5), 0, 0.66);
    if (snow) this.snowPoints.material.uniforms.opacity.value = clamp(0.28 + this.level * 0.55, 0, 0.78);
    const px = player.pos.x;
    const pz = player.pos.z;
    const fallScale = snow ? 0.16 : 0.45 + this.level * 0.75;
    const streak = snow ? 0.22 : 1.2 + this.level * 0.9;
    const slant = snow ? 0.12 : 0.5;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      const p = i * 6;
      this.local[k + 1] -= this.speeds[i] * dt * fallScale;
      this.local[k] += dt * this.drifts[i] * (snow ? 2.2 : 2.5);
      if (this.local[k + 1] < 0 || Math.abs(this.local[k]) > 32) this._respawn(i);
      const x = px + this.local[k];
      const y = this.local[k + 1];
      const z = pz + this.local[k + 2];
      this.positions[p] = x;
      this.positions[p + 1] = y;
      this.positions[p + 2] = z;
      this.positions[p + 3] = x + slant * this.drifts[i];
      this.positions[p + 4] = y + streak;
      this.positions[p + 5] = z + slant * 0.35;
      this.snowPositions[k] = x;
      this.snowPositions[k + 1] = y;
      this.snowPositions[k + 2] = z;
    }
    this.drops.geometry.attributes.position.needsUpdate = true;
    this.snowPoints.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.drops);
    this.scene.remove(this.snowPoints);
    this.drops.geometry.dispose();
    this.drops.material.dispose();
    this.snowPoints.geometry.dispose();
    this.snowPoints.material.dispose();
  }
}
