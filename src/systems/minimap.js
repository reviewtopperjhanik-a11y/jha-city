import { C, districtAt } from '../look/palette.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const EMPTY = [];
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
    // One stable snapshot object; update() writes into it instead of churning.
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

    // Reused projection / clipping scratch. Rotation is applied centrally in
    // _toPx via view.angle: the small map spins with the player, the big map
    // stays north-up (angle 0).
    this._smallView = { cx: 0, cz: 0, range: 165, angle: 0, rot: Math.PI, cos: -1, sin: 0, nx: 0, ny: 1 };
    this._bigView = { cx: 0, cz: 0, range: 473, angle: 0, rot: 0, cos: 1, sin: 0, nx: 0, ny: -1 };
    this._jobClamp = { x: 0, y: 0, outside: false };
    this._wpClamp = { x: 0, y: 0, outside: false };

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
        this.dragLast.x = e.clientX;
        this.dragLast.y = e.clientY;
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
        if (this.dragLast) {
          this.dragLast.x = p.x;
          this.dragLast.y = p.y;
        } else {
          this.dragLast = { x: p.x, y: p.y };
        }
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

  // Fills a reused view object. `rotate` is true only for the small map.
  _getView(angle = 0, rotate = false, out = null) {
    const view = out || this._bigView;
    view.cx = this.pan.x;
    view.cz = this.pan.z;
    view.range = this.baseRange / this.zoom;
    view.angle = angle || 0;
    view.rot = rotate ? view.angle + Math.PI : 0;
    view.cos = Math.cos(view.rot);
    view.sin = Math.sin(view.rot);
    view.nx = view.sin;
    view.ny = -view.cos;
    return view;
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

  // The one place world coordinates become map pixels. axis 'x' projects a
  // world X value, axis 'z' a world Z value, with the optional companion
  // coordinate needed for rotation. Legacy four-argument calls stay north-up.
  _toPx(v, c, S, view, axis = 'x', other = 0, otherC = 0) {
    const d1 = v - c;
    const d2 = other - otherC;
    const cos = view.cos === undefined ? 1 : view.cos;
    const sin = view.sin === undefined ? 0 : view.sin;
    const rotated = axis === 'z' ? d1 * sin + d2 * cos : d1 * cos - d2 * sin;
    return S / 2 + rotated * S / (view.range * 2);
  }

  _clampPoint(x, y, S, margin = S * 0.055, out = this._jobClamp, round = false) {
    if (round) {
      const radius = S / 2 - margin;
      let dx = x - S / 2;
      let dy = y - S / 2;
      const d2 = dx * dx + dy * dy;
      const outside = d2 > radius * radius;
      if (outside) {
        const scale = radius / Math.sqrt(d2);
        dx *= scale;
        dy *= scale;
      }
      out.x = S / 2 + dx;
      out.y = S / 2 + dy;
      out.outside = outside;
    } else {
      const outside = x < margin || x > S - margin || y < margin || y > S - margin;
      out.x = clamp(x, margin, S - margin);
      out.y = clamp(y, margin, S - margin);
      out.outside = outside;
    }
    return out;
  }

  _worldLine(c, x0, z0, x1, z1, S, view) {
    c.beginPath();
    c.moveTo(this._toPx(x0, view.cx, S, view, 'x', z0, view.cz), this._toPx(z0, view.cz, S, view, 'z', x0, view.cx));
    c.lineTo(this._toPx(x1, view.cx, S, view, 'x', z1, view.cz), this._toPx(z1, view.cz, S, view, 'z', x1, view.cx));
    c.stroke();
  }

  _worldRect(c, x0, z0, x1, z1, S, view, fill, stroke, lineWidth) {
    const ax = this._toPx(x0, view.cx, S, view, 'x', z0, view.cz);
    const ay = this._toPx(z0, view.cz, S, view, 'z', x0, view.cx);
    const bx = this._toPx(x1, view.cx, S, view, 'x', z0, view.cz);
    const by = this._toPx(z0, view.cz, S, view, 'z', x1, view.cx);
    const cx = this._toPx(x1, view.cx, S, view, 'x', z1, view.cz);
    const cy = this._toPx(z1, view.cz, S, view, 'z', x1, view.cx);
    const dx = this._toPx(x0, view.cx, S, view, 'x', z1, view.cz);
    const dy = this._toPx(z1, view.cz, S, view, 'z', x0, view.cx);
    if (Math.max(ax, bx, cx, dx) < -4 || Math.min(ax, bx, cx, dx) > S + 4
      || Math.max(ay, by, cy, dy) < -4 || Math.min(ay, by, cy, dy) > S + 4) return;
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(bx, by);
    c.lineTo(cx, cy);
    c.lineTo(dx, dy);
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lineWidth;
      c.stroke();
    }
  }

  _drawBase(c, S, view, world, detail) {
    const G = world.GRID;
    const unit = S / (view.range * 2);
    const px = (x, z) => this._toPx(x, view.cx, S, view, 'x', z, view.cz);
    const py = (x, z) => this._toPx(z, view.cz, S, view, 'z', x, view.cx);

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
        this._worldRect(
          c, bx - blockHalf, bz - blockHalf, bx + blockHalf, bz + blockHalf, S, view,
          BLOCK_TINT[districtAt(bx, bz)] || '#232337',
          'rgba(122,120,146,0.26)',
          Math.max(1, unit * 0.7),
        );
      }
    }

    // Roads.
    c.strokeStyle = hex(C.road);
    c.lineWidth = Math.max(2, G.ROAD * unit);
    c.lineCap = 'butt';
    const span = view.range * 2;
    for (let i = 0; i <= G.N; i++) {
      const p = world.roadLine(i);
      this._worldLine(c, p, -span, p, span, S, view);
      this._worldLine(c, -span, p, span, p, S, view);
    }

    // Dashed lane centres.
    c.strokeStyle = 'rgba(246,230,200,0.16)';
    c.lineWidth = Math.max(1, unit * 0.45);
    c.setLineDash([Math.max(3, unit * 5), Math.max(5, unit * 9)]);
    for (let i = 0; i <= G.N; i++) {
      const p = world.roadLine(i);
      this._worldLine(c, p, -span, p, span, S, view);
      this._worldLine(c, -span, p, span, p, S, view);
    }
    c.setLineDash([]);

    // Building footprints generated from the same collision bounds as the world.
    if (detail) {
      for (const b of world.bounds) {
        if (b.h < 2) continue;
        this._worldRect(
          c, b.x - b.hw + 1, b.z - b.hd + 1, b.x + b.hw - 1, b.z + b.hd - 1, S, view,
          b.h > 38 ? 'rgba(137,126,176,0.58)' : b.h > 18 ? 'rgba(98,94,138,0.5)' : 'rgba(72,72,102,0.46)',
          'rgba(200,190,230,0.16)',
          1,
        );
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
        const x0 = px(x, z);
        const y0 = py(x, z);
        if (x0 < 0 || x0 > S || y0 < 0 || y0 > S) continue;
        c.fillStyle = 'rgba(255,225,200,0.42)';
        c.fillText(label, x0, y0);
      }
      c.shadowBlur = 0;
    }

    // City boundary (a rotated square on the spinning map).
    const edge = G.HALF + G.ROAD / 2;
    this._worldRect(c, -edge, -edge, edge, edge, S, view, null, 'rgba(47,182,178,0.4)', 2);
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

  _drawMarkers(c, S, view, player, missions, police, wanted, waypoint, economy, extras, round = false) {
    const px = (x, z) => this._toPx(x, view.cx, S, view, 'x', z, view.cz);
    const py = (x, z) => this._toPx(z, view.cz, S, view, 'z', x, view.cx);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.005);
    const ppx = px(player.pos.x, player.pos.z);
    const ppy = py(player.pos.x, player.pos.z);
    const cars = Array.isArray(police) ? police : police?.cars || EMPTY;
    const officers = Array.isArray(police) ? EMPTY : police?.officers || EMPTY;
    const search = wanted?.search || null;
    // currentPoint() follows a moving suspect; fall back to the static point
    // for older callers that hand us a bare mission object.
    const job = typeof missions?.currentPoint === 'function'
      ? missions.currentPoint()
      : missions?.active?.points?.[missions.active.index] || null;
    const margin = round ? S * 0.075 : S * 0.055;
    const jobPos = job ? this._clampPoint(px(job.x, job.z), py(job.x, job.z), S, margin, this._jobClamp, round) : null;
    const wp = waypoint ? this._clampPoint(px(waypoint.x, waypoint.z), py(waypoint.x, waypoint.z), S, margin, this._wpClamp, round) : null;

    if (search) {
      const sx = px(search.x, search.z);
      const sy = py(search.x, search.z);
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
    if (jobPos) this._routeLine(c, ppx, ppy, jobPos.x, jobPos.y, 'rgba(255,169,72,0.5)', S);
    if (wp) this._routeLine(c, ppx, ppy, wp.x, wp.y, 'rgba(143,240,232,0.45)', S);

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
        const ang = Math.atan2(jobPos.y - ppy, jobPos.x - ppx);
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
      const x = px(v.pos.x, v.pos.z);
      const y = py(v.pos.x, v.pos.z);
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
      const x = px(o.x, o.z);
      const y = py(o.x, o.z);
      if (x < 0 || x > S || y < 0 || y > S) continue;
      c.fillStyle = '#ffd9a0';
      c.strokeStyle = 'rgba(12,13,27,0.8)';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, S * 0.007, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }

    for (const loc of economy?.locations || EMPTY) {
      const x = px(loc.x, loc.z);
      const y = py(loc.x, loc.z);
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

    for (const landmark of extras?.landmarks || EMPTY) {
      const x = px(landmark.x, landmark.z);
      const y = py(landmark.x, landmark.z);
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

    for (const incident of extras?.incidents || EMPTY) {
      const x = px(incident.x, incident.z);
      const y = py(incident.x, incident.z);
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

    // Player chevron: always nose-up on the rotating map, heading-aware on the
    // north-up city map.
    c.save();
    c.translate(ppx, ppy);
    c.rotate(Math.PI - (player.heading || 0) + view.rot);
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

    // North indicator follows the map rotation and stays inside the circle.
    const nx = round ? S / 2 + view.nx * S * 0.3 : S - S * 0.055;
    const ny = round ? S / 2 + view.ny * S * 0.3 : S * 0.055;
    c.fillStyle = 'rgba(12,13,27,0.62)';
    c.beginPath();
    c.arc(nx, ny, S * (round ? 0.036 : 0.042), 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,217,160,0.9)';
    c.font = `800 ${Math.max(9, Math.round(S * (round ? 0.024 : 0.028)))}px ui-sans-serif, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', nx, ny - (round ? S * 0.003 : S * 0.003));

    // Scale bar. On the round minimap it sits below the player, well within
    // the clipped circle instead of hanging off the edge.
    const meters = view.range > 380 ? 200 : view.range > 200 ? 100 : 50;
    const bar = (meters / (view.range * 2)) * S;
    const bx = round ? S / 2 - (bar + 22) / 2 : S * 0.045;
    const by = round ? S * 0.8 : S * 0.94;
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
    const view = this._getView(0, false, this._bigView);
    const key = `${view.cx.toFixed(1)}|${view.cz.toFixed(1)}|${view.range.toFixed(1)}|${S}`;
    if (force || key !== this.baseKey) {
      this.baseKey = key;
      this._drawBase(this.ctxBaseBig, S, view, this.world, true);
    }
    c.clearRect(0, 0, S, S);
    c.drawImage(this.baseBig, 0, 0);
    this._drawMarkers(
      c, S, view, this.last.player, this.last.missions, this.last.police,
      this.last.wanted, this.waypoint, this.last.economy, this.last.extras, false,
    );
  }

  update(player, world, missions, police, wanted, economy, extras) {
    this.world = world;
    this.baseRange = world.GRID.HALF + world.GRID.ROAD;
    if (!this.last) this.last = { player: null, missions: null, police: null, wanted: null, economy: null, extras: null };
    this.last.player = player;
    this.last.missions = missions;
    this.last.police = police;
    this.last.wanted = wanted;
    this.last.economy = economy;
    this.last.extras = extras;

    const S = this.small.width;
    const view = this._getView(player.heading || 0, true, this._smallView);
    view.cx = player.pos.x;
    view.cz = player.pos.z;
    view.range = 165;
    this._drawBase(this.ctxSmall, S, view, world, true);
    this._drawMarkers(
      this.ctxSmall, S, view, player, missions, police, wanted,
      this.waypoint, economy, extras, true,
    );
    if (this.isOpen) {
      this._drawLarge();
      this._updateWaypointUI();
    }
  }
}
