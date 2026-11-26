import * as THREE from 'three';

// One geometry and one material shared by every car, bike and on-foot player.
// The circle is rotated once so it lies flat in the XZ plane; per-instance
// variation is expressed only through the mesh transform, never by cloning.
const geometry = new THREE.CircleGeometry(1, 18);
geometry.rotateX(-Math.PI / 2);

const material = new THREE.MeshBasicMaterial({
  color: 0x05060e,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
  toneMapped: false,
});

export const blobShadowGeometry = geometry;
export const blobShadowMaterial = material;

export function createBlobShadow(size = 1) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(size, 1, size * 0.74);
  mesh.position.y = 0.045;
  mesh.renderOrder = 1;
  return mesh;
}
