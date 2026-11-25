import * as THREE from 'three';
import { clamp } from '../util/math.js';

const LIT = [0xff3355, 0xffc247, 0x5cffa8];
const DIM = [0x300d18, 0x30220d, 0x0d2c1c];
const PHASES = [
  { key: 'ns', ns: LIT[2], ew: LIT[0], time: 10 },
  { key: 'ns-y', ns: LIT[1], ew: LIT[0], time: 2.4 },
  { key: 'ew', ns: LIT[0], ew: LIT[2], time: 10 },
  { key: 'ew-y', ns: LIT[0], ew: LIT[1], time: 2.4 },
];
const APPROACHES = [
  { ox: -11, oz: -11, ry: 0, axis: 'z' },
  { ox: 11, oz: 11, ry: Math.PI, axis: 'z' },
  { ox: -11, oz: 11, ry: -Math.PI / 2, axis: 'x' },
  { ox: 11, oz: -11, ry: Math.PI / 2, axis: 'x' },
];

// Synchronised grid signals. One instanced housing/pole/bulb set for the whole
// city, so 64 intersections cost three draw calls instead of hundreds.
export class TrafficLights {
  constructor(scene, look, world, callbacks = {}) {
    this.world = world;
    this.onChange = callbacks.change || (() => {});
    this.phaseIndex = 0;
    this.timer = PHASES[0].time;
    this.heads = [];
    this._status = { label: '', tone: '' };

    const housingMat = new THREE.MeshToonMaterial({ color: 0x171b2e, gradientMap: look?.gradientMap });
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const lines = world.GRID.N + 1;
    const capacity = lines * lines * APPROACHES.length;
    this.housings = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 2.3, 0.65), housingMat, capacity);
    this.poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 4.6, 0.22), housingMat, capacity);
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 8, 6), bulbMat, capacity * 3);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < lines; i++) {
      for (let j = 0; j < lines; j++) {
        const x = world.roadLine(i);
        const z = world.roadLine(j);
        for (const a of APPROACHES) {
          const index = this.heads.length;
          const hx = x + a.ox;
          const hz = z + a.oz;
          const fx = Math.sin(a.ry);
          const fz = Math.cos(a.ry);
          dummy.position.set(hx, 3.7, hz);
          dummy.rotation.set(0, a.ry, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          this.housings.setMatrixAt(index, dummy.matrix);
          dummy.position.set(hx + fx * 0.5, 1.9, hz + fz * 0.5);
          dummy.updateMatrix();
          this.poles.setMatrixAt(index, dummy.matrix);
          for (let b = 0; b < 3; b++) {
            dummy.position.set(hx + fx * 0.42, 3.7 + (1 - b) * 0.64, hz + fz * 0.42);
            dummy.updateMatrix();
            this.bulbs.setMatrixAt(index * 3 + b, dummy.matrix);
          }
          this.heads.push({ x, z, axis: a.axis, index });
        }
      }
    }
    this.housings.count = this.heads.length;
    this.poles.count = this.heads.length;
    this.bulbs.count = this.heads.length * 3;
    this.housings.instanceMatrix.needsUpdate = true;
    this.poles.instanceMatrix.needsUpdate = true;
    this.bulbs.instanceMatrix.needsUpdate = true;
    scene.add(this.housings, this.poles, this.bulbs);
    this._applyColors();
  }

  get phase() {
    return PHASES[this.phaseIndex];
  }

  _applyColors() {
    const p = this.phase;
    const color = new THREE.Color();
    for (const head of this.heads) {
      const active = head.axis === 'z' ? p.ns : p.ew;
      const slot = LIT.indexOf(active);
      for (let b = 0; b < 3; b++) {
        color.setHex(b === slot ? LIT[b] : DIM[b]);
        this.bulbs.setColorAt(head.index * 3 + b, color);
      }
    }
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.phaseIndex = (this.phaseIndex + 1) % PHASES.length;
    this.timer += PHASES[this.phaseIndex].time;
    this._applyColors();
    this.onChange(this.phase.key);
  }

  canGo(axis) {
    const p = this.phase;
    return axis === 'z' ? p.key === 'ns' : p.key === 'ew';
  }

  caution(axis) {
    const p = this.phase;
    return axis === 'z' ? p.key === 'ns-y' : p.key === 'ew-y';
  }

  // Distance from a moving vehicle to the next intersection stop line.
  nextStop(pos, axis, dir) {
    const { GRID, roadLine } = this.world;
    const coord = axis === 'z' ? pos.z : pos.x;
    const t = (coord + GRID.HALF) / GRID.BLOCK;
    // Just past the line the intersection is already behind us; skip it so a
    // car does not slam on the brakes after crossing on green/amber.
    const raw = dir > 0 ? Math.ceil(t - 0.02) : Math.floor(t + 0.02);
    const index = clamp(raw, 0, GRID.N);
    const center = roadLine(index);
    const dist = (center - coord) * (dir > 0 ? 1 : -1);
    if (dist < -1) return null;
    return { index, dist, x: axis === 'z' ? pos.x : center, z: axis === 'z' ? center : pos.x };
  }

  status(player) {
    if (player.vehicle) {
      const h = player.heading;
      const axis = Math.abs(Math.sin(h)) > 0.5 ? 'x' : 'z';
      const dir = axis === 'z' ? (Math.cos(h) >= 0 ? 1 : -1) : (Math.sin(h) >= 0 ? 1 : -1);
      const stop = this.nextStop(player.pos, axis, dir);
      if (stop && stop.dist >= 0 && stop.dist < 26) {
        const out = this._status;
        if (this.canGo(axis)) {
          out.label = 'GREEN';
          out.tone = 'go';
        } else if (this.caution(axis)) {
          out.label = 'AMBER';
          out.tone = 'slow';
        } else {
          out.label = 'RED';
          out.tone = 'stop';
        }
        return out;
      }
    }
    return null;
  }
}
