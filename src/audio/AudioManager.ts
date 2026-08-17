import { AssetLoader } from '../core/AssetLoader';
import { clamp } from '../core/MathUtils';

interface EngineNodes {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

const SOUND_FILES = {
  engine: 'assets/sounds/engine.mp3',
  brake: 'assets/sounds/brake.mp3',
  tire: 'assets/sounds/tire.mp3',
  collision: 'assets/sounds/collision.mp3',
  nitro: 'assets/sounds/nitro.mp3',
  music: 'assets/sounds/music.mp3',
} as const;

type SoundKey = keyof typeof SOUND_FILES;

/**
 * Web Audio sound engine.
 *
 * Everything is synthesised by default — engine note, tyre scrub, wind, nitro
 * and a small music bed — so the game ships with no audio files at all. Drop
 * real samples into /public/assets/sounds (engine.mp3, brake.mp3, tire.mp3,
 * collision.mp3, nitro.mp3, music.mp3) and they take over automatically.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private engine: EngineNodes | null = null;
  private engineSample: AudioBufferSourceNode | null = null;
  private engineSampleGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private tyreGain: GainNode | null = null;
  private tyreFilter: BiquadFilterNode | null = null;

  private windGain: GainNode | null = null;
  private nitroGain: GainNode | null = null;
  private nitroFilter: BiquadFilterNode | null = null;

  private musicTimer = 0;
  private musicStep = 0;
  private musicSource: AudioBufferSourceNode | null = null;

  private readonly buffers = new Map<SoundKey, AudioBuffer>();
  private readonly loader = new AssetLoader();

  private started = false;
  private startPromise: Promise<void> | null = null;
  private volume = 0.7;
  musicEnabled = true;

  get isRunning(): boolean {
    return this.started;
  }

  /**
   * Must be called from a user gesture (browsers block audio otherwise).
   * Single-flight: several UI paths call this, and creating two AudioContexts
   * would leave half the graph wired to the wrong one.
   */
  start(): Promise<void> {
    if (this.started) return this.ctx ? this.ctx.resume() : Promise.resolve();
    if (!this.startPromise) {
      this.startPromise = this.createContext().catch((err) => {
        console.warn('[Audio] could not start:', err);
        this.startPromise = null;
      });
    }
    return this.startPromise;
  }

  private async createContext(): Promise<void> {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;
    await ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicEnabled ? 0.34 : 0;
    this.musicBus.connect(this.master);

    this.noiseBuffer = this.createNoiseBuffer(ctx);
    this.started = true;

    this.buildEngine();
    this.buildTyres();
    this.buildWind();

    // Optional real samples — silently ignored when the folder is empty.
    void this.loadOptionalSamples();
  }

  private async loadOptionalSamples(): Promise<void> {
    if (!this.ctx) return;
    const entries = Object.entries(SOUND_FILES) as Array<[SoundKey, string]>;
    await Promise.all(
      entries.map(async ([key, url]) => {
        const buf = await this.loader.loadAudioBuffer(this.ctx!, url);
        if (buf) this.buffers.set(key, buf);
      }),
    );
    if (this.buffers.has('engine')) this.swapToEngineSample();
    if (this.buffers.has('music') && this.musicEnabled) this.playMusicSample();
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      // Slightly brown-ish noise reads more like tyres and wind than white.
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  /* ---------------- synthesised engine ---------------- */

  private buildEngine(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 3.5;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.detune.value = 12;
    const sub = ctx.createOscillator();
    sub.type = 'sine';

    const g1 = ctx.createGain();
    g1.gain.value = 0.5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.22;
    const g3 = ctx.createGain();
    g3.gain.value = 0.5;

    osc1.connect(g1).connect(filter);
    osc2.connect(g2).connect(filter);
    sub.connect(g3).connect(filter);
    filter.connect(gain).connect(this.sfxBus);

    osc1.start();
    osc2.start();
    sub.start();

    this.engine = { osc1, osc2, sub, filter, gain };
  }

  private swapToEngineSample(): void {
    const ctx = this.ctx;
    const buf = this.buffers.get('engine');
    if (!ctx || !buf || !this.sfxBus) return;
    if (this.engine) this.engine.gain.gain.value = 0.0001;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(gain).connect(this.sfxBus);
    src.start();
    this.engineSample = src;
    this.engineSampleGain = gain;
  }

  private buildTyres(): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer || !this.sfxBus) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 6;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    // The graph itself keeps the looping source alive once it is connected.
    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start();

    this.tyreGain = gain;
    this.tyreFilter = filter;
  }

  private buildWind(): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer || !this.sfxBus) return;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start();
    this.windGain = gain;

    // Nitro layer: a bright hiss that opens up while boosting.
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = this.noiseBuffer;
    nsrc.loop = true;
    const nfilter = ctx.createBiquadFilter();
    nfilter.type = 'bandpass';
    nfilter.frequency.value = 2600;
    nfilter.Q.value = 1.2;
    const ngain = ctx.createGain();
    ngain.gain.value = 0.0001;
    nsrc.connect(nfilter).connect(ngain).connect(this.sfxBus);
    nsrc.start();
    this.nitroGain = ngain;
    this.nitroFilter = nfilter;
  }

  /* ---------------- per-frame ---------------- */

  update(
    dt: number,
    params: {
      rpm: number;
      throttle: number;
      speed: number;
      maxSpeed: number;
      drift: number;
      offRoad: boolean;
      nitro: boolean;
      braking: boolean;
    },
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    const t = ctx.currentTime;
    // Web Audio throws on non-finite values, which would take the game loop
    // down with it — so every incoming number is sanitised here.
    const rpmT = clamp(finite(params.rpm) / 7500, 0, 1);
    const load = clamp(finite(params.throttle), 0, 1);
    const speed = finite(params.speed);
    const maxSpeed = Math.max(1, finite(params.maxSpeed, 80));
    const drift = clamp(finite(params.drift), 0, 1);

    if (this.engineSample && this.engineSampleGain) {
      this.engineSample.playbackRate.setTargetAtTime(0.55 + rpmT * 1.9, t, 0.08);
      this.engineSampleGain.gain.setTargetAtTime(0.22 + load * 0.3, t, 0.1);
    } else if (this.engine) {
      const base = 42 + rpmT * 210;
      this.engine.osc1.frequency.setTargetAtTime(base, t, 0.05);
      this.engine.osc2.frequency.setTargetAtTime(base * 1.5, t, 0.05);
      this.engine.sub.frequency.setTargetAtTime(base * 0.5, t, 0.05);
      this.engine.filter.frequency.setTargetAtTime(
        420 + rpmT * 2600 + load * 900 + (params.nitro ? 900 : 0),
        t,
        0.07,
      );
      const vol = 0.045 + rpmT * 0.14 + load * 0.07;
      this.engine.gain.gain.setTargetAtTime(vol, t, 0.06);
    }

    if (this.tyreGain && this.tyreFilter) {
      const squeal = drift;
      const gravel = params.offRoad ? clamp(speed / 30, 0, 1) * 0.5 : 0;
      const brakeHiss = params.braking && speed > 6 ? 0.16 : 0;
      this.tyreGain.gain.setTargetAtTime(squeal * 0.22 + gravel * 0.12 + brakeHiss, t, 0.05);
      this.tyreFilter.frequency.setTargetAtTime(
        params.offRoad ? 700 : 1500 + squeal * 1600,
        t,
        0.08,
      );
      this.tyreFilter.Q.value = params.offRoad ? 1.2 : 6;
    }

    if (this.windGain) {
      const speedT = clamp(speed / maxSpeed, 0, 1);
      this.windGain.gain.setTargetAtTime(speedT * speedT * 0.20, t, 0.15);
    }

    if (this.nitroGain && this.nitroFilter) {
      this.nitroGain.gain.setTargetAtTime(params.nitro ? 0.16 : 0.0001, t, 0.08);
      this.nitroFilter.frequency.setTargetAtTime(params.nitro ? 3200 : 2000, t, 0.2);
    }

    if (this.musicEnabled && !this.buffers.has('music')) this.updateSynthMusic(dt);
  }

  /* ---------------- one-shots ---------------- */

  playCollision(impact: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const sample = this.buffers.get('collision');
    const strength = clamp(finite(impact) / 22, 0.15, 1);

    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      const g = ctx.createGain();
      g.gain.value = strength;
      src.connect(g).connect(this.sfxBus);
      src.start();
      return;
    }

    const t = ctx.currentTime;
    // Metallic crunch: noise burst + a falling body thud.
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900 + Math.random() * 900;
      filter.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(strength * 0.7, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      src.connect(filter).connect(g).connect(this.sfxBus);
      src.start(t);
      src.stop(t + 0.4);
    }
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.28);
    const og = ctx.createGain();
    og.gain.setValueAtTime(strength * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(og).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  playNitroBurst(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const sample = this.buffers.get('nitro');
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      const g = ctx.createGain();
      g.gain.value = 0.7;
      src.connect(g).connect(this.sfxBus);
      src.start();
      return;
    }
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.42);
  }

  /** UI blip / checkpoint chime. */
  playBeep(freq = 880, duration = 0.12, gainValue = 0.14): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainValue, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /* ---------------- music ---------------- */

  private playMusicSample(): void {
    const ctx = this.ctx;
    const buf = this.buffers.get('music');
    if (!ctx || !buf || !this.musicBus) return;
    this.musicSource?.stop();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicBus);
    src.start();
    this.musicSource = src;
  }

  /** A simple minor-key pulse used when no music file is supplied. */
  private updateSynthMusic(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 0.5;

    const scale = [55, 65.41, 73.42, 82.41, 98, 110];
    const step = this.musicStep++;
    const root = scale[step % scale.length];
    const t = ctx.currentTime;

    const voice = (freq: number, dur: number, gainValue: number, type: OscillatorType) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gainValue, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.musicBus!);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    };

    voice(root, 1.1, 0.16, 'sawtooth');
    voice(root * 2, 0.9, 0.06, 'triangle');
    if (step % 4 === 0) voice(root * 3, 0.4, 0.05, 'square');
  }

  /* ---------------- settings ---------------- */

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    if (this.musicBus) this.musicBus.gain.value = on ? 0.34 : 0;
    if (on && this.buffers.has('music') && !this.musicSource) this.playMusicSample();
  }

  setEngineMuted(muted: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.engine) this.engine.gain.gain.setTargetAtTime(muted ? 0.0001 : 0.06, t, 0.1);
    if (this.engineSampleGain) this.engineSampleGain.gain.setTargetAtTime(muted ? 0.0001 : 0.3, t, 0.1);
    if (this.tyreGain) this.tyreGain.gain.setTargetAtTime(0.0001, t, 0.1);
    if (this.windGain) this.windGain.gain.setTargetAtTime(0.0001, t, 0.1);
    if (this.nitroGain) this.nitroGain.gain.setTargetAtTime(0.0001, t, 0.1);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }
}

/** Web Audio rejects NaN/Infinity outright, so clean every value first. */
function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}
