import { clamp } from '../util/math.js';

// The wanted system owns the heat, the last place the police saw the player and
// the search circle that the map draws. Police units ask it where to search.
const SENSE_INTERVAL = 0.18;

export class Wanted {
  constructor() {
    this.stars = 0;
    this.evade = 0;
    this.evadeNeed = 0;
    this.lastCrime = -99;
    this.lastSeen = null;
    this.searchRadius = 0;
    this.spotted = false;
    this.hidden = false;
    this.onChange = () => {};

    this._senseTimer = 0;
    this._seen = false;
    this._senseStars = -1;
    this._hudState = { label: '', tone: '', progress: 0 };
  }

  crime(amount = 1, time = 0, x = null, z = null) {
    const before = this.stars;
    this.stars = Math.min(5, this.stars + amount);
    this.evade = 0;
    this.lastCrime = time;
    if (Number.isFinite(x) && Number.isFinite(z)) {
      this.lastSeen = { x, z };
    } else if (!this.lastSeen) {
      this.lastSeen = { x: 0, z: 0 };
    }
    this.searchRadius = 52 + this.stars * 15;
    this.spotted = true;
    this.hidden = false;
    this._senseTimer = 0;
    if (before !== this.stars) this.onChange(this.stars, before);
  }

  // Police.isSpotted() does the line-of-sight work; throttle it so the world
  // collision check does not run for every cruiser on every frame.
  _sense(player, police, dt) {
    this._senseTimer -= dt;
    if (this._senseTimer > 0 && this._senseStars === this.stars) return this._seen;
    this._senseTimer = SENSE_INTERVAL;
    this._senseStars = this.stars;
    if (police && typeof police.isSpotted === 'function') {
      this._seen = police.isSpotted(player, this.stars);
    } else if (Array.isArray(police) && police.length) {
      let near = false;
      for (const v of police) {
        if (!v?.pos) continue;
        if (Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z) < 45) {
          near = true;
          break;
        }
      }
      this._seen = near;
    } else {
      this._seen = false;
    }
    return this._seen;
  }

  update(dt, player, police, time) {
    if (this.stars <= 0) {
      this.spotted = false;
      this.hidden = false;
      this.evade = 0;
      this.lastSeen = null;
      this.searchRadius = 0;
      return;
    }

    const seen = this._sense(player, police, dt);
    this.spotted = seen;

    if (seen) {
      this.hidden = false;
      this.lastSeen = { x: player.pos.x, z: player.pos.z };
      this.searchRadius = Math.max(48, 52 + this.stars * 15);
      this.evade = Math.max(0, this.evade - dt * 4);
      this.evadeNeed = this._need(player);
      return;
    }

    this.hidden = true;
    if (!this.lastSeen) this.lastSeen = { x: player.pos.x, z: player.pos.z };
    // A search circle widens while the police sweep the last known area.
    this.searchRadius = Math.min(195, Math.max(this.searchRadius, 48) + dt * 4.5);

    const onFoot = !player.vehicle;
    const still = onFoot && Math.abs(player.speed || 0) < 0.4;
    const rate = onFoot ? (still ? 1.55 : 1.0) : 0.62;
    this.evade = Math.min(40, this.evade + dt * rate);
    this.evadeNeed = this._need(player);

    if (this.evade >= this.evadeNeed && time - this.lastCrime > 3) {
      const before = this.stars;
      this.stars = Math.max(0, this.stars - 1);
      this.evade = 0;
      this.lastCrime = time;
      if (this.stars === 0) {
        this.lastSeen = null;
        this.searchRadius = 0;
        this.hidden = false;
        this.spotted = false;
      } else {
        // Once a star is dropped, the police still look around the old area.
        this.searchRadius = Math.max(55, 52 + this.stars * 15);
      }
      this.onChange(this.stars, before);
    }
  }

  _need(player) {
    // Getting away in a vehicle takes longer than slipping away on foot.
    return 9 + this.stars * 2.2 + (player?.vehicle ? 4 : 0);
  }

  get search() {
    if (this.stars <= 0 || !this.lastSeen) return null;
    return { x: this.lastSeen.x, z: this.lastSeen.z, r: this.searchRadius || 60 };
  }

  hudState() {
    if (this.stars <= 0) return null;
    const out = this._hudState;
    if (this.spotted) {
      out.label = 'SPOTTED';
      out.tone = 'spotted';
      out.progress = 1;
      return out;
    }
    const progress = clamp(this.evade / Math.max(0.1, this.evadeNeed), 0, 1);
    if (this.evade > 0.05) {
      out.label = `HIDDEN ${Math.round(progress * 100)}%`;
      out.tone = 'hidden';
      out.progress = progress;
    } else {
      out.label = 'SEARCHING';
      out.tone = 'search';
      out.progress = 0;
    }
    return out;
  }

  clear(silent = false) {
    const before = this.stars;
    this.stars = 0;
    this.evade = 0;
    this.evadeNeed = 0;
    this.lastSeen = null;
    this.searchRadius = 0;
    this.spotted = false;
    this.hidden = false;
    this._senseTimer = 0;
    if (!silent && before > 0) this.onChange(0, before);
  }
}
