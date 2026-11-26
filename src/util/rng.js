// Tiny deterministic PRNG so the city looks the same on every device.
const DEFAULT_SEED = 1337;

const finite = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function seedToInt(seed) {
  if (typeof seed === 'string') {
    // FNV-1a: two different string keys never collapse onto the same city.
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) {
      hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
    }
    return hash;
  }
  return finite(seed, DEFAULT_SEED) >>> 0;
}

export function makeRng(seed = DEFAULT_SEED) {
  let s = seedToInt(seed);
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const asRng = (rng) => (typeof rng === 'function' ? rng : Math.random);

export const rand = (rng, a, b) => {
  const lo = finite(a, 0);
  const hi = finite(b, lo);
  return lo + (hi - lo) * asRng(rng)();
};

export const randInt = (rng, a, b) => {
  const lo = Math.ceil(finite(a, 0));
  const hi = Math.floor(finite(b, lo));
  if (hi <= lo) return lo;
  return lo + Math.floor(asRng(rng)() * (hi - lo + 1));
};

export const pick = (rng, arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const index = Math.min(arr.length - 1, Math.max(0, Math.floor(asRng(rng)() * arr.length)));
  return arr[index];
};
