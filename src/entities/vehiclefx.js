import * as THREE from 'three';

// Shared, preallocated particle pool for HIGH-quality drift smoke and impact
// sparks. One InstancedMesh (one draw call) is created on first use and reused
// by every vehicle; there are no allocations in the emit/update paths.
const MAX = 48;
const SMOKE = 0;
const SPARK = 1;

const particles = Array.from({ length: MAX }, () => ({
  life: 0,
  max: 1,
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  size: 0,
  kind: SMOKE,
}));
const smokeColor = new THREE.Color(0x7a8196);
const sparkColor = new THREE.Color(0xffcf7a);
const SIDES = [-1, 1];
const dummy = new THREE.Object3D();
dummy.rotation.set(-Math.PI / 2, 0, 0);

let mesh = null;
let cursor = 0;
let lastTick = 0;
let colorDirty = false;

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
  scene?.add?.(mesh);
  return mesh;
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
}

// Called from Vehicle._sync. Timestamp gating keeps the pool aging once per
// rendered frame even when several vehicles sync in the same tick.
export function updateFx(dt, scene) {
  if (!mesh) return;
  const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const elapsed = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : (dt || 0.016);
  if (lastTick && now - lastTick < 6) return;
  lastTick = now;
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
  if (colorDirty) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    colorDirty = false;
  }
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
