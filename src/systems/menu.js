import { PRICES } from './economy.js';
import { currentSlot } from '../core/save.js';
import { STYLE_KEYS, styleLabel } from '../look/wardrobe.js';

const money = (n) => `$${Math.round(n || 0)}`;
const hex = (n) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
const STORY_TOTAL = 5;
// Keep in step with the $750 pay-'n'-spray charge in main.js.
const SPRAY_PRICE = 750;

export class Menu {
  constructor(root, { toast = () => {} } = {}) {
    this.toast = toast;
    this.isOpen = false;
    this.dialog = null;
    this.overlay = document.createElement('div');
    this.overlay.className = 'menu-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.innerHTML = `
      <div class="menu-panel">
        <div class="menu-head">
          <span class="menu-title" id="menu-title"></span>
          <button class="menu-close" aria-label="Close menu">✕</button>
        </div>
        <div class="menu-body" id="menu-body"></div>
      </div>`;
    root.append(this.overlay);
    this.title = this.overlay.querySelector('#menu-title');
    this.body = this.overlay.querySelector('#menu-body');
    this.overlay.querySelector('.menu-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) this.close();
    });
  }

  _show(title, html) {
    this.title.textContent = title;
    this.body.innerHTML = html;
    this.overlay.classList.add('open');
    this.overlay.setAttribute('aria-hidden', 'false');
    this.isOpen = true;
    return this.body;
  }

  close() {
    this.isOpen = false;
    this.dialog = null;
    this.overlay.classList.remove('open');
    this.overlay.setAttribute('aria-hidden', 'true');
  }

  _on(selector, event, handler) {
    for (const el of this.body.querySelectorAll(selector)) el.addEventListener(event, handler);
  }

  showQuick(entries) {
    const cards = entries.map((entry) => `<button class="menu-item" data-quick="${entry.key}">
      <span class="menu-item-title">${entry.label}</span>
      ${entry.sub ? `<span class="menu-item-sub">${entry.sub}</span>` : ''}
    </button>`).join('');
    this._show('CITY MENU', `
      <div class="menu-label">QUICK ACTIONS</div>
      <div class="menu-grid">${cards}</div>
      <div class="menu-note">Swipe the right half of the screen to look around.</div>`);
    this._on('[data-quick]', 'click', (e) => {
      const entry = entries.find((item) => item.key === e.currentTarget.dataset.quick);
      this.close();
      entry?.run();
    });
  }

  showJobs(missions, onStart, onStory) {
    const total = Math.max(STORY_TOTAL, Math.round(Number(missions.storyCount) || 0));
    const step = Math.min(missions.storyStep, total - 1) + 1;
    const cards = missions.jobTypes.map((type) => {
      const info = missions.jobInfo(type);
      return `<button class="menu-item" data-job="${type}">
        <span class="menu-item-title">${info.name}</span>
        <span class="menu-item-sub">${info.desc}</span>
        <span class="menu-item-price">BASE ${money(info.base)}</span>
      </button>`;
    }).join('');
    const body = this._show('JOB BOARD', `
      <button class="menu-item story" data-story="1">
        <span class="menu-item-title">STORY ${step}/${total} · NEXT CHAPTER</span>
        <span class="menu-item-sub">Dialogue, a bigger payout and a chain of jobs.</span>
      </button>
      <div class="menu-label">SIDE JOBS</div>
      <div class="menu-grid">${cards}</div>
      <div class="menu-note">${missions.active ? 'Finish your current job first.' : 'Tap a job to start it.'}</div>`);
    this._on('[data-job]', 'click', (e) => {
      const type = e.currentTarget.dataset.job;
      this.close();
      onStart(type);
    });
    this._on('[data-story]', 'click', () => {
      this.close();
      onStory();
    });
  }

  showDialog(speaker, lines, onDone) {
    this.dialog = { speaker, lines: [...lines], index: 0, onDone };
    this._renderDialog();
  }

  _renderDialog() {
    const d = this.dialog;
    if (!d) return;
    const last = d.index >= d.lines.length - 1;
    this._show('RADIO CALL', `
      <div class="dialog-speaker">${d.speaker}</div>
      <p class="dialog-line">${d.lines[d.index]}</p>
      <button class="menu-primary" id="dialog-next">${last ? 'GOT IT' : 'NEXT'}</button>`);
    this.body.querySelector('#dialog-next').addEventListener('click', () => {
      if (!this.dialog) return;
      if (last) {
        const done = this.dialog.onDone;
        this.close();
        done?.();
      } else {
        this.dialog.index++;
        this._renderDialog();
      }
    });
  }

  showGarage(save, owned = [], onAction) {
    const vehicles = Array.isArray(owned) ? owned.filter((v) => v && typeof v === 'object') : [];
    const list = vehicles.length
      ? vehicles.map((v, i) => {
        const fitted = [v.upgrades?.engine && 'ENGINE', v.upgrades?.armor && 'ARMOR', v.upgrades?.handling && 'SUSPENSION'].filter(Boolean);
        return `<span class="menu-chip">${i + 1}. ${String(v.type || 'vehicle').toUpperCase()} · ${money(v.price || 0)}${fitted.length ? ` · ${fitted.join(' + ')}` : ''}</span>`;
      }).join('')
      : '<span class="menu-note">No owned vehicles yet.</span>';
    const count = (type) => vehicles.filter((v) => v.type === type).length;
    const item = (action, label, price, sub = '') => {
      const afford = Number(save.money) >= price;
      const hint = sub || (afford ? '' : `NEED ${money(price - Math.max(0, Number(save.money) || 0))} MORE`);
      return `<button class="menu-item" data-action="${action}"><span class="menu-item-title">${label}</span>${hint ? `<span class="menu-item-sub">${hint}</span>` : ''}${price ? `<span class="menu-item-price">${money(price)}</span>` : ''}</button>`;
    };
    this._show('GARAGE', `
      <div class="menu-wallet">WALLET ${money(save.money)}</div>
      <div class="menu-label">YOUR VEHICLES</div>
      <div class="menu-chips">${list}</div>
      <div class="menu-grid">
        ${item('buy-bike', 'BUY BIKE', PRICES.bike, count('bike') ? `OWNED ×${count('bike')}` : '')}
        ${item('buy-car', 'BUY COUPE', PRICES.car, count('car') ? `OWNED ×${count('car')}` : '')}
        ${item('engine', 'ENGINE TUNE', PRICES.engine)}
        ${item('armor', 'REINFORCED BODY', PRICES.armor)}
        ${item('handling', 'SPORT SUSPENSION', PRICES.handling)}
        ${item('paint', 'PAINT JOB', PRICES.paint)}
        <button class="menu-item" data-action="spray"><span class="menu-item-title">PAY 'N' SPRAY</span><span class="menu-item-price">${money(SPRAY_PRICE)}</span></button>
        <button class="menu-item" data-action="drive" ${vehicles.length ? '' : 'disabled aria-disabled="true"'}><span class="menu-item-title">SPAWN / DRIVE OWNED</span><span class="menu-item-sub">${vehicles.length ? 'Last owned vehicle or a fresh one.' : 'BUY A VEHICLE FIRST'}</span></button>
      </div>
      <div class="menu-note">Prices match the cash charged at purchase. Upgrades and paint apply to the vehicle you are driving.</div>`);
    this._on('[data-action]', 'click', (e) => {
      const btn = e.currentTarget;
      const action = btn.dataset.action;
      if (action === 'drive' && !vehicles.length) {
        this.toast('BUY A VEHICLE FIRST');
        return;
      }
      this.close();
      onAction(action);
    });
  }

  showShop(save, onAction) {
    this._show('SUPPLY SHOP', `
      <div class="menu-wallet">WALLET ${money(save.money)}</div>
      <div class="menu-grid">
        <button class="menu-item" data-action="health"><span class="menu-item-title">MED KIT +35</span><span class="menu-item-price">${money(PRICES.health)}</span></button>
        <button class="menu-item" data-action="armor"><span class="menu-item-title">BODY ARMOR +40</span><span class="menu-item-price">${money(PRICES.armor)}</span></button>
      </div>
      <div class="menu-note">Free pickups respawn around the city every 22 seconds.</div>`);
    this._on('[data-action]', 'click', (e) => {
      const action = e.currentTarget.dataset.action;
      this.close();
      onAction(action);
    });
  }

  showWardrobe(getStyle, onCycle, onRandom, onDone) {
    const style = getStyle();
    const preview = `--skin:${hex(style.skin)};--shirt:${hex(style.shirt)};--hair:${hex(style.hair)};--pants:${hex(style.pants)}`;
    const rows = STYLE_KEYS.map((key) => `
      <div class="wardrobe-row">
        <button data-style="${key}" data-delta="-1" aria-label="Previous ${key}">◀</button>
        <span>${styleLabel(style, key)}</span>
        <button data-style="${key}" data-delta="1" aria-label="Next ${key}">▶</button>
      </div>`).join('');
    this._show('YOUR LOOK', `
      <div class="wardrobe-preview" style="${preview}">
        <div class="wp-head"></div><div class="wp-hair"></div>
        <div class="wp-body"></div><div class="wp-legs"></div>
      </div>
      ${rows}
      <div class="menu-grid">
        <button class="menu-item" data-random="1"><span class="menu-item-title">RANDOM OUTFIT</span></button>
        <button class="menu-item" data-done="1"><span class="menu-item-title">DONE</span></button>
      </div>
      <div class="menu-note">Your look is saved with the current slot.</div>`);
    this._on('[data-style]', 'click', (e) => {
      const btn = e.currentTarget;
      onCycle(btn.dataset.style, Number(btn.dataset.delta));
      this.showWardrobe(getStyle, onCycle, onRandom, onDone);
    });
    this._on('[data-random]', 'click', () => {
      onRandom();
      this.showWardrobe(getStyle, onCycle, onRandom, onDone);
    });
    this._on('[data-done]', 'click', () => {
      this.close();
      onDone?.();
    });
  }

  showSafehouse(save, slots = [], onAction) {
    const available = Array.isArray(slots) ? slots : [];
    const active = Number.isFinite(save.activeSlot) ? save.activeSlot : currentSlot();
    const rows = available.map((s) => `<div class="menu-slot">
      <span>SLOT ${s.index}${s.index === active ? ' · ACTIVE' : ''}<small>${s.exists ? `${money(s.money)} · ${s.missionsDone} jobs · story ${s.storyStep}/${STORY_TOTAL}` : 'EMPTY'}</small></span>
      <button data-action="save-${s.index}">SAVE</button>
      <button data-action="load-${s.index}" ${s.exists ? '' : 'disabled aria-disabled="true"'}>LOAD</button>
    </div>`).join('');
    this._show('SAFEHOUSE', `
      <div class="menu-wallet">WALLET ${money(save.money)} · HP ${Math.round(save.hp ?? 100)} · ARMOR ${Math.round(save.armor || 0)}</div>
      <button class="menu-primary" data-action="rest">REST — FULL HEAL</button>
      <div class="menu-label">SAVE SLOTS</div>
      ${rows}
      <div class="menu-note">Loading a slot restores cash, story progress and location. Empty slots cannot be loaded.</div>`);
    this._on('[data-action]', 'click', (e) => {
      const action = e.currentTarget.dataset.action;
      if (action.startsWith('load-') && !available.find((s) => s.index === Number(action.slice(5)))?.exists) {
        this.toast(`SLOT ${action.slice(5)} IS EMPTY`);
        return;
      }
      this.close();
      onAction(action);
    });
  }
}
