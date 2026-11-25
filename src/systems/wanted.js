export class Wanted {
  constructor() {
    this.stars = 0;
    this.evade = 0;
    this.lastCrime = -99;
    this.onChange = () => {};
  }

  crime(amount = 1, time = 0) {
    const before = this.stars;
    this.stars = Math.min(5, this.stars + amount);
    this.evade = 0;
    this.lastCrime = time;
    if (before !== this.stars) this.onChange(this.stars);
  }

  update(dt, playerPos, police, time) {
    if (this.stars <= 0) return;
    let near = false;
    for (const p of police) {
      const d = Math.hypot(p.pos.x - playerPos.x, p.pos.z - playerPos.z);
      if (d < 38) {
        near = true;
        break;
      }
    }
    this.evade = near ? Math.max(0, this.evade - dt * 2.5) : this.evade + dt;
    if (this.evade > 14 && time - this.lastCrime > 14) {
      this.stars = Math.max(0, this.stars - 1);
      this.evade = 0;
      this.lastCrime = time;
      this.onChange(this.stars);
    }
  }

  clear() {
    this.stars = 0;
    this.evade = 0;
    this.onChange(0);
  }
}
