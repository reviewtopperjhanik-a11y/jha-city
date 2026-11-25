// Everything is synthesised at runtime: no audio files, no licence issues.
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
    this.hornCooldown = 0;
    this.nextNote = 0;
    this.step = 0;
    this.enabled = true;
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

  update(dt, { speed = 0, throttle = 0, wanted = 0, driving = false, time = 0, siren = 0, sirenPan = 0, heli = 0, rain = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    this.hornCooldown = Math.max(0, this.hornCooldown - dt);
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(rain * 0.05, now, 0.4);
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
