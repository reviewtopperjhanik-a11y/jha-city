// Original sunset-first palette: warm neon over cool shadows, never flat grey.
export const C = {
  dusk: 0x4c5fca,
  orchid: 0x813dbb,
  flamingo: 0xcc46a0,
  coral: 0xf76685,
  tangerine: 0xff885f,
  amber: 0xffa948,
  teal: 0x2fb6b2,
  sand: 0xf0d3a6,
  ink: 0x0c0d1b,
  road: 0x24243a,
  lane: 0xf6e6c8,
  sidewalk: 0x7a7892,
  rust: 0x8c5a4a,
  leaf: 0x3d7d5c,
};

// Procedural sky stops. Morning is pale blue + gold, midday is clear blue,
// dusk is orange-pink, and night is a deep purple that lets neon read.
export const SKY = {
  morningHorizon: 0xffd8a3,
  morningTop: 0x86bdf0,
  morningLight: 0xcfe6ff,
  middayTop: 0x2f6fc4,
  middaySun: 0xfff3d0,
  duskRose: 0xff83a8,
  duskTop: 0x6c3a8f,
  duskLight: 0xe6b7d8,
  nightHorizon: 0x232a55,
  nightTop: 0x11173a,
  nightDeep: 0x151a3a,
  nightTopDeep: 0x0b0d24,
  groundNight: 0x303a5a,
  hemiNight: 0x7d91d8,
  hemiDay: 0xbfe3ff,
  moon: 0xa8bdff,
  bottomNight: 0x111738,
};

// Shared by owned cars, traffic and police paint jobs. Everything stays in the
// sunset/neon family rather than drifting into flat greys.
export const CAR_COLORS = [
  C.flamingo, C.teal, C.amber, C.coral, C.tangerine, C.dusk,
  C.orchid, 0x4cc9b0, 0xffd166, 0x6c8cff, 0xe8e8f0, 0x141827,
];

export const DISTRICTS = {
  beach: { base: C.sand, accent: C.teal, height: [8, 22], palm: true },
  downtown: { base: C.orchid, accent: C.flamingo, height: [28, 95], palm: false },
  port: { base: C.rust, accent: C.amber, height: [8, 26], palm: false },
  strip: { base: C.coral, accent: C.tangerine, height: [12, 40], palm: false },
};

export function districtAt(x, z) {
  if (z < -150) return 'beach';
  if (x > 150) return 'downtown';
  if (x < -150) return 'port';
  return 'strip';
}
