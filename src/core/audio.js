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

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.engineGain = null;
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
    this.enabled = true;
  }

  get radioStation() {
    return RADIO_STATIONS[this.radioIndex] || RADIO_STATIONS[0];
  }

  radioLabel() {
    return `♪ ${this.radioStation.label}`;
  }

  setRadio(index) {
    const next = ((Math.round(Number(index) || 0) % RADIO_STATIONS.length) + RADIO_STATIONS.length) % RADIO_STATIONS.length;
    this.radioIndex = next;
    this.radioStep = 0;
    this.radioTime = 0;
    if (this.radioGain && this.ctx) {
      this.radioGain.gain.setTargetAtTime(next === 0 ? 0 : 0.7, this.ctx.currentTime, 0.12);
    }
    return this.radioStation;
  }

  radioNext(delta = 1) {
    return this.setRadio(this.radioIndex + delta);
  }

  radioToggle() {
    return this.setRadio(this.radioIndex === 0 ? 1 : 0);
  }

  radioNote(time) {
    const station = this.radioStation;
    if (!station.notes.length || !this.radioGain || !this.ctx) return false;
    const freq = station.notes[this.radioStep % station.notes.length];
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = station.type;
    o.frequency.value = freq;
    const dur = station.tempo * 0.9;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.06, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(this.radioGain);
    o.start(time);
    o.stop(time + dur + 0.02);
    this.radioStep++;
    return true;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

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
    const frames = Math.floor(this.ctx.sampleRate * 2);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
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
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.055, now + 0.025);
      gain.gain.setValueAtTime(0.055, now + 0.22);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.38);
    }
  }

  blip(freq = 660, dur = 0.14, type = 'sine', vol = 0.12) {
    if (!this.ctx || !this.enabled) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + dur + 0.02);
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

  update(dt, { speed = 0, throttle = 0, wanted = 0, driving = false, time = 0, siren = 0, sirenPan = 0, heli = 0, rain = 0, skid = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    this.hornCooldown = Math.max(0, this.hornCooldown - dt);
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(rain * 0.05, now, 0.4);
    if (this.skidGain) this.skidGain.gain.setTargetAtTime(Math.min(1, Math.max(0, skid)) * 0.055, now, 0.08);
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
