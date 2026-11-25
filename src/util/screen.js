import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const tmp = new THREE.Vector3();
const ndc = new THREE.Vector3();

// Where a world point lands on screen, clamped to an edge when it is outside
// the view or behind the camera. Pure math so it can be unit-tested without a renderer.
export function screenMarker(camera, point, width = 1280, height = 720, margin = 64, out = {}) {
  camera.updateMatrixWorld();
  const x = Number(point?.x) || 0;
  const y = (Number(point?.y) || 0) + 2;
  const z = Number(point?.z) || 0;
  const local = camera.worldToLocal(tmp.set(x, y, z));
  const behind = local.z > 0;
  let sx;
  let sy;
  if (behind) {
    const len = Math.hypot(local.x, local.y) || 1;
    const radius = Math.min(width, height) / 2 - margin;
    sx = width / 2 + (local.x / len) * radius;
    sy = height / 2 - (local.y / len) * radius;
  } else {
    ndc.set(x, y, z).project(camera);
    sx = (ndc.x * 0.5 + 0.5) * width;
    sy = (-ndc.y * 0.5 + 0.5) * height;
  }
  const inside = !behind && sx >= margin && sx <= width - margin && sy >= margin && sy <= height - margin;
  if (!inside) {
    sx = clamp(sx, margin, width - margin);
    sy = clamp(sy, margin, height - margin);
  }
  out.show = !inside;
  out.x = sx;
  out.y = sy;
  out.angle = Math.atan2(sy - height / 2, sx - width / 2);
  out.distance = Math.hypot(camera.position.x - x, camera.position.z - z);
  return out;
}
