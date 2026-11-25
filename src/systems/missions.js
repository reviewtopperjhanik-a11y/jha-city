import * as THREE from 'three';
import { C } from '../look/palette.js';
import { Vehicle } from '../entities/vehicle.js';
import { makeRng } from '../util/rng.js';
import { dist2 } from '../util/math.js';

const JOBS = {
  delivery: {
    name: 'DELIVERY', points: 2, base: 450,
    labels: ['COLLECT PACKAGE', 'DELIVER PACKAGE'],
    desc: 'Two stops, no timer. Easy money.',
  },
  race: {
    name: 'STREET RACE', points: 4, base: 1100, speedBonus: true, vehicle: true,
    labels: ['CHECKPOINT 1', 'CHECKPOINT 2', 'CHECKPOINT 3', 'FINISH'],
    desc: 'Four checkpoints. Fast times pay more.',
  },
  taxi: {
    name: 'TAXI RUN', points: 2, base: 520,
    labels: ['PICK UP FARE', 'DROP OFF FARE'],
    desc: 'Short fare across town.',
  },
  courier: {
    name: 'COURIER', points: 3, base: 700, time: 75, bonusPerSec: 7, vehicle: true,
    labels: ['PICK UP PARCEL', 'SORTING POINT', 'FINAL DROP'],
    desc: 'Three drops against the clock.',
  },
  vip: {
    name: 'VIP DRIVE', points: 2, base: 1250, vehicle: true, maxSpeed: 24, maxDamage: 22,
    labels: ['PICK UP VIP', 'DROP OFF VIP'],
    desc: 'Drive smooth: stay under 86 km/h and avoid damage.',
  },
  chase: {
    name: 'SUSPECT CHASE', points: 1, base: 1350, time: 95, vehicle: true, suspect: true,
    labels: ['CATCH THE SUSPECT'],
    desc: 'Ram or reach the fleeing car before time runs out.',
  },
  trial: {
    name: 'TIME TRIAL', points: 5, base: 900, time: 60, bonusPerSec: 10, vehicle: true,
    labels: ['GATE 1', 'GATE 2', 'GATE 3', 'GATE 4', 'FINISH'],
    desc: 'Five gates. Beat the clock for a bonus.',
  },
};

const STORY = [
  {
    title: 'FIRST FARE', speaker: 'NIX', job: 'taxi', points: 2, base: 900,
    labels: ['PICK UP NIX', 'DROP NIX AT THE PIER'],
    lines: [
      'You need cash? I know a guy who pays for wheels.',
      'Pick me up, take it easy, and I will show you where the real jobs are.',
    ],
    outro: ['Not bad. The city talks about a courier who never misses a drop.'],
  },
  {
    title: 'PACKAGE RUN', speaker: 'MARA', job: 'courier', points: 3, base: 1250,
    labels: ['COLLECT THE CASE', 'SWAP POINT', 'MARA’S CONTACT'],
    lines: [
      'Nix says you drive clean. Good. I need this case moved quietly.',
      'Three stops, stay moving, and do not lead anyone back to me.',
    ],
    outro: ['The case was clean. Next time we do it with heat behind us.'],
  },
  {
    title: 'HOT PURSUIT', speaker: 'NIX', job: 'chase', points: 1, base: 1700,
    labels: ['CATCH THE RIVAL'],
    lines: [
      'That driver owes me. Bring the car in before the cops do.',
      'Bump it hard enough to stop, then get close and we take it.',
    ],
    outro: ['You brought it in. Mara wants to see you at the safehouse.'],
  },
  {
    title: 'SUNSET SHOWDOWN', speaker: 'MARA', job: 'trial', points: 5, base: 2300,
    labels: ['GATE 1', 'GATE 2', 'GATE 3', 'GATE 4', 'FINISH'],
    lines: [
      'Last run. Five gates along the strip, one shot.',
      'Leave the sirens behind and finish before the sun goes down.',
    ],
    outro: ['You made it. The city is yours now, driver.'],
  },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Missions {
  constructor(scene, world, callbacks = {}, look = null, traffic = null) {
    this.world = world;
    this.scene = scene;
    this.look = look;
    this.traffic = traffic;
    this.onReward = callbacks.reward || (() => {});
    this.onToast = callbacks.toast || (() => {});
    this.onDialog = callbacks.dialog || ((speaker, lines, done) => done());
    this.onStory = callbacks.story || (() => {});
    this.active = null;
    this.done = 0;
    this.storyStep = clamp(Math.round(callbacks.storyStep || 0), 0, STORY.length);
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
    return Object.keys(JOBS);
  }

  jobInfo(type) {
    return JOBS[type] || null;
  }

  start(type, player) {
    if (!JOBS[type]) return false;
    if (this.active) {
      this.onToast('Finish the current job first');
      return false;
    }
    const config = JOBS[type];
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
    if (this.storyStep >= STORY.length) {
      this.onToast('STORY COMPLETE — free roam');
      return false;
    }
    const step = this.storyStep;
    const story = STORY[step];
    this.onDialog(story.speaker, story.lines, () => this._beginStory(step, player));
    return true;
  }

  _beginStory(step, player) {
    if (this.active) return;
    const story = STORY[clamp(step, 0, STORY.length - 1)];
    const config = {
      ...JOBS[story.job],
      name: story.title,
      points: story.points,
      labels: story.labels,
      base: story.base,
      vehicle: true,
    };
    this._begin(story.job, player, config, { story, step });
  }

  _begin(type, player, config, meta = {}) {
    const count = config.suspect ? 1 : config.points;
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
    return this.active.points[this.active.index];
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
    this.onReward(reward, active.type);
    this.onToast(`+$${reward}  ${active.config.name} COMPLETE`);
    const story = active.story;
    const step = active.storyStep;
    this._clearSuspect();
    this.active = null;
    this.done++;
    this.marker.visible = false;
    if (story) {
      this.storyStep = clamp((step ?? 0) + 1, 0, STORY.length);
      this.onStory(this.storyStep);
      if (story.outro?.length) this.onDialog(story.speaker, story.outro, () => {});
      else if (this.storyStep >= STORY.length) this.onToast('STORY COMPLETE — free roam');
    }
  }

  _fail(message) {
    this.onToast(message);
    this._clearSuspect();
    this.active = null;
    this.marker.visible = false;
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
      this._fail(`TIME UP — ${cfg.name} FAILED`);
      return;
    }
    if (cfg.maxSpeed && player.speed > cfg.maxSpeed) {
      this.active.violationTime += dt;
      if (this.active.violationTime > 3 || this._damage(player) > cfg.maxDamage) {
        this._fail('VIP RIDE RUINED');
        return;
      }
    } else if (cfg.maxSpeed) {
      this.active.violationTime = Math.max(0, this.active.violationTime - dt * 0.5);
    } else if (cfg.maxDamage && this._damage(player) > cfg.maxDamage) {
      this._fail(`TOO MUCH DAMAGE — ${cfg.name} FAILED`);
      return;
    }

    const p = this._currentPoint();
    if (p) this.marker.position.set(p.x, 0, p.z);
    const radius = cfg.suspect ? 6 : 7.5;
    if (dist2(player.pos.x, player.pos.z, p.x, p.z) >= radius) return;

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
}
