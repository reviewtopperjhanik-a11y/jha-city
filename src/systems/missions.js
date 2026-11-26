import * as THREE from 'three';
import { C } from '../look/palette.js';
import { Vehicle } from '../entities/vehicle.js';
import { makeRng } from '../util/rng.js';
import { dist2 } from '../util/math.js';
import { MISSION_DATA, storyCount, missionDataIssues } from '../data/missions.js';

export { MISSION_DATA, storyCount };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Every persisted number passes through here: a corrupt save must never turn a
// payout, timer or waypoint into NaN.
const num = (value, fallback, lo = -Infinity, hi = Infinity) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
};
const pointOf = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.z)
  ? { x: p.x, z: p.z }
  : null);
const labelsOf = (entry) => (entry && (entry.objectives || entry.labels)) || [];
const labelAt = (config, index) => {
  const labels = Array.isArray(config?.labels) && config.labels.length ? config.labels : null;
  if (!labels) return 'OBJECTIVE';
  const i = clamp(Math.round(num(index, 0)), 0, labels.length - 1);
  return String(labels[i] ?? 'OBJECTIVE');
};

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
    this.dataIssues = missionDataIssues(this.data);

    this.onReward = callbacks.reward || (() => {});
    this.onToast = callbacks.toast || (() => {});
    this.onDialog = callbacks.dialog || ((speaker, lines, done) => done());
    this.onStory = callbacks.story || (() => {});
    this.onPass = callbacks.pass || (() => {});
    this.onFail = callbacks.fail || (() => {});
    this.active = null;
    this.done = 0;
    this.storyStep = clamp(Math.round(num(callbacks.storyStep, 0)), 0, this.storyCount);
    this.rng = makeRng(4242);
    this._suspect = null;
    this._lastDistance = 0;
    // A dialog's completion is only valid for the exact story run that opened
    // it. Death, a slot load or a direct job start invalidates the token.
    this._storyToken = 0;
    this._pendingStory = null;
    // Terminal transitions clear state before any callback runs, so a reentrant
    // update or a retry after a thrown callback can never pay out twice.
    this._finishing = false;

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
    const override = overrides && typeof overrides === 'object' ? overrides : {};
    const labels = labelsOf(override).length ? labelsOf(override) : labelsOf(base);
    const rewards = override.rewards || base.rewards || {};
    const points = override.waypoints ?? override.points ?? base.waypoints ?? base.points ?? labels.length;
    const config = {
      ...base,
      ...override,
      labels,
      points: Math.round(num(points, Math.max(1, labels.length), 1, 32)),
      base: num(override.base ?? rewards.base ?? base.base, 450, 0, 1e9),
    };
    if (config.speedBonus === undefined && rewards.speedBonus !== undefined) config.speedBonus = rewards.speedBonus;
    if (config.bonusPerSec === undefined && rewards.bonusPerSec !== undefined) config.bonusPerSec = rewards.bonusPerSec;
    config.base = num(config.base, 450, 0, 1e9);
    config.bonusPerSec = num(config.bonusPerSec, 0, 0, 1e6);
    return config;
  }

  start(type, player) {
    if (!type || !this.jobs[type]) return false;
    if (this.active || this._finishing) {
      this.onToast('Finish the current job first');
      return false;
    }
    const config = this._configFor(type);
    // An explicit foot mode wins over a stale vehicle reference; callers that
    // only supply a vehicle stub are still treated as mounted.
    const onFoot = player?.mode === 'foot';
    const mounted = !!player?.vehicle || player?.mode === 'car' || player?.mode === 'bike';
    if (config.vehicle && (onFoot || !mounted)) {
      this.onToast('Steal a bike or car first');
      return false;
    }
    this._pendingStory = null;
    this._begin(type, player, config);
    return true;
  }

  startStory(player) {
    if (this.active || this._finishing) {
      this.onToast('Finish the current job first');
      return false;
    }
    if (this.storyStep >= this.storyCount) {
      this.onToast('STORY COMPLETE — free roam');
      return false;
    }
    const step = clamp(Math.round(num(this.storyStep, 0)), 0, this.storyCount - 1);
    const story = this.stories[step];
    if (!story || !this.jobs[story.job]) return false;
    const token = ++this._storyToken;
    this._pendingStory = token;
    this.onDialog(story.speaker, story.lines || [], () => this._beginStory(step, player, token));
    return true;
  }

  _beginStory(step, player, token) {
    // A dialog left open across death/slot-load must not start a stale chapter.
    if (token !== undefined && token !== this._pendingStory) return;
    if (this.active || this._finishing) return;
    const target = clamp(Math.round(num(step, this.storyStep)), 0, this.storyCount - 1);
    if (target !== clamp(this.storyStep, 0, this.storyCount - 1)) return;
    const story = this.stories[target];
    if (!story || !this.jobs[story.job]) return;
    this._pendingStory = null;
    const config = this._configFor(story.job, { ...story, vehicle: true });
    this._begin(story.job, player, config, { story, step: target });
  }

  _begin(type, player, config, meta = {}) {
    const count = config.suspect ? 1 : clamp(Math.round(num(config.points, 1, 1, 32)), 1, 32);
    const points = [];
    for (let i = 0; i < count; i++) points.push(this.world.randomRoadPoint(this.rng));
    config.base = num(config.base, 450, 0, 1e9);
    this.active = {
      type,
      config,
      story: meta.story || null,
      storyStep: meta.step ?? null,
      points,
      index: 0,
      time: 0,
      label: config.labels,
      startHp: num(player?.hp, 100, 0, 100),
      startVehicleHealth: num(player?.vehicle?.health, 100, 0, 1000),
      violationTime: 0,
      base: config.base,
    };
    if (config.suspect) this._spawnSuspect(player);
    this._pendingStory = null;
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
    // Vehicle adds a separate ground shadow: both meshes belong to this car.
    this.scene.remove(v.mesh);
    if (v.shadow) this.scene.remove(v.shadow);
    this._suspect = null;
  }

  _damage(player) {
    if (!this.active) return 0;
    const startHp = num(this.active.startHp, num(player?.hp, 100), 0, 100);
    const hp = num(player?.hp, startHp, 0, 100);
    const hpLoss = Math.max(0, startHp - hp);
    const vehicle = player?.vehicle;
    const startVehicle = num(this.active.startVehicleHealth, num(vehicle?.health, 100), 0, 1000);
    const vLoss = vehicle ? Math.max(0, startVehicle - num(vehicle.health, startVehicle, 0, 1000)) * 0.45 : 0;
    return hpLoss + vLoss;
  }

  _reward(player) {
    const cfg = this.active.config;
    const damage = num(this._damage(player), 0, 0);
    const elapsed = num(this.active.time, 0, 0);
    let bonus = 0;
    if (cfg.speedBonus) bonus = Math.max(0, Math.round(900 - elapsed * 12));
    else if (cfg.bonusPerSec && cfg.time) {
      bonus = Math.max(0, Math.round((num(cfg.time, 0, 0) - elapsed) * num(cfg.bonusPerSec, 0, 0, 1e6)));
    }
    const base = num(this.active.base, cfg.base, 0, 1e9);
    const total = Math.round(base + bonus - damage * 4);
    return Math.max(150, Number.isFinite(total) ? total : 150);
  }

  _complete(player) {
    if (!this.active || this._finishing) return;
    this._finishing = true;
    try {
      const active = this.active;
      const reward = this._reward(player);
      const passInfo = {
        type: active.type,
        name: active.config.name,
        title: active.config.name,
        reward,
        story: !!active.story,
        storyStep: active.storyStep ?? null,
        label: labelAt(active.config, active.index),
      };
      // Terminal state first: a callback that throws or reenters cannot
      // produce a second reward, pass card or story advance.
      this._clearSuspect();
      this.active = null;
      this.marker.visible = false;
      this.done++;
      // The reward lands before the story callback saves, so a story-complete
      // autosave contains the payout and job count, not a pre-payout snapshot.
      this.onReward(reward, active.type);
      this.onToast(`+$${reward}  ${active.config.name} COMPLETE`);
      const story = active.story;
      const step = active.storyStep;
      if (story) {
        // Never let a stale saved mission step rewind newer story progress.
        const advanced = clamp(Math.max(this.storyStep, num(step, this.storyStep - 1) + 1), 0, this.storyCount);
        this.storyStep = advanced;
        this.onStory(advanced);
      }
      if (story) {
        if (story.outro?.length) {
          const token = ++this._storyToken;
          this._pendingStory = token;
          this.onDialog(story.speaker, story.outro, () => {
            if (this._pendingStory !== token) return;
            this._pendingStory = null;
            this.onPass(passInfo);
            if (this.storyStep >= this.storyCount) this.onToast('STORY COMPLETE — free roam');
          });
        } else {
          this.onPass(passInfo);
          if (this.storyStep >= this.storyCount) this.onToast('STORY COMPLETE — free roam');
        }
      } else {
        this.onPass(passInfo);
      }
    } finally {
      this._finishing = false;
    }
  }

  _fail(message, reason = message) {
    if (!this.active || this._finishing) return;
    this._finishing = true;
    try {
      const active = this.active;
      const info = {
        type: active.type,
        name: active.config.name,
        title: active.config.name,
        message,
        reason,
        story: !!active.story,
        storyStep: active.storyStep ?? null,
      };
      // A fail/cancel ends the run but never touches storyStep.
      this._clearSuspect();
      this.active = null;
      this.marker.visible = false;
      this._pendingStory = null;
      this.onToast(message);
      this.onFail(info);
    } finally {
      this._finishing = false;
    }
  }

  // Public alias so callers do not have to reach into the private failure path.
  cancel(reason = 'MISSION CANCELLED') {
    if (!this.active) return false;
    this._fail(reason, 'cancel');
    return true;
  }

  update(dt, player) {
    if (!this.active || this._finishing) {
      this.marker.visible = false;
      return;
    }
    const step = num(dt, 0, 0);
    this.marker.visible = true;
    this.ring.rotation.z += step * 1.4;
    this.active.time += step;
    const cfg = this.active.config;
    const px = player?.pos?.x;
    const pz = player?.pos?.z;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) return;

    const timeLimit = num(cfg.time, 0, 0);
    if (timeLimit > 0 && this.active.time > timeLimit) {
      this._fail(`TIME UP — ${cfg.name} FAILED`, 'time');
      return;
    }
    const maxSpeed = num(cfg.maxSpeed, 0, 0);
    const maxDamage = num(cfg.maxDamage, 0, 0);
    if (maxSpeed > 0 && num(player?.speed, 0, 0) > maxSpeed) {
      this.active.violationTime += step;
      if (this.active.violationTime > 3 || (maxDamage > 0 && this._damage(player) > maxDamage)) {
        this._fail('VIP RIDE RUINED', 'speed');
        return;
      }
    } else if (maxSpeed > 0) {
      this.active.violationTime = Math.max(0, this.active.violationTime - step * 0.5);
    } else if (maxDamage > 0 && this._damage(player) > maxDamage) {
      this._fail(`TOO MUCH DAMAGE — ${cfg.name} FAILED`, 'damage');
      return;
    }

    const p = this._currentPoint();
    if (p) this.marker.position.set(p.x, 0, p.z);
    const radius = cfg.suspect ? 6 : 7.5;
    if (!p || dist2(px, pz, p.x, p.z) >= radius) return;

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
    this.onToast(labelAt(cfg, this.active.index));
  }

  status() {
    if (!this.active) return 'No active job';
    const d = Math.round(num(this._lastDistance, 0, 0));
    const cfg = this.active.config;
    let timer = '';
    const timeLimit = num(cfg.time, 0, 0);
    if (timeLimit > 0) timer = `  ${Math.max(0, Math.ceil(timeLimit - this.active.time))}s`;
    else if (cfg.speedBonus) timer = `  ${num(this.active.time, 0, 0).toFixed(1)}s`;
    const trouble = cfg.maxSpeed && this.active.violationTime > 0 ? '  SMOOTH DRIVE!' : '';
    return `${cfg.name} · ${labelAt(cfg, this.active.index)} · ${d}m${timer}${trouble}`;
  }

  setDistance(d) {
    this._lastDistance = num(d, 0, 0);
  }

  // Save/load the active job without serialising Three.js objects. A chase's
  // moving suspect is frozen at its last position so the job stays completable.
  serialize() {
    if (!this.active || this._finishing) return null;
    const a = this.active;
    const cfg = a.config || {};
    const point = this._currentPoint();
    return {
      type: a.type,
      config: {
        name: cfg.name,
        desc: cfg.desc,
        base: num(a.base, cfg.base, 0, 1e9),
        points: num(cfg.points, a.points.length, 1, 32),
        labels: Array.isArray(cfg.labels) ? cfg.labels.filter((l) => typeof l === 'string') : [],
        time: Number.isFinite(cfg.time) ? cfg.time : null,
        speedBonus: !!cfg.speedBonus,
        bonusPerSec: num(cfg.bonusPerSec, 0, 0, 1e6),
        vehicle: !!cfg.vehicle,
        suspect: !!cfg.suspect,
        maxSpeed: Number.isFinite(cfg.maxSpeed) ? cfg.maxSpeed : null,
        maxDamage: Number.isFinite(cfg.maxDamage) ? cfg.maxDamage : null,
      },
      story: a.story ? {
        id: typeof a.story.id === 'string' ? a.story.id : '',
        title: typeof a.story.title === 'string' ? a.story.title : '',
        speaker: typeof a.story.speaker === 'string' ? a.story.speaker : '',
        outro: Array.isArray(a.story.outro) ? a.story.outro.filter((l) => typeof l === 'string') : null,
      } : null,
      storyStep: Number.isFinite(a.storyStep) ? a.storyStep : null,
      progress: this.storyStep,
      storyCount: this.storyCount,
      base: num(a.base, 450, 0, 1e9),
      points: a.points.map((p) => ({ x: p.x, z: p.z })),
      point: point ? { x: point.x, z: point.z } : null,
      index: a.index,
      time: num(a.time, 0, 0),
      violationTime: num(a.violationTime, 0, 0),
      startHp: num(a.startHp, 100, 0, 100),
      startVehicleHealth: num(a.startVehicleHealth, 100, 0, 1000),
      done: this.done,
    };
  }

  restoreProgress(state) {
    this._clearSuspect();
    this._pendingStory = null;
    if (!state || typeof state !== 'object' || !state.type || !this.jobs[state.type]) {
      this.active = null;
      this.marker.visible = false;
      return;
    }
    const config = this._configFor(state.type, state.config || {});
    config.base = num(state.base, config.base, 0, 1e9);
    const points = (Array.isArray(state.points) ? state.points : [])
      .map(pointOf)
      .filter(Boolean)
      .slice(0, 32);
    const savedPoint = pointOf(state.point);
    if (savedPoint) {
      const index = clamp(Math.round(num(state.index, 0, 0)), 0, Math.max(0, points.length - 1));
      if (points.length) points[index] = savedPoint;
      else points.push(savedPoint);
    }
    if (!points.length) points.push({ x: 0, z: 65 });
    const src = state.story && typeof state.story === 'object' ? state.story : null;
    const story = src ? {
      id: typeof src.id === 'string' ? src.id : '',
      title: typeof src.title === 'string' ? src.title : '',
      speaker: typeof src.speaker === 'string' ? src.speaker : '',
      outro: Array.isArray(src.outro) ? src.outro.filter((l) => typeof l === 'string') : null,
    } : null;
    this.active = {
      type: state.type,
      config,
      story,
      storyStep: Number.isFinite(state.storyStep) ? clamp(Math.round(state.storyStep), 0, this.storyCount) : null,
      points,
      index: clamp(Math.round(num(state.index, 0, 0)), 0, points.length - 1),
      time: num(state.time, 0, 0),
      label: config.labels,
      startHp: num(state.startHp, 100, 0, 100),
      startVehicleHealth: num(state.startVehicleHealth, 100, 0, 1000),
      violationTime: num(state.violationTime, 0, 0),
      base: config.base,
    };
    // Progress only moves forward here. A stale mission snapshot must never
    // rewind the chapter count on boot or after a death/bust autosave.
    if (Number.isFinite(state.progress)) {
      this.storyStep = Math.max(this.storyStep, clamp(Math.round(state.progress), 0, this.storyCount));
    }
    if (Number.isFinite(state.done)) this.done = Math.max(this.done, Math.round(state.done));
    this.marker.visible = true;
    this._place();
  }
}
