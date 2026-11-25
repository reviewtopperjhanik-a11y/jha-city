import { C } from '../look/palette.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class Minimap {
  constructor(root) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 220;
    this.canvas.height = 220;
    this.canvas.className = 'minimap';
    root.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  update(player, world, missions, police) {
    const c = this.ctx;
    const S = this.canvas.width;
    const range = world.GRID.HALF + 40;
    const toPx = (v) => ((v + range) / (range * 2)) * S;
    c.clearRect(0, 0, S, S);
    c.fillStyle = hex(C.ink);
    c.globalAlpha = 0.78;
    c.fillRect(0, 0, S, S);
    c.globalAlpha = 1;

    c.strokeStyle = hex(C.sidewalk);
    c.lineWidth = 4;
    for (let i = 0; i <= world.GRID.N; i++) {
      const p = toPx(world.roadLine(i));
      c.beginPath();
      c.moveTo(p, 0);
      c.lineTo(p, S);
      c.stroke();
      c.beginPath();
      c.moveTo(0, p);
      c.lineTo(S, p);
      c.stroke();
    }

    for (const v of police) {
      c.fillStyle = hex(C.dusk);
      c.fillRect(toPx(v.pos.x) - 3, toPx(v.pos.z) - 3, 6, 6);
    }
    if (missions.active) {
      const p = missions.active.points[missions.active.index];
      c.fillStyle = hex(C.amber);
      c.beginPath();
      c.arc(toPx(p.x), toPx(p.z), 6, 0, Math.PI * 2);
      c.fill();
    }

    c.save();
    c.translate(toPx(player.pos.x), toPx(player.pos.z));
    c.rotate(-player.heading);
    c.fillStyle = hex(C.coral);
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6, 7);
    c.lineTo(0, 3);
    c.lineTo(-6, 7);
    c.closePath();
    c.fill();
    c.restore();
  }
}
