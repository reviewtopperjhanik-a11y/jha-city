import * as THREE from 'three';
import { C } from '../look/palette.js';

// i/j are the city block indices reserved for each landmark.
export const LANDMARKS = [
  { key: 'spire', name: 'SOLAR SPIRE', x: 260, z: 0, i: 5, j: 3 },
  { key: 'crane', name: 'PORT CRANE', x: -260, z: 0, i: 1, j: 3 },
  { key: 'wheel', name: 'SUNSET WHEEL', x: 0, z: -260, i: 3, j: 1 },
  { key: 'arch', name: 'NEON ARCH', x: 0, z: 260, i: 3, j: 5 },
];

const RESERVED = new Set(LANDMARKS.map((l) => `${l.i},${l.j}`));
export const isLandmarkBlock = (i, j) => RESERVED.has(`${i},${j}`);

const geoCache = new Map();
const matCache = new Map();
const g = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};
const toon = (color, look) => {
  const key = `t${color}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap: look?.gradientMap }));
  return matCache.get(key);
};
const neon = (color) => {
  const key = `n${color}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  return matCache.get(key);
};

function builder(group, look) {
  const add = (mesh, x, y, z, rx = 0, ry = 0, rz = 0, shadow = false) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = shadow;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  };
  const box = (key, w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0, shadow = false) => add(
    new THREE.Mesh(g(key, () => new THREE.BoxGeometry(w, h, d)), toon(color, look)),
    x, y, z, rx, ry, rz, shadow,
  );
  const glowBox = (key, w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0) => add(
    new THREE.Mesh(g(key, () => new THREE.BoxGeometry(w, h, d)), neon(color)),
    x, y, z, rx, ry, rz,
  );
  return { add, box, glowBox };
}

function buildSpire(group, look) {
  const { add, box, glowBox } = builder(group, look);
  add(new THREE.Mesh(g('spireBase', () => new THREE.CylinderGeometry(11, 13.5, 3, 6)), toon(C.orchid, look)), 0, 1.5, 0, 0, Math.PI / 6, 0, true);
  add(new THREE.Mesh(g('spireShaft', () => new THREE.CylinderGeometry(4.2, 8, 86, 6)), toon(0x4c3d8f, look)), 0, 46, 0, 0, Math.PI / 6, 0, true);
  for (const y of [18, 38, 58, 76]) {
    add(new THREE.Mesh(g('spireRing', () => new THREE.TorusGeometry(6.6, 0.38, 6, 18)), neon(y > 60 ? C.coral : C.amber)), 0, y, 0, Math.PI / 2);
  }
  add(new THREE.Mesh(g('spireCrown', () => new THREE.IcosahedronGeometry(3.4, 0)), neon(C.flamingo)), 0, 93, 0);
  add(new THREE.Mesh(g('spireMast', () => new THREE.CylinderGeometry(0.18, 0.18, 11, 6)), neon(C.lane)), 0, 100, 0);
  box('spireDoor', 2.4, 3.4, 0.5, C.ink, 0, 2.2, 11.2);
  glowBox('spireSign', 5.2, 0.45, 0.4, C.teal, 0, 4.6, 11.4);
  return { hw: 14, hd: 14 };
}

function buildCrane(group, look) {
  const { add, box, glowBox } = builder(group, look);
  box('cranePad', 12, 1, 12, 0x3a3027, 0, 0.5, 0);
  box('craneColumn', 3.4, 42, 3.4, C.rust, 0, 21, 0, 0, 0, 0, true);
  box('craneBoom', 58, 1.8, 3.2, C.amber, 18, 44, 0, 0, 0, 0, true);
  box('craneCounter', 16, 1.6, 3, 0xb0764f, -9, 44, 0);
  box('craneBrace', 0.8, 26, 0.8, C.sand, 2, 33, 0, 0, 0, -0.62);
  for (let i = 0; i < 9; i++) {
    glowBox('craneStripe', 1.5, 1.9, 3.25, i % 2 ? C.ink : C.lane, -2 + i * 5.5, 44, 0);
  }
  add(new THREE.Mesh(g('craneCable', () => new THREE.CylinderGeometry(0.1, 0.1, 14, 5)), neon(C.lane)), 42, 36.5, 0);
  box('craneContainer', 11, 4, 5, C.teal, 42, 26, 0, 0, 0, 0, true);
  glowBox('craneBeacon', 1.2, 1.2, 1.2, 0xff3355, 0, 46.4, 0);
  return { hw: 8, hd: 8 };
}

function buildWheel(group, look) {
  const { add, box } = builder(group, look);
  for (const s of [-1, 1]) {
    box('wheelLeg', 1.6, 25, 1.6, 0x6a4bb0, s * 14, 12.5, 0, 0, 0, s * 0.22, true);
  }
  box('wheelAxle', 2.6, 2.6, 4, C.orchid, 0, 27, 0);
  add(new THREE.Mesh(g('wheelRim', () => new THREE.TorusGeometry(21, 0.95, 8, 40)), neon(C.coral)), 0, 27, 0);
  add(new THREE.Mesh(g('wheelRimInner', () => new THREE.TorusGeometry(16.5, 0.34, 6, 36)), neon(C.amber)), 0, 27, 0);
  for (let i = 0; i < 12; i++) {
    add(new THREE.Mesh(g('wheelSpoke', () => new THREE.BoxGeometry(0.34, 42, 0.34)), toon(0x8a4f9e, look)), 0, 27, 0, 0, 0, (i / 12) * Math.PI);
  }
  const cabinColors = [C.teal, C.amber, C.flamingo, C.tangerine, C.lane];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    box('wheelCabin', 2.6, 2.1, 2.4, cabinColors[i % cabinColors.length], Math.cos(a) * 21, 27 + Math.sin(a) * 21, 0, 0, 0, 0, true);
  }
  return { hw: 22, hd: 6 };
}

function buildArch(group, look) {
  const { add, box, glowBox } = builder(group, look);
  for (const s of [-1, 1]) {
    box('archPillar', 3, 23, 3.4, C.orchid, s * 17, 11.5, 0, 0, 0, 0, true);
    glowBox('archTrim', 0.5, 18, 3.6, C.teal, s * 17, 11, 0);
  }
  add(new THREE.Mesh(g('archTop', () => new THREE.TorusGeometry(17, 1.25, 8, 28, Math.PI)), neon(C.flamingo)), 0, 22.5, 0);
  box('archSign', 20, 3.2, 0.9, C.ink, 0, 25.4, 0.9);
  for (let i = -2; i <= 2; i++) {
    glowBox('archLetter', 1.6, 1.4, 0.35, i % 2 ? C.amber : C.lane, i * 3.5, 25.4, 1.5);
  }
  return { hw: 19, hd: 5 };
}

const BUILDERS = { spire: buildSpire, crane: buildCrane, wheel: buildWheel, arch: buildArch };

// Adds four skyline landmarks to reserved city blocks and returns their data so
// the minimap, collision bounds and debug tooling can all share it.
export function addLandmarks(parent, look, bounds = []) {
  return LANDMARKS.filter((l) => BUILDERS[l.key]).map((l) => {
    const group = new THREE.Group();
    group.position.set(l.x, 0, l.z);
    const footprint = BUILDERS[l.key](group, look);
    parent.add(group);
    bounds.push({ x: l.x, z: l.z, hw: footprint.hw, hd: footprint.hd });
    return { ...l, footprint, group };
  });
}
