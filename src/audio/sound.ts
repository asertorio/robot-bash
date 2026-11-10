import type { SoundLevel } from '../data/settings';
import type { Match } from '../sim/match';
import type { Robot } from '../sim/robot';

/**
 * Fight sound, synthesised with Web Audio: no samples to download, and every
 * sound comes from what the simulation is doing.
 *
 * - Drive motors whine with the current they draw and the speed they turn.
 * - Spinners, drums and discs howl at a pitch that follows their rpm, so you
 *   hear one spin up, and hear it bog down when it hits.
 * - Impacts clang: a burst of filtered noise plus a few inharmonic partials
 *   (the way struck plate rings), louder and lower the more energy the hit
 *   dissipated (the same impact energies the damage model uses).
 * - Pneumatics hiss when gas is spent; chainsaws buzz; flamethrowers and the
 *   flame pit roar.
 * - The crowd murmurs, and roars after big hits and knock-outs.
 * - Countdown beeps, the activate horn, the end-of-fight buzzer and the pit
 *   klaxon.
 *
 * Browsers only allow audio after a click or key press, so `unlock()` is
 * called from the first one. Everything here reads the match; nothing writes it.
 */
export const SOUND = {
  /** Master volume for 'quiet' and 'loud'. */
  volume: { off: 0, quiet: 0.35, loud: 0.8 },
  /** At most this many impact sounds start per second (a grind is many contacts). */
  impactRate: 14,
  /** Impacts below this (J) are silent. */
  impactMin: 40,
  /** Drive whine: gain per amp drawn, capped. */
  drivePerAmp: 0.0009,
  /** Behind the menus (the attract fight) everything is this much quieter. */
  attract: 0.25,
};


interface RobotVoice {
  robot: Robot;
  drive: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode };
  rotors: Array<{ osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }>;
  buzz: { osc: OscillatorNode; gain: GainNode } | null;
  roar: { src: AudioBufferSourceNode; gain: GainNode } | null;
  pan: StereoPannerNode;
  lastGas: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices: RobotVoice[] = [];
  private match: Match | null = null;
  private crowd: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private pitFire: { gain: GainNode } | null = null;
  /** 0..1: how excited the crowd is. Rises with big hits, decays. */
  private excitement = 0;
  private impactBudget = 0;
  private lastTime = 0;
  private lastPhase = '';
  private lastPit = false;
  private lastFlames = false;
  private lastOut = 0;
  private level: SoundLevel = 'loud';
  private background = false;

  /** Call from a user gesture: browsers keep audio off until then. */
  unlock() {
    if (this.level === 'off') return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      // A gentle limiter so a pile-up of clangs doesn't clip.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      this.noise = this.makeNoise();
      this.applyVolume();
      if (this.match) this.setMatch(this.match, this.background);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setLevel(level: SoundLevel) {
    this.level = level;
    // (The context itself only starts from a gesture: see unlock.)
    if (level !== 'off' && this.ctx?.state === 'suspended') void this.ctx.resume();
    this.applyVolume();
  }

  private paused = false;

  /** Paused: everything fades out (and back in on resume). */
  pause(on: boolean) {
    this.paused = on;
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.master || !this.ctx) return;
    const v = this.paused ? 0 : SOUND.volume[this.level] * (this.background ? SOUND.attract : 1);
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** A new fight (or test bay): one set of voices per robot. `background` = behind the menus. */
  setMatch(m: Match | null, background = false) {
    this.stopVoices();
    this.match = m;
    this.background = background;
    this.paused = false;
    this.applyVolume();
    const ctx = this.ctx;
    if (!ctx || !m || !this.master) return;
    this.lastTime = m.time;
    this.lastPhase = m.phase;
    this.lastPit = m.arena.pitOpen;
    this.lastFlames = m.arena.flamesOn;
    this.lastOut = 0;
    this.excitement = 0;
    for (const r of m.robots) this.voices.push(this.makeVoice(r));
    if (!this.crowd) this.makeCrowd();
  }

  /** A big hit between competitors: a boom and a roar from the crowd. */
  bigHit(energy: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const k = Math.min(1, energy / 6000);
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 + 0.5 * k, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.75);
    this.excitement = Math.min(1, this.excitement + 0.35 + 0.4 * k);
  }

  /** A short tick for menu buttons. */
  click() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.tone(1400, 0.035, 0.08, 'square');
  }

  /** Per frame, before the view consumes the match's impacts. */
  update(m: Match, dt: number, listener: { x: number; z: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.master || m !== this.match || this.level === 'off') return;
    const t = ctx.currentTime;
    const ease = 0.04;

    for (const v of this.voices) {
      const r = v.robot;
      const p = r.position;
      // Quieter further from the camera, panned left–right by where it is.
      const dist = Math.hypot(p.x - listener.x, p.z - listener.z);
      const near = 1 / (1 + dist * 0.12);
      v.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, (p.x - listener.x) / 6)), t, 0.1);
      const gone = p.y < -0.5;

      // Drive: pitch from chassis speed, loudness from current.
      const lv = r.chassis.linvel();
      const speed = Math.hypot(lv.x, lv.z);
      const amps = gone ? 0 : r.current;
      const driveGain = Math.min(0.09, amps * SOUND.drivePerAmp) * near;
      v.drive.gain.gain.setTargetAtTime(driveGain, t, ease);
      const f = 70 + speed * 95 + Math.min(amps, 300) * 0.35;
      v.drive.osc.frequency.setTargetAtTime(f, t, ease);
      v.drive.osc2.frequency.setTargetAtTime(f * 1.5, t, ease);
      v.drive.filter.frequency.setTargetAtTime(500 + amps * 6, t, ease);

      // Rotors: pitch follows rpm (two teeth/blades a turn is typical).
      r.rotors().forEach((rot, k) => {
        const rv = v.rotors[k];
        if (!rv) return;
        const hz = Math.max(20, Math.min(1500, (rot.rpm / 60) * 2));
        const on = rot.rpm > 120 && !gone;
        rv.osc.frequency.setTargetAtTime(hz, t, ease);
        rv.sub.frequency.setTargetAtTime(hz / 2, t, ease);
        rv.filter.frequency.setTargetAtTime(300 + hz * 2.2, t, ease);
        rv.gain.gain.setTargetAtTime(on ? Math.min(0.11, 0.02 + rot.rpm / 30000) * near : 0, t, ease);
      });

      // Chainsaws.
      if (v.buzz) {
        const running = r.chains.some((c) => c.on);
        v.buzz.gain.gain.setTargetAtTime(running && !gone ? 0.05 * near : 0, t, ease);
      }
      // Flamethrowers.
      if (v.roar) v.roar.gain.gain.setTargetAtTime(r.flames.some((fl) => fl.on) && !gone ? 0.28 * near : 0, t, 0.06);

      // Gas spent since last frame: a hiss, louder for a bigger shot.
      const used = v.lastGas - r.gasLeft;
      if (used > 1e-4 && r.gasCapacity > 0) this.hiss(Math.min(1, used / (r.gasCapacity * 0.04)) * near, v.pan);
      v.lastGas = r.gasLeft;
    }

    // Impacts (the view clears this list after drawing sparks).
    this.impactBudget = Math.min(SOUND.impactRate, this.impactBudget + dt * SOUND.impactRate);
    for (const hit of m.impacts) {
      if (hit.energy < SOUND.impactMin || this.impactBudget < 1) continue;
      this.impactBudget -= 1;
      const dist = Math.hypot(hit.point.x - listener.x, hit.point.z - listener.z);
      this.clang(hit.energy, 1 / (1 + dist * 0.1), (hit.point.x - listener.x) / 6);
    }

    // The show: countdown, horn, buzzer, pit klaxon, flame pit, crowd.
    if (m.phase === 'countdown') {
      for (const s of [-3, -2, -1]) if (this.lastTime < s && m.time >= s) this.tone(660, 0.18, 0.25);
    }
    if (this.lastPhase === 'countdown' && m.phase === 'fight') { this.horn(); this.excitement = Math.min(1, this.excitement + 0.5); }
    if (this.lastPhase !== 'over' && m.phase === 'over' && this.lastPhase !== '') { this.buzzer(); this.excitement = 1; }
    if (!this.lastPit && m.arena.pitOpen) this.klaxon();
    this.lastPit = m.arena.pitOpen;
    const outs = m.eliminated.filter(Boolean).length;
    if (outs > this.lastOut) this.excitement = 1;
    this.lastOut = outs;
    if (this.pitFire) this.pitFire.gain.gain.setTargetAtTime(m.arena.flamesOn ? 0.18 : 0, t, m.arena.flamesOn && !this.lastFlames ? 0.02 : 0.2);
    this.lastFlames = m.arena.flamesOn;
    this.lastPhase = m.phase;
    this.lastTime = m.time;

    if (this.crowd) {
      this.excitement *= Math.exp(-dt * 0.35);
      const base = this.background ? 0.02 : 0.045;
      this.crowd.gain.gain.setTargetAtTime(base + this.excitement * 0.22, t, 0.25);
      this.crowd.filter.frequency.setTargetAtTime(700 + this.excitement * 900, t, 0.3);
    }
  }

  // ------------------------------------------------------------- building blocks

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * 1.5);
    return src;
  }

  private makeVoice(r: Robot): RobotVoice {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.connect(this.master!);
    const mk = (type: OscillatorType) => { const o = ctx.createOscillator(); o.type = type; o.start(); return o; };
    // Drive: two saws a fifth apart through a low-pass, like a geared DC motor.
    const dGain = ctx.createGain();
    dGain.gain.value = 0;
    const dFilter = ctx.createBiquadFilter();
    dFilter.type = 'lowpass';
    dFilter.Q.value = 3;
    const osc = mk('sawtooth'), osc2 = mk('sawtooth');
    osc.detune.value = (r.index % 4) * 13;
    osc.connect(dFilter);
    osc2.connect(dFilter);
    dFilter.connect(dGain).connect(pan);
    const rotors = r.rotors().map(() => {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.2;
      const o = mk('sawtooth'), sub = mk('triangle');
      o.connect(f);
      sub.connect(g);
      f.connect(g).connect(pan);
      return { osc: o, sub, gain: g, filter: f };
    });
    let buzz: RobotVoice['buzz'] = null;
    if (r.chains.length) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const o = mk('square');
      o.frequency.value = 118 + r.index * 7;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 400;
      o.connect(f).connect(g).connect(pan);
      buzz = { osc: o, gain: g };
    }
    let roar: RobotVoice['roar'] = null;
    if (r.flames.length) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const src = this.loopNoise();
      src.connect(f).connect(g).connect(pan);
      roar = { src, gain: g };
    }
    return { robot: r, drive: { osc, osc2, gain: dGain, filter: dFilter }, rotors, buzz, roar, pan, lastGas: r.gasLeft };
  }

  private makeCrowd() {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 800;
    f.Q.value = 0.6;
    this.loopNoise().connect(f).connect(g).connect(this.master!);
    this.crowd = { gain: g, filter: f };
    // The flame pit: a low roar while it burns.
    const pg = ctx.createGain();
    pg.gain.value = 0;
    const pf = ctx.createBiquadFilter();
    pf.type = 'lowpass';
    pf.frequency.value = 500;
    this.loopNoise().connect(pf).connect(pg).connect(this.master!);
    this.pitFire = { gain: pg };
  }

  private stopVoices() {
    for (const v of this.voices) {
      for (const o of [v.drive.osc, v.drive.osc2, ...v.rotors.flatMap((r) => [r.osc, r.sub]), v.buzz?.osc, v.roar?.src]) {
        try { o?.stop(); } catch { /* already stopped */ }
      }
      v.pan.disconnect();
    }
    this.voices = [];
  }

  /** Struck plate: noise thump plus three inharmonic partials that ring briefly. */
  private clang(energy: number, near: number, pan: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const k = Math.min(1, Math.log10(energy / SOUND.impactMin) / 2.3);
    const out = ctx.createStereoPanner();
    out.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    out.connect(this.master!);
    const vol = (0.12 + 0.5 * k) * near;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600 - 1900 * k + Math.random() * 400;
    bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08 + 0.18 * k);
    src.connect(bp).connect(ng).connect(out);
    src.start(t, Math.random() * 1.5, 0.4);
    const base = 380 - 220 * k + Math.random() * 120;
    for (const [ratio, amp] of [[1, 0.5], [2.76, 0.3], [5.4, 0.18]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      const ring = 0.12 + 0.45 * k;
      g.gain.setValueAtTime(vol * amp, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ring / ratio ** 0.3);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + ring + 0.05);
    }
    setTimeout(() => out.disconnect(), 1200);
  }

  private hiss(amount: number, pan: StereoPannerNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + 0.25 * amount, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(hp).connect(g).connect(pan);
    src.start(t, Math.random(), 0.4);
  }

  private tone(freq: number, len: number, vol: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  /** The activate horn: two detuned saws, a second long. */
  private horn() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.04);
    g.gain.setValueAtTime(0.22, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    f.connect(g).connect(this.master!);
    for (const hz of [220, 277, 330]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      o.connect(f);
      o.start(t);
      o.stop(t + 1.15);
    }
  }

  private buzzer() {
    for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && this.tone(150, 0.28, 0.3, 'square'), i * 330);
  }

  /** Pit open: a two-tone klaxon. */
  private klaxon() {
    for (let i = 0; i < 4; i++) setTimeout(() => this.ctx && this.tone(i % 2 ? 520 : 700, 0.22, 0.16, 'square'), i * 240);
  }
}
