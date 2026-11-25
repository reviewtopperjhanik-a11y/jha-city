import { C, districtAt } from '../look/palette.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
const MAX_ZOOM = 4;

export class Minimap {
  constructor(root, { toast = () => {} } = {}) {
    this.isOpen = false;
    this.world = null;
    this.last = null;
    this.toast = toast;
    this.baseRange = 473;
    this.zoom = 1;
    this.pan = { x: 0, z: 0 };
    this.waypoint = null;
    this.pointers = new Map();
    this.dragMoved = 0;
    this.dragLast = null;
    this.pinchStart = 0;
    this.pinchZoom = 1;

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
        <span class="map-wp" id="map-wp"></span>
        <button class="map-close" aria-label="Close map">✕</button>
      </div>
      <div class="map-body">
        <canvas class="map-canvas"></canvas>
        <div class="map-controls">
          <button data-map="in" aria-label="Zoom in">+</button>
          <button data-map="out" aria-label="Zoom out">−</button>
          <button data-map="fit" aria-label="Show the whole city">⌂</button>
        </div>
      </div>
      <div class="map-legend">
        <span><i class="dot you"></i>YOU</span>
        <span><i class="dot job"></i>JOB</span>
        <span><i class="dot wp"></i>WAYPOINT</span>
        <span><i class="dot cop"></i>POLICE</span>
        <span><i class="dot search"></i>SEARCH</span>
        <span><i class="dot biz"></i>GARAGE / SHOP / SAFEHOUSE</span>
        <span><i class="dot landmark"></i>LANDMARK</span>
        <span><i class="dot accident"></i>ACCIDENT</span>
        <button class="map-clear" hidden>CLR WP</button>
      </div>
      <div class="map-tip">TAP MAP TO SET WAYPOINT · DRAG TO PAN · PINCH OR +/− TO ZOOM</div>`;
    this.overlay.append(this.panel);
    root.append(this.wrap, this.overlay);

    this.big = this.panel.querySelector('.map-canvas');
    this.big.width = 900;
    this.big.height = 900;
    this.ctxSmall = this.small.getContext('2d');
    this.ctxBig = this.big.getContext('2d');
    // The city never moves, so cache the whole pan/zoom layer and redraw only
    // the live markers on top each frame.
    this.baseBig = document.createElement('canvas');
    this.baseBig.width = 900;
    this.baseBig.height = 900;
    this.ctxBaseBig = this.baseBig.getContext('2d');
    this.baseKey = '';
    this.lastLargeDraw = 0;
    this.wpEl = this.panel.querySelector('#map-wp');
    this.clearBtn = this.panel.querySelector('.map-clear');

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
    this.clearBtn.addEventListener('click', () => this.clearWaypoint());
    for (const btn of this.panel.querySelectorAll('[data-map]')) {
      btn.addEventListener('click', () => {
        const action = btn.dataset.map;
        if (action === 'in') this._zoomAt(this.zoom * 1.5, 0.5, 0.5);
        else if (action === 'out') this._zoomAt(this.zoom / 1.5, 0.5, 0.5);
        else this.fit();
      });
    }
    this._bindPointers();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) this.close();
    });
  }

  _bindPointers() {
    const canvas = this.big;
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragMoved = 0;
        this.dragLast = { x: e.clientX, y: e.clientY };
      } else if (this.pointers.size === 2) {
        this.pinchStart = this._pinchDistance();
        this.pinchZoom = this.zoom;
        this.dragMoved = 99;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1 && this.dragLast) {
        const dx = e.clientX - this.dragLast.x;
        const dy = e.clientY - this.dragLast.y;
        this.dragMoved += Math.hypot(dx, dy);
        this.dragLast = { x: e.clientX, y: e.clientY };
        if (this.dragMoved > 4 && this.zoom > 1.001) {
          const rect = canvas.getBoundingClientRect();
          const range = this.baseRange / this.zoom;
          this.pan.x -= (dx / Math.max(1, rect.width)) * range * 2;
          this.pan.z -= (dy / Math.max(1, rect.height)) * range * 2;
          this._clampPan();
          this._drawLarge();
        }
      } else if (this.pointers.size === 2 && this.pinchStart > 0) {
        const d = this._pinchDistance();
        if (d > 0) {
          this.zoom = clamp(this.pinchZoom * (d / this.pinchStart), 1, MAX_ZOOM);
          this._clampPan();
          this._drawLarge();
        }
      }
    });
    const release = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      if (wasSingle && this.dragMoved < 6 && this.last) {
        const rect = canvas.getBoundingClientRect();
        const fx = (e.clientX - rect.left) / Math.max(1, rect.width);
        const fy = (e.clientY - rect.top) / Math.max(1, rect.height);
        if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) {
          const view = this._getView();
          this.setWaypoint(view.cx + (fx - 0.5) * 2 * view.range, view.cz + (fy - 0.5) * 2 * view.range);
        }
      }
      if (this.pointers.size === 0) {
        this.dragLast = null;
        this.dragMoved = 0;
        this.pinchStart = 0;
      } else if (this.pointers.size === 1) {
        const p = this.pointers.values().next().value;
        this.dragLast = { x: p.x, y: p.y };
        this.dragMoved = 99;
        this.pinchStart = 0;
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.isOpen) return;
      const rect = canvas.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / Math.max(1, rect.width);
      const fy = (e.clientY - rect.top) / Math.max(1, rect.height);
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      this._zoomAt(this.zoom * factor, fx, fy);
    }, { passive: false });
  }

  _pinchDistance() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  _getView() {
    return { cx: this.pan.x, cz: this.pan.z, range: this.baseRange / this.zoom };
  }

  _clampPan() {
    const max = Math.max(0, this.baseRange - this.baseRange / this.zoom);
    this.pan.x = clamp(this.pan.x, -max, max);
    this.pan.z = clamp(this.pan.z, -max, max);
  }

  _zoomAt(zoom, fx, fy) {
    const old = this._getView();
    const wx = old.cx + (fx - 0.5) * 2 * old.range;
    const wz = old.cz + (fy - 0.5) * 2 * old.range;
    this.zoom = clamp(zoom, 1, MAX_ZOOM);
    const range = this.baseRange / this.zoom;
    this.pan.x = wx - (fx - 0.5) * 2 * range;
    this.pan.z = wz - (fy - 0.5) * 2 * range;
    this._clampPan();
    this._drawLarge();
  }

  fit() {
    this.zoom = 1;
    this.pan.x = 0;
    this.pan.z = 0;
    this._drawLarge(true);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.overlay.classList.add('open');
    this.overlay.setAttribute('aria-hidden', 'false');
    this.zoom = 1;
    this.pan.x = 0;
    this.pan.z = 0;
    this.pointers.clear();
    this._updateWaypointUI();
    this._drawLarge(true);
  }

  close() {
    this.isOpen = false;
    this.overlay.classList.remove('open');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.pointers.clear();
    this.dragLast = null;
    this.pinchStart = 0;
  }

  setWaypoint(x, z) {
    if (!this.world) return;
    const lim = this.world.GRID.HALF - 8;
    this.waypoint = { x: clamp(x, -lim, lim), z: clamp(z, -lim, lim) };
    this._updateWaypointUI();
    this._drawLarge();
    const player = this.last?.player;
    if (player) {
      const d = Math.round(Math.hypot(this.waypoint.x - player.pos.x, this.waypoint.z - player.pos.z));
      this.toast(`WAYPOINT SET · ${d}m`);
    } else {
      this.toast('WAYPOINT SET');
    }
  }

  clearWaypoint() {
    if (!this.waypoint) return;
    this.waypoint = null;
    this._updateWaypointUI();
    this._drawLarge();
    this.toast('WAYPOINT CLEARED');
  }

  _updateWaypointUI() {
    if (!this.wpEl) return;
    if (!this.waypoint) {
      this.wpEl.textContent = '';
      if (this.clearBtn) this.clearBtn.hidden = true;
      return;
    }
    const player = this.last?.player;
    const d = player
      ? Math.round(Math.hypot(this.waypoint.x - player.pos.x, this.waypoint.z - player.pos.z))
      : 0;
    this.wpEl.textContent = `WP ${d}m`;
    if (this.clearBtn) this.clearBtn.hidden = false;
  }

  _toPx(v, c, S, view) {
    return ((v - c) / (view.range * 2)) * S + S / 2;
  }

  _clampPoint(x, y, S, margin = S * 0.055) {
    const outside = x < margin || x > S - margin || y < margin || y > S - margin;
    return {
      x: clamp(x, margin, S - margin),
      y: clamp(y, margin, S - margin),
      outside,
    };
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

    // Building footprints generated from the same collision bounds as the world.
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
      c.font = `700 ${Math.max(8, Math.round(S * 0.022))}px ui-sans-serif, system-ui, sans-serif`;
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

  _routeLine(c, ax, ay, bx, by, color, S) {
    c.save();
    c.strokeStyle = color;
    c.lineWidth = Math.max(1.2, S * 0.0028);
    c.setLineDash([S * 0.012, S * 0.018]);
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(bx, by);
    c.stroke();
    c.restore();
  }

  _drawMarkers(c, S, view, player, missions, police, wanted, waypoint, economy, extras) {
    const toX = (v) => this._toPx(v, view.cx, S, view);
    const toY = (v) => this._toPx(v, view.cz, S, view);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.005);
    const px = toX(player.pos.x);
    const py = toY(player.pos.z);
    const cars = Array.isArray(police) ? police : police?.cars || [];
    const officers = Array.isArray(police) ? [] : police?.officers || [];
    const search = wanted?.search || null;
    const job = missions.active ? missions.active.points[missions.active.index] : null;
    const jobPos = job ? this._clampPoint(toX(job.x), toY(job.z), S) : null;
    const wp = waypoint ? this._clampPoint(toX(waypoint.x), toY(waypoint.z), S) : null;

    if (search) {
      const sx = toX(search.x);
      const sy = toY(search.z);
      const sr = Math.max(6, search.r * (S / (view.range * 2)));
      c.save();
      c.fillStyle = 'rgba(255,51,85,0.08)';
      c.strokeStyle = 'rgba(255,51,85,0.5)';
      c.lineWidth = Math.max(1.2, S * 0.0025);
      c.setLineDash([S * 0.01, S * 0.014]);
      c.beginPath();
      c.arc(sx, sy, sr, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.setLineDash([]);
      c.restore();
    }

    // Dashed route lines sit under the markers.
    if (jobPos) this._routeLine(c, px, py, jobPos.x, jobPos.y, 'rgba(255,169,72,0.5)', S);
    if (wp) this._routeLine(c, px, py, wp.x, wp.y, 'rgba(143,240,232,0.45)', S);

    if (wp) {
      c.save();
      c.translate(wp.x, wp.y);
      c.rotate(Math.PI / 4);
      c.shadowColor = hex(C.teal);
      c.shadowBlur = 12;
      c.fillStyle = hex(C.teal);
      c.strokeStyle = '#eafffb';
      c.lineWidth = Math.max(1, S * 0.0025);
      const w = S * 0.017 + pulse * 1.5;
      c.fillRect(-w, -w, w * 2, w * 2);
      c.strokeRect(-w, -w, w * 2, w * 2);
      c.restore();
    }

    if (jobPos) {
      c.save();
      c.shadowColor = hex(C.amber);
      c.shadowBlur = 14;
      c.strokeStyle = hex(C.amber);
      c.fillStyle = `rgba(255,169,72,${0.24 + pulse * 0.24})`;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(jobPos.x, jobPos.y, S * 0.019 + pulse * 2.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = hex(C.amber);
      c.beginPath();
      c.arc(jobPos.x, jobPos.y, S * 0.008, 0, Math.PI * 2);
      c.fill();
      if (jobPos.outside) {
        const ang = Math.atan2(job.z - player.pos.z, job.x - player.pos.x);
        c.translate(jobPos.x, jobPos.y);
        c.rotate(ang);
        c.beginPath();
        c.moveTo(10, 0);
        c.lineTo(-4, 5);
        c.lineTo(-4, -5);
        c.closePath();
        c.fill();
      }
      c.restore();
    }

    const flash = Math.floor(performance.now() * 0.006) % 2 === 0;
    for (const v of cars) {
      const x = toX(v.pos.x);
      const y = toY(v.pos.z);
      if (x < 0 || x > S || y < 0 || y > S) continue;
      c.fillStyle = flash ? '#ff3355' : '#3a7bff';
      c.shadowColor = c.fillStyle;
      c.shadowBlur = 10;
      c.beginPath();
      c.arc(x, y, S * 0.011, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#fff3e0';
      c.beginPath();
      c.arc(x, y, S * 0.004, 0, Math.PI * 2);
      c.fill();
    }
    for (const o of officers) {
      const x = toX(o.x);
      const y = toY(o.z);
      if (x < 0 || x > S || y < 0 || y > S) continue;
      c.fillStyle = '#ffd9a0';
      c.strokeStyle = 'rgba(12,13,27,0.8)';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, S * 0.007, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }

    for (const loc of economy?.locations || []) {
      const x = toX(loc.x);
      const y = toY(loc.z);
      if (x < 0 || x > S || y < 0 || y > S) continue;
      const w = Math.max(7, S * 0.016);
      c.save();
      c.shadowColor = hex(loc.color);
      c.shadowBlur = 9;
      c.fillStyle = hex(loc.color);
      c.strokeStyle = '#fff3e0';
      c.lineWidth = 1;
      c.fillRect(x - w / 2, y - w / 2, w, w);
      c.strokeRect(x - w / 2, y - w / 2, w, w);
      c.shadowBlur = 0;
      c.fillStyle = '#0c0d1b';
      c.font = `800 ${Math.max(7, Math.round(w * 0.78))}px ui-sans-serif, system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(loc.key[0].toUpperCase(), x, y + 0.5);
      c.restore();
    }

    for (const landmark of extras?.landmarks || []) {
      const x = toX(landmark.x);
      const y = toY(landmark.z);
      if (x < 0 || x > S || y < 0 || y > S) continue;
      const r = Math.max(6, S * 0.014);
      c.save();
      c.translate(x, y);
      c.rotate(Math.PI / 4);
      c.shadowColor = '#ffd9a0';
      c.shadowBlur = 8;
      c.fillStyle = '#ffd9a0';
      c.strokeStyle = '#fff3e0';
      c.lineWidth = 1;
      c.fillRect(-r, -r, r * 2, r * 2);
      c.strokeRect(-r, -r, r * 2, r * 2);
      c.restore();
    }

    for (const incident of extras?.incidents || []) {
      const x = toX(incident.x);
      const y = toY(incident.z);
      if (x < 0 || x > S || y < 0 || y > S) continue;
      const r = Math.max(5, S * 0.012);
      c.save();
      c.strokeStyle = '#ff3355';
      c.shadowColor = '#ff3355';
      c.shadowBlur = 10;
      c.lineWidth = Math.max(1.5, S * 0.003);
      c.beginPath();
      c.moveTo(x - r, y - r);
      c.lineTo(x + r, y + r);
      c.moveTo(x + r, y - r);
      c.lineTo(x - r, y + r);
      c.stroke();
      c.restore();
    }

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

    // North indicator and scale bar.
    c.fillStyle = 'rgba(12,13,27,0.62)';
    c.beginPath();
    c.arc(S - S * 0.055, S * 0.055, S * 0.042, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,217,160,0.9)';
    c.font = `800 ${Math.max(9, Math.round(S * 0.028))}px ui-sans-serif, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', S - S * 0.055, S * 0.052);

    const meters = view.range > 380 ? 200 : view.range > 200 ? 100 : 50;
    const bar = (meters / (view.range * 2)) * S;
    const bx = S * 0.045;
    const by = S * 0.94;
    c.fillStyle = 'rgba(12,13,27,0.68)';
    c.fillRect(bx - 4, by - 14, bar + 48, 19);
    c.fillStyle = 'rgba(143,240,232,0.8)';
    c.fillRect(bx, by, bar, Math.max(1.5, S * 0.0025));
    c.fillStyle = 'rgba(143,240,232,0.9)';
    c.textAlign = 'left';
    c.font = `700 ${Math.max(8, Math.round(S * 0.017))}px ui-sans-serif, system-ui, sans-serif`;
    c.fillText(`${meters}m`, bx + bar + 6, by - 3);
  }

  _drawLarge(force = false) {
    if (!this.world || !this.last) return;
    const now = performance.now();
    if (!force && now - this.lastLargeDraw < 40) return;
    this.lastLargeDraw = now;
    const c = this.ctxBig;
    const S = this.big.width;
    const view = this._getView();
    const key = `${view.cx.toFixed(1)}|${view.cz.toFixed(1)}|${view.range.toFixed(1)}|${S}`;
    if (force || key !== this.baseKey) {
      this.baseKey = key;
      this._drawBase(this.ctxBaseBig, S, view, this.world, true);
    }
    c.clearRect(0, 0, S, S);
    c.drawImage(this.baseBig, 0, 0);
    this._drawMarkers(c, S, view, this.last.player, this.last.missions, this.last.police, this.last.wanted, this.waypoint, this.last.economy, this.last.extras);
  }

  update(player, world, missions, police, wanted, economy, extras) {
    this.world = world;
    this.baseRange = world.GRID.HALF + world.GRID.ROAD;
    this.last = { player, missions, police, wanted, economy, extras };

    const S = this.small.width;
    const view = { cx: player.pos.x, cz: player.pos.z, range: 165 };
    this._drawBase(this.ctxSmall, S, view, world, true);
    this._drawMarkers(this.ctxSmall, S, view, player, missions, police, wanted, this.waypoint, economy, extras);
    if (this.isOpen) {
      this._drawLarge();
      this._updateWaypointUI();
    }
  }
}
