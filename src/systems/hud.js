export class Hud {
  constructor(root) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-top">
        <div class="hud-card" id="hud-money">$0</div>
        <div class="hud-card" id="hud-stars">☆☆☆☆☆</div>
        <div class="hud-card" id="hud-clock">18:24</div>
        <div class="hud-card hud-weather" id="hud-weather">☀ CLEAR</div>
        <button class="hud-card hud-gear" id="hud-settings" aria-label="Open settings">⚙</button>
      </div>
      <div class="hud-card hud-heat" id="hud-heat" hidden>SEARCHING</div>
      <div class="hud-card hud-signal" id="hud-signal" hidden>GREEN</div>
      <div class="hud-card hud-fps" id="hud-fps">60 FPS</div>
      <div class="hud-card hud-mission" id="hud-mission">No active job</div>
      <div class="hud-bottom">
        <div class="hud-card" id="hud-health">HP 100</div>
        <div class="hud-card" id="hud-armor">ARMOR 0</div>
        <div class="hud-card hud-speed" id="hud-speed">0 <small>KM/H</small></div>
        <div class="hud-card" id="hud-mode">ON FOOT</div>
      </div>
      <div class="toast" id="hud-toast"></div>
      <div class="busted" id="hud-busted" role="alert" aria-hidden="true">
        <div class="busted-inner">
          <div class="busted-kicker">JHA CITY POLICE</div>
          <div class="busted-title">BUSTED</div>
          <div class="busted-sub" id="hud-busted-sub"></div>
        </div>
      </div>
      <div class="hint">WASD / stick · GAS · BRAKE · DRIFT · BOOST · E ENTER/EXIT · J JOBS · G SHOP · H HORN · V WEATHER · N DAY/NIGHT · P BRIBE · TAP MAP · ⚙ QUALITY</div>
    `;
    root.append(el);
    this.money = el.querySelector('#hud-money');
    this.stars = el.querySelector('#hud-stars');
    this.clock = el.querySelector('#hud-clock');
    this.weather = el.querySelector('#hud-weather');
    this.signal = el.querySelector('#hud-signal');
    this.mission = el.querySelector('#hud-mission');
    this.health = el.querySelector('#hud-health');
    this.armor = el.querySelector('#hud-armor');
    this.speed = el.querySelector('#hud-speed');
    this.mode = el.querySelector('#hud-mode');
    this.heat = el.querySelector('#hud-heat');
    this.bustedEl = el.querySelector('#hud-busted');
    this.bustedSub = el.querySelector('#hud-busted-sub');
    this.toastEl = el.querySelector('#hud-toast');
    this.toastTimer = 0;
  }

  showBusted(sub = '') {
    this.bustedSub.textContent = sub;
    this.bustedEl.classList.add('show');
    this.bustedEl.setAttribute('aria-hidden', 'false');
  }

  hideBusted() {
    this.bustedEl.classList.remove('show');
    this.bustedEl.setAttribute('aria-hidden', 'true');
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
    if (s.weather) this.weather.textContent = s.weather;
    const signal = s.signal;
    if (!signal) {
      this.signal.hidden = true;
    } else {
      this.signal.hidden = false;
      this.signal.textContent = signal.label;
      this.signal.className = `hud-card hud-signal ${signal.tone}`;
    }
    this.mission.textContent = s.mission;
    this.health.textContent = `HP ${Math.round(s.hp)}`;
    this.armor.textContent = `ARMOR ${Math.round(s.armor || 0)}`;
    this.speed.innerHTML = `${Math.round(s.speed * 3.6)} <small>KM/H</small>`;
    this.mode.textContent = s.mode.toUpperCase();

    const heat = s.heat;
    if (!heat) {
      this.heat.hidden = true;
    } else {
      this.heat.hidden = false;
      this.heat.textContent = heat.label;
      this.heat.className = `hud-card hud-heat ${heat.tone}`;
      this.heat.style.setProperty('--heat', `${Math.round((heat.progress || 0) * 100)}%`);
    }
  }
}
