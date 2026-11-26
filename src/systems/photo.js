import * as THREE from 'three';
import { wrapAngle } from '../util/math.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PNG_PREFIX = 'data:image/png;base64,';
// The free camera keeps the same safety margins as the chase camera: never
// closer than this to the subject, never below the street surface.
const MIN_CAMERA_DISTANCE = 2;
const MIN_EYE_Y = 0.9;

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
    this._final = new THREE.Vector3();
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
    // Fail the SNAP press immediately when there is no readable canvas, rather
    // than leaving a pending request that flashes success on an empty PNG.
    if (typeof this.canvas?.toDataURL !== 'function') return false;
    this.pendingCapture = true;
    return true;
  }

  _validPng(data) {
    return typeof data === 'string'
      && data.startsWith(PNG_PREFIX)
      && data.length > PNG_PREFIX.length + 64;
  }

  // Fraction along focus -> eye where the first obstacle starts. A bad ray
  // result is treated as clear; a hit still keeps a small minimum distance so
  // the camera cannot end up inside the player's own head.
  _safeFraction(hit, distance) {
    const value = Number.isFinite(hit) ? clamp(hit, 0, 1) : 1;
    const floor = Math.min(0.9, MIN_CAMERA_DISTANCE / Math.max(0.001, distance));
    return Math.max(value, floor);
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
    if (!this._validPng(data)) {
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
    // A steep downward pitch used to put the eye several metres below the
    // street. Keep it above the road before and after the collision pull-in.
    this._desired.y = Math.max(this._desired.y, MIN_EYE_Y);
    const canRaycast = typeof this.raycast === 'function';
    if (canRaycast) {
      const focusDist = this._desired.distanceTo(this._from);
      const fraction = this._safeFraction(this.raycast(this._from, this._desired), focusDist);
      this._desired.lerpVectors(this._from, this._desired, fraction);
      this._desired.y = Math.max(this._desired.y, MIN_EYE_Y);
    }
    // Smooth follow, but never let the interpolation itself cross a wall.
    this._final.copy(this.camera.position).lerp(this._desired, 1 - Math.exp(-8 * dt));
    this._final.y = Math.max(this._final.y, MIN_EYE_Y);
    if (canRaycast && this._final.distanceToSquared(this._desired) > 0.0001) {
      const finalDist = this._final.distanceTo(this._from);
      // Only pull in while there is room to keep the minimum distance. When
      // the lerp starts very close to the player, pulling toward the focus
      // would make the framing worse; the next frames converge on _desired.
      if (finalDist > MIN_CAMERA_DISTANCE) {
        const fraction = this._safeFraction(this.raycast(this._from, this._final), finalDist);
        if (fraction < 1) this._final.lerp(this._from, 1 - fraction);
      }
    }
    this.camera.position.copy(this._final);
    this._look.set(player.pos.x, player.pos.y + 1.5, player.pos.z);
    this.camera.lookAt(this._look);
  }
}
