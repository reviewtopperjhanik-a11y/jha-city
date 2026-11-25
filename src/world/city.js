import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { C, DISTRICTS, districtAt } from '../look/palette.js';
import { makeRng, rand, randInt, pick } from '../util/rng.js';
import { dist2, TAU } from '../util/math.js';

export const GRID = { N: 7, BLOCK: 130, ROAD: 18, HALF: 455 };
export const roadLine = (i) => -GRID.HALF + i * GRID.BLOCK;

const BUILDING_PALETTES = {
  downtown: [C.orchid, C.dusk, C.flamingo, 0x4c3d8f, 0x6a4bb0, 0x8a4f9e],
  strip: [C.coral, C.tangerine, C.amber, 0xd85f6a, 0xb85a8f, 0xe0a060],
  port: [C.rust, 0x7a5a4a, 0xb0764f, 0x9a6a50, 0x8a6248],
  beach: [C.sand, 0xe8c49a, 0xd8b26a, 0xc9a47c, 0x9fc4b8],
};

function colorAttr(geometry, colors) {
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
}

function paintVertical(g, base, accent, rng) {
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minY = Math.min(minY, pos.getY(i));
    maxY = Math.max(maxY, pos.getY(i));
  }
  const span = Math.max(0.001, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / span;
    const c = base.clone().lerp(accent, 0.06 + t * 0.25);
    c.multiplyScalar(0.7 + t * 0.38 + rng() * 0.05);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  colorAttr(g, arr);
}

function paintSolid(g, base, rng, variance = 0.1) {
  const arr = new Float32Array(g.attributes.position.count * 3);
  const c = base.clone().multiplyScalar(0.94 + rng() * variance);
  for (let i = 0; i < g.attributes.position.count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  colorAttr(g, arr);
}

function mergeOrNull(list) {
  if (!list.length) return null;
  const merged = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return merged;
}

function windowQuad(x, y, z, angle, color, w = 1.45, h = 1.0) {
  const g = new THREE.PlaneGeometry(w, h);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  colorAttr(g, [color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b]);
  return g;
}

function addWindows(chunk, x, z, w, d, baseY, h, litColor, pattern, rng) {
  const glass = new THREE.Color(0x1b2740);
  for (let row = 0, y = baseY + 4; y < baseY + h - 2; y += 4.3, row++) {
    for (let col = 0, o = -w / 2 + 2.4; o < w / 2 - 1; o += 4.0, col++) {
      const lit = (row + col + pattern) % 5 < 2;
      const c = (lit ? litColor.clone().multiplyScalar(1.0 + rng() * 0.25) : glass.clone().multiplyScalar(0.72 + rng() * 0.22));
      chunk.windows.push(windowQuad(x + o, y, z + d / 2 + 0.05, 0, c));
      chunk.windows.push(windowQuad(x + o, y, z - d / 2 - 0.05, Math.PI, c));
    }
    for (let col = 0, o = -d / 2 + 2.4; o < d / 2 - 1; o += 4.0, col++) {
      const lit = (row + col + pattern + 2) % 5 < 2;
      const c = (lit ? litColor.clone().multiplyScalar(1.0 + rng() * 0.25) : glass.clone().multiplyScalar(0.72 + rng() * 0.22));
      chunk.windows.push(windowQuad(x + w / 2 + 0.05, y, z + o, Math.PI / 2, c));
      chunk.windows.push(windowQuad(x - w / 2 - 0.05, y, z + o, -Math.PI / 2, c));
    }
  }
}

function addMass(chunk, bounds, rng, { x, z, w, d, h, baseY = 0, base, accent, litColor, pattern }) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, baseY + h / 2 + 0.18, z);
  paintVertical(g, base, accent, rng);
  chunk.buildings.push(g);
  bounds.push({ x, z, hw: w / 2 + 1.0, hd: d / 2 + 1.0, h: baseY + h });

  // A darker plinth grounds the building at street level.
  if (baseY < 0.5) {
    const plinth = new THREE.BoxGeometry(w + 0.5, 0.55, d + 0.5);
    plinth.translate(x, 0.44, z);
    paintSolid(plinth, accent.clone().multiplyScalar(0.52), rng, 0.05);
    chunk.buildings.push(plinth);
  }

  // Horizontal floor ledges break up the flat box silhouette.
  const bands = Math.min(5, Math.max(0, Math.floor(h / 8.6) - 1));
  for (let k = 1; k <= bands; k++) {
    const band = new THREE.BoxGeometry(w + 0.28, 0.16, d + 0.28);
    band.translate(x, baseY + k * 8.6, z);
    paintSolid(band, accent.clone().multiplyScalar(0.72), rng, 0.06);
    chunk.buildings.push(band);
  }

  // Corner trim makes taller buildings read as towers, not plain blocks.
  if (h > 16 && rng() > 0.3) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const trim = new THREE.BoxGeometry(0.24, h, 0.24);
        trim.translate(x + sx * (w / 2 - 0.05), baseY + h / 2 + 0.18, z + sz * (d / 2 - 0.05));
        paintSolid(trim, accent.clone().multiplyScalar(0.95), rng, 0.05);
        chunk.buildings.push(trim);
      }
    }
  }

  // Neon facade strips and a dark double door at street level.
  if (h > 20 && rng() > 0.55) {
    const neon = new THREE.Color(pick(rng, [C.teal, C.flamingo, C.amber, C.tangerine]));
    chunk.windows.push(windowQuad(x + w * 0.33, baseY + h * 0.52, z + d / 2 + 0.06, 0, neon, 0.42, h * 0.72));
    if (rng() > 0.5) {
      const neon2 = new THREE.Color(pick(rng, [C.teal, C.coral, C.lane]));
      chunk.windows.push(windowQuad(x + w / 2 + 0.06, baseY + h * 0.5, z - d * 0.25, Math.PI / 2, neon2, 0.36, h * 0.6));
    }
  }
  if (baseY < 0.5 && w > 18) {
    const door = new THREE.Color(0x0c1320);
    chunk.windows.push(windowQuad(x - w * 0.2, 1.85, z + d / 2 + 0.3, 0, door, 1.7, 2.2));
    const lamp = new THREE.Color(C.amber).multiplyScalar(1.25);
    chunk.windows.push(windowQuad(x - w * 0.2, 3.45, z + d / 2 + 0.31, 0, lamp, 0.42, 0.2));
  }

  addWindows(chunk, x, z, w, d, baseY, h, litColor, pattern, rng);
  return { x, z, w, d, h, top: baseY + h };
}

function addRoof(chunk, rng, { x, z, w, d, top }, base, accent) {
  // Low-rise blocks get pitched hip roofs so the skyline is not all boxes.
  if (top < 25 && rng() > 0.48) {
    const roofH = rand(rng, 2.6, 5.4);
    const roof = new THREE.ConeGeometry(1, 1, 4);
    roof.rotateY(Math.PI / 4);
    roof.scale(w * 0.72, roofH, d * 0.72);
    roof.translate(x, top + 0.18 + roofH / 2, z);
    paintSolid(roof, base.clone().multiplyScalar(0.66).lerp(accent, 0.18), rng, 0.1);
    chunk.buildings.push(roof);
    return;
  }

  const slab = new THREE.BoxGeometry(w + 1.0, 0.4, d + 1.0);
  slab.translate(x, top + 0.38, z);
  paintSolid(slab, base.clone().multiplyScalar(0.8), rng);
  chunk.buildings.push(slab);

  for (const [px, pz, pw, pd] of [
    [x, z + d / 2 + 0.35, w + 1.0, 0.3],
    [x, z - d / 2 - 0.35, w + 1.0, 0.3],
    [x + w / 2 + 0.35, z, 0.3, d + 1.0],
    [x - w / 2 - 0.35, z, 0.3, d + 1.0],
  ]) {
    const edge = new THREE.BoxGeometry(pw, 0.7, pd);
    edge.translate(px, top + 0.85, pz);
    paintSolid(edge, accent.clone().multiplyScalar(0.85), rng);
    chunk.buildings.push(edge);
  }

  const details = randInt(rng, 2, 4);
  for (let i = 0; i < details; i++) {
    const px = x + rand(rng, -w / 3, w / 3);
    const pz = z + rand(rng, -d / 3, d / 3);
    if (rng() > 0.55) {
      const tank = new THREE.CylinderGeometry(1.0, 1.1, 2.1, 8);
      tank.translate(px, top + 1.6, pz);
      paintSolid(tank, new THREE.Color(C.rust), rng);
      chunk.buildings.push(tank);
    } else {
      const ac = new THREE.BoxGeometry(1.4, 0.8, 1.2);
      ac.translate(px, top + 0.95, pz);
      paintSolid(ac, new THREE.Color(0x9ca3b8), rng);
      chunk.buildings.push(ac);
    }
  }
  if (rng() > 0.45) {
    const mast = new THREE.CylinderGeometry(0.055, 0.055, 4.0, 5);
    mast.translate(x + rand(rng, -w / 4, w / 4), top + 2.3, z + rand(rng, -d / 4, d / 4));
    paintSolid(mast, new THREE.Color(0xcfd6e6), rng);
    chunk.buildings.push(mast);
  }

  // Glowing parapet band on taller roofs.
  if (top > 22 && rng() > 0.4) {
    const neon = new THREE.Color(pick(rng, [C.teal, C.flamingo, C.amber, C.tangerine]));
    const y = top + 0.92;
    chunk.windows.push(windowQuad(x, y, z + d / 2 + 0.52, 0, neon, w + 1.1, 0.34));
    chunk.windows.push(windowQuad(x, y, z - d / 2 - 0.52, Math.PI, neon, w + 1.1, 0.34));
    chunk.windows.push(windowQuad(x + w / 2 + 0.52, y, z, Math.PI / 2, neon, d + 1.1, 0.34));
    chunk.windows.push(windowQuad(x - w / 2 - 0.52, y, z, -Math.PI / 2, neon, d + 1.1, 0.34));
  }

  // Rooftop billboard with a simple steel frame.
  if (top > 26 && w > 28 && rng() > 0.62) {
    const signColor = new THREE.Color(pick(rng, [C.coral, C.teal, C.amber, C.flamingo])).multiplyScalar(1.2);
    const signW = Math.min(w * 0.68, 13);
    chunk.windows.push(windowQuad(x, top + 3.6, z + d / 2 + 0.18, 0, signColor, signW, 3.4));
    for (const sx of [-0.4, 0.4]) {
      const post = new THREE.BoxGeometry(0.18, 3.2, 0.18);
      post.translate(x + signW * sx, top + 1.8, z + d / 2 + 0.05);
      paintSolid(post, new THREE.Color(0x3a3a4a), rng, 0.04);
      chunk.buildings.push(post);
    }
  }
}

function addStorefront(chunk, rng, { x, z, w, d }, accent) {
  const bandColor = accent.clone().multiplyScalar(1.15);
  const shopColor = new THREE.Color(pick(rng, [C.amber, C.lane, C.tangerine])).multiplyScalar(0.92);
  const faces = [
    { wx: x, wz: z + d / 2 + 0.07, ax: x, az: z + d / 2 + 0.55, aw: w * 0.88, ad: 1.0, ww: w * 0.76, angle: 0 },
    { wx: x, wz: z - d / 2 - 0.07, ax: x, az: z - d / 2 - 0.55, aw: w * 0.88, ad: 1.0, ww: w * 0.76, angle: Math.PI },
    { wx: x + w / 2 + 0.07, wz: z, ax: x + w / 2 + 0.55, az: z, aw: 1.0, ad: d * 0.88, ww: d * 0.76, angle: Math.PI / 2 },
    { wx: x - w / 2 - 0.07, wz: z, ax: x - w / 2 - 0.55, az: z, aw: 1.0, ad: d * 0.88, ww: d * 0.76, angle: -Math.PI / 2 },
  ];
  for (const f of faces) {
    const awning = new THREE.BoxGeometry(f.aw, 0.26, f.ad);
    awning.translate(f.ax, 3.15, f.az);
    paintSolid(awning, bandColor, rng, 0.06);
    chunk.buildings.push(awning);
    chunk.windows.push(windowQuad(f.wx, 1.95, f.wz, f.angle, shopColor, Math.max(3, f.ww), 2.1));
  }
}

let _treeGeo;
let _palmGeo;
let _bushGeo;

function makeTreeGeometry() {
  const rng = makeRng(3301);
  const parts = [];
  const add = (g, color) => {
    paintSolid(g, new THREE.Color(color), rng, 0.12);
    // Icosahedrons are non-indexed while cylinders are indexed; normalise all
    // parts before merging or mergeGeometries returns null.
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    parts.push(ng);
  };
  const pot = new THREE.CylinderGeometry(0.56, 0.66, 0.34, 8);
  pot.translate(0, 0.17, 0);
  add(pot, 0x4d4a62);
  const trunk = new THREE.CylinderGeometry(0.16, 0.27, 2.7, 7);
  trunk.translate(0, 1.65, 0);
  add(trunk, 0x6e4a33);
  for (const [sx, sz, rz] of [[-0.45, 0.1, 0.55], [0.42, -0.12, -0.5]]) {
    const branch = new THREE.CylinderGeometry(0.07, 0.12, 1.1, 5);
    branch.translate(0, 0.55, 0);
    branch.rotateZ(rz);
    branch.translate(sx, 2.7, sz);
    add(branch, 0x5e402d);
  }
  const blobs = [
    [0, 3.65, 0, 1.55, 0x3f7f55],
    [0.88, 3.3, 0.28, 1.18, 0x4a8c60],
    [-0.82, 3.25, -0.3, 1.22, 0x376f4c],
    [0.08, 4.4, -0.12, 1.08, 0x529966],
    [-0.2, 3.2, 0.78, 1.0, 0x478659],
  ];
  for (const [x, y, z, s, color] of blobs) {
    const blob = new THREE.IcosahedronGeometry(s, 0);
    blob.scale(1.08, 0.88, 1.08);
    blob.translate(x, y, z);
    add(blob, color);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function makePalmGeometry() {
  const rng = makeRng(5511);
  const parts = [];
  const add = (g, color) => {
    paintSolid(g, new THREE.Color(color), rng, 0.1);
    parts.push(g);
  };
  const segs = [
    [0.3, 0.4, 2.2, 0, 1.1, 0, 0],
    [0.24, 0.31, 2.0, 0.09, 3.0, 0.02, 0.07],
    [0.18, 0.25, 1.6, 0.22, 4.5, 0.05, 0.13],
  ];
  for (const [rt, rb, h, x, y, z, rz] of segs) {
    const seg = new THREE.CylinderGeometry(rt, rb, h, 7);
    seg.translate(0, h / 2, 0);
    seg.rotateZ(rz);
    seg.translate(x, y - h / 2, z);
    add(seg, 0x8a6248);
  }
  const cx = 0.3;
  const cy = 5.35;
  for (let layer = 0; layer < 2; layer++) {
    const count = layer === 0 ? 10 : 7;
    const len = layer === 0 ? 3.0 : 2.25;
    const droop = layer === 0 ? 0.5 : 0.1;
    for (let i = 0; i < count; i++) {
      const frond = new THREE.CylinderGeometry(0.015, 0.17, len, 3);
      frond.translate(0, len / 2, 0);
      frond.rotateX(Math.PI / 2 + droop);
      frond.rotateY((i / count) * TAU + layer * 0.32);
      frond.translate(cx, cy + layer * 0.1, 0);
      add(frond, layer === 0 ? 0x3d8a5f : 0x4da06a);
    }
  }
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.SphereGeometry(0.16, 6, 5);
    nut.translate(cx + Math.cos((i / 3) * TAU) * 0.2, cy - 0.22, Math.sin((i / 3) * TAU) * 0.2);
    add(nut, 0x6b4a2f);
  }
  const spear = new THREE.CylinderGeometry(0.02, 0.1, 1.2, 4);
  spear.translate(cx, cy + 0.45, 0);
  add(spear, 0x4da06a);
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function makeBushGeometry() {
  const rng = makeRng(7717);
  const parts = [];
  const add = (g, color) => {
    paintSolid(g, new THREE.Color(color), rng, 0.14);
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    parts.push(ng);
  };
  const pot = new THREE.CylinderGeometry(0.34, 0.42, 0.3, 7);
  pot.translate(0, 0.15, 0);
  add(pot, 0x5a566e);
  for (const [x, y, z, s, color] of [
    [0, 0.62, 0, 0.46, 0x3f7f55],
    [0.28, 0.5, 0.12, 0.32, 0x4a8c60],
    [-0.25, 0.52, -0.14, 0.3, 0x376f4c],
  ]) {
    const blob = new THREE.IcosahedronGeometry(s, 0);
    blob.scale(1.1, 0.9, 1.1);
    blob.translate(x, y, z);
    add(blob, color);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function addStreetTreeInstances(chunk, vegMat) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const make = (items, geometry) => {
    if (!items.length) return;
    const inst = new THREE.InstancedMesh(geometry, vegMat, items.length);
    items.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot || 0);
      pos.set(t.x, 0.15, t.z);
      scl.setScalar(t.s);
      m.compose(pos, q, scl);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    chunk.group.add(inst);
  };
  make(chunk.trees, (_treeGeo ||= makeTreeGeometry()));
  make(chunk.palms, (_palmGeo ||= makePalmGeometry()));
  make(chunk.bushes, (_bushGeo ||= makeBushGeometry()));
}

function neonSign() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#ff885f');
  grad.addColorStop(0.5, '#f76685');
  grad.addColorStop(1, '#2fb6b2');
  ctx.fillStyle = '#0c0d1b';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = grad;
  ctx.font = 'bold 74px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#f76685';
  ctx.shadowBlur = 22;
  ctx.fillText('JHA CITY', 256, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(42, 10.5),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }),
  );
  mesh.position.set(120, 46, 120);
  mesh.rotation.y = -Math.PI / 4;
  return mesh;
}

export function createCity(scene, look) {
  const rng = makeRng(9931);
  const root = new THREE.Group();
  scene.add(root);
  const bounds = [];
  const chunks = new Map();

  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: look.gradientMap, ...extra });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), toon(0x4a4459));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  root.add(ground);

  const roadParts = [];
  const markParts = [];
  const sideParts = [];
  for (let i = 0; i <= GRID.N; i++) {
    const p = roadLine(i);
    const v = new THREE.BoxGeometry(GRID.ROAD, 0.08, GRID.HALF * 2 + GRID.ROAD);
    v.translate(p, 0.01, 0);
    roadParts.push(v);
    const h = new THREE.BoxGeometry(GRID.HALF * 2 + GRID.ROAD, 0.08, GRID.ROAD);
    h.translate(0, 0.01, p);
    roadParts.push(h);
    for (let dd = -GRID.HALF; dd <= GRID.HALF; dd += 16) {
      const m1 = new THREE.BoxGeometry(0.28, 0.02, 5);
      m1.translate(p, 0.07, dd);
      markParts.push(m1);
      const m2 = new THREE.BoxGeometry(5, 0.02, 0.28);
      m2.translate(dd, 0.07, p);
      markParts.push(m2);
    }
  }
  for (let i = 0; i < GRID.N; i++) {
    for (let j = 0; j < GRID.N; j++) {
      const cx = roadLine(i) + GRID.BLOCK / 2;
      const cz = roadLine(j) + GRID.BLOCK / 2;
      const s = new THREE.BoxGeometry(GRID.BLOCK - GRID.ROAD - 2, 0.18, GRID.BLOCK - GRID.ROAD - 2);
      s.translate(cx, 0.06, cz);
      sideParts.push(s);
    }
  }
  const roadMesh = new THREE.Mesh(mergeOrNull(roadParts), toon(C.road));
  const markMesh = new THREE.Mesh(mergeOrNull(markParts), new THREE.MeshBasicMaterial({ color: C.lane, toneMapped: false }));
  const sideMesh = new THREE.Mesh(mergeOrNull(sideParts), toon(C.sidewalk));
  roadMesh.receiveShadow = true;
  sideMesh.receiveShadow = true;
  root.add(roadMesh, markMesh, sideMesh);

  for (let i = 0; i < GRID.N; i++) {
    for (let j = 0; j < GRID.N; j++) {
      const key = `${Math.floor(i / 2)},${Math.floor(j / 2)}`;
      if (!chunks.has(key)) {
        chunks.set(key, { group: new THREE.Group(), buildings: [], windows: [], palms: [], trees: [], bushes: [], cx: 0, cz: 0, n: 0 });
      }
      const chunk = chunks.get(key);
      const cx = roadLine(i) + GRID.BLOCK / 2;
      const cz = roadLine(j) + GRID.BLOCK / 2;
      chunk.cx += cx;
      chunk.cz += cz;
      chunk.n++;
      const districtKey = districtAt(cx, cz);
      const district = DISTRICTS[districtKey];
      const palette = BUILDING_PALETTES[districtKey] || [district.base];
      const count = district.height[1] > 50 ? randInt(rng, 2, 3) : randInt(rng, 1, 2);
      const litColor = new THREE.Color(pick(rng, [C.amber, C.tangerine, C.lane]));
      const pattern = randInt(rng, 0, 4);
      const slots = count === 1 ? [0] : count === 2 ? [-1, 1] : [-1, 0, 1];

      for (let b = 0; b < count; b++) {
        const base = new THREE.Color(pick(rng, palette));
        const accent = new THREE.Color(district.accent);
        accent.offsetHSL(rand(rng, -0.02, 0.02), 0, rand(rng, -0.06, 0.04));
        const slot = slots[b];
        let w;
        let d;
        let bx;
        let bz;
        if (count === 1) {
          w = rand(rng, 28, GRID.BLOCK - GRID.ROAD - 30);
          d = rand(rng, 28, GRID.BLOCK - GRID.ROAD - 30);
          bx = cx + rand(rng, -4, 4);
          bz = cz + rand(rng, -4, 4);
        } else if (count === 2) {
          w = rand(rng, 24, 46);
          d = rand(rng, 28, 62);
          bx = cx + slot * 28 + rand(rng, -2, 2);
          bz = cz + rand(rng, -8, 8);
        } else {
          w = rand(rng, 24, 31);
          d = rand(rng, 28, 50);
          bx = cx + slot * 34 + rand(rng, -1, 1);
          bz = cz + rand(rng, -6, 6);
        }
        const h = rand(rng, district.height[0], district.height[1]);
        const style = rng();

        if (style < 0.42 && h > 24) {
          const baseH = h * rand(rng, 0.28, 0.4);
          const b1 = addMass(chunk, bounds, rng, { x: bx, z: bz, w, d, h: baseH, base, accent, litColor, pattern });
          const tw = w * rand(rng, 0.6, 0.75);
          const td = d * rand(rng, 0.6, 0.75);
          const tower = addMass(chunk, bounds, rng, { x: bx, z: bz, w: tw, d: td, h: h - baseH, baseY: baseH, base, accent, litColor, pattern });
          addRoof(chunk, rng, tower, base, accent);
          addStorefront(chunk, rng, b1, accent);
        } else if (style < 0.72) {
          const w1 = w * 0.62;
          const d1 = d;
          const h1 = h;
          const m1 = addMass(chunk, bounds, rng, { x: bx - w * 0.19, z: bz, w: w1, d: d1, h: h1, base, accent, litColor, pattern });
          const w2 = w * 0.52;
          const d2 = d * 0.55;
          const m2 = addMass(chunk, bounds, rng, { x: bx + w * 0.24, z: bz + d * 0.22, w: w2, d: d2, h: h * rand(rng, 0.55, 0.8), base, accent, litColor, pattern });
          addRoof(chunk, rng, m1, base, accent);
          addRoof(chunk, rng, m2, base, accent);
          addStorefront(chunk, rng, m1, accent);
        } else {
          const m = addMass(chunk, bounds, rng, { x: bx, z: bz, w, d, h, base, accent, litColor, pattern });
          addRoof(chunk, rng, m, base, accent);
          addStorefront(chunk, rng, m, accent);
        }
      }

      // Trees, palms and bushes on the sidewalk edge (52 units from block centre,
      // clear of the 9-unit road half-width and the building line).
      const treeCount = randInt(rng, 4, 7);
      for (let t = 0; t < treeCount; t++) {
        const side = randInt(rng, 0, 3);
        const off = rand(rng, -GRID.BLOCK / 2 + 16, GRID.BLOCK / 2 - 16);
        const edge = GRID.BLOCK / 2 - GRID.ROAD / 2 - 4;
        const x = side < 2 ? cx + off : cx + (side === 2 ? edge : -edge);
        const z = side === 0 ? cz + edge : side === 1 ? cz - edge : cz + off;
        const item = { x, z, s: rand(rng, 0.82, 1.24), rot: rand(rng, 0, TAU) };
        if (district.palm && rng() > 0.3) chunk.palms.push(item);
        else chunk.trees.push(item);
      }
      const bushCount = randInt(rng, 2, 4);
      for (let b = 0; b < bushCount; b++) {
        const edge = GRID.BLOCK / 2 - GRID.ROAD / 2 - 3;
        const x = cx + (rng() > 0.5 ? 1 : -1) * edge + rand(rng, -3, 3);
        const z = cz + rand(rng, -GRID.BLOCK / 2 + 14, GRID.BLOCK / 2 - 14);
        chunk.bushes.push({ x, z, s: rand(rng, 0.7, 1.15), rot: rand(rng, 0, TAU) });
      }
    }
  }

  const buildingMat = toon(0xffffff, { vertexColors: true });
  const windowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const vegMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: look.gradientMap });
  for (const [key, chunk] of chunks) {
    chunk.cx /= chunk.n;
    chunk.cz /= chunk.n;
    const bg = mergeOrNull(chunk.buildings);
    if (bg) {
      const mesh = new THREE.Mesh(bg, buildingMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      chunk.group.add(mesh);
    }
    const wg = mergeOrNull(chunk.windows);
    if (wg) chunk.group.add(new THREE.Mesh(wg, windowMat));
    addStreetTreeInstances(chunk, vegMat);
    root.add(chunk.group);
  }

  root.add(neonSign());

  function randomRoadPoint(r) {
    const idx = randInt(r, 0, GRID.N);
    const along = rand(r, -GRID.HALF + 20, GRID.HALF - 20);
    return r() > 0.5
      ? { x: roadLine(idx), z: along, axis: 'z', line: idx }
      : { x: along, z: roadLine(idx), axis: 'x', line: idx };
  }

  function collide(x, z, radius) {
    for (const b of bounds) {
      const dx = x - b.x;
      const dz = z - b.z;
      const px = b.hw + radius - Math.abs(dx);
      const pz = b.hd + radius - Math.abs(dz);
      if (px > 0 && pz > 0) {
        if (px < pz) return { x: b.x + Math.sign(dx || 1) * (b.hw + radius), z, hit: true };
        return { x, z: b.z + Math.sign(dz || 1) * (b.hd + radius), hit: true };
      }
    }
    return { x, z, hit: false };
  }

  function update(playerPos) {
    for (const chunk of chunks.values()) {
      chunk.group.visible = dist2(chunk.cx, chunk.cz, playerPos.x, playerPos.z) < 1050;
    }
  }

  return { root, bounds, chunks, update, collide, randomRoadPoint, GRID, roadLine };
}
