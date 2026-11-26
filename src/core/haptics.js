// Phase 7 — haptic feedback. Capacitor Haptics on device, a safe no-op in the
// browser/jsdom. Nothing here awaits inside a frame: calls are fire-and-forget
// and rejected native promises are swallowed.

export const HAPTIC_STYLES = Object.freeze({
  LIGHT: 'LIGHT',
  MEDIUM: 'MEDIUM',
  HEAVY: 'HEAVY',
});

const SMG_MIN_INTERVAL = 60; // ms — the SMG fires every 85ms, so 60ms trims doubles.
const COLLISION_MIN_INTERVAL = 110; // ms — collision bursts arrive in clusters.

const nowMs = () => (typeof performance !== 'undefined' && performance.now
  ? performance.now()
  : Date.now());

const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  if (n === Infinity) return 1;
  if (n === -Infinity) return 0;
  return Math.max(0, Math.min(1, n));
};

const collisionStyle = (strength) => {
  const value = clamp01(strength);
  if (value < 0.35) return HAPTIC_STYLES.LIGHT;
  if (value < 0.7) return HAPTIC_STYLES.MEDIUM;
  return HAPTIC_STYLES.HEAVY;
};

const normalizeStyle = (style) => {
  if (typeof style === 'number') return collisionStyle(style);
  const s = typeof style === 'string' ? style.toUpperCase() : '';
  return HAPTIC_STYLES[s] || HAPTIC_STYLES.MEDIUM;
};

/**
 * @param {{plugin?: object|null, enabled?: boolean}} options
 *   plugin: injected Haptics-like object (test / custom bridge). When absent,
 *   window.Capacitor.Plugins.Haptics is used, then @capacitor/haptics is
 *   imported lazily and only once.
 */
export function createHaptics({ plugin = null, enabled = true } = {}) {
  let on = enabled !== false;
  // undefined = unresolved, null = deliberately no-op, object = ready.
  let resolved = plugin || undefined;
  let importStarted = false;
  let lastSmg = -Infinity;
  let lastCollision = -Infinity;

  const fromCapacitor = () => {
    if (typeof window === 'undefined') return null;
    return window.Capacitor?.Plugins?.Haptics || null;
  };

  const resolve = () => {
    if (resolved !== undefined) return resolved;
    const globalPlugin = fromCapacitor();
    if (globalPlugin) {
      resolved = globalPlugin;
      return resolved;
    }
    if (!importStarted) {
      importStarted = true;
      import('@capacitor/haptics')
        .then((mod) => {
          if (resolved !== undefined) return;
          resolved = mod?.Haptics || mod?.default?.Haptics || null;
        })
        .catch(() => {
          if (resolved === undefined) resolved = null;
        });
    }
    return null; // The first call after boot is allowed to be a no-op.
  };

  const invoke = (method, args) => {
    if (!on) return false;
    const target = resolve();
    const fn = target && target[method];
    if (typeof fn !== 'function') return false;
    try {
      const result = fn.call(target, ...args);
      // Capacitor returns a Promise; do not await it in the frame loop, but
      // do swallow web-plugin errors (e.g. navigator.vibrate unavailable).
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  };

  const api = {
    get enabled() {
      return on;
    },

    setEnabled(value) {
      on = !!value;
      if (!on) {
        lastSmg = -Infinity;
        lastCollision = -Infinity;
      }
      return on;
    },

    // Optional intensity (0..1) overrides the weapon's default style. Values
    // outside the range never reach the native bridge.
    shot(id = 'pistol', intensity = null) {
      const kind = typeof id === 'string' ? id : 'pistol';
      const style = intensity === null || intensity === undefined
        ? (kind === 'shotgun' ? HAPTIC_STYLES.HEAVY
          : kind === 'smg' ? HAPTIC_STYLES.LIGHT : HAPTIC_STYLES.MEDIUM)
        : collisionStyle(intensity);
      const t = nowMs();
      if (kind === 'smg') {
        if (t - lastSmg < SMG_MIN_INTERVAL) return false;
        lastSmg = t;
        return invoke('impact', [{ style }]);
      }
      return invoke('impact', [{ style }]);
    },

    hit() {
      return invoke('impact', [{ style: HAPTIC_STYLES.HEAVY }]);
    },

    collision(strength01 = 0.5) {
      const t = nowMs();
      if (t - lastCollision < COLLISION_MIN_INTERVAL) return false;
      lastCollision = t;
      return invoke('impact', [{ style: collisionStyle(strength01) }]);
    },

    // A numeric argument is treated as a 0..1 intensity; strings keep the
    // existing LIGHT/MEDIUM/HEAVY contract.
    impact(style = 'MEDIUM') {
      return invoke('impact', [{ style: normalizeStyle(style) }]);
    },

    selection() {
      return invoke('selectionChanged', []);
    },
  };

  return api;
}

export default createHaptics;
