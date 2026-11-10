import type RAPIER from '@dimforge/rapier3d-compat';
import type { CommentaryLine, Match, MatchResult, Phase } from './match';
import type { Robot } from './robot';

/**
 * Online play is host-authoritative: one device (the host) runs the physics,
 * the other (the guest) builds the same Match from the same designs and
 * options but never steps it — it copies the host's state into it, and the
 * renderer, HUD and sound read it as usual.
 *
 * A snapshot carries what the view, HUD and sound read:
 * - every robot body's pose (and whether it's enabled — spare cannon rounds
 *   wait on disabled bodies), the chassis' velocity (drive sound), and the
 *   arena's moving parts;
 * - each part's condition and whether it has failed or come off (the guest
 *   breaks parts off itself the same way, so both sides have the same bodies);
 * - battery, current, gas, power, actuator speeds and switches, chainsaws and
 *   flamethrowers;
 * - the clock, phase, counts, eliminations, commentary since the last
 *   snapshot, big hits and impacts (sparks and clangs), and the result.
 *
 * Poses and conditions go as Float32Arrays so the message is a few kB.
 */
export interface NetState {
  time: number;
  arenaTime: number;
  phase: Phase;
  endTime: number | null;
  finaleStarted: boolean;
  pitOpen: boolean;
  counts: Array<number | null>;
  eliminated: Array<string | null>;
  outOrder: number[];
  /** Commentary lines from index `commentaryFrom` on. */
  commentaryFrom: number;
  commentary: CommentaryLine[];
  result: MatchResult | null;
  bigHits: Array<{ x: number; y: number; z: number; e: number }>;
  impacts: Array<{ x: number; y: number; z: number; e: number }>;
  /** Per robot: x y z qx qy qz qw enabled for each of its bodies (see bodiesOf). */
  poses: Float32Array[];
  /** Per robot: chassis linear velocity. */
  vel: Float32Array;
  /** Per robot: each part's condition, and flags (1 detached, 2 failed). */
  cond: Float32Array[];
  flags: Uint8Array[];
  /** Per robot: energy, current, gasLeft, powered, then per actuator speed and toggled, chains on, flames on and fuel. */
  stats: Float32Array[];
  /** Trapdoor translation, floor flipper rotation. */
  arena: Float32Array;
}

/** A robot's distinct bodies, in part order (the same on both sides once the same parts are off). */
function bodiesOf(r: Robot): RAPIER.RigidBody[] {
  const out: RAPIER.RigidBody[] = [];
  const seen = new Set<number>();
  for (const p of r.parts) {
    const b = p.body;
    if (!b || seen.has(b.handle)) continue;
    seen.add(b.handle);
    out.push(b);
  }
  return out;
}

/** The host: what the guest needs, with commentary from line `commentaryFrom` on. */
export function captureState(m: Match, commentaryFrom: number): NetState {
  const poses = m.robots.map((r) => {
    const bodies = bodiesOf(r);
    const a = new Float32Array(bodies.length * 8);
    bodies.forEach((b, i) => {
      const t = b.translation(), q = b.rotation();
      a.set([t.x, t.y, t.z, q.x, q.y, q.z, q.w, b.isEnabled() ? 1 : 0], i * 8);
    });
    return a;
  });
  const vel = new Float32Array(m.robots.length * 3);
  m.robots.forEach((r, i) => { const v = r.chassis.linvel(); vel.set([v.x, v.y, v.z], i * 3); });
  const td = m.arena.trapdoor.translation(), ff = m.arena.floorFlipper.rotation();
  return {
    time: m.time,
    arenaTime: m.arena.time,
    phase: m.phase,
    endTime: m.endTime,
    finaleStarted: m.finaleStarted,
    pitOpen: m.arena.pitOpen,
    counts: [...m.counts],
    eliminated: [...m.eliminated],
    outOrder: [...m.outOrder],
    commentaryFrom,
    commentary: m.commentary.slice(commentaryFrom),
    result: m.result,
    bigHits: m.bigHits.map((h) => ({ x: h.point.x, y: h.point.y, z: h.point.z, e: h.energy })),
    impacts: m.impacts.map((h) => ({ x: h.point.x, y: h.point.y, z: h.point.z, e: h.energy })),
    poses,
    vel,
    cond: m.robots.map((r) => Float32Array.from(r.parts, (p) => p.condition)),
    flags: m.robots.map((r) => Uint8Array.from(r.parts, (p) => (p.detached ? 1 : 0) | (p.failed ? 2 : 0))),
    stats: m.robots.map((r) => Float32Array.from([
      r.energy, r.current, r.gasLeft, r.powered ? 1 : 0,
      ...r.actuators.flatMap((a) => [a.speed, a.toggled ? 1 : 0]),
      ...r.chains.map((c) => (c.on ? 1 : 0)),
      ...r.flames.flatMap((f) => [f.on ? 1 : 0, f.fuel]),
    ])),
    arena: Float32Array.from([td.x, td.y, td.z, ff.x, ff.y, ff.z, ff.w]),
  };
}

/**
 * The guest: copy a snapshot into a Match built from the same designs and
 * options. With `prev`, poses are blended from `prev` to `s` by `alpha`
 * (0..1), so 30 snapshots a second still draw smoothly at 60 frames.
 * Returns the big hits and impacts it carried (the caller decides when to
 * use them, so a blended frame doesn't repeat them).
 */
export function applyState(m: Match, s: NetState, prev: NetState | null = null, alpha = 1) {
  m.time = s.time;
  m.arena.time = s.arenaTime;
  m.phase = s.phase;
  m.endTime = s.endTime;
  m.finaleStarted = s.finaleStarted;
  m.arena.pitOpen = s.pitOpen;
  m.result = s.result;
  s.counts.forEach((c, i) => (m.counts[i] = c));
  s.eliminated.forEach((e, i) => (m.eliminated[i] = e));
  m.outOrder = [...s.outOrder];
  // Commentary: add whatever this side hasn't got yet.
  for (let k = Math.max(0, m.commentary.length - s.commentaryFrom); k < s.commentary.length; k++) m.commentary.push(s.commentary[k]);

  m.robots.forEach((r, i) => {
    const cond = s.cond[i], flags = s.flags[i];
    if (cond && flags && cond.length === r.parts.length) {
      r.parts.forEach((p, k) => {
        p.condition = cond[k];
        p.failed = (flags[k] & 2) !== 0;
        if (flags[k] & 1 && !p.detached) r.mirrorDetach(p);
      });
    }
    const bodies = bodiesOf(r);
    const pose = s.poses[i], from = prev?.poses[i];
    if (pose && pose.length === bodies.length * 8) {
      const blend = from && from.length === pose.length && alpha < 1;
      bodies.forEach((b, k) => {
        const o = k * 8;
        let x = pose[o], y = pose[o + 1], z = pose[o + 2];
        let qx = pose[o + 3], qy = pose[o + 4], qz = pose[o + 5], qw = pose[o + 6];
        if (blend) {
          const f = from!;
          x = f[o] + (x - f[o]) * alpha;
          y = f[o + 1] + (y - f[o + 1]) * alpha;
          z = f[o + 2] + (z - f[o + 2]) * alpha;
          // Normalised lerp, taking the short way round.
          const dot = f[o + 3] * qx + f[o + 4] * qy + f[o + 5] * qz + f[o + 6] * qw;
          const sg = dot < 0 ? -1 : 1;
          qx = f[o + 3] + (qx * sg - f[o + 3]) * alpha;
          qy = f[o + 4] + (qy * sg - f[o + 4]) * alpha;
          qz = f[o + 5] + (qz * sg - f[o + 5]) * alpha;
          qw = f[o + 6] + (qw * sg - f[o + 6]) * alpha;
          const n = Math.hypot(qx, qy, qz, qw) || 1;
          qx /= n; qy /= n; qz /= n; qw /= n;
        }
        const on = pose[o + 7] > 0.5;
        if (b.isEnabled() !== on) b.setEnabled(on);
        b.setTranslation({ x, y, z }, false);
        b.setRotation({ x: qx, y: qy, z: qz, w: qw }, false);
      });
    }
    const v = s.vel;
    if (v.length >= i * 3 + 3) r.chassis.setLinvel({ x: v[i * 3], y: v[i * 3 + 1], z: v[i * 3 + 2] }, false);
    const st = s.stats[i];
    if (st) {
      let k = 0;
      r.energy = st[k++];
      r.current = st[k++];
      r.gasLeft = st[k++];
      r.powered = st[k++] > 0.5;
      for (const a of r.actuators) { a.speed = st[k++] ?? 0; a.toggled = (st[k++] ?? 0) > 0.5; }
      for (const c of r.chains) c.on = (st[k++] ?? 0) > 0.5;
      for (const f of r.flames) { f.on = (st[k++] ?? 0) > 0.5; f.fuel = st[k++] ?? f.fuel; }
    }
  });
  const a = s.arena;
  m.arena.trapdoor.setTranslation({ x: a[0], y: a[1], z: a[2] }, false);
  m.arena.floorFlipper.setRotation({ x: a[3], y: a[4], z: a[5], w: a[6] }, false);
}

/** NetState as plain JSON (typed arrays become number arrays), for the wire. */
export type WireState = Omit<NetState, 'poses' | 'vel' | 'cond' | 'flags' | 'stats' | 'arena'> & {
  poses: number[][]; vel: number[]; cond: number[][]; flags: number[][]; stats: number[][]; arena: number[];
};

/** Floats to 5 significant figures: plenty for drawing, and a third the size as JSON. */
const trim = (a: ArrayLike<number>): number[] => Array.from(a, (v) => (v === 0 ? 0 : Number(v.toPrecision(5))));

export function toWire(s: NetState): WireState {
  return {
    ...s,
    poses: s.poses.map(trim), vel: trim(s.vel), cond: s.cond.map(trim),
    flags: s.flags.map((f) => Array.from(f)), stats: s.stats.map(trim), arena: trim(s.arena),
  };
}

export function fromWire(w: WireState): NetState {
  return {
    ...w,
    poses: w.poses.map((a) => Float32Array.from(a)), vel: Float32Array.from(w.vel), cond: w.cond.map((a) => Float32Array.from(a)),
    flags: w.flags.map((a) => Uint8Array.from(a)), stats: w.stats.map((a) => Float32Array.from(a)), arena: Float32Array.from(w.arena),
  };
}
