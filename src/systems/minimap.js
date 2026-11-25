import { C, districtAt } from '../look/palette.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const BLOCK_TINT = {
  downtown: '#241f3d',
  strip: '#33232e',
  port: '#2e251f',
  beach: '#2b2a23',
};
const DISTRICT_LABEL = {
  downtown: ['DOWNTOWN', 330, 60],
  strip: ['NEON STRIP', 0, 160],
  beach: ['SUNSET BEACH', 0, -340],
  port: ['THE DOCKS', -330, 20],
};

export class Minimap {
  constructor(root) {
    this.isOpen = false;
    this.world = null;
    this.last = null;

    this.wrap = document.createElement('div');
    this.wrap.className = 'minimap-wrap';
    this.wrap.setAttribute('role', 'button');
    this.wrap.setAttribute('tabindex', '0');
    this.wrap.setAttribute('aria-label', 'Open the city map');
    this.small = document.createElement('canvas');
    this.small.width = 280;
    this.small.height = 280;
    this.small.className = 'minimap';
    const badge = document.createElement('div');
    badge.className = 'map-badge';
    badge.textContent = 'MAP';
    this.wrap.append(this.small, badge);

    this.overlay = document.createElement('div');
    this.overlay.className = 'map-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.panel = document.createElement('div');
    this.panel.className = 'map-panel';
    this.panel.innerHTML = `
      <div class="map-head">
        <span class="map-brand">JHA CITY</span>
        <span class="map-sub">CITY MAP</span>
        <button class="map-close" aria-label="Close map">✕</button>
      </div>
      <canvas class="map-canvas"></canvas>
      <div class="map-legend">
        <span><i class="dot you"></i>YOU</span>
        <span><i class="dot job"></i>JOB</span>
        <span><i class="dot cop"></i>POLICE</span>
        <span class="map-hint">TAP OUTSIDE TO CLOSE</span>
      </div>`;
    this.overlay.append(this.panel);
    root.append(this.wrap, this.overlay);

    this.big = this.panel.querySelector('.map-canvas');
    this.big.width = 880;
    this.big.height = 880;
    this.ctxSmall = this.small.getContext('2d');
    this.ctxBig = this.big.getContext('2d');
    this.cache = document.createElement('canvas');
    this.cache.width = 880;
    this.cache.height = 880;
    this.cacheCtx = this.cache.getContext('2d');
    this.cacheReady = false;

    this.wrap.addEventListener('click', () => this.open());
    this.wrap.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.open();
      }
    });
    this.panel.querySelector('.map-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) this.close();
    });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.overlay.classList.add('open');
    this.overlay.setAttribute('aria-hidden', 'false');
    this._drawLarge();
  }

  close() {
    this.isOpen = false;
    this.overlay.classList.remove('open');
    this.overlay.setAttribute('aria-hidden', 'true');
  }

  _view(cx, cz, range) {
    return { cx, cz, range };
  }

  _toPx(v, c, S, view) {
    return ((v - c) / (view.range * 2)) * S + S / 2;
  }

  _drawBase(c, S, view, world, detail) {
    const G = world.GRID;
    const toX = (v) => this._toPx(v, view.cx, S, view);
    const toY = (v) => this._toPx(v, view.cz, S, view);
    const unit = S / (view.range * 2);

    c.clearRect(0, 0, S, S);
    const bg = c.createLinearGradient(0, 0, S, S);
    bg.addColorStop(0, '#0b0d1c');
    bg.addColorStop(0.55, '#111326');
    bg.addColorStop(1, '#0a0b16');
    c.fillStyle = bg;
    c.fillRect(0, 0, S, S);

    // City blocks, tinted by district.
    const blockHalf = (G.BLOCK - G.ROAD - 2) / 2;
    for (let i = 0; i < G.N; i++) {
      for (let j = 0; j < G.N; j++) {
        const bx = world.roadLine(i) + G.BLOCK / 2;
        const bz = world.roadLine(j) + G.BLOCK / 2;
        const x0 = toX(bx - blockHalf);
        const y0 = toY(bz - blockHalf);
        const w = blockHalf * 2 * unit;
        if (x0 + w < -4 || x0 > S + 4 || y0 + w < -4 || y0 > S + 4) continue;
        c.fillStyle = BLOCK_TINT[districtAt(bx, bz)] || '#232337';
        c.fillRect(x0, y0, w, w);
        c.strokeStyle = 'rgba(122,120,146,0.26)';
        c.lineWidth = Math.max(1, unit * 0.7);
        c.strokeRect(x0, y0, w, w);
      }
    }

    // Roads.
    c.strokeStyle = hex(C.road);
    c.lineWidth = Math.max(2, G.ROAD * unit);
    c.lineCap = 'butt';
    for (let i = 0; i <= G.N; i++) {
      const p = world.roadLine(i);
      c.beginPath();
      c.moveTo(toX(p), -20);
      c.lineTo(toX(p), S + 20);
      c.stroke();
      c.beginPath();
      c.moveTo(-20, toY(p));
      c.lineTo(S + 20, toY(p));
      c.stroke();
    }

    // Dashed lane centres.
    c.strokeStyle = 'rgba(246,230,200,0.16)';
    c.lineWidth = Math.max(1, unit * 0.45);
    c.setLineDash([Math.max(3, unit * 5), Math.max(5, unit * 9)]);
    for (let i = 0; i <= G.N; i++) {
      const p = world.roadLine(i);
      c.beginPath();
      c.moveTo(toX(p), 0);
      c.lineTo(toX(p), S);
      c.stroke();
      c.beginPath();
      c.moveTo(0, toY(p));
      c.lineTo(S, toY(p));
      c.stroke();
    }
    c.setLineDash([]);

    // Building footprints: the map is generated from the same collision bounds
    // the world uses, so streets, blocks and buildings line up with the game.
    if (detail) {
      for (const b of world.bounds) {
        if (b.h < 2) continue;
        const x = toX(b.x - b.hw + 1);
        const y = toY(b.z - b.hd + 1);
        const w = (b.hw - 1) * 2 * unit;
        const h = (b.hd - 1) * 2 * unit;
        if (x + w < -2 || x > S + 2 || y + h < -2 || y > S + 2) continue;
        c.fillStyle = b.h > 38 ? 'rgba(137,126,176,0.58)' : b.h > 18 ? 'rgba(98,94,138,0.5)' : 'rgba(72,72,102,0.46)';
        c.fillRect(x, y, w, h);
        c.strokeStyle = 'rgba(200,190,230,0.16)';
        c.lineWidth = 1;
        c.strokeRect(x, y, w, h);
      }
    }

    if (detail) {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${Math.round(S * 0.022)}px ui-sans-serif, system-ui, sans-serif`;
      c.shadowColor = 'rgba(247,102,133,0.55)';
      c.shadowBlur = 10;
      for (const key of Object.keys(DISTRICT_LABEL)) {
        const [label, x, z] = DISTRICT_LABEL[key];
        const px = toX(x);
        const py = toY(z);
        if (px < 0 || px > S || py < 0 || py > S) continue;
        c.fillStyle = 'rgba(255,225,200,0.42)';
        c.fillText(label, px, py);
      }
      c.shadowBlur = 0;
    }

    // City boundary.
    const left = toX(-G.HALF - G.ROAD / 2);
    const top = toY(-G.HALF - G.ROAD / 2);
    const size = (G.HALF * 2 + G.ROAD) * unit;
    c.strokeStyle = 'rgba(47,182,178,0.4)';
    c.lineWidth = 2;
    c.strokeRect(left, top, size, size);
  }

  _drawMarkers(c, S, view, player, missions, police) {
    const toX = (v) => this._toPx(v, view.cx, S, view);
    const toY = (v) => this._toPx(v, view.cz, S, view);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.005);

    const job = missions.active ? missions.active.points[missions.active.index] : null;
    if (job) {
      let mx = toX(job.x);
      let my = toY(job.z);
      const margin = S * 0.055;
      const outside = mx < margin || mx > S - margin || my < margin || my > S - margin;
      mx = Math.max(margin, Math.min(S - margin, mx));
      my = Math.max(margin, Math.min(S - margin, my));
      c.save();
      c.shadowColor = hex(C.amber);
      c.shadowBlur = 14;
      c.strokeStyle = hex(C.amber);
      c.fillStyle = `rgba(255,169,72,${0.24 + pulse * 0.24})`;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(mx, my, S * 0.019 + pulse * 2.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = hex(C.amber);
      c.beginPath();
      c.arc(mx, my, S * 0.008, 0, Math.PI * 2);
      c.fill();
      if (outside) {
        c.fillStyle = hex(C.amber);
        c.beginPath();
        c.moveTo(mx, my - 8);
        c.lineTo(mx + 5, my + 3);
        c.lineTo(mx - 5, my + 3);
        c.closePath();
        c.fill();
      }
      c.restore();
    }

    const flash = Math.floor(performance.now() * 0.006) % 2 === 0;
    for (const v of police) {
      const px = toX(v.pos.x);
      const py = toY(v.pos.z);
      if (px < 0 || px > S || py < 0 || py > S) continue;
      c.fillStyle = flash ? '#ff3355' : '#3a7bff';
      c.shadowColor = c.fillStyle;
      c.shadowBlur = 10;
      c.beginPath();
      c.arc(px, py, S * 0.011, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#fff3e0';
      c.beginPath();
      c.arc(px, py, S * 0.004, 0, Math.PI * 2);
      c.fill();
    }

    const px = toX(player.pos.x);
    const py = toY(player.pos.z);
    c.save();
    c.translate(px, py);
    c.rotate(Math.PI - player.heading);
    c.shadowColor = hex(C.coral);
    c.shadowBlur = 12;
    c.fillStyle = hex(C.coral);
    c.strokeStyle = '#fff3e0';
    c.lineWidth = Math.max(1.2, S * 0.004);
    const a = S * 0.022;
    c.beginPath();
    c.moveTo(0, -a * 1.5);
    c.lineTo(a, a);
    c.lineTo(0, a * 0.45);
    c.lineTo(-a, a);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();

    // North indicator.
    c.fillStyle = 'rgba(255,217,160,0.85)';
    c.font = `800 ${Math.round(S * 0.028)}px ui-sans-serif, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', S - S * 0.04, S * 0.04);
  }

  _buildCache(world) {
    const S = this.cache.width;
    const view = this._view(0, 0, world.GRID.HALF + world.GRID.ROAD);
    this._drawBase(this.cacheCtx, S, view, world, true);
    this.cacheReady = true;
  }

  _drawLarge() {
    if (!this.world || !this.last) return;
    if (!this.cacheReady) this._buildCache(this.world);
    const c = this.ctxBig;
    const S = this.big.width;
    c.clearRect(0, 0, S, S);
    c.drawImage(this.cache, 0, 0);
    const view = this._view(0, 0, this.world.GRID.HALF + this.world.GRID.ROAD);
    this._drawMarkers(c, S, view, this.last.player, this.last.missions, this.last.police);
  }

  update(player, world, missions, police) {
    this.world = world;
    this.last = { player, missions, police };
    if (!this.cacheReady) this._buildCache(world);

    const S = this.small.width;
    const view = this._view(player.pos.x, player.pos.z, 165);
    this._drawBase(this.ctxSmall, S, view, world, true);
    this._drawMarkers(this.ctxSmall, S, view, player, missions, police);
    if (this.isOpen) this._drawLarge();
  }
}
