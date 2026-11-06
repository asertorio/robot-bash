import RAPIER from '@dimforge/rapier3d-compat';
import { Arena, flamePitRect, floorFlipperRect, inRect } from './arena';
import { NEUTRAL, type ControlState } from './control';
import type { RobotDesign } from './design';
import { HOUSE_CORNERS, HouseDriver, zoneCentre } from './house';
import { Robot, type Part } from './robot';
import { vadd, vcross, vdot, vlen, vscale, vsub, type V3 } from './vmath';

export const STEP = 1 / 480;
const MAX_STEPS_PER_FRAME = 40;
const COUNTDOWN = 3;
/** Seconds without moving under its own power before the referee starts counting. */
const COUNT_GRACE = 4;
const COUNT_OUT = 10;
/** Seconds of driving under its own power a robot needs to stop a count once it's started. */
const PROVE_MOBILE = 0.4;

export type Phase = 'countdown' | 'fight' | 'over';

export interface CommentaryLine {
  time: number;
  text: string;
  level: 'info' | 'major';
}

export interface JudgeScore {
  aggression: number;
  control: number;
  damage: number;
  style: number;
  total: number;
}

export interface MatchResult {
  winner: number | null;
  reason: string;
  scores?: JudgeScore[];
}

interface Tally {
  aggression: number;
  control: number;
  damage: number;
  style: number;
}

/** One impact between two colliders, which may last several physics steps. */
interface Episode {
  energy: number;
  start: number;
  last: number;
}
/** Contact gaps shorter than this (s) are the same impact. */
const EPISODE_GAP = 0.02;
/** A long grind is treated as a fresh impact this often (s). */
const EPISODE_MAX = 0.25;

interface BodySnapshot {
  lin: V3;
  ang: V3;
  com: V3;
}

export interface MatchOptions {
  duration?: number;
  /** Skip the 3-2-1 (tests, test bay). */
  skipCountdown?: boolean;
  /** Override start positions (robot origin on the floor) and headings. */
  spawns?: Array<{ pos: V3; yaw: number }>;
  /** Test bay: no referee, no time limit, nobody is eliminated. */
  sandbox?: boolean;
  /** House robots, one per corner patrol zone (up to four). */
  house?: RobotDesign[];
}

export class Match {
  readonly world: RAPIER.World;
  readonly arena: Arena;
  /** Competitors first, then house robots. */
  readonly robots: Robot[];
  readonly competitors: Robot[];
  readonly houseRobots: Robot[];
  readonly duration: number;
  phase: Phase;
  /** Seconds since activation (negative during the countdown). */
  time: number;
  commentary: CommentaryLine[] = [];
  readonly sandbox: boolean;
  /** The biggest single impact so far, for test-bay telemetry. */
  biggestHit: { energy: number; time: number; parts: string } | null = null;
  /** Hard hits since the renderer last looked (for sparks). */
  impacts: Array<{ point: V3; energy: number }> = [];
  result: MatchResult | null = null;
  /** Current referee count per robot (seconds), or null when not counting. */
  counts: Array<number | null>;
  eliminated: Array<string | null>;

  private events = new RAPIER.EventQueue(true);
  private acc = 0;
  private controls: ControlState[];
  private lastSelfMove: number[];
  private movingFor: number[];
  private tally: Tally[];
  private robotColliders: Set<number>[] = [];
  private stepCount = 0;
  private episodes = new Map<string, Episode>();
  private houseDrivers: HouseDriver[] = [];
  private onFloorFlipper = 0;
  private lastRoast = new Map<Robot, number>();
  private lastCountSay: number[] = [];
  private lastTorch = new Map<string, number>();
  /** Who last touched each robot, and when (for crediting landing damage). */
  private lastHitBy = new Map<Robot, { robot: Robot; time: number; y: number; peak: number }>();

  constructor(designs: RobotDesign[], opts: MatchOptions = {}) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.world.numSolverIterations = 8;
    this.arena = new Arena(this.world);
    const spawns = opts.spawns ?? [
      { pos: { x: 0, y: 0.01, z: -3.5 }, yaw: 0 },
      { pos: { x: 0, y: 0.01, z: 3.5 }, yaw: Math.PI },
      { pos: { x: -3.5, y: 0.01, z: 0 }, yaw: Math.PI / 2 },
      { pos: { x: 3.5, y: 0.01, z: 0 }, yaw: -Math.PI / 2 },
    ];
    this.competitors = designs.map((d, i) => new Robot(this.world, d, i, spawns[i].pos, spawns[i].yaw));
    this.houseRobots = (opts.house ?? []).slice(0, 4).map((d, k) => {
      const zone = HOUSE_CORNERS[k];
      const home = zoneCentre(zone);
      this.houseDrivers.push(new HouseDriver(zone));
      return new Robot(this.world, d, designs.length + k, { x: home.x, y: 0.01, z: home.z }, Math.atan2(-zone.sx, -zone.sz));
    });
    this.robots = [...this.competitors, ...this.houseRobots];
    this.sandbox = opts.sandbox ?? false;
    this.duration = this.sandbox ? Infinity : opts.duration ?? 180;
    this.phase = opts.skipCountdown ? 'fight' : 'countdown';
    this.time = opts.skipCountdown ? 0 : -COUNTDOWN;
    this.controls = this.competitors.map(() => NEUTRAL);
    this.counts = this.competitors.map(() => null);
    this.eliminated = this.competitors.map(() => null);
    this.lastSelfMove = this.competitors.map(() => 0);
    this.movingFor = this.competitors.map(() => 0);
    this.tally = this.competitors.map(() => ({ aggression: 0, control: 0, damage: 0, style: 0 }));
  }

  /** Advance by a frame's worth of real time, in fixed physics steps. */
  update(frameDt: number, controls: ControlState[]) {
    this.controls = controls;
    this.acc += Math.min(frameDt, MAX_STEPS_PER_FRAME * STEP);
    while (this.acc >= STEP) {
      this.step();
      this.acc -= STEP;
    }
  }

  /** One fixed physics step. */
  step() {
    const prevPhase = this.phase;
    this.time += STEP;
    this.stepCount++;
    if (this.phase === 'countdown' && this.time >= 0) {
      this.phase = 'fight';
      this.say('Activate!', 'major');
    }

    this.competitors.forEach((r, i) => {
      const live = this.phase !== 'countdown' && !this.eliminated[i];
      r.setControl(live ? this.controls[i] ?? NEUTRAL : NEUTRAL);
    });
    if (this.stepCount % 8 === 1) this.driveHouseRobots(8 * STEP);
    // Velocities before this step's motor and ram impulses: a ram pushing a
    // plate against an opponent isn't an impact (the solver would otherwise
    // see the plate leap forward and stop dead every step).
    const snapshot = this.snapshot();
    for (const r of this.robots) r.update(STEP);
    this.arena.update(STEP);

    this.world.step(this.events);
    this.processContacts(snapshot);

    for (const r of this.robots) {
      const shaken = r.measureShock(STEP);
      // A big landing is the work of whoever just threw you: they touched you
      // last, and you've been up in the air since.
      const by = this.lastHitBy.get(r);
      if (by) by.peak = Math.max(by.peak, r.position.y);
      if (shaken > 0 && this.phase === 'fight' && by && this.time - by.time < 2 && by.peak - by.y > 0.2 && r.index < this.tally.length && by.robot.index < this.tally.length) {
        this.tally[by.robot.index].damage += shaken;
      }
      r.resolveDamage();
      for (const e of r.events) this.say(phrase(r.design.name, e.text), e.level);
      r.events = [];
    }

    if (this.stepCount % 480 === 0) {
      for (const [k, ep] of this.episodes) if (this.time - ep.last > 1) this.episodes.delete(k);
    }

    // Rules run at 60 Hz; no need for more.
    if (this.stepCount % 8 === 0 && prevPhase !== 'countdown') this.referee(8 * STEP);
  }

  private snapshot(): Map<number, BodySnapshot> {
    const snap = new Map<number, BodySnapshot>();
    this.world.forEachRigidBody((b) => {
      if (!b.isDynamic()) return;
      snap.set(b.handle, { lin: b.linvel(), ang: b.angvel(), com: b.worldCom() });
    });
    return snap;
  }

  /**
   * Turn this step's contact forces into damage. Energy dissipated by an
   * impact ≈ ½ × impulse × closing speed at the contact point (pre-impact).
   */
  private processContacts(snap: Map<number, BodySnapshot>) {
    this.events.drainContactForceEvents((e) => {
      const c1 = this.world.getCollider(e.collider1());
      const c2 = this.world.getCollider(e.collider2());
      if (!c1 || !c2) return;
      const owner1 = this.owner(c1), owner2 = this.owner(c2);
      if (!owner1 && !owner2) return;
      if (owner1 && owner2 && owner1.robot !== owner2.robot) this.touched(owner1.robot, owner2.robot);
      const impulse = e.totalForceMagnitude() * STEP;

      let point: V3 | null = null;
      let normal: V3 | null = null;
      this.world.contactPair(c1, c2, (m, flipped) => {
        const n = m.numSolverContacts();
        if (!n) return;
        let p = { x: 0, y: 0, z: 0 };
        for (let i = 0; i < n; i++) p = vadd(p, m.solverContactPoint(i)!);
        point = vscale(p, 1 / n);
        const mn = m.normal();
        normal = flipped ? vscale(mn, -1) : mn;
      });
      if (!point || !normal) return;
      const v1 = this.preVelocity(c1, point, snap);
      const v2 = this.preVelocity(c2, point, snap);
      const closing = Math.abs(vdot(vsub(v1, v2), normal));
      const energy = 0.5 * impulse * closing;
      if (energy < 1) return;
      if (energy > 150 && this.impacts.length < 64) this.impacts.push({ point, energy });

      // Accumulate the whole impact, so a hit spread over several steps
      // counts as one hit against each part's yield threshold.
      const key = c1.handle < c2.handle ? `${c1.handle}:${c2.handle}` : `${c2.handle}:${c1.handle}`;
      let ep = this.episodes.get(key);
      if (!ep || this.time - ep.last > EPISODE_GAP || this.time - ep.start > EPISODE_MAX) {
        ep = { energy: 0, start: this.time, last: this.time };
        this.episodes.set(key, ep);
      }
      // Robot on robot, each side soaks up half. Against the arena (a
      // massive steel structure) the robot is what gives, so it takes it all.
      const share = owner1 && owner2 ? 0.5 : 1;
      const prior = ep.energy * share;
      ep.energy += energy;
      ep.last = this.time;
      if (ep.energy > 20 && ep.energy > (this.biggestHit?.energy ?? 0) && (owner1 || owner2)) {
        const names = [owner1, owner2].filter(Boolean).map((o) => `${o!.robot.design.name} ${o!.part.label.toLowerCase()}`);
        this.biggestHit = { energy: ep.energy, time: this.time, parts: names.join(' vs ') };
      }

      const loss1 = owner1 ? owner1.robot.absorb(owner1.part, energy * share, point, prior) : 0;
      const loss2 = owner2 ? owner2.robot.absorb(owner2.part, energy * share, point, prior) : 0;
      if (this.phase !== 'fight') return;
      // Only competitor-on-competitor damage impresses the judges.
      const t1 = owner1 && this.tally[owner1.robot.index], t2 = owner2 && this.tally[owner2.robot.index];
      if (t1 && t2 && owner1!.robot !== owner2!.robot) {
        t2.damage += loss1;
        t1.damage += loss2;
        if (ep.energy > 2500 && ep.energy - energy <= 2500) {
          // A big hit is good television.
          (loss2 > loss1 ? t1 : t2).style += 1;
        }
      }
    });
  }

  private owner(c: RAPIER.Collider): { robot: Robot; part: Part } | null {
    for (const r of this.robots) {
      const part = r.partFor(c);
      if (part) return { robot: r, part };
    }
    return null;
  }

  private preVelocity(c: RAPIER.Collider, p: V3, snap: Map<number, BodySnapshot>): V3 {
    const b = c.parent();
    if (!b) return { x: 0, y: 0, z: 0 };
    const s = snap.get(b.handle);
    if (!s) return b.isKinematic() ? b.linvel() : { x: 0, y: 0, z: 0 };
    return vadd(s.lin, vcross(s.ang, vsub(p, s.com)));
  }

  // ---------------------------------------------------------------- rules

  private driveHouseRobots(dt: number) {
    if (this.phase === 'countdown') {
      for (const h of this.houseRobots) h.setControl(NEUTRAL);
      return;
    }
    // Counted-out robots (still in the arena) are fair game for everyone.
    const victims = this.competitors.filter((_, i) => this.eliminated[i] === 'immobilised' || (this.counts[i] ?? 0) > 3);
    const fighting = this.competitors.filter((_, i) => !this.eliminated[i]);
    this.houseRobots.forEach((h, k) => h.setControl(this.houseDrivers[k].update(h, fighting, victims, dt)));
  }

  /** Floor flipper and flame pit. */
  private hazards(dt: number) {
    const ff = floorFlipperRect();
    const onFlipper = this.robots.find((r) => inRect(ff, r.position, -0.1) && r.position.y < 0.3);
    this.onFloorFlipper = onFlipper ? this.onFloorFlipper + dt : 0;
    if (onFlipper && this.onFloorFlipper > 0.35 && this.arena.fireFloorFlipper()) {
      this.say(`The floor flipper launches ${onFlipper.design.name}!`, 'major');
    }
    const flames = flamePitRect();
    if (this.arena.flamesOn) {
      for (const r of this.robots) {
        let hit = false;
        for (const p of r.parts) {
          const c = p.collider;
          if (!c || p.detached) continue;
          const pos = c.translation();
          if (pos.y < 0.9 && inRect(flames, pos)) { r.heat(p, dt); hit = true; }
        }
        if (hit && this.time - (this.lastRoast.get(r) ?? -99) > 5) this.say(`${r.design.name} is roasting in the flame pit!`, 'info');
        if (hit) this.lastRoast.set(r, this.time);
      }
    }
    // Flamethrowers: anything in the cone of fire heats up.
    for (const r of this.robots) {
      for (const f of r.activeFlames()) {
        for (const o of this.robots) {
          if (o === r) continue;
          let hit = false;
          for (const p of o.parts) {
            const c = p.collider;
            if (!c || p.detached) continue;
            const d = vsub(c.translation(), f.origin);
            const along = vdot(d, f.dir);
            if (along <= 0 || along > f.range) continue;
            const perp = vlen(vsub(d, vscale(f.dir, along)));
            if (perp > 0.06 + along * 0.35) continue;
            o.heat(p, dt * 1.5);
            hit = true;
          }
          const key = `${r.index}>${o.index}`;
          if (hit && this.time - (this.lastTorch.get(key) ?? -99) > 6) {
            this.lastTorch.set(key, this.time);
            this.say(`${r.design.name} is torching ${o.design.name}!`, 'major');
          }
        }
      }
    }
  }

  private referee(dt: number) {
    this.hazards(dt);
    const alive = () => this.competitors.filter((_, i) => !this.eliminated[i]);
    this.competitors.forEach((r, i) => {
      if (this.eliminated[i]) return;
      this.robotColliders[i] ??= new Set();
      const handles = this.robotColliders[i];
      handles.clear();
      for (const p of r.parts) if (p.collider && !p.detached) handles.add(p.collider.handle);

      if (!this.arena.pitOpen && this.arena.buttonPressedBy(handles)) {
        this.arena.pitOpen = true;
        this.say(`${r.design.name} has hit the pit release — the pit is open!`, 'major');
      }
      const pos = r.position;
      if (this.sandbox) return;
      if (this.arena.isInPit(pos)) return this.eliminate(i, 'into the pit');
      if (this.arena.isOutOfArena(pos)) return this.eliminate(i, 'out of the arena');
      if (this.phase !== 'fight') return;

      // Moving under its own power resets the count; being shoved around
      // doesn't. Turning on the spot or shoving an opponent counts as control,
      // but anything a house robot does to you is not your own doing.
      const c = this.controls[i] ?? NEUTRAL;
      const v = r.chassis.linvel();
      const speed = Math.hypot(v.x, v.z);
      const trying = Math.abs(c.left) + Math.abs(c.right) > 0.2;
      const contact = this.contacts(i);
      if (contact.touching) this.touched(r, contact.touching);
      const active = speed > 0.12 || Math.abs(r.chassis.angvel().y) > 0.6 || contact.opponent;
      const selfMoving = trying && active && !contact.house && r.tractionWheels() > 0;
      // Once the count has started, a robot has to show it really can move —
      // a moment of drift after a house robot lets go doesn't stop the count.
      this.movingFor[i] = selfMoving ? this.movingFor[i] + dt : 0;
      if (selfMoving && (this.counts[i] === null || this.movingFor[i] >= PROVE_MOBILE)) this.lastSelfMove[i] = this.time;
      const still = this.time - this.lastSelfMove[i] - COUNT_GRACE;
      const was = this.counts[i];
      this.counts[i] = still > 0 ? still : null;
      if (was === null && this.counts[i] !== null && this.time - (this.lastCountSay[i] ?? -99) > 8) {
        this.lastCountSay[i] = this.time;
        this.say(`The referee is counting out ${r.design.name}…`, 'info');
      }
      if (still >= COUNT_OUT) return this.eliminate(i, 'immobilised');

      // Judges' notes.
      const t = this.tally[i];
      if (selfMoving) t.control += dt;
      const opp = this.competitors.find((_, j) => j !== i && !this.eliminated[j]);
      if (opp) {
        const to = vsub(opp.position, pos);
        const d = vlen(to);
        if (d < 4 && selfMoving && vdot(v, vscale(to, 1 / d)) > 0.5) t.aggression += dt;
        // Opponent off the ground near us: we probably put it there.
        if (d < 2 && opp.position.y > 0.35) t.style += dt * 2;
      }
    });

    if (this.phase === 'fight' && !this.sandbox) {
      const left = alive();
      if (left.length <= 1 && this.competitors.length > 1) {
        const winner = left[0];
        const loser = this.competitors.find((_, i) => this.eliminated[i]);
        const reason = loser ? `${loser.design.name} went ${this.eliminated[loser.index]}` : '';
        this.finish({ winner: winner ? winner.index : null, reason });
      } else if (this.time >= this.duration) {
        this.judge();
      }
    }
  }

  /** Is competitor `i` touching another competitor, and is it touching a house robot? */
  private contacts(i: number): { opponent: boolean; house: boolean; touching: Robot | null } {
    const mine = this.robotColliders[i];
    const out = { opponent: false, house: false, touching: null as Robot | null };
    const me = this.robots[i];
    for (const p of me.parts) {
      if (out.opponent && out.house) break;
      if (p.detached) continue;
      for (const c of [p.tyre, ...me.collidersOf(p)]) {
        if (!c) continue;
        this.world.contactPairsWith(c, (other) => {
          if (mine.has(other.handle)) return;
          const j = this.robots.findIndex((r, k) => k !== i && r.partFor(other));
          if (j < 0) return;
          const kind = j < this.competitors.length ? 'opponent' : 'house';
          if (out[kind]) return;
          this.world.contactPair(c, other, (m) => { if (m.numContacts() > 0) { out[kind] = true; out.touching ??= this.robots[j]; } });
        });
      }
    }
    return out;
  }

  /** Remember who's touching whom, however gently (for crediting throws). */
  private touched(a: Robot, b: Robot) {
    for (const [me, them] of [[a, b], [b, a]]) {
      const y = me.position.y;
      const prev = this.lastHitBy.get(me);
      // Still the same tussle: keep where it started, so landing on them after
      // they threw you still counts as their throw.
      if (prev && prev.robot === them && this.time - prev.time < 2) {
        prev.time = this.time;
        prev.y = Math.min(prev.y, y);
        prev.peak = Math.max(prev.peak, y);
      } else {
        this.lastHitBy.set(me, { robot: them, time: this.time, y, peak: y });
      }
    }
  }

  private eliminate(i: number, how: string) {
    if (this.eliminated[i]) return;
    this.eliminated[i] = how;
    this.counts[i] = null;
    const name = this.robots[i].design.name;
    const line = how === 'immobilised' ? `${name} is immobilised! …8, 9, 10 — out!` : `${name} is ${how}!`;
    this.say(line, 'major');
  }

  private judge() {
    const keys: (keyof Tally)[] = ['aggression', 'control', 'damage', 'style'];
    const scores: JudgeScore[] = this.competitors.map(() => ({ aggression: 0, control: 0, damage: 0, style: 0, total: 0 }));
    for (const k of keys) {
      const sum = this.tally.reduce((s, t) => s + t[k], 0);
      this.tally.forEach((t, i) => {
        // 25 points per category, shared in proportion to what each robot did.
        const pts = sum > 0 ? (25 * t[k]) / sum : 25 / this.competitors.length;
        scores[i][k] = Math.round(pts * 10) / 10;
        scores[i].total += pts;
      });
    }
    scores.forEach((s) => (s.total = Math.round(s.total * 10) / 10));
    let winner = 0;
    scores.forEach((s, i) => { if (s.total > scores[winner].total) winner = i; });
    this.finish({ winner, reason: "Judges' decision", scores });
  }

  private finish(result: MatchResult) {
    this.phase = 'over';
    this.result = result;
    const w = result.winner !== null ? this.robots[result.winner].design.name : 'Nobody';
    this.say(`${w} wins! ${result.reason}`, 'major');
  }

  private say(text: string, level: CommentaryLine['level']) {
    this.commentary.push({ time: Math.max(0, this.time), text, level });
  }

  free() {
    this.world.free();
    this.events.free();
  }
}

/** Join a robot name and an event fragment into a sentence. */
function phrase(name: string, text: string): string {
  if (text.startsWith("'s")) return `${name}${text}`;
  if (text.startsWith('— ')) return `${name}: ${text.slice(2)}`;
  return `${name} ${text}`;
}
