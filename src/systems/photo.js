import * as THREE from 'three';
import { wrapAngle } from '../util/math.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A small, self-contained free-look mode. It borrows the live camera and
// produces a PNG from the canvas immediately after a render — no assets,
// no encoded textures shipped with the game.
export class PhotoMode {
  constructor(camera, canvas, { hud = null, onCapture = () => {} } = {}) {
    this.camera = camera;
    this.canvas = canvas;
    this.hud = hud;
    this.onCapture = onCapture;
    this.active = false;
    this.pendingCapture = false;
    this.yaw = 0;
    this.pitch = 0.22;
    this.distance = 11;
    this.shots = 0;
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this.raycast = null;
  }

  toggle(player = null, heading = 0) {
    if (this.active) this.exit();
    else this.enter(player, heading);
    return this.active;
  }

  enter(player = null, heading = 0) {
    if (this.active) return;
    this.active = true;
    this.yaw = heading || 0;
    this.pitch = 0.22;
    this.distance = 11;
    this.hud?.setPhoto(true);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.pendingCapture = false;
    this.hud?.setPhoto(false);
  }

  orbit(dx, dy) {
    if (!this.active) return;
    this.yaw = wrapAngle(this.yaw - dx * 0.005);
    this.pitch = clamp(this.pitch + dy * 0.004, -0.35, 1.05);
  }

  zoom(delta) {
    if (!this.active) return;
    this.distance = clamp(this.distance + delta, 5, 24);
  }

  requestCapture() {
    if (!this.active) return false;
    this.pendingCapture = true;
    return true;
  }

  // Called right after look.render() so the drawing buffer is still intact.
  capture() {
    this.pendingCapture = false;
    if (!this.active) return false;
    let data = null;
    try {
      data = this.canvas?.toDataURL?.('image/png') || null;
    } catch {
      data = null;
    }
    if (!data || data.length < 64) {
      this.hud?.photoFlash(false);
      this.onCapture(false);
      return false;
    }
    this.shots++;
    try {
      const link = document.createElement('a');
      link.href = data;
      link.download = `jha-city-${Date.now()}.png`;
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      /* browsers that block downloads still count the shot */
    }
    this.hud?.photoFlash(true);
    this.onCapture(true);
    return true;
  }

  update(dt, player) {
    if (!this.active || !player) return;
    const dist = this.distance;
    const flat = Math.cos(this.pitch) * dist;
    this._from.set(player.pos.x, player.pos.y + 1.5, player.pos.z);
    this._desired.set(
      player.pos.x - Math.sin(this.yaw) * flat,
      player.pos.y + 1.5 + Math.sin(this.pitch) * dist,
      player.pos.z - Math.cos(this.yaw) * flat,
    );
    // Pull the free camera in front of walls and parked cars.
    if (typeof this.raycast === 'function') {
      const fraction = clamp(this.raycast(this._from, this._desired), 0.18, 1);
      this._desired.lerpVectors(this._from, this._desired, fraction);
    }
    this.camera.position.lerp(this._desired, 1 - Math.exp(-8 * dt));
    this._look.set(player.pos.x, player.pos.y + 1.5, player.pos.z);
    this.camera.lookAt(this._look);
  }
}
