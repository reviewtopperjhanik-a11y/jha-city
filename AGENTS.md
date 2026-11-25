# JHA City — agent instructions

- This is an original game. **Never** use Rockstar/GTA names, logos, characters, music or assets.
- Engine: Three.js only. Build with Vite, ship as Android APK via Capacitor + GitHub Actions.
- Art direction: **Neon Sunset** — sunset palette, glossy low-poly geometry, emissive neon + bloom,
  cool tinted shadows, horizon fog. **No PS1 pixelation / jitter / dither.**
- All geometry, textures and sound are procedural. Keep files small and modular.
- Performance: DPR <= 1.5, one directional light with a 1024 shadow map, `InstancedMesh` or merged
  static geometry for repeats, reuse materials, auto quality tiers, check FPS after each feature.
- Touch controls are first-class; keyboard is for desktop testing.
- Keep gameplay systems decoupled: `core/`, `look/`, `world/`, `entities/`, `systems/`.
