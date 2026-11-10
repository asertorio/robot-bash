import type { Match } from '../sim/match';
import type { Part } from '../sim/robot';
import { qmul, qrotate, vadd, type V3 } from '../sim/vmath';

/**
 * Action replays, the way the show did them: the knockout blow or the
 * fight's biggest hit again, slowed down, from a low camera.
 *
 * The recorder keeps the last few seconds of every part's world pose (body
 * pose × the part's pose on its body, exactly what the view draws), 30 times
 * a second of match time. Playing back only changes what's drawn: the view
 * takes the poses from a recorded frame instead of from the bodies, so the
 * simulation is never touched — and a part that has since come off is shown
 * where it was, still bolted on.
 */
export const REPLAY = {
  /** Frames per second of match time. */
  rate: 30,
  /** Seconds of history kept. */
  keep: 10,
  /** Playback speed (0.4 = two and a half times slower). */
  speed: 0.4,
  /** A big hit's clip: this long before it and after it (s). */
  before: 2.2,
  after: 1.4,
  /** A knockout's clip: the last this many seconds. */
  knockout: 4,
};

export interface ReplayFrame {
  time: number;
  /** Per part (all robots, in order): x y z qx qy qz qw visible. */
  poses: Float32Array;
  impacts: Array<{ point: V3; energy: number }>;
  /** Football: the ball's x y z qx qy qz qw. */
  ball: number[] | null;
}

export interface Clip {
  frames: ReplayFrame[];
  /** What the camera watches: a part to follow (its index), or a fixed point. */
  follow: number | null;
  point: V3 | null;
  title: string;
}

export class ReplayRecorder {
  private frames: ReplayFrame[] = [];
  private parts: Part[] = [];
  private next = -Infinity;
  private pendingImpacts: Array<{ point: V3; energy: number }> = [];
  /** The best big-hit clip so far, and one waiting for its "after" frames. */
  best: (Clip & { energy: number }) | null = null;
  private waiting: { time: number; energy: number; point: V3 } | null = null;

  reset(m: Match | null) {
    this.frames = [];
    this.parts = m ? m.robots.flatMap((r) => r.parts) : [];
    this.next = -Infinity;
    this.best = null;
    this.waiting = null;
    this.pendingImpacts = [];
  }

  /** Index of a robot's chassis part, for the camera to follow. */
  chassisIndex(m: Match, robot: number): number {
    const r = m.robots[robot];
    return this.parts.findIndex((p) => r.parts.includes(p) && p.body === r.chassis && p.def?.parent === null);
  }

  /** A big hit just happened: keep a clip of it once its aftermath is recorded. */
  bigHit(time: number, energy: number, point: V3) {
    if (energy <= (this.best?.energy ?? 0) || energy <= (this.waiting?.energy ?? 0)) return;
    this.waiting = { time, energy, point };
  }

  /** After each physics update (before the view clears this frame's impacts). */
  record(m: Match) {
    for (const h of m.impacts) if (this.pendingImpacts.length < 32) this.pendingImpacts.push({ point: { ...h.point }, energy: h.energy });
    if (m.time < this.next) return;
    this.next = m.time + 1 / REPLAY.rate;
    const poses = new Float32Array(this.parts.length * 8);
    this.parts.forEach((p, i) => {
      const b = p.body, v = p.visual;
      if (!b || !v || !p.collider || !b.isEnabled()) return;
      const bq = b.rotation();
      const pos = vadd(b.translation(), qrotate(bq, v.pos));
      const q = qmul(bq, v.rot);
      poses.set([pos.x, pos.y, pos.z, q.x, q.y, q.z, q.w, 1], i * 8);
    });
    const bt = m.ball?.translation(), bq = m.ball?.rotation();
    const ball = bt && bq ? [bt.x, bt.y, bt.z, bq.x, bq.y, bq.z, bq.w] : null;
    this.frames.push({ time: m.time, poses, impacts: this.pendingImpacts, ball });
    this.pendingImpacts = [];
    const oldest = m.time - REPLAY.keep;
    while (this.frames.length && this.frames[0].time < oldest) this.frames.shift();
    const w = this.waiting;
    if (w && m.time >= w.time + REPLAY.after) this.keepBest();
  }

  private keepBest() {
    const w = this.waiting;
    if (!w) return;
    this.waiting = null;
    const frames = this.frames.filter((f) => f.time >= w.time - REPLAY.before && f.time <= w.time + REPLAY.after);
    if (frames.length > 5) this.best = { frames, follow: null, point: w.point, title: 'Action replay', energy: w.energy };
  }

  /** The last `seconds` of the fight, watching one part. */
  last(seconds: number, follow: number, title: string): Clip | null {
    const end = this.frames[this.frames.length - 1]?.time ?? 0;
    const frames = this.frames.filter((f) => f.time >= end - seconds);
    return frames.length > 5 ? { frames, follow, point: null, title } : null;
  }

  /** The biggest hit's clip (finishing it off if the fight ended first). */
  bestHit(): (Clip & { energy: number }) | null {
    if (this.waiting) this.keepBest();
    return this.best;
  }
}

/** Plays a clip back in real time × REPLAY.speed. */
export class ReplayPlayer {
  private t = 0;
  private shown = -1;
  constructor(readonly clip: Clip) {}

  get done(): boolean {
    const f = this.clip.frames;
    return this.t >= f[f.length - 1].time - f[0].time;
  }

  /**
   * Advance; returns the poses to draw (blended between frames), the camera
   * target, and impacts reached since the last call (for sparks and clangs).
   */
  advance(dt: number): { poses: Float32Array; target: V3; impacts: ReplayFrame['impacts']; ball: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } | null } {
    this.t += dt * REPLAY.speed;
    const f = this.clip.frames;
    const at = f[0].time + this.t;
    let i = 0;
    while (i < f.length - 2 && f[i + 1].time <= at) i++;
    const a = f[i], b = f[Math.min(i + 1, f.length - 1)];
    const k = b.time > a.time ? Math.max(0, Math.min(1, (at - a.time) / (b.time - a.time))) : 0;
    const poses = new Float32Array(a.poses.length);
    for (let o = 0; o < poses.length; o += 8) {
      const vis = a.poses[o + 7] > 0 && b.poses[o + 7] > 0;
      const src = vis ? null : a.poses[o + 7] > 0 ? a.poses : b.poses;
      if (src) { poses.set(src.subarray(o, o + 8), o); continue; }
      for (let j = 0; j < 3; j++) poses[o + j] = a.poses[o + j] + (b.poses[o + j] - a.poses[o + j]) * k;
      const dot = a.poses[o + 3] * b.poses[o + 3] + a.poses[o + 4] * b.poses[o + 4] + a.poses[o + 5] * b.poses[o + 5] + a.poses[o + 6] * b.poses[o + 6];
      const s = dot < 0 ? -1 : 1;
      let n = 0;
      for (let j = 3; j < 7; j++) { poses[o + j] = a.poses[o + j] + (b.poses[o + j] * s - a.poses[o + j]) * k; n += poses[o + j] ** 2; }
      n = Math.sqrt(n) || 1;
      for (let j = 3; j < 7; j++) poses[o + j] /= n;
      poses[o + 7] = 1;
    }
    const impacts = i > this.shown ? f.slice(this.shown + 1, i + 1).flatMap((x) => x.impacts) : [];
    this.shown = Math.max(this.shown, i);
    const c = this.clip;
    const fo = c.follow !== null && c.follow >= 0 ? c.follow * 8 : -1;
    const target = fo >= 0 && poses[fo + 7] > 0 ? { x: poses[fo], y: poses[fo + 1], z: poses[fo + 2] } : c.point ?? { x: 0, y: 0, z: 0 };
    const bb = (k < 0.5 ? a : b).ball;
    const ball = bb ? { x: a.ball![0] + (b.ball![0] - a.ball![0]) * k, y: a.ball![1] + (b.ball![1] - a.ball![1]) * k, z: a.ball![2] + (b.ball![2] - a.ball![2]) * k, qx: bb[3], qy: bb[4], qz: bb[5], qw: bb[6] } : null;
    return { poses, target, impacts, ball };
  }
}
