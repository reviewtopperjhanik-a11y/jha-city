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
      <div class="hud-card hud-radio" id="hud-radio">♪ OFF · B</div>
      <div class="hud-bottom">
        <div class="hud-card" id="hud-health">HP 100</div>
        <div class="hud-card" id="hud-armor">ARMOR 0</div>
        <div class="hud-speedo">
          <div class="hud-speed-ring" id="hud-speed-ring"></div>
          <div class="hud-speed-needle" id="hud-speed-needle"></div>
          <div class="hud-card hud-speed" id="hud-speed">0 <small>KM/H</small></div>
        </div>
        <div class="hud-card" id="hud-mode">ON FOOT</div>
      </div>
      <div class="hud-arrow" id="hud-arrow" hidden>
        <div class="hud-arrow-tip" id="hud-arrow-tip"></div>
        <div class="hud-arrow-label" id="hud-arrow-label">OBJECTIVE</div>
      </div>
      <div class="hud-damage" id="hud-damage" hidden></div>
      <div class="hud-photo-flash" id="hud-flash"></div>
      <div class="toast" id="hud-toast"></div>
      <div class="busted" id="hud-busted" role="alert" aria-hidden="true">
        <div class="busted-inner">
          <div class="busted-kicker">JHA CITY POLICE</div>
          <div class="busted-title">BUSTED</div>
          <div class="busted-sub" id="hud-busted-sub"></div>
        </div>
      </div>
      <div class="hint">WASD / stick · GAS · BRAKE · DRIFT · BOOST · E ENTER/EXIT · J JOBS · G SHOP · H HORN · V WEATHER · B RADIO · K PHOTO · L LOOK · N DAY/NIGHT · P BRIBE · TAP MAP · ⚙ QUALITY</div>
    `;
    root.append(el);
    this.el = el;
    this.money = el.querySelector('#hud-money');
    this.stars = el.querySelector('#hud-stars');
    this.clock = el.querySelector('#hud-clock');
    this.weather = el.querySelector('#hud-weather');
    this.signal = el.querySelector('#hud-signal');
    this.mission = el.querySelector('#hud-mission');
    this.health = el.querySelector('#hud-health');
    this.armor = el.querySelector('#hud-armor');
    this.speed = el.querySelector('#hud-speed');
    this.speedRing = el.querySelector('#hud-speed-ring');
    this.speedNeedle = el.querySelector('#hud-speed-needle');
    this.mode = el.querySelector('#hud-mode');
    this.heat = el.querySelector('#hud-heat');
    this.radio = el.querySelector('#hud-radio');
    this.arrow = el.querySelector('#hud-arrow');
    this.arrowTip = el.querySelector('#hud-arrow-tip');
    this.arrowLabel = el.querySelector('#hud-arrow-label');
    this.damageEl = el.querySelector('#hud-damage');
    this.flashEl = el.querySelector('#hud-flash');
    this.bustedEl = el.querySelector('#hud-busted');
    this.bustedSub = el.querySelector('#hud-busted-sub');
    this.toastEl = el.querySelector('#hud-toast');
    this.toastTimer = 0;
    this.damageTimer = 0;
    this.flashTimer = 0;
  }

  setRadio(label) {
    this.radio.textContent = label;
  }

  updateArrow(marker) {
    if (!marker || !marker.show) {
      this.arrow.hidden = true;
      return;
    }
    this.arrow.hidden = false;
    this.arrow.style.left = `${marker.x}px`;
    this.arrow.style.top = `${marker.y}px`;
    this.arrowTip.style.transform = `rotate(${Math.round(marker.angle * 180 / Math.PI) + 90}deg)`;
    this.arrowLabel.textContent = marker.label || 'OBJECTIVE';
  }

  damage(strength = 1, angle = 0) {
    this.damageEl.hidden = false;
    this.damageEl.style.setProperty('--dmg-angle', `${Math.round(angle * 180 / Math.PI)}deg`);
    this.damageEl.style.opacity = String(Math.max(0.25, Math.min(1, strength)));
    this.damageTimer = 0.85;
  }

  setPhoto(on) {
    this.el.classList.toggle('photo-mode', !!on);
    if (!on) this.arrow.hidden = true;
  }

  photoFlash(ok = true) {
    this.flashEl.classList.remove('ok', 'fail');
    this.flashEl.classList.add('show', ok ? 'ok' : 'fail');
    this.flashTimer = 0.45;
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
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      if (this.damageTimer <= 0) this.damageEl.hidden = true;
      else this.damageEl.style.opacity = String(Math.max(0, Math.min(1, this.damageTimer / 0.85)));
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flashEl.classList.remove('show', 'ok', 'fail');
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
    const kmh = Math.max(0, Math.min(220, s.speed * 3.6));
    this.speedRing.style.setProperty('--speed', `${(kmh / 220) * 100}%`);
    this.speedNeedle.style.transform = `rotate(${-120 + (kmh / 220) * 240}deg)`;
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
