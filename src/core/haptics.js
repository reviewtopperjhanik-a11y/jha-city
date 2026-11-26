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

const normalizeStyle = (style) => {
  const s = typeof style === 'string' ? style.toUpperCase() : '';
  return HAPTIC_STYLES[s] || HAPTIC_STYLES.MEDIUM;
};

const collisionStyle = (strength) => {
  const n = Number(strength);
  const value = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  if (value < 0.35) return HAPTIC_STYLES.LIGHT;
  if (value < 0.7) return HAPTIC_STYLES.MEDIUM;
  return HAPTIC_STYLES.HEAVY;
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

    shot(id = 'pistol') {
      const kind = typeof id === 'string' ? id : 'pistol';
      const t = nowMs();
      if (kind === 'smg') {
        if (t - lastSmg < SMG_MIN_INTERVAL) return false;
        lastSmg = t;
        return invoke('impact', [{ style: HAPTIC_STYLES.LIGHT }]);
      }
      return invoke('impact', [{
        style: kind === 'shotgun' ? HAPTIC_STYLES.HEAVY : HAPTIC_STYLES.MEDIUM,
      }]);
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
