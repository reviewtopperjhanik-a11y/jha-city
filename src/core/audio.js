// Everything is synthesised at runtime: no audio files, no licence issues.
export const RADIO_STATIONS = [
  { key: 'off', label: 'OFF', notes: [], tempo: 0, type: 'sine' },
  {
    key: 'sunset', label: 'SUNSET FM', notes: [261.6, 329.6, 392, 523.3, 392, 329.6],
    tempo: 0.34, type: 'triangle',
  },
  {
    key: 'pulse', label: 'NEON PULSE', notes: [220, 220, 277.2, 329.6, 440, 329.6],
    tempo: 0.22, type: 'square',
  },
  {
    key: 'docks', label: 'DOCKS BLUES', notes: [196, 233.1, 293.7, 349.2, 293.7, 233.1],
    tempo: 0.48, type: 'sine',
  },
];

const OSC_TYPES = new Set(['sine', 'square', 'triangle', 'sawtooth']);
const MIN_GAIN = 0.0001;

const finite = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const inRange = (value, fallback, lo, hi) => Math.max(lo, Math.min(hi, finite(value, fallback)));

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.siren = null;
    this.sirenGain = null;
    this.sirenPan = null;
    this.rotor = null;
    this.rotorGain = null;
    this.rain = null;
    this.rainGain = null;
    this.skidGain = null;
    this.skidFilter = null;
    this.ambientGain = null;
    this.radioGain = null;
    this.radioIndex = 0;
    this.radioTime = 0;
    this.radioStep = 0;
    this.hornCooldown = 0;
    this.nextNote = 0;
    this.step = 0;
    // Phase 7: persisted sound preferences. The master gain is the single
    // mute point; every synth voice (including radio notes) feeds it.
    this.enabled = true;
    this.volume = 0.55;
    this._graphBuilt = false;
    this._unlocked = false;
    this._lastTime = 0;
  }

  // Resuming a suspended context outside a user gesture returns a rejected
  // promise on some WebViews. Never let that become an unhandled rejection.
  _resume() {
    if (!this.ctx || this.ctx.state !== 'suspended' || typeof this.ctx.resume !== 'function') return;
    try {
      const pending = this.ctx.resume();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_) {
      /* autoplay refused — stay silent until the next real gesture */
    }
  }

  // Mute without tearing down the context: gain goes to zero immediately and
  // no new voices are allocated while disabled. Re-enabling restores volume.
  setEnabled(on) {
    const next = !!on;
    const wasEnabled = this.enabled;
    this.enabled = next;
    if (this.master) {
      const value = next ? this.volume : 0;
      if (typeof this.master.gain.setValueAtTime === 'function') {
        this.master.gain.setValueAtTime(value, this.ctx ? this.ctx.currentTime : 0);
      } else {
        this.master.gain.value = value;
      }
    }
    if (!next) return;
    this._resume();
    if (wasEnabled === next && this._graphBuilt) return;
    // Deferred graph creation keeps a muted session oscillator-free.
    if (this.ctx) this._ensureGraph();
    if (this.radioGain) this.radioGain.gain.value = this.radioIndex === 0 ? 0 : 0.7;
  }

  setVolume(v) {
    const n = Number(v);
    const volume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : this.volume;
    this.volume = volume;
    if (this.master && this.enabled) {
      if (typeof this.master.gain.setValueAtTime === 'function') {
        this.master.gain.setValueAtTime(volume, this.ctx ? this.ctx.currentTime : 0);
      } else {
        this.master.gain.value = volume;
      }
    }
    return volume;
  }

  get radioStation() {
    return RADIO_STATIONS[this.radioIndex] || RADIO_STATIONS[0];
  }

  radioLabel() {
    return `♪ ${this.radioStation.label}`;
  }

  // Accepts an index (including negative/overflowing ones) or a station key.
  setRadio(index) {
    let next = this.radioIndex;
    if (typeof index === 'string') {
      const key = index.toLowerCase();
      const found = RADIO_STATIONS.findIndex((s) => s.key === key || s.label.toLowerCase() === key);
      if (found >= 0) next = found;
    } else {
      const n = Number(index);
      if (Number.isFinite(n)) next = Math.trunc(n);
    }
    next = ((next % RADIO_STATIONS.length) + RADIO_STATIONS.length) % RADIO_STATIONS.length;
    this.radioIndex = next;
    this.radioStep = 0;
    this.radioTime = 0;
    if (this.radioGain && this.ctx) {
      const value = next === 0 ? 0 : 0.7;
      if (typeof this.radioGain.gain.setTargetAtTime === 'function') {
        this.radioGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.12);
      } else {
        this.radioGain.gain.value = value;
      }
    }
    return this.radioStation;
  }

  radioNext(delta = 1) {
    const n = finite(delta, 1);
    return this.setRadio(this.radioIndex + Math.trunc(n));
  }

  radioToggle() {
    return this.setRadio(this.radioIndex === 0 ? 1 : 0);
  }

  radioNote(time) {
    // This path used to bypass the enabled flag; mute must be absolute.
    if (!this.enabled) return false;
    const station = this.radioStation;
    if (!station.notes.length || !this.radioGain || !this.ctx) return false;
    const at = inRange(time, this.ctx.currentTime, 0, this.ctx.currentTime + 3600);
    const freq = inRange(station.notes[this.radioStep % station.notes.length], 261.6, 20, 12000);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = OSC_TYPES.has(station.type) ? station.type : 'sine';
    o.frequency.value = freq;
    const dur = inRange(station.tempo, 0.3, 0.05, 2) * 0.9;
    g.gain.setValueAtTime(MIN_GAIN, at);
    g.gain.linearRampToValueAtTime(0.06, at + 0.02);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, at + dur);
    o.connect(g).connect(this.radioGain);
    o.start(at);
    o.stop(at + dur + 0.02);
    this.radioStep++;
    return true;
  }

  // Only call this from a real user gesture (main.js binds pointerdown/keydown
  // once). No context or persistent voice is created at module load.
  unlock() {
    if (this.ctx) {
      this._resume();
      if (this.enabled) this._ensureGraph();
      return;
    }
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (_) {
      return; // audio is optional; a WebView may refuse a second context
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.ctx.destination);
    this._unlocked = true;
    this._resume(); // the gesture that unlocked us may have created a suspended ctx
    if (this.enabled) this._ensureGraph();
  }

  // Built once, lazily: a sound-off session never allocates oscillators,
  // buffers or persistent voices at all.
  _ensureGraph() {
    if (this._graphBuilt || !this.ctx || !this.master) return;
    this._graphBuilt = true;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    osc.connect(filter).connect(g).connect(this.master);
    osc.start();
    this.engine = osc;
    this.engineFilter = filter;
    this.engineGain = g;

    const s = this.ctx.createOscillator();
    s.type = 'square';
    const sg = this.ctx.createGain();
    sg.gain.value = 0;
    s.connect(sg);
    if (this.ctx.createStereoPanner) {
      this.sirenPan = this.ctx.createStereoPanner();
      sg.connect(this.sirenPan).connect(this.master);
    } else {
      sg.connect(this.master);
    }
    s.start();
    this.siren = s;
    this.sirenGain = sg;

    const r = this.ctx.createOscillator();
    r.type = 'sawtooth';
    r.frequency.value = 64;
    const rf = this.ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 170;
    const rg = this.ctx.createGain();
    rg.gain.value = 0;
    r.connect(rf).connect(rg).connect(this.master);
    r.start();
    this.rotor = r;
    this.rotorGain = rg;

    // Looping filtered noise for rain. Generated once, gain driven by weather.
    const sampleRate = inRange(this.ctx.sampleRate, 44100, 8000, 96000);
    const frames = Math.max(1, Math.floor(sampleRate * 2));
    const buffer = this.ctx.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < frames; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.14) * 0.96;
      data[i] = brown;
    }
    const rain = this.ctx.createBufferSource();
    rain.buffer = buffer;
    rain.loop = true;
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'lowpass';
    rainFilter.frequency.value = 2400;
    const rgain = this.ctx.createGain();
    rgain.gain.value = 0;
    rain.connect(rainFilter).connect(rgain).connect(this.master);
    rain.start();
    this.rain = rain;
    this.rainGain = rgain;

    // Tyre scrub and city wind reuse the same noise buffer — one allocation.
    const skid = this.ctx.createBufferSource();
    skid.buffer = buffer;
    skid.loop = true;
    const skidFilter = this.ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = 1800;
    const skidGain = this.ctx.createGain();
    skidGain.gain.value = 0;
    skid.connect(skidFilter).connect(skidGain).connect(this.master);
    skid.start();
    this.skidGain = skidGain;
    this.skidFilter = skidFilter;

    const ambient = this.ctx.createBufferSource();
    ambient.buffer = buffer;
    ambient.loop = true;
    const ambientFilter = this.ctx.createBiquadFilter();
    ambientFilter.type = 'lowpass';
    ambientFilter.frequency.value = 420;
    const ambientGain = this.ctx.createGain();
    ambientGain.gain.value = 0;
    ambient.connect(ambientFilter).connect(ambientGain).connect(this.master);
    ambient.start();
    this.ambientGain = ambientGain;

    const radioGain = this.ctx.createGain();
    radioGain.gain.value = this.radioIndex === 0 ? 0 : 0.7;
    radioGain.connect(this.master);
    this.radioGain = radioGain;
  }

  horn() {
    if (!this.ctx || !this.enabled || this.hornCooldown > 0) return;
    this.hornCooldown = 0.6;
    const now = this.ctx.currentTime;
    for (const freq of [392, 494]) {
      const o = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      gain.gain.setValueAtTime(MIN_GAIN, now);
      gain.gain.linearRampToValueAtTime(0.055, now + 0.025);
      gain.gain.setValueAtTime(0.055, now + 0.22);
      gain.gain.exponentialRampToValueAtTime(MIN_GAIN, now + 0.36);
      o.connect(gain).connect(this.master);
      o.start(now);
      o.stop(now + 0.38);
    }
  }

  // One scheduling path for every one-shot, including every shot variant.
  // Non-finite values are rejected before they reach Web Audio automation.
  blip(freq = 660, dur = 0.14, type = 'sine', vol = 0.12) {
    if (!this.ctx || !this.enabled || !this.master) return false;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = OSC_TYPES.has(type) ? type : 'sine';
    o.frequency.value = inRange(freq, 660, 20, 12000);
    const length = inRange(dur, 0.14, 0.01, 2);
    const level = Math.max(MIN_GAIN, inRange(vol, 0.12, 0, 0.5));
    const at = finite(this.ctx.currentTime, 0) + 0.001;
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, at + length);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + length + 0.02);
    return true;
  }

  // Phase 4 combat cues: short synthesised transients built from the same
  // oscillator/blip path as the rest of the game. No samples, no assets.
  shot(id = 'pistol') {
    if (id === 'shotgun') {
      this.blip(96, 0.19, 'sawtooth', 0.2);
      this.blip(154, 0.1, 'square', 0.075);
    } else if (id === 'smg') {
      this.blip(248, 0.055, 'square', 0.11);
      this.blip(124, 0.045, 'sawtooth', 0.045);
    } else {
      this.blip(186, 0.09, 'square', 0.14);
      this.blip(318, 0.045, 'triangle', 0.05);
    }
  }

  reload() {
    this.blip(720, 0.035, 'square', 0.05);
    this.blip(510, 0.045, 'triangle', 0.045);
  }

  hit() {
    this.blip(142, 0.06, 'triangle', 0.075);
  }

  update(dt, frame = {}) {
    if (!this.ctx || !this.enabled || !this._graphBuilt || !this.master) return;
    const now = finite(this.ctx.currentTime, 0);
    const step = inRange(dt, 0, 0, 1);
    this.hornCooldown = Math.max(0, this.hornCooldown - step);

    const speed = inRange(frame.speed, 0, 0, 600);
    const throttle = inRange(frame.throttle, 0, 0, 1);
    const wanted = inRange(frame.wanted, 0, 0, 5);
    const driving = !!frame.driving;
    const siren = inRange(frame.siren, 0, 0, 1);
    const sirenPan = inRange(frame.sirenPan, 0, -1, 1);
    const heli = inRange(frame.heli, 0, 0, 1);
    const rain = inRange(frame.rain, 0, 0, 1);
    const skid = inRange(frame.skid, 0, 0, 1);
    const time = finite(frame.time, this._lastTime);
    // Corrupt or stale deadlines must never leak into note scheduling.
    if (!Number.isFinite(this.radioTime)) this.radioTime = 0;
    if (!Number.isFinite(this.nextNote)) this.nextNote = 0;
    // A slot load can move game time backwards; drop stale note deadlines.
    if (time < this._lastTime - 0.5) {
      this.radioTime = 0;
      this.nextNote = 0;
    }
    this._lastTime = time;

    if (this.rainGain) this.rainGain.gain.setTargetAtTime(rain * 0.05, now, 0.4);
    if (this.skidGain) this.skidGain.gain.setTargetAtTime(skid * 0.055, now, 0.08);
    if (this.skidFilter) this.skidFilter.frequency.setTargetAtTime(1300 + speed * 60, now, 0.1);
    if (this.ambientGain) {
      this.ambientGain.gain.setTargetAtTime((driving ? 0.008 : 0.004) + Math.min(0.016, speed * 0.0005), now, 0.4);
    }
    if (this.radioGain && this.radioIndex > 0 && time > this.radioTime) {
      if (this.radioNote(now)) this.radioTime = time + this.radioStation.tempo;
    }
    const targetFreq = 45 + speed * 6.5 + throttle * 22;
    this.engine.frequency.setTargetAtTime(targetFreq, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(500 + speed * 45, now, 0.1);
    this.engineGain.gain.setTargetAtTime(driving ? 0.035 + throttle * 0.045 : 0, now, 0.12);

    if (wanted > 0 && siren > 0.01) {
      const wail = 0.5 + 0.5 * Math.sin(now * 5.2);
      this.siren.frequency.setTargetAtTime(590 + wail * 470, now, 0.035);
      const volume = (0.014 + 0.09 * siren) * Math.min(1, 0.55 + wanted * 0.15);
      this.sirenGain.gain.setTargetAtTime(volume, now, 0.16);
      if (this.sirenPan) this.sirenPan.pan.setTargetAtTime(sirenPan, now, 0.12);
    } else {
      this.sirenGain.gain.setTargetAtTime(0, now, 0.3);
    }

    if (this.rotor) {
      this.rotor.frequency.setTargetAtTime(58 + heli * 9, now, 0.2);
      this.rotorGain.gain.setTargetAtTime(heli > 0 ? 0.02 * heli : 0, now, 0.25);
    }

    if (time > this.nextNote) {
      this.nextNote = time + 0.42;
      const scale = [220, 261.6, 293.7, 329.6, 392, 440];
      this.blip(scale[this.step % scale.length] * (wanted > 2 ? 2 : 1), 0.3, 'triangle', 0.018);
      this.step++;
    }
  }
}
