import { LANDMARKS } from '../world/landmarks.js';
import { dist2 } from '../util/math.js';

// Original, local-only awards. No online services, no external assets.
export const ACHIEVEMENTS = [
  { key: 'firstJob', label: 'FIRST FARE', desc: 'Finish a job.' },
  { key: 'story', label: 'CITY INSIDER', desc: 'Finish the story chain.' },
  { key: 'speed', label: 'PEDAL TO THE METAL', desc: 'Hit 110 km/h.' },
  { key: 'clean', label: 'GHOST', desc: 'Lose a five-star chase.' },
  { key: 'wet', label: 'RAIN RUNNER', desc: 'Drive through a downpour.' },
  { key: 'night', label: 'NIGHT OWL', desc: 'Drive after midnight.' },
  { key: 'collector', label: 'GARAGE FULL', desc: 'Buy a vehicle.' },
  { key: 'explorer', label: 'SKYLINE TOUR', desc: 'Visit all four landmarks.' },
  { key: 'shutter', label: 'SHUTTER BUG', desc: 'Take a photo.' },
  { key: 'makeover', label: 'NEW LOOK', desc: 'Change your outfit.' },
];

const BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));
// Older saves/harnesses use the four-chapter chain; main.js passes the live
// chapter count once the extended story is installed.
const STORY_TOTAL = 4;
const PROGRESS_KEY = 'achievementProgress';
const num = (value, fallback, lo = -Infinity, hi = Infinity) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

function readProgress(save) {
  const raw = save?.[PROGRESS_KEY];
  if (!raw || typeof raw !== 'object') return { visited: [], highestStars: 0 };
  return {
    visited: Array.isArray(raw.visited) ? raw.visited.filter((k) => typeof k === 'string') : [],
    highestStars: num(raw.highestStars, 0, 0, 5),
  };
}

export class Achievements {
  constructor(save, { toast = () => {}, onChange = () => {} } = {}) {
    this.save = save && typeof save === 'object' ? save : {};
    this.toast = toast;
    this.onChange = onChange;
    this.unlocked = new Set(Array.isArray(this.save.achievements) ? this.save.achievements : []);
    const progress = readProgress(this.save);
    this.visited = new Set(progress.visited);
    this.highestStars = progress.highestStars;
    this._dirty = false;
    this._saveRef = this.save.achievements;
    this._progressRef = this.save[PROGRESS_KEY];
  }

  has(key) {
    return this.unlocked.has(key);
  }

  // Keep the in-memory sets in step with the live save record. Slot loads
  // replace save.achievements and save.achievementProgress wholesale; without
  // this check a previous slot's visited landmarks or five-star history would
  // leak into the new one and unlock awards that were never earned there.
  syncFromSave() {
    const ref = this.save.achievements;
    if (ref !== this._saveRef) {
      this._saveRef = ref;
      this.unlocked = new Set(Array.isArray(ref) ? ref : []);
      this._dirty = false;
    }
    const progressRef = this.save[PROGRESS_KEY];
    if (progressRef !== this._progressRef) {
      this._progressRef = progressRef;
      const progress = readProgress(this.save);
      this.visited = new Set(progress.visited);
      this.highestStars = progress.highestStars;
    }
  }

  _persistProgress() {
    this.save[PROGRESS_KEY] = {
      visited: [...this.visited],
      highestStars: this.highestStars,
    };
    this._progressRef = this.save[PROGRESS_KEY];
    this._dirty = true;
  }

  unlock(key) {
    // One award fires exactly once: repeated events, frames or slot loads do
    // not re-toast or call onChange again.
    if (!BY_KEY.has(key) || this.unlocked.has(key)) return false;
    this.unlocked.add(key);
    this.save.achievements = [...this.unlocked];
    this._saveRef = this.save.achievements;
    this._dirty = true;
    const info = BY_KEY.get(key);
    this.toast(`ACHIEVEMENT · ${info.label}`);
    this.onChange(info);
    return true;
  }

  // Called by gameplay actions that are not continuous frame state.
  event(key) {
    this.syncFromSave();
    return this.unlock(key);
  }

  // Five stars only count if the player was actually seen at that level.
  noteStars(stars) {
    const level = num(stars, 0, 0, 5);
    if (level >= 5 && this.highestStars < 5) {
      this.highestStars = 5;
      this._persistProgress();
    }
  }

  update(dt, ctx = {}) {
    this.syncFromSave();
    const {
      player,
      hours = 0,
      wanted = 0,
      weather = 0,
      missionsDone = 0,
      storyStep = 0,
      storyTotal = STORY_TOTAL,
    } = ctx;
    const driving = !!(player?.vehicle);
    const speed = num(player?.speed, 0, 0);
    const clock = num(hours, 0, 0, 24);
    const heat = num(wanted, 0, 0, 5);
    const rain = num(weather, 0, 0, 1);
    const done = num(missionsDone, 0, 0);
    const chapter = num(storyStep, 0, 0);
    const total = Math.max(STORY_TOTAL, num(storyTotal, STORY_TOTAL, 0));

    if (driving && speed >= 30.5) this.unlock('speed');
    if (driving && rain >= 0.8) this.unlock('wet');
    if (driving && clock >= 0 && clock < 5) this.unlock('night');
    if (done > 0) this.unlock('firstJob');
    if (chapter >= total) this.unlock('story');
    if (this.highestStars >= 5 && heat === 0) {
      this.unlock('clean');
      this.highestStars = 0;
      this._persistProgress();
    }

    let visitedChanged = false;
    if (player?.pos && Number.isFinite(player.pos.x) && Number.isFinite(player.pos.z)) {
      for (const landmark of LANDMARKS) {
        if (this.visited.has(landmark.key)) continue;
        // util/math.js dist2 is already a Euclidean distance, not a squared
        // one; comparing it with 42 ** 2 awarded the tour across the whole map.
        if (dist2(player.pos.x, player.pos.z, landmark.x, landmark.z) < 42) {
          this.visited.add(landmark.key);
          visitedChanged = true;
        }
      }
      if (visitedChanged && this.visited.size >= LANDMARKS.length) this.unlock('explorer');
    }
    if (visitedChanged) this._persistProgress();

    void dt;
    if (this._dirty) {
      this._dirty = false;
      return true;
    }
    return false;
  }
}
