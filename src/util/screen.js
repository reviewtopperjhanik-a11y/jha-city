import * as THREE from 'three';

const tmp = new THREE.Vector3();
const ndc = new THREE.Vector3();

const finite = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// Where a world point lands on screen, clamped to an edge when it is outside
// the view or behind the camera. Pure math: no window/document reads, so it
// stays unit-testable without a renderer or a DOM.
export function screenMarker(camera, point, width = 1280, height = 720, margin = 64, out = {}) {
  const w = Math.max(1, finite(width, 1280));
  const h = Math.max(1, finite(height, 720));
  // A tiny viewport must still leave room for the arrow.
  const edge = Math.max(0, Math.min(finite(margin, 64), Math.min(w, h) / 2 - 1));
  const x = finite(point?.x, 0);
  const y = finite(point?.y, 0) + 2;
  const z = finite(point?.z, 0);

  camera?.updateMatrixWorld?.();
  const local = camera?.worldToLocal
    ? camera.worldToLocal(tmp.set(x, y, z))
    : tmp.set(x, y, z);
  const behind = local.z > 0;

  let sx;
  let sy;
  if (behind) {
    const len = Math.hypot(local.x, local.y) || 1;
    const radius = Math.max(0, Math.min(w, h) / 2 - edge);
    sx = w / 2 + (local.x / len) * radius;
    sy = h / 2 - (local.y / len) * radius;
  } else if (camera?.projectionMatrix) {
    ndc.set(x, y, z).project(camera);
    sx = (finite(ndc.x, 0) * 0.5 + 0.5) * w;
    sy = (-finite(ndc.y, 0) * 0.5 + 0.5) * h;
  } else {
    sx = w / 2;
    sy = h / 2;
  }

  const inside = !behind && sx >= edge && sx <= w - edge && sy >= edge && sy <= h - edge;
  if (!inside) {
    sx = Math.max(edge, Math.min(w - edge, sx));
    sy = Math.max(edge, Math.min(h - edge, sy));
  }
  out.show = !inside;
  out.x = sx;
  out.y = sy;
  out.angle = Math.atan2(sy - h / 2, sx - w / 2);
  out.distance = Math.hypot(
    finite(camera?.position?.x, 0) - x,
    finite(camera?.position?.z, 0) - z,
  );
  return out;
}
