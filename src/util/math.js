export const TAU = Math.PI * 2;

const finite = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// A non-finite input is clamped to the lower bound instead of poisoning a
// transform for the rest of the frame.
export const clamp = (v, a, b) => {
  const lo = finite(a, 0);
  const hi = finite(b, lo);
  const top = hi < lo ? lo : hi;
  const n = Number(v);
  if (Number.isNaN(n)) return lo;
  if (n === Infinity) return top;
  if (n === -Infinity) return lo;
  return Math.max(lo, Math.min(top, n));
};

export const lerp = (a, b, t) => {
  const from = finite(a, 0);
  const to = finite(b, 0);
  const amount = finite(t, 0);
  return from + (to - from) * amount;
};

export const damp = (a, b, lambda, dt) => {
  const rate = Math.max(0, finite(lambda, 0));
  const step = Math.max(0, finite(dt, 0));
  return lerp(a, b, 1 - Math.exp(-rate * step));
};

export const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export function wrapAngle(a) {
  const n = finite(a, 0);
  return ((n + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

// Shortest-path interpolation, always wrapped into [-PI, PI].
export function angleLerp(a, b, t) {
  const from = finite(a, 0);
  const to = finite(b, 0);
  const amount = clamp(t, 0, 1);
  const delta = ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return wrapAngle(from + delta * amount);
}

// Kept as the true Euclidean distance for existing callers. Use `distSq`
// when comparing against a squared radius (police/achievement checks).
export function dist2(ax, az, bx, bz) {
  const dx = finite(ax, 0) - finite(bx, 0);
  const dz = finite(az, 0) - finite(bz, 0);
  return Math.hypot(dx, dz);
}

export const distance = dist2;

export function distSq(ax, az, bx, bz) {
  const dx = finite(ax, 0) - finite(bx, 0);
  const dz = finite(az, 0) - finite(bz, 0);
  return dx * dx + dz * dz;
}
