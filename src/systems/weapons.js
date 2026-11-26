// Phase 4 — weapon state. All numbers are original and tuned for a phone:
// short bursts, quick reloads and enough reserve ammo to explore the city.
// No THREE objects, no textures and no per-frame allocations live here.

export const WEAPONS = Object.freeze({
  pistol: Object.freeze({
    id: 'pistol', label: 'PISTOL', mag: 12, reserve: 72, damage: 26,
    interval: 0.26, reload: 1.2, range: 72, spread: 0.018,
    pellets: 1, auto: false, noise: 1,
  }),
  shotgun: Object.freeze({
    id: 'shotgun', label: 'SHOTGUN', mag: 6, reserve: 36, damage: 14,
    interval: 0.72, reload: 2.1, range: 38, spread: 0.095,
    pellets: 7, auto: false, noise: 1.7,
  }),
  smg: Object.freeze({
    id: 'smg', label: 'SMG', mag: 30, reserve: 150, damage: 14,
    interval: 0.085, reload: 1.8, range: 58, spread: 0.055,
    pellets: 1, auto: true, noise: 1.25,
  }),
});

const ORDER = ['pistol', 'shotgun', 'smg'];

const clampInt = (value, max, fallback = 0) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : fallback;
};

export class Weapons {
  constructor() {
    // One reused state object and one reused ammo table for the whole session.
    this._state = {
      id: 'pistol', label: WEAPONS.pistol.label, mag: WEAPONS.pistol.mag,
      reserve: WEAPONS.pistol.reserve, reloading: false, reloadLeft: 0, cooldown: 0,
    };
    this.ammo = {
      pistol: { mag: 0, reserve: 0 },
      shotgun: { mag: 0, reserve: 0 },
      smg: { mag: 0, reserve: 0 },
    };
    this.reset();
  }

  get stats() {
    return WEAPONS[this.id] || WEAPONS.pistol;
  }

  get id() {
    return this._state.id;
  }

  get mag() {
    return this.ammo[this.id].mag;
  }

  get reserve() {
    return this.ammo[this.id].reserve;
  }

  reset() {
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i];
      const slot = this.ammo[id];
      slot.mag = WEAPONS[id].mag;
      slot.reserve = WEAPONS[id].reserve;
    }
    this._state.id = 'pistol';
    this._state.reloading = false;
    this._state.reloadLeft = 0;
    this._state.cooldown = 0;
    this.state();
    return this._state;
  }

  resupply() {
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i];
      this.ammo[id].reserve = WEAPONS[id].reserve;
    }
    this.state();
    return this._state;
  }

  equip(id) {
    if (!WEAPONS[id]) return this.state();
    if (id !== this._state.id) {
      // Switching away from a half-finished reload cancels it.
      this._state.reloading = false;
      this._state.reloadLeft = 0;
      this._state.id = id;
    }
    return this.state();
  }

  cycle() {
    const at = ORDER.indexOf(this._state.id);
    return this.equip(ORDER[(at + 1) % ORDER.length]);
  }

  // Called by Combat once per accepted shot. Returns false when empty/cooling.
  beginShot() {
    if (this._state.reloading || this._state.cooldown > 0) return false;
    const slot = this.ammo[this._state.id];
    if (slot.mag <= 0) {
      this.reload();
      return false;
    }
    slot.mag--;
    this._state.cooldown = this.stats.interval;
    return true;
  }

  canFire() {
    return !this._state.reloading && this._state.cooldown <= 0 && this.mag > 0;
  }

  reload() {
    const stats = this.stats;
    const slot = this.ammo[this._state.id];
    if (this._state.reloading || slot.mag >= stats.mag || slot.reserve <= 0) return false;
    this._state.reloading = true;
    this._state.reloadLeft = stats.reload;
    return true;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return this._state;
    if (this._state.cooldown > 0) {
      this._state.cooldown = Math.max(0, this._state.cooldown - dt);
    }
    if (this._state.reloading) {
      this._state.reloadLeft -= dt;
      if (this._state.reloadLeft <= 0) {
        const stats = this.stats;
        const slot = this.ammo[this._state.id];
        const need = stats.mag - slot.mag;
        const taken = Math.min(need, slot.reserve);
        slot.mag += taken;
        slot.reserve -= taken;
        this._state.reloading = false;
        this._state.reloadLeft = 0;
      }
    }
    this.state();
    return this._state;
  }

  state() {
    const out = this._state;
    const stats = this.stats;
    const slot = this.ammo[stats.id];
    out.id = stats.id;
    out.label = stats.label;
    out.mag = slot.mag;
    out.reserve = slot.reserve;
    return out;
  }

  serialize() {
    const data = { id: this._state.id, ammo: {} };
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i];
      data.ammo[id] = { mag: this.ammo[id].mag, reserve: this.ammo[id].reserve };
    }
    return data;
  }

  restore(data) {
    const saved = data && typeof data === 'object' ? data : null;
    this._state.id = saved && WEAPONS[saved.id] ? saved.id : 'pistol';
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i];
      const slot = saved?.ammo?.[id];
      this.ammo[id].mag = clampInt(slot?.mag, WEAPONS[id].mag, WEAPONS[id].mag);
      this.ammo[id].reserve = clampInt(slot?.reserve, WEAPONS[id].reserve, WEAPONS[id].reserve);
    }
    this._state.reloading = false;
    this._state.reloadLeft = 0;
    this._state.cooldown = 0;
    this.state();
    return this._state;
  }
}
