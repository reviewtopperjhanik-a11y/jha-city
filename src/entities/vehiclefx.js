import * as THREE from 'three';

// Shared, preallocated particle pools for HIGH-quality drift smoke, impact
// sparks, damage smoke and explosions. One InstancedMesh per pool (two draw
// calls total) is created on first use and reused by every vehicle; there are
// no allocations in the emit/update paths. All art is procedural geometry:
// no texture is created or loaded here.
const MAX = 48;
const SMOKE = 0;
const SPARK = 1;

// Explosion particles are low-poly octahedra coloured per instance: a hot
// core, cooling fire, rising soot and fast embers. The pool is fixed size and
// its InstancedMesh identity never changes, so repeated blasts reuse it.
const BLAST_MAX = 24;
const FIRE = 0;
const SOOT = 1;
const EMBER = 2;

const particles = Array.from({ length: MAX }, () => ({
  life: 0,
  max: 1,
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  size: 0,
  kind: SMOKE,
}));
const blasts = Array.from({ length: BLAST_MAX }, () => ({
  life: 0,
  max: 1,
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  size: 0,
  grow: 0,
  kind: FIRE,
}));
const smokeColor = new THREE.Color(0x7a8196);
const sparkColor = new THREE.Color(0xffcf7a);
const fireColor = new THREE.Color(0xffd37a);
const flameColor = new THREE.Color(0xff6234);
const sootColor = new THREE.Color(0x3c4052);
const emberColor = new THREE.Color(0xff9a3c);
const SIDES = [-1, 1];
const dummy = new THREE.Object3D();
dummy.rotation.set(-Math.PI / 2, 0, 0);

let mesh = null;
let blastMesh = null;
let cursor = 0;
let blastCursor = 0;
let lastTick = 0;
let colorDirty = false;
let blastColorDirty = false;

// Stable debug view: the exact same object is returned every time, and its
// mesh references let harnesses assert pool identity without new allocations.
export const fxStats = {
  particleMesh: null,
  explosionMesh: null,
  particlePool: MAX,
  explosionPool: BLAST_MAX,
  smokeEmitted: 0,
  sparkEmitted: 0,
  explosionEmits: 0,
  blastEmitted: 0,
  activeBlasts: 0,
  ticks: 0,
};

export function fxDebug() {
  return fxStats;
}

export function resetFxCounters() {
  fxStats.smokeEmitted = 0;
  fxStats.sparkEmitted = 0;
  fxStats.explosionEmits = 0;
  fxStats.blastEmitted = 0;
  fxStats.ticks = 0;
}

function ensure(scene) {
  if (mesh) return mesh;
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    toneMapped: false,
  });
  mesh = new THREE.InstancedMesh(geometry, material, MAX);
  mesh.name = 'vehicleFx';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  for (let i = 0; i < MAX; i++) {
    dummy.position.set(0, -50, 0);
    dummy.scale.setScalar(0.0001);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  fxStats.particleMesh = mesh;
  scene?.add?.(mesh);
  return mesh;
}

function ensureBlast(scene) {
  if (blastMesh) return blastMesh;
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    toneMapped: false,
  });
  blastMesh = new THREE.InstancedMesh(geometry, material, BLAST_MAX);
  blastMesh.name = 'vehicleExplosionFx';
  blastMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blastMesh.frustumCulled = false;
  for (let i = 0; i < BLAST_MAX; i++) {
    dummy.position.set(0, -50, 0);
    dummy.scale.setScalar(0.0001);
    dummy.updateMatrix();
    blastMesh.setMatrixAt(i, dummy.matrix);
    blastMesh.setColorAt(i, i % 3 === 2 ? emberColor : flameColor);
  }
  blastMesh.instanceMatrix.needsUpdate = true;
  if (blastMesh.instanceColor) blastMesh.instanceColor.needsUpdate = true;
  fxStats.explosionMesh = blastMesh;
  scene?.add?.(blastMesh);
  return blastMesh;
}

function spawn(scene, kind, x, y, z, vx, vy, vz, size, life) {
  ensure(scene);
  const p = particles[cursor];
  cursor = (cursor + 1) % MAX;
  p.kind = kind;
  p.life = life;
  p.max = life;
  p.x = x;
  p.y = y;
  p.z = z;
  p.vx = vx;
  p.vy = vy;
  p.vz = vz;
  p.size = size;
  mesh.setColorAt(cursor === 0 ? MAX - 1 : cursor - 1, kind === SMOKE ? smokeColor : sparkColor);
  colorDirty = true;
  if (kind === SMOKE) fxStats.smokeEmitted++;
  else fxStats.sparkEmitted++;
}

function spawnBlast(scene, kind, x, y, z, vx, vy, vz, size, grow, life) {
  ensureBlast(scene);
  const p = blasts[blastCursor];
  blastCursor = (blastCursor + 1) % BLAST_MAX;
  p.kind = kind;
  p.life = life;
  p.max = life;
  p.x = x;
  p.y = y;
  p.z = z;
  p.vx = vx;
  p.vy = vy;
  p.vz = vz;
  p.size = size;
  p.grow = grow;
  blastMesh.setColorAt(blastCursor === 0 ? BLAST_MAX - 1 : blastCursor - 1,
    kind === FIRE ? fireColor : kind === SOOT ? sootColor : emberColor);
  blastColorDirty = true;
  fxStats.blastEmitted++;
  fxStats.activeBlasts++;
}

// Called from Vehicle._sync. Timestamp gating keeps the pools aging once per
// rendered frame even when several vehicles sync in the same tick.
export function updateFx(dt, scene) {
  if (!mesh && !blastMesh) return;
  const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const elapsed = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : (dt || 0.016);
  if (lastTick && now - lastTick < 6) return;
  lastTick = now;
  advanceFx(elapsed, scene);
}

// Deterministic, allocation-free step used by harnesses and by updateFx.
export function stepFx(dt, scene) {
  advanceFx(Math.max(0, Math.min(0.05, dt || 0)), scene);
}

function advanceFx(elapsed, scene) {
  fxStats.ticks++;
  if (mesh) {
    for (let i = 0; i < MAX; i++) {
      const p = particles[i];
      if (p.life <= 0) continue;
      p.life -= elapsed;
      if (p.life <= 0) {
        dummy.position.set(0, -50, 0);
        dummy.scale.setScalar(0.0001);
      } else {
        p.x += p.vx * elapsed;
        p.y += p.vy * elapsed;
        p.z += p.vz * elapsed;
        p.vy += (p.kind === SMOKE ? 0.55 : -7.5) * elapsed;
        const t = p.life / p.max;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.size * (p.kind === SMOKE ? 1.6 - t * 0.6 : t * 1.1));
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (colorDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    colorDirty = false;
  }
  if (blastMesh) {
    let active = 0;
    for (let i = 0; i < BLAST_MAX; i++) {
      const p = blasts[i];
      if (p.life <= 0) continue;
      p.life -= elapsed;
      if (p.life <= 0) {
        dummy.position.set(0, -50, 0);
        dummy.scale.setScalar(0.0001);
      } else {
        active++;
        p.x += p.vx * elapsed;
        p.y += p.vy * elapsed;
        p.z += p.vz * elapsed;
        p.vy += (p.kind === SOOT ? 0.7 : -3.4) * elapsed;
        const t = p.life / p.max;
        const age = 1 - t;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(Math.max(0.001, p.size + p.grow * age) * (p.kind === EMBER ? t : 1));
      }
      dummy.updateMatrix();
      blastMesh.setMatrixAt(i, dummy.matrix);
    }
    blastMesh.instanceMatrix.needsUpdate = true;
    if (blastColorDirty && blastMesh.instanceColor) blastMesh.instanceColor.needsUpdate = true;
    blastColorDirty = false;
    fxStats.activeBlasts = active;
  }
  void scene;
}

export function emitDriftFx(scene, x, y, z, heading, speed) {
  const back = Math.sin(heading) * -1.5;
  const side = Math.cos(heading) * -1.5;
  const drift = Math.min(1, Math.abs(speed) / 24);
  for (let i = 0; i < SIDES.length; i++) {
    const sx = SIDES[i];
    spawn(
      scene, SMOKE,
      x + back - Math.cos(heading) * sx * 1.1, y + 0.22, z + side + Math.sin(heading) * sx * 1.1,
      (Math.random() - 0.5) * 0.9 - Math.sin(heading) * speed * 0.05,
      0.35 + Math.random() * 0.35,
      (Math.random() - 0.5) * 0.9 - Math.cos(heading) * speed * 0.05,
      0.7 + drift * 0.8, 0.55 + drift * 0.35,
    );
  }
}

export function emitImpactFx(scene, x, y, z) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    spawn(
      scene, SPARK, x, y + 0.55, z,
      Math.cos(a) * 3.2, 2.2 + Math.random() * 1.6, Math.sin(a) * 3.2,
      0.22, 0.38,
    );
  }
}

// Damage escalation: health01 is health / maxHealth. A lightly dented car
// coughs one puff; a nearly wrecked car throws several fat puffs and sparks.
// Counts are deterministic so the effect can be verified without rendering.
export function emitDamageFx(scene, x, y, z, health01, heading = 0) {
  const health = health01 == null ? 1 : Math.max(0, Math.min(1, health01));
  const severity = 1 - health;
  const puffs = severity < 0.3 ? 0 : severity < 0.6 ? 1 : 2;
  const sparks = severity < 0.45 ? 0 : severity < 0.75 ? 2 : 4;
  for (let i = 0; i < puffs; i++) {
    const jitter = (Math.random() - 0.5) * 0.8;
    spawn(
      scene, SMOKE,
      x - Math.sin(heading) * 1.2 + jitter, y + 0.85 + i * 0.3, z - Math.cos(heading) * 1.2 + jitter,
      (Math.random() - 0.5) * 1.1 + Math.sin(heading) * 1.4,
      0.9 + Math.random() * 0.6,
      (Math.random() - 0.5) * 1.1 + Math.cos(heading) * 1.4,
      0.75 + severity * 1.1, 0.7 + severity * 0.5,
    );
  }
  for (let i = 0; i < sparks; i++) {
    const a = (i / sparks) * Math.PI * 2 + heading;
    spawn(
      scene, SPARK, x, y + 0.6, z,
      Math.cos(a) * (2.2 + severity * 2.4), 1.8 + Math.random() * 1.5, Math.sin(a) * (2.2 + severity * 2.4),
      0.18 + severity * 0.1, 0.32,
    );
  }
}

// One blast reuses the same InstancedMesh and preallocated particle slots.
// It is safe to call twice on the same vehicle: idempotency lives in
// Vehicle.explode(), which only emits once.
export function emitExplosionFx(scene, x, y, z) {
  ensureBlast(scene);
  fxStats.explosionEmits++;
  // Hot core and expanding fire lobes.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const speed = i === 0 ? 0 : 2.2 + Math.random() * 1.6;
    spawnBlast(
      scene, FIRE,
      x + Math.cos(a) * 0.4, y + 0.8 + (i === 0 ? 0.5 : 0), z + Math.sin(a) * 0.4,
      Math.cos(a) * speed, i === 0 ? 1.4 : 1.8 + Math.random(), Math.sin(a) * speed,
      i === 0 ? 1.5 : 0.6 + Math.random() * 0.4, i === 0 ? 2.6 : 1.5, 0.5 + Math.random() * 0.35,
    );
  }
  // Rising soot cloud.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 1.1 + Math.random() * 1.3;
    spawnBlast(
      scene, SOOT,
      x + Math.cos(a) * r * 0.4, y + 1.0 + Math.random() * 0.7, z + Math.sin(a) * r * 0.4,
      Math.cos(a) * (0.7 + Math.random()), 1.7 + Math.random() * 1.2, Math.sin(a) * (0.7 + Math.random()),
      0.6 + Math.random() * 0.5, 1.4 + Math.random() * 0.8, 0.9 + Math.random() * 0.4,
    );
  }
  // Fast embers, reusing the shared spark pool.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    spawn(
      scene, SPARK, x, y + 0.75, z,
      Math.cos(a) * (5 + Math.random() * 3), 3 + Math.random() * 3, Math.sin(a) * (5 + Math.random() * 3),
      0.3, 0.55,
    );
  }
}
