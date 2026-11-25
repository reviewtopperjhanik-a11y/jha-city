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
