import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { C } from './palette.js';
import { clamp, smooth, TAU } from '../util/math.js';

const col = (hex) => new THREE.Color(hex);
const mix = (a, b, t) => col(a).lerp(col(b), t);

export function makeGradientMap() {
  // Cool shadow -> warm lit. Bands, not pixels: no PS1 dither/jitter.
  const data = new Uint8Array([
    70, 74, 120, 255,
    122, 116, 168, 255,
    214, 186, 196, 255,
    255, 238, 214, 255,
  ]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function createSky() {
  const uniforms = {
    topColor: { value: col(C.dusk) },
    horizonColor: { value: col(C.tangerine) },
    bottomColor: { value: col(C.ink) },
    sunColor: { value: col(C.amber) },
    sunDir: { value: new THREE.Vector3(-1, 0.1, 0.3).normalize() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      varying vec3 vWorld;
      void main() {
        vec3 dir = normalize(vWorld);
        float h = dir.y;
        vec3 sky = mix(horizonColor, topColor, smoothstep(0.0, 0.55, h));
        sky = mix(bottomColor, sky, smoothstep(-0.30, 0.02, h));
        float d = max(dot(dir, normalize(sunDir)), 0.0);
        sky += sunColor * (pow(d, 260.0) + pow(d, 9.0) * 0.28);
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

export function createLook(scene, camera, renderer, { bloomEnabled = true, dpr = 1.5 } = {}) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const gradientMap = makeGradientMap();
  const sky = createSky();
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(C.dusk, C.road, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe0b0, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);

  scene.fog = new THREE.FogExp2(C.tangerine, 0.00135);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.72, 0.65, 0.7);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const u = sky.material.uniforms;
  const state = { hours: 18.4, day: 0.35, bloomEnabled };

  function setTime(hours) {
    state.hours = ((hours % 24) + 24) % 24;
    const angle = ((state.hours - 6) / 24) * TAU;
    const elev = Math.sin(angle);
    const day = clamp(elev * 1.6 + 0.25, 0, 1);
    state.day = day;
    const dir = new THREE.Vector3(Math.cos(angle) * 180, Math.max(elev, -0.25) * 180, 70).normalize();
    sun.position.copy(dir).multiplyScalar(220);
    sun.target.position.set(0, 0, 0);
    u.sunDir.value.copy(dir);

    const horizon = elev > 0
      ? mix(C.ink, mix(C.flamingo, C.tangerine, smooth(clamp(elev * 2, 0, 1))), day)
      : mix(C.ink, C.orchid, clamp(1 + elev * 2, 0, 1));
    const top = mix(C.ink, C.dusk, day);
    const skyLight = mix(C.dusk, 0xa9d7ff, day * 0.85);
    const ground = mix(C.ink, C.sand, day * 0.5);

    u.horizonColor.value.copy(horizon);
    u.topColor.value.copy(top);
    u.bottomColor.value.copy(mix(C.ink, horizon, 0.25));
    u.sunColor.value.copy(mix(C.amber, 0xfff3d0, day));
    hemi.color.copy(skyLight);
    hemi.groundColor.copy(ground);
    hemi.intensity = 0.35 + day * 0.75;
    sun.color.copy(mix(C.tangerine, 0xffeed6, day));
    sun.intensity = 0.15 + day * 2.0;
    scene.fog.color.copy(horizon);
    scene.fog.density = 0.0011 + (1 - day) * 0.0005;
  }

  function resize(w, h) {
    composer.setSize(w, h);
    bloom.setSize(Math.max(2, Math.floor(w * 0.6)), Math.max(2, Math.floor(h * 0.6)));
  }

  function render() {
    if (state.bloomEnabled) composer.render();
    else renderer.render(scene, camera);
  }

  function setBloom(on) {
    state.bloomEnabled = !!on;
  }

  function setDpr(v) {
    renderer.setPixelRatio(v);
    composer.setPixelRatio(v);
  }

  setTime(state.hours);
  return { gradientMap, sky, sun, hemi, state, setTime, resize, render, setBloom, setDpr };
}
