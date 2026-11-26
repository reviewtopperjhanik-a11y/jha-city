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

export class Achievements {
  constructor(save, { toast = () => {}, onChange = () => {} } = {}) {
    this.save = save;
    this.toast = toast;
    this.onChange = onChange;
    this.unlocked = new Set(Array.isArray(save.achievements) ? save.achievements : []);
    this.visited = new Set();
    this.highestStars = 0;
    this._dirty = false;
  }

  has(key) {
    return this.unlocked.has(key);
  }

  unlock(key) {
    if (!BY_KEY.has(key) || this.unlocked.has(key)) return false;
    this.unlocked.add(key);
    this.save.achievements = [...this.unlocked];
    this._dirty = true;
    const info = BY_KEY.get(key);
    this.toast(`ACHIEVEMENT · ${info.label}`);
    this.onChange(info);
    return true;
  }

  // Called by gameplay actions that are not continuous frame state.
  event(key) {
    return this.unlock(key);
  }

  // Five stars only count if the player was actually seen at that level.
  noteStars(stars) {
    if (stars >= 5) this.highestStars = 5;
  }

  update(dt, ctx = {}) {
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
    const speed = player?.speed || 0;

    if (driving && speed >= 30.5) this.unlock('speed');
    if (driving && weather >= 0.8) this.unlock('wet');
    if (driving && (hours >= 0 && hours < 5)) this.unlock('night');
    if (missionsDone > 0) this.unlock('firstJob');
    if (storyStep >= Math.max(STORY_TOTAL, storyTotal)) this.unlock('story');
    if (this.highestStars >= 5 && wanted === 0) {
      this.unlock('clean');
      this.highestStars = 0;
    }

    if (player?.pos) {
      for (const landmark of LANDMARKS) {
        if (this.visited.has(landmark.key)) continue;
        if (dist2(player.pos.x, player.pos.z, landmark.x, landmark.z) < 42 ** 2) {
          this.visited.add(landmark.key);
        }
      }
      if (this.visited.size >= LANDMARKS.length) this.unlock('explorer');
    }

    if (this._dirty) {
      this._dirty = false;
      return true;
    }
    void dt;
    return false;
  }
}
