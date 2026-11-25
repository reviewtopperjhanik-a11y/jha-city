import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { C, DISTRICTS, districtAt } from '../look/palette.js';
import { makeRng, rand, randInt, pick } from '../util/rng.js';
import { dist2 } from '../util/math.js';

export const GRID = { N: 7, BLOCK: 130, ROAD: 18, HALF: 455 };
export const roadLine = (i) => -GRID.HALF + i * GRID.BLOCK;

function colorAttr(geometry, colors) {
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
}

function shadeGeometry(g, base, accent, rng, vertical = true) {
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
    const t = vertical ? (pos.getY(i) - minY) / span : 0.5;
    const c = base.clone().lerp(accent, 0.08 + t * 0.28);
    c.multiplyScalar(0.62 + t * 0.5 + rng() * 0.06);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  colorAttr(g, arr);
  return g;
}

function mergeOrNull(list) {
  if (!list.length) return null;
  const merged = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return merged;
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

  const toon = (color, extra = {}) =>
    new THREE.MeshToonMaterial({ color, gradientMap: look.gradientMap, ...extra });

  // Ground + roads + markings + sidewalks: four merged draws for the whole city.
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
    for (let d = -GRID.HALF; d <= GRID.HALF; d += 16) {
      const m1 = new THREE.BoxGeometry(0.28, 0.02, 5);
      m1.translate(p, 0.07, d);
      markParts.push(m1);
      const m2 = new THREE.BoxGeometry(5, 0.02, 0.28);
      m2.translate(d, 0.07, p);
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

  // Buildings, windows and palms per chunk.
  for (let i = 0; i < GRID.N; i++) {
    for (let j = 0; j < GRID.N; j++) {
      const key = `${Math.floor(i / 2)},${Math.floor(j / 2)}`;
      if (!chunks.has(key)) chunks.set(key, { group: new THREE.Group(), buildings: [], windows: [], palms: [], cx: 0, cz: 0, n: 0 });
      const chunk = chunks.get(key);
      const cx = roadLine(i) + GRID.BLOCK / 2;
      const cz = roadLine(j) + GRID.BLOCK / 2;
      chunk.cx += cx;
      chunk.cz += cz;
      chunk.n++;
      const district = DISTRICTS[districtAt(cx, cz)];
      const count = randInt(rng, 1, district.height[1] > 50 ? 2 : 3);

      for (let b = 0; b < count; b++) {
        const w = rand(rng, 20, GRID.BLOCK - GRID.ROAD - 26);
        const d = rand(rng, 20, GRID.BLOCK - GRID.ROAD - 26);
        const bx = cx + rand(rng, -(GRID.BLOCK - GRID.ROAD - w) / 2, (GRID.BLOCK - GRID.ROAD - w) / 2);
        const bz = cz + rand(rng, -(GRID.BLOCK - GRID.ROAD - d) / 2, (GRID.BLOCK - GRID.ROAD - d) / 2);
        const h = rand(rng, district.height[0], district.height[1]);
        const bg = new THREE.BoxGeometry(w, h, d);
        bg.translate(bx, h / 2 + 0.18, bz);
        shadeGeometry(bg, new THREE.Color(district.base), new THREE.Color(district.accent), rng);
        chunk.buildings.push(bg);
        bounds.push({ x: bx, z: bz, hw: w / 2 + 1.2, hd: d / 2 + 1.2, h });

        // Steady, patterned windows: no random flicker and no rainbow of colours.
        const litColors = [C.amber, C.tangerine, C.lane];
        const pattern = randInt(rng, 0, 4);
        const litColor = new THREE.Color(pick(rng, litColors));
        const addWindow = (x, y, z, angle) => {
          const wg = new THREE.PlaneGeometry(1.5, 1.05);
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
          const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
          wg.applyMatrix4(m);
          const c = litColor.clone().multiplyScalar(1.0 + rng() * 0.3);
          colorAttr(wg, [c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b]);
          chunk.windows.push(wg);
        };
        let row = 0;
        for (let y = 4; y < h - 2; y += 4.4) {
          let col = 0;
          for (let o = -w / 2 + 2.5; o < w / 2 - 1; o += 4.0) {
            const lit = (row + col + pattern) % 5 < 2;
            if (lit) addWindow(bx + o, y, bz + d / 2 + 0.04, 0);
            if (lit) addWindow(bx + o, y, bz - d / 2 - 0.04, Math.PI);
            col++;
          }
          col = 0;
          for (let o = -d / 2 + 2.5; o < d / 2 - 1; o += 4.0) {
            const lit = (row + col + pattern) % 5 < 2;
            if (lit) addWindow(bx + w / 2 + 0.04, y, bz + o, Math.PI / 2);
            if (lit) addWindow(bx - w / 2 - 0.04, y, bz + o, -Math.PI / 2);
            col++;
          }
          row++;
        }
      }

      if (district.palm) {
        const palms = randInt(rng, 3, 7);
        for (let p = 0; p < palms; p++) {
          chunk.palms.push({
            x: cx + rand(rng, -GRID.BLOCK / 2 + 8, GRID.BLOCK / 2 - 8),
            z: cz + rand(rng, -GRID.BLOCK / 2 + 8, GRID.BLOCK / 2 - 8),
            s: rand(rng, 0.8, 1.35),
          });
        }
      }
    }
  }

  const buildingMat = toon(0xffffff, { vertexColors: true });
  const windowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const trunkMat = toon(0x8a6a4a);
  const frondMat = toon(C.leaf);

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
    if (chunk.palms.length) {
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.55, 6, 6), trunkMat, chunk.palms.length);
      const frond = new THREE.InstancedMesh(new THREE.ConeGeometry(3.0, 1.4, 6), frondMat, chunk.palms.length);
      const m = new THREE.Matrix4();
      chunk.palms.forEach((p, idx) => {
        m.compose(new THREE.Vector3(p.x, 3 * p.s + 0.18, p.z), new THREE.Quaternion(), new THREE.Vector3(p.s, p.s, p.s));
        trunk.setMatrixAt(idx, m);
        m.compose(new THREE.Vector3(p.x, 6.5 * p.s + 0.18, p.z), new THREE.Quaternion(), new THREE.Vector3(p.s, p.s, p.s));
        frond.setMatrixAt(idx, m);
      });
      trunk.instanceMatrix.needsUpdate = true;
      frond.instanceMatrix.needsUpdate = true;
      chunk.group.add(trunk, frond);
    }
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
