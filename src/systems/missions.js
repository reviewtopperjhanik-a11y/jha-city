import * as THREE from 'three';
import { C } from '../look/palette.js';
import { makeRng } from '../util/rng.js';
import { dist2 } from '../util/math.js';

const NAMES = { delivery: 'DELIVERY', race: 'STREET RACE', taxi: 'TAXI RUN' };

export class Missions {
  constructor(scene, world, callbacks = {}) {
    this.world = world;
    this.onReward = callbacks.reward || (() => {});
    this.onToast = callbacks.toast || (() => {});
    this.active = null;
    this.done = 0;
    this.rng = makeRng(4242);

    this.marker = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.6, 44, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    beam.position.y = 22;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.2, 0.28, 8, 20),
      new THREE.MeshBasicMaterial({ color: C.tangerine, toneMapped: false }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.4;
    this.ring = ring;
    this.beam = beam;
    this.marker.add(beam, ring);
    this.marker.visible = false;
    scene.add(this.marker);
  }

  start(type, player) {
    if (this.active) this.onToast('Finish the current job first');
    if (type === 'race' && player.mode === 'foot') {
      this.onToast('Steal a bike or car first');
      return false;
    }
    const count = type === 'race' ? 4 : 2;
    const points = [];
    for (let i = 0; i < count; i++) points.push(this.world.randomRoadPoint(this.rng));
    this.active = {
      type,
      points,
      index: 0,
      time: 0,
      label: type === 'taxi' ? ['PICK UP FARE', 'DROP OFF FARE'] : type === 'delivery' ? ['COLLECT PACKAGE', 'DELIVER PACKAGE'] : points.map((_, i) => `CHECKPOINT ${i + 1}`),
    };
    this.marker.visible = true;
    this._place();
    this.onToast(`${NAMES[type]} started`);
    return true;
  }

  _place() {
    const p = this.active.points[this.active.index];
    this.marker.position.set(p.x, 0, p.z);
  }

  update(dt, player) {
    if (!this.active) {
      this.marker.visible = false;
      return;
    }
    this.marker.visible = true;
    this.ring.rotation.z += dt * 1.4;
    this.active.time += dt;
    const p = this.active.points[this.active.index];
    if (dist2(player.pos.x, player.pos.z, p.x, p.z) < 7.5) {
      this.active.index++;
      if (this.active.index >= this.active.points.length) {
        const base = this.active.type === 'race' ? 1400 : this.active.type === 'taxi' ? 750 : 950;
        const bonus = this.active.type === 'race' ? Math.max(0, Math.round(900 - this.active.time * 12)) : 0;
        const reward = base + bonus;
        this.onReward(reward, this.active.type);
        this.onToast(`+$${reward}  ${NAMES[this.active.type]} COMPLETE`);
        this.active = null;
        this.marker.visible = false;
        this.done++;
        return;
      }
      this._place();
      this.onToast(this.active.label[this.active.index]);
    }
  }

  status() {
    if (!this.active) return 'No active job — press M for delivery, R for race, T for taxi';
    const p = this.active.points[this.active.index];
    const d = this._lastDistance || 0;
    const timer = this.active.type === 'race' ? `  ${this.active.time.toFixed(1)}s` : '';
    return `${NAMES[this.active.type]} · ${this.active.label[this.active.index]} · ${Math.round(d)}m${timer}`;
  }

  setDistance(d) {
    this._lastDistance = d;
  }
}
