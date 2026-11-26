import * as THREE from 'three';

// A single no-texture sea shader. look.registerWater(uniform) drives the wave
// phase from the day/night/weather clock; nothing is allocated per frame.
export function createWaterSurface(look) {
  const uniform = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: uniform },
    side: THREE.FrontSide,
    depthWrite: true,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying float vCrest;
      void main() {
        vUv = uv;
        vec3 p = position;
        float a = sin(p.x * 0.052 + uTime * 1.15);
        float b = sin(p.z * 0.083 - uTime * 0.78 + p.x * 0.014);
        p.y += a * 0.13 + b * 0.09;
        vCrest = a * 0.6 + b * 0.4;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying float vCrest;
      void main() {
        float band = sin(vUv.y * 46.0 + vUv.x * 12.0 + uTime * 1.3) * 0.5 + 0.5;
        float ripple = sin(vUv.x * 74.0 - uTime * 1.8 + vUv.y * 9.0) * 0.5 + 0.5;
        vec3 deep = vec3(0.028, 0.115, 0.245);
        vec3 shallow = vec3(0.075, 0.36, 0.46);
        vec3 col = mix(deep, shallow, clamp(0.32 + vCrest * 0.28 + band * 0.18, 0.0, 1.0));
        col += vec3(0.42, 0.62, 0.68) * pow(band * ripple, 7.0) * 0.48;
        col += vec3(0.16, 0.09, 0.18) * smoothstep(0.0, 0.8, vUv.y);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  look?.registerWater?.(uniform);

  const geometry = new THREE.PlaneGeometry(1600, 170, 24, 8);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sea';
  mesh.position.set(0, -0.015, -655);
  mesh.receiveShadow = false;
  return { mesh, material, uniform };
}
