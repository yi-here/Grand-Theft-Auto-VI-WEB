// All sound is synthesized with WebAudio — no audio files. Engines are
// oscillators pitch-mapped to speed; gunshots are filtered noise bursts;
// ambience is looped filtered noise whose mix follows the shoreline.

import { CITY, clamp } from '@vice/shared';

interface EngineNode {
  osc: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private engines = new Map<string, EngineNode>();
  private waves: { gain: GainNode } | null = null;
  private stepTimer = 0;
  muted = false;

  /** must be called from a user gesture (Join click) */
  init(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // pinkish noise via leaky integrator
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[i] = last * 3;
    }
    this.noiseBuf = buf;

    // waves: looped noise through a slow-swelling lowpass
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(lp.frequency);
    src.connect(lp).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    this.waves = { gain };
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  private panFor(dx: number, dz: number, camYaw: number): number {
    // project into camera space: positive = right of view
    const rightX = -Math.cos(camYaw);
    const rightZ = Math.sin(camYaw);
    const d = Math.hypot(dx, dz) || 1;
    return clamp((dx * rightX + dz * rightZ) / d, -1, 1) * 0.7;
  }

  private distGain(dist: number, ref: number): number {
    return clamp(ref / (ref + dist * dist * 0.015), 0, 1);
  }

  gunshot(kind: string, dist = 0, dx = 0, dz = 0, camYaw = 0): void {
    if (!this.ctx || !this.noiseBuf || !this.master) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = kind === 'smg' ? 1.6 : 1.1;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = kind === 'smg' ? 1500 : dist > 40 ? 500 : 900;
    bp.Q.value = 0.7;
    const gain = ctx.createGain();
    const vol = (kind === 'fist' ? 0.25 : 0.85) * this.distGain(dist, 60);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (kind === 'smg' ? 0.08 : 0.16));
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.panFor(dx, dz, camYaw);
    src.connect(bp).connect(gain).connect(pan).connect(this.master);
    src.start(0, Math.random() * 0.4, 0.25);
  }

  punch(): void {
    this.thump(180, 0.12, 0.5);
  }

  crash(intensity: number): void {
    this.thump(120, 0.28, clamp(0.3 + intensity * 0.7, 0, 1));
  }

  private thump(freq: number, dur: number, vol: number): void {
    if (!this.ctx || !this.noiseBuf || !this.master) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = freq * 2.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(lp).connect(gain).connect(this.master);
    src.start(0, Math.random() * 0.3, dur);
    // descending body
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, ctx.currentTime + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.7, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(og).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  hitFeedback(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  }

  footsteps(dt: number, speed: number, grounded: boolean): void {
    if (!this.ctx || !this.noiseBuf || !this.master || !grounded || speed < 1) {
      return;
    }
    this.stepTimer -= dt * speed;
    if (this.stepTimer > 0) return;
    this.stepTimer = 3.4;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    src.connect(hp).connect(gain).connect(this.master);
    src.start(0, Math.random() * 0.5, 0.05);
  }

  /** engines: call every frame per audible vehicle; unseen ids fade out */
  updateEngine(id: string, speedRatio: number, throttle: number, dist: number, dx: number, dz: number, camYaw: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    let e = this.engines.get(id);
    if (!e) {
      if (this.engines.size >= 5) return;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      const mix = ctx.createGain();
      mix.gain.value = 1;
      osc.connect(mix);
      sub.connect(mix);
      mix.connect(filter).connect(gain).connect(pan).connect(this.master);
      osc.start();
      sub.start();
      e = { osc, sub, filter, gain, pan };
      this.engines.set(id, e);
    }
    const freq = 52 + speedRatio * 165 + Math.sin(performance.now() / 90) * 3;
    e.osc.frequency.value = freq;
    e.sub.frequency.value = freq / 2;
    e.filter.frequency.value = 300 + throttle * 500 + speedRatio * 700;
    e.gain.gain.value = 0.09 * this.distGain(dist, 40) * (0.45 + speedRatio + throttle * 0.3);
    e.pan.pan.value = this.panFor(dx, dz, camYaw);
  }

  stopEngine(id: string): void {
    const e = this.engines.get(id);
    if (e) {
      try {
        e.osc.stop();
        e.sub.stop();
      } catch { /* already stopped */ }
      this.engines.delete(id);
    }
  }

  activeEngineIds(): string[] {
    return [...this.engines.keys()];
  }

  /** ambient wave volume by distance to the shoreline */
  updateAmbience(px: number): void {
    if (this.waves) {
      const dist = Math.max(0, px - CITY.SAND_END);
      this.waves.gain.gain.value = 0.05 + 0.11 * this.distGain(dist, 30);
    }
  }
}
