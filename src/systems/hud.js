export class Hud {
  constructor(root) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-top">
        <div class="hud-card" id="hud-money">$0</div>
        <div class="hud-card" id="hud-stars">☆☆☆☆☆</div>
        <div class="hud-card" id="hud-clock">18:24</div>
      </div>
      <div class="hud-card hud-mission" id="hud-mission">No active job</div>
      <div class="hud-bottom">
        <div class="hud-card" id="hud-health">HP 100</div>
        <div class="hud-card hud-speed" id="hud-speed">0 <small>KM/H</small></div>
        <div class="hud-card" id="hud-mode">ON FOOT</div>
      </div>
      <div class="toast" id="hud-toast"></div>
      <div class="hint">WASD / stick · W GAS · S BRAKE · SPACE DRIFT/JUMP · SHIFT BOOST · E ENTER/EXIT · M DELIVERY · R RACE · T TAXI · N DAY/NIGHT · P BRIBE · TAP MAP</div>
    `;
    root.append(el);
    this.money = el.querySelector('#hud-money');
    this.stars = el.querySelector('#hud-stars');
    this.clock = el.querySelector('#hud-clock');
    this.mission = el.querySelector('#hud-mission');
    this.health = el.querySelector('#hud-health');
    this.speed = el.querySelector('#hud-speed');
    this.mode = el.querySelector('#hud-mode');
    this.toastEl = el.querySelector('#hud-toast');
    this.toastTimer = 0;
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = 2.6;
  }

  tick(dt) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  update(s) {
    this.money.textContent = `$${Math.round(s.money)}`;
    this.stars.textContent = '★'.repeat(s.wanted) + '☆'.repeat(5 - s.wanted);
    this.stars.style.color = s.wanted > 0 ? '#f76685' : '';
    const h = Math.floor(s.hours);
    const m = Math.floor((s.hours - h) * 60);
    this.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.mission.textContent = s.mission;
    this.health.textContent = `HP ${Math.round(s.hp)}`;
    this.speed.innerHTML = `${Math.round(s.speed * 3.6)} <small>KM/H</small>`;
    this.mode.textContent = s.mode.toUpperCase();
  }
}
