import { C } from './palette.js';

// Small, original palettes. Everything is flat colour on procedural meshes —
// no textures, portraits or third-party character assets.
export const SKIN_TONES = [0xd9a06b, 0xb87a52, 0x8a5a3b, 0xf0c9a0, 0x6b432c, 0xc98f63];
export const SHIRTS = [C.coral, C.teal, C.amber, C.orchid, C.flamingo, 0x6f86d6, 0x8fbf7a, 0xe8e8f0];
export const HAIR = [0x2b1a12, 0x3d2a1c, 0x101018, 0x5a3a22, 0xd8b26a, 0x7a4a28];
export const PANTS = [0x2a3050, 0x3a3a4a, 0x4a3a32, 0x252a40, 0x55607a];

export const STYLE_KEYS = ['skin', 'shirt', 'hair', 'pants'];
export const STYLE_LABELS = { skin: 'SKIN', shirt: 'JACKET', hair: 'HAIR', pants: 'TROUSERS' };
export const STYLE_OPTIONS = { skin: SKIN_TONES, shirt: SHIRTS, hair: HAIR, pants: PANTS };

export const DEFAULT_STYLE = {
  skin: SKIN_TONES[0],
  shirt: SHIRTS[0],
  hair: HAIR[0],
  pants: PANTS[0],
};

const colorOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v & 0xffffff : null);

export function normalizeStyle(raw) {
  const style = { ...DEFAULT_STYLE };
  for (const key of STYLE_KEYS) {
    const options = STYLE_OPTIONS[key];
    const value = colorOf(raw?.[key]);
    style[key] = options.includes(value) ? value : DEFAULT_STYLE[key];
  }
  return style;
}

export function cycleStyle(style, key, delta = 1) {
  const options = STYLE_OPTIONS[key];
  if (!options) return normalizeStyle(style);
  const current = options.indexOf(colorOf(style?.[key]));
  const next = ((current < 0 ? 0 : current + delta) % options.length + options.length) % options.length;
  return { ...normalizeStyle(style), [key]: options[next] };
}

export function randomStyle(rng = Math.random) {
  const style = {};
  for (const key of STYLE_KEYS) {
    const options = STYLE_OPTIONS[key];
    style[key] = options[Math.floor(rng() * options.length) % options.length];
  }
  return style;
}

export function styleOption(style, key) {
  const options = STYLE_OPTIONS[key] || [];
  return options.indexOf(colorOf(style?.[key])) + 1;
}

export function styleLabel(style, key) {
  const count = STYLE_OPTIONS[key]?.length || 1;
  return `${STYLE_LABELS[key]} ${styleOption(style, key)}/${count}`;
}
