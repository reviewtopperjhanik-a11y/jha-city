import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { C, SKY } from './palette.js';
import { clamp, smooth, TAU } from '../util/math.js';

const col = (hex) => new THREE.Color(hex);
const rainTint = col(0x6a7490);
const scratchMix = col(0);

// setTime runs every frame. Doing the colour blending into reusable Color
// objects keeps the day/night cycle out of the GC's way.
function mixInto(out, a, b, t) {
  out.set(a);
  scratchMix.set(b);
  return out.lerp(scratchMix, t);
}

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
  renderer.setPixelRatio(Math.max(1.25, Math.min(window.devicePixelRatio || 1, dpr)));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.6, 0.8);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const u = sky.material.uniforms;
  const state = { hours: 18.4, day: 0.35, bloomEnabled, dpr: 0, shadows: true, shadowSize: 1024, weather: 0 };
  const horizonNow = col(C.tangerine);
  const horizonScratch = col(0);
  const topScratch = col(0);
  const groundScratch = col(0);
  const skyLightScratch = col(0);
  const sunScratch = col(0);
  const bottomScratch = col(0);
  const dirScratch = new THREE.Vector3();
  // Registration-time allocations only; setTime walks these with index loops
  // and reuses the cached colours, so the night/water cycle stays GC-free.
  const nightLights = [];
  const waterUniforms = [];
  let viewW = window.innerWidth;
  let viewH = window.innerHeight;

  function registerNightLight(material, dayColorHex, nightColorHex, { dayOpacity = 1, nightOpacity = 1 } = {}) {
    if (!material || !material.color) return null;
    // Opacity only blends when the material is transparent. Leave vertexColors,
    // toneMapped and every other constructor semantic untouched.
    if (dayOpacity < 1 || nightOpacity < 1) {
      material.transparent = true;
      material.needsUpdate = true;
    }
    const entry = {
      material,
      day: col(dayColorHex),
      night: col(nightColorHex),
      dayOpacity,
      nightOpacity,
    };
    nightLights.push(entry);
    return entry;
  }

  function registerWater(uniform) {
    if (!uniform || typeof uniform !== 'object') return null;
    waterUniforms.push(uniform);
    return uniform;
  }

  function applyNightLights() {
    for (let i = 0; i < nightLights.length; i++) {
      const entry = nightLights[i];
      entry.material.color.copy(entry.night).lerp(entry.day, state.day);
      entry.material.opacity = entry.nightOpacity + (entry.dayOpacity - entry.nightOpacity) * state.day;
    }
  }

  function applyWater() {
    for (let i = 0; i < waterUniforms.length; i++) {
      waterUniforms[i].value = performance.now() * 0.0006;
    }
  }

  function applyAtmosphere() {
    const w = state.weather;
    scene.fog.color.copy(horizonNow).lerp(rainTint, w * 0.55);
    scene.fog.density = (0.00085 + (1 - state.day) * 0.00025) * (1 + w * 1.5);
    sun.intensity = (0.4 + state.day * 1.7) * (1 - w * 0.35);
    hemi.intensity = (0.7 + state.day * 0.55) * (1 - w * 0.15);
  }

  function setWeather(level) {
    state.weather = clamp(level || 0, 0, 1);
    applyAtmosphere();
  }

  function setTime(hours) {
    state.hours = ((hours % 24) + 24) % 24;
    const h = state.hours;
    const angle = ((h - 6) / 24) * TAU;
    const elev = Math.sin(angle);
    const sunUp = clamp(elev * 1.45 + 0.2, 0, 1);
    // 11:00-14:00 reads as clear blue; morning and dusk get their own bands;
    // night falls back to deep purple so the city's neon stays readable.
    const midday = smooth(clamp((h - 9.5) / 2, 0, 1)) * smooth(clamp((16.5 - h) / 2.5, 0, 1));
    const twilight = clamp(1 - Math.abs(elev) * 3.2, 0, 1);
    const morning = smooth(clamp((h - 5) / 2.2, 0, 1)) * smooth(clamp((9.2 - h) / 2.4, 0, 1));
    const dusk = smooth(clamp((h - 15.8) / 2, 0, 1)) * smooth(clamp((20 - h) / 2.4, 0, 1));
    const night = 1 - sunUp;
    state.day = clamp(sunUp * 0.75 + midday * 0.25, 0.12, 1);

    // Keep a soft "moon" above the horizon at night so the city stays readable.
    dirScratch.set(Math.cos(angle) * 180, Math.max(elev, 0.18) * 180, 70).normalize();
    sun.position.copy(dirScratch).multiplyScalar(220);
    sun.target.position.set(0, 0, 0);
    u.sunDir.value.copy(dirScratch);

    mixInto(horizonScratch, SKY.nightHorizon, C.tangerine, clamp(sunUp - midday * 0.85, 0, 1));
    horizonScratch.lerp(scratchMix.set(0x8bbcf5), midday * 0.92);
    horizonScratch.lerp(scratchMix.set(SKY.morningHorizon), morning * 0.55);
    horizonScratch.lerp(scratchMix.set(SKY.duskRose), dusk * 0.5);
    horizonScratch.lerp(scratchMix.set(C.flamingo), twilight * (elev >= 0 ? 0.62 : 0.34));
    horizonScratch.lerp(scratchMix.set(SKY.nightDeep), night * (1 - twilight) * 0.8);

    mixInto(topScratch, SKY.nightTop, SKY.middayTop, midday);
    topScratch.lerp(scratchMix.set(SKY.morningTop), morning * 0.55);
    topScratch.lerp(scratchMix.set(SKY.duskTop), dusk * 0.35);
    topScratch.lerp(scratchMix.set(C.dusk), sunUp * 0.2);
    topScratch.lerp(scratchMix.set(SKY.nightTopDeep), night * 0.5);
    mixInto(groundScratch, SKY.groundNight, C.sand, state.day * 0.5);
    mixInto(skyLightScratch, SKY.hemiNight, SKY.hemiDay, midday);
    skyLightScratch.lerp(scratchMix.set(SKY.morningLight), morning * 0.25);
    skyLightScratch.lerp(scratchMix.set(SKY.duskLight), dusk * 0.25);
    mixInto(sunScratch, C.amber, SKY.middaySun, state.day);

    u.horizonColor.value.copy(horizonScratch);
    u.topColor.value.copy(topScratch);
    mixInto(bottomScratch, SKY.bottomNight, horizonScratch, 0.45);
    u.bottomColor.value.copy(bottomScratch);
    u.sunColor.value.copy(sunScratch);
    hemi.color.copy(skyLightScratch);
    hemi.groundColor.copy(groundScratch);
    hemi.intensity = 0.7 + state.day * 0.55;
    mixInto(sunScratch, elev > 0 ? C.tangerine : SKY.moon, 0xffeed6, state.day);
    sun.color.copy(sunScratch);
    horizonNow.copy(horizonScratch);
    applyAtmosphere();
    applyNightLights();
    applyWater();
  }

  function resize(w, h) {
    viewW = w;
    viewH = h;
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
    const ratio = Math.max(1.25, Math.min(window.devicePixelRatio || 1, v));
    state.dpr = ratio;
    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    composer.setSize(viewW, viewH);
    bloom.setSize(Math.max(2, Math.floor(viewW * 0.6)), Math.max(2, Math.floor(viewH * 0.6)));
  }

  function setShadows(enabled, size) {
    state.shadows = !!enabled;
    renderer.shadowMap.enabled = state.shadows;
    sun.castShadow = state.shadows;
    if (size && size !== state.shadowSize) {
      state.shadowSize = size;
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
      sun.shadow.mapSize.set(size, size);
    }
    if (state.shadows) renderer.shadowMap.needsUpdate = true;
  }

  function applyQuality({ dpr = 1.5, bloom: bloomOn = true, shadows = true, shadowSize = 1024 } = {}) {
    setDpr(dpr);
    setBloom(bloomOn);
    setShadows(shadows, shadowSize);
  }

  setTime(state.hours);
  return {
    gradientMap,
    sky,
    sun,
    hemi,
    state,
    nightLights,
    waterUniforms,
    registerNightLight,
    registerWater,
    setTime,
    setWeather,
    resize,
    render,
    setBloom,
    setDpr,
    setShadows,
    applyQuality,
  };
}
