import * as THREE from 'three';
import { C } from '../look/palette.js';
import { Vehicle } from '../entities/vehicle.js';
import { makeRng } from '../util/rng.js';
import { dist2 } from '../util/math.js';
import { MISSION_DATA, storyCount } from '../data/missions.js';

export { MISSION_DATA, storyCount };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const labelsOf = (entry) => (entry && (entry.objectives || entry.labels)) || [];

export class Missions {
  constructor(scene, world, callbacks = {}, look = null, traffic = null, data = null) {
    this.world = world;
    this.scene = scene;
    this.look = look;
    this.traffic = traffic;

    // Content is data-driven. `callbacks.data` is the preferred override so the
    // existing (scene, world, callbacks, look, traffic) signature stays intact.
    this.data = callbacks.data || data || MISSION_DATA;
    this.jobs = this.data.jobs || {};
    this.stories = this.data.story || this.data.stories || [];
    this.storyCount = this.stories.length;

    this.onReward = callbacks.reward || (() => {});
    this.onToast = callbacks.toast || (() => {});
    this.onDialog = callbacks.dialog || ((speaker, lines, done) => done());
    this.onStory = callbacks.story || (() => {});
    this.onPass = callbacks.pass || (() => {});
    this.onFail = callbacks.fail || (() => {});
    this.active = null;
    this.done = 0;
    this.storyStep = clamp(Math.round(callbacks.storyStep || 0), 0, this.storyCount);
    this.rng = makeRng(4242);
    this._suspect = null;

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

  get jobTypes() {
    return Object.keys(this.jobs);
  }

  get freeRoam() {
    return !this.active;
  }

  jobInfo(type) {
    return this.jobs[type] || null;
  }

  // Turn authored data into the flat config the engine uses. The aliases make
  // hand-written missions terse while keeping older saves and harnesses valid.
  _configFor(type, overrides = {}) {
    const base = this.jobs[type] || {};
    const labels = labelsOf(overrides).length ? labelsOf(overrides) : labelsOf(base);
    const rewards = overrides.rewards || base.rewards || {};
    const config = {
      ...base,
      ...overrides,
      labels,
      points: overrides.waypoints ?? overrides.points ?? base.waypoints ?? base.points ?? labels.length,
      base: overrides.base ?? rewards.base ?? base.base ?? 450,
    };
    if (config.speedBonus === undefined && rewards.speedBonus !== undefined) config.speedBonus = rewards.speedBonus;
    if (config.bonusPerSec === undefined && rewards.bonusPerSec !== undefined) config.bonusPerSec = rewards.bonusPerSec;
    return config;
  }

  start(type, player) {
    if (!this.jobs[type]) return false;
    if (this.active) {
      this.onToast('Finish the current job first');
      return false;
    }
    const config = this._configFor(type);
    if (config.vehicle && player.mode === 'foot') {
      this.onToast('Steal a bike or car first');
      return false;
    }
    this._begin(type, player, config);
    return true;
  }

  startStory(player) {
    if (this.active) {
      this.onToast('Finish the current job first');
      return false;
    }
    if (this.storyStep >= this.storyCount) {
      this.onToast('STORY COMPLETE — free roam');
      return false;
    }
    const step = this.storyStep;
    const story = this.stories[step];
    this.onDialog(story.speaker, story.lines || [], () => this._beginStory(step, player));
    return true;
  }

  _beginStory(step, player) {
    if (this.active) return;
    const story = this.stories[clamp(step, 0, this.storyCount - 1)];
    if (!story) return;
    const config = this._configFor(story.job, { ...story, vehicle: true });
    this._begin(story.job, player, config, { story, step });
  }

  _begin(type, player, config, meta = {}) {
    const count = config.suspect ? 1 : Math.max(1, config.points || 1);
    const points = [];
    for (let i = 0; i < count; i++) points.push(this.world.randomRoadPoint(this.rng));
    this.active = {
      type,
      config,
      story: meta.story || null,
      storyStep: meta.step ?? null,
      points,
      index: 0,
      time: 0,
      label: config.labels,
      startHp: player.hp,
      startVehicleHealth: player.vehicle ? player.vehicle.health : 100,
      violationTime: 0,
      base: config.base,
    };
    if (config.suspect) this._spawnSuspect(player);
    this.marker.visible = true;
    this._place();
    this.onToast(`${config.name} started`);
  }

  _currentPoint() {
    if (!this.active) return null;
    if (this._suspect) return this._suspect.pos;
    return this.active.points[this.active.index] || null;
  }

  currentPoint() {
    return this._currentPoint();
  }

  _place() {
    const p = this._currentPoint();
    if (p) this.marker.position.set(p.x, 0, p.z);
  }

  _spawnSuspect(player) {
    const p = this.world.randomRoadPoint(this.rng);
    const dir = this.rng() > 0.5 ? 1 : -1;
    const heading = p.axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const v = new Vehicle(this.scene, this.look, 'car', p.x, p.z, heading, C.tangerine);
    v.ai = true;
    v.role = 'suspect';
    v.route = { axis: p.axis, line: p.line, dir };
    v.targetSpeed = 21;
    v.speed = 19;
    if (this.traffic?.vehicles) this.traffic.vehicles.push(v);
    this._suspect = v;
    void player;
    return v;
  }

  _clearSuspect() {
    const v = this._suspect;
    if (!v) return;
    v.ai = false;
    v.role = 'parked';
    v.speed = 0;
    if (this.traffic?.vehicles) {
      const i = this.traffic.vehicles.indexOf(v);
      if (i >= 0) this.traffic.vehicles.splice(i, 1);
    }
    this.scene.remove(v.mesh);
    this._suspect = null;
  }

  _damage(player) {
    if (!this.active) return 0;
    const hpLoss = Math.max(0, this.active.startHp - player.hp);
    const vLoss = player.vehicle ? Math.max(0, this.active.startVehicleHealth - player.vehicle.health) * 0.45 : 0;
    return hpLoss + vLoss;
  }

  _reward(player) {
    const cfg = this.active.config;
    const damage = this._damage(player);
    let bonus = 0;
    if (cfg.speedBonus) bonus = Math.max(0, Math.round(900 - this.active.time * 12));
    else if (cfg.bonusPerSec && cfg.time) bonus = Math.max(0, Math.round((cfg.time - this.active.time) * cfg.bonusPerSec));
    return Math.max(150, Math.round(this.active.base + bonus - damage * 4));
  }

  _complete(player) {
    const active = this.active;
    const reward = this._reward(player);
    const passInfo = {
      type: active.type,
      name: active.config.name,
      title: active.config.name,
      reward,
      story: !!active.story,
      storyStep: active.storyStep ?? null,
      label: active.label?.[Math.min(active.index, active.label.length - 1)] || '',
    };
    this.onReward(reward, active.type);
    this.onToast(`+$${reward}  ${active.config.name} COMPLETE`);
    const story = active.story;
    const step = active.storyStep;
    this._clearSuspect();
    this.active = null;
    this.done++;
    this.marker.visible = false;
    if (story) {
      this.storyStep = clamp((step ?? 0) + 1, 0, this.storyCount);
      this.onStory(this.storyStep);
      if (story.outro?.length) {
        // Let the pass screen appear after the closing radio call.
        this.onDialog(story.speaker, story.outro, () => this.onPass(passInfo));
      } else {
        this.onPass(passInfo);
        if (this.storyStep >= this.storyCount) this.onToast('STORY COMPLETE — free roam');
      }
    } else {
      this.onPass(passInfo);
    }
  }

  _fail(message, reason = message) {
    const active = this.active;
    if (!active) return;
    const info = {
      type: active.type,
      name: active.config.name,
      title: active.config.name,
      message,
      reason,
      story: !!active.story,
      storyStep: active.storyStep ?? null,
    };
    this.onToast(message);
    this._clearSuspect();
    this.active = null;
    this.marker.visible = false;
    this.onFail(info);
  }

  update(dt, player) {
    if (!this.active) {
      this.marker.visible = false;
      return;
    }
    this.marker.visible = true;
    this.ring.rotation.z += dt * 1.4;
    this.active.time += dt;
    const cfg = this.active.config;

    if (cfg.time && this.active.time > cfg.time) {
      this._fail(`TIME UP — ${cfg.name} FAILED`, 'time');
      return;
    }
    if (cfg.maxSpeed && player.speed > cfg.maxSpeed) {
      this.active.violationTime += dt;
      if (this.active.violationTime > 3 || this._damage(player) > cfg.maxDamage) {
        this._fail('VIP RIDE RUINED', 'speed');
        return;
      }
    } else if (cfg.maxSpeed) {
      this.active.violationTime = Math.max(0, this.active.violationTime - dt * 0.5);
    } else if (cfg.maxDamage && this._damage(player) > cfg.maxDamage) {
      this._fail(`TOO MUCH DAMAGE — ${cfg.name} FAILED`, 'damage');
      return;
    }

    const p = this._currentPoint();
    if (p) this.marker.position.set(p.x, 0, p.z);
    const radius = cfg.suspect ? 6 : 7.5;
    if (!p || dist2(player.pos.x, player.pos.z, p.x, p.z) >= radius) return;

    if (cfg.suspect) {
      this._complete(player);
      return;
    }
    this.active.index++;
    if (this.active.index >= this.active.points.length) {
      this._complete(player);
      return;
    }
    this._place();
    this.onToast(this.active.label[this.active.index]);
  }

  status() {
    if (!this.active) return 'No active job';
    const p = this._currentPoint();
    const d = p ? Math.round(this._lastDistance || 0) : 0;
    const cfg = this.active.config;
    let timer = '';
    if (cfg.time) timer = `  ${Math.max(0, Math.ceil(cfg.time - this.active.time))}s`;
    else if (cfg.speedBonus) timer = `  ${this.active.time.toFixed(1)}s`;
    const trouble = cfg.maxSpeed && this.active.violationTime > 0 ? '  SMOOTH DRIVE!' : '';
    return `${cfg.name} · ${this.active.label[this.active.index]} · ${d}m${timer}${trouble}`;
  }

  setDistance(d) {
    this._lastDistance = d;
  }

  // Save/load the active job without serialising Three.js objects. A chase's
  // moving suspect is frozen at its last position so the job stays completable.
  serialize() {
    if (!this.active) return null;
    const a = this.active;
    const cfg = a.config || {};
    const point = this._currentPoint();
    return {
      type: a.type,
      config: {
        name: cfg.name,
        desc: cfg.desc,
        base: a.base ?? cfg.base,
        points: cfg.points,
        labels: Array.isArray(cfg.labels) ? [...cfg.labels] : [],
        time: cfg.time ?? null,
        speedBonus: !!cfg.speedBonus,
        bonusPerSec: cfg.bonusPerSec || 0,
        vehicle: !!cfg.vehicle,
        suspect: !!cfg.suspect,
        maxSpeed: cfg.maxSpeed ?? null,
        maxDamage: cfg.maxDamage ?? null,
      },
      story: a.story ? {
        id: a.story.id,
        title: a.story.title,
        speaker: a.story.speaker,
        outro: a.story.outro ? [...a.story.outro] : null,
      } : null,
      storyStep: a.storyStep ?? null,
      progress: this.storyStep,
      points: a.points.map((p) => ({ x: p.x, z: p.z })),
      point: point ? { x: point.x, z: point.z } : null,
      index: a.index,
      time: a.time,
      violationTime: a.violationTime || 0,
      startHp: a.startHp,
      startVehicleHealth: a.startVehicleHealth,
      done: this.done,
    };
  }

  restoreProgress(state) {
    this._clearSuspect();
    if (!state || !state.type) {
      this.active = null;
      this.marker.visible = false;
      return;
    }
    const config = this._configFor(state.type, state.config || {});
    const points = Array.isArray(state.points)
      ? state.points.map((p) => ({ x: p.x, z: p.z }))
      : [];
    if (state.point && points.length) points[Math.min(state.index || 0, points.length - 1)] = { x: state.point.x, z: state.point.z };
    if (!points.length) points.push({ x: 0, z: 65 });
    this.active = {
      type: state.type,
      config,
      story: state.story || null,
      storyStep: Number.isFinite(state.storyStep) ? state.storyStep : null,
      points,
      index: clamp(Math.round(state.index || 0), 0, points.length - 1),
      time: Number.isFinite(state.time) ? state.time : 0,
      label: config.labels,
      startHp: Number.isFinite(state.startHp) ? state.startHp : 100,
      startVehicleHealth: Number.isFinite(state.startVehicleHealth) ? state.startVehicleHealth : 100,
      violationTime: Number.isFinite(state.violationTime) ? state.violationTime : 0,
      base: config.base,
    };
    if (Number.isFinite(state.progress)) this.storyStep = clamp(Math.round(state.progress), 0, this.storyCount);
    if (Number.isFinite(state.done)) this.done = Math.max(0, Math.round(state.done));
    this.marker.visible = true;
    this._place();
  }
}
