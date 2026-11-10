import RAPIER from '@dimforge/rapier3d-compat';
import { hardnessOf, material } from '../data/materials';
import { ARENA, Arena, flamePitRect, floorFlipperRect, inRect } from './arena';
import { NEUTRAL, type ControlState } from './control';
import type { RobotDesign } from './design';
import { HOUSE_CORNERS, HouseDriver, zoneCentre } from './house';
import { CUT, PIERCE, cutRatio, hitShare, pierceForce } from './damage';
import { LAUNCH } from './launch';
import { Robot, type Part, type Round } from './robot';
import { qrotate, vadd, vcross, vdot, vlen, vscale, vsub, type V3 } from './vmath';

export const STEP = 1 / 480;
const MAX_STEPS_PER_FRAME = 40;
const COUNTDOWN = 3;
/** Seconds without moving under its own power before the referee starts counting. */
const COUNT_GRACE = 4;
const COUNT_OUT = 10;
/** Seconds of driving under its own power a robot needs to stop a count once it's started. */
const PROVE_MOBILE = 0.4;
/**
 * With a house robot touching you, what counts as driving yourself: speed
 * along your heading the way the throttle says (m/s), or yaw the way you're
 * steering (rad/s). Walking pace and a slow pivot — clearly deliberate.
 */
const SELF_DRIVE = { speed: 0.25, yaw: 0.8 };
/** Seconds two robots can be locked together going nowhere before the referee breaks them up. */
const STALEMATE = 5;
/** The last this many seconds of a fight are the finale (when that's switched on). */
const FINALE = 30;
/** Impacts this big (J) are big hits: slow motion, camera shake, the crowd goes wild. */
export const BIG_HIT = 1500;

export type Phase = 'countdown' | 'fight' | 'over';

/**
 * What kind of contest: an ordinary fight, or one of the show's side events.
 * - sumo: on a raised dais; pushed (or driven) off it, you're out.
 * - football: a ball and a goal at each end; first to GOALS_TO_WIN, or the
 *   most goals at time. In a melee, even-numbered players (P1, P3) are the
 *   red team at the −z end and odd-numbered ones blue at the +z end.
 */
export type GameEvent = 'fight' | 'sumo' | 'football';
export const GOALS_TO_WIN = 3;

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
  /** Multiplies all damage (1 = realistic). */
  damageScale?: number;
  /** The referee pulls apart robots locked together going nowhere (default on). */
  breaks?: boolean;
  /** Last 30 seconds: the pit opens and the house robots leave their corners. */
  finale?: boolean;
  /** A side event instead of a fight (default 'fight'). */
  event?: GameEvent;
  /**
   * Damage carried in from an earlier fight (a championship): per competitor,
   * each part's condition by index in `robot.parts` (see sim/tournament.ts).
   * A part at 0 fails as the fight starts — it's missing, or dead.
   */
  wear?: Array<number[] | null | undefined>;
}

/** One robot's part grinding on another's: who, what, and how it's going. */
interface Wear {
  robot: Robot;
  part: Part;
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
  /** Big hits between competitors since the app last looked (slow motion, camera shake). */
  bigHits: Array<{ point: V3; energy: number }> = [];
  /** The finale's begun: the pit's open and the house robots are loose. */
  finaleStarted = false;
  result: MatchResult | null = null;
  /** When the fight was decided (the clock stops there). */
  endTime: number | null = null;
  /** Current referee count per robot (seconds), or null when not counting. */
  counts: Array<number | null>;
  eliminated: Array<string | null>;
  readonly event: GameEvent;
  /** Football: the ball, and goals scored by red (P1, P3) and blue (P2, P4). */
  readonly ball: RAPIER.RigidBody | null = null;
  goals: [number, number] = [0, 0];
  /** Competitors in the order they went out (first out first). */
  outOrder: number[] = [];

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
  private damageScale: number;
  private breaks: boolean;
  private finale: boolean;
  /** How long each pair of competitors has been locked together going nowhere. */
  private locked = new Map<string, number>();
  private lastCutSay = new Map<string, number>();
  private lastBigSay = -99;
  private lastStanding = Infinity;

  constructor(designs: RobotDesign[], opts: MatchOptions = {}) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.world.numSolverIterations = 8;
    this.arena = new Arena(this.world);
    this.event = opts.event ?? 'fight';
    if (this.event === 'sumo') this.arena.addDais();
    if (this.event === 'football') this.ball = this.arena.addBall();
    const spawns = opts.spawns ?? eventSpawns(this.event, designs.length) ?? [
      { pos: { x: 0, y: 0.01, z: -3.5 }, yaw: 0 },
      { pos: { x: 0, y: 0.01, z: 3.5 }, yaw: Math.PI },
      { pos: { x: -3.5, y: 0.01, z: 0 }, yaw: Math.PI / 2 },
      { pos: { x: 3.5, y: 0.01, z: 0 }, yaw: -Math.PI / 2 },
    ];
    this.competitors = designs.map((d, i) => new Robot(this.world, d, i, spawns[i].pos, spawns[i].yaw));
    this.damageScale = opts.damageScale ?? 1;
    this.breaks = opts.breaks ?? true;
    this.finale = opts.finale ?? false;
    for (const r of this.competitors) r.damageScale = this.damageScale;
    opts.wear?.forEach((w, i) => {
      const r = this.competitors[i];
      if (!w || !r || w.length !== r.parts.length) return;
      r.parts.forEach((p, k) => {
        p.condition = Math.max(0, Math.min(1, w[k]));
        // Already-known damage isn't news: only announce it getting worse.
        p.announced = p.condition < 0.3 ? 0.3 : p.condition < 0.65 ? 0.65 : p.announced;
      });
    });
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
      // Hands off the sticks once it's over.
      const live = this.phase === 'fight' && !this.eliminated[i];
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
    for (const { robot, round, body, victim } of this.embeds) {
      if (round.embed) continue;
      robot.embed(round, body);
      if (this.phase !== 'countdown') this.say(`${robot.design.name} has harpooned ${victim.design.name}!`, 'major');
    }
    this.embeds.length = 0;

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
      if (this.ball && (c1.parent() === this.ball || c2.parent() === this.ball)) {
        const toucher = owner1 ?? owner2;
        if (toucher && toucher.robot.index < this.competitors.length) this.ballTouch = toucher.robot;
        // A ball isn't armour: kicking it doesn't hurt anyone.
        return;
      }
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
      const rel = vsub(v1, v2);
      const along = vdot(rel, normal);
      const closing = Math.abs(along);
      // Saws and spikes work on steady contact as well as impacts.
      if (owner1 && owner2 && owner1.robot !== owner2.robot) {
        const slide = vlen(vsub(rel, vscale(normal, along)));
        const force = e.totalForceMagnitude();
        this.wear(owner1, owner2, force, slide, point);
        this.wear(owner2, owner1, force, slide, point);
      }
      // A pointed round hitting hard enough to pierce the plate sticks in.
      for (const [att, def, col] of [[owner1, owner2, c2], [owner2, owner1, c1]] as const) {
        if (!att || !def || att.robot === def.robot || att.part.edge !== 'spike' || def.part.kind !== 'structure' || def.part.detached) continue;
        const round = att.robot.roundOf(att.part);
        const body = col.parent();
        if (!round || round.embed || !body) continue;
        if (e.totalForceMagnitude() > LAUNCH.EMBED * pierceForce(def.part.material, def.part.thickness)) this.embeds.push({ robot: att.robot, round, body, victim: def.robot });
      }
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
      // Robot on robot, a sharp or harder edge concentrates the blow on
      // the other side (see EDGE in damage.ts). Against the arena (a
      // massive steel structure) the robot is what gives, so it takes it all.
      let share1 = 1, share2 = 1;
      if (owner1 && owner2) {
        const p1 = owner1.part, p2 = owner2.part;
        share1 = hitShare(p2, p1);
        share2 = hitShare(p1, p2);
      }
      const prior1 = ep.energy * share1, prior2 = ep.energy * share2;
      const before = ep.energy;
      ep.energy += energy;
      ep.last = this.time;
      if (owner1 && owner2 && owner1.robot !== owner2.robot && before < BIG_HIT && ep.energy >= BIG_HIT && this.phase === 'fight') {
        this.bigHits.push({ point, energy: ep.energy });
        if (ep.energy > 3000 && this.time - this.lastBigSay > 4) {
          this.lastBigSay = this.time;
          const [hitter, hit] = owner1.part.edge !== 'blunt' ? [owner1, owner2] : [owner2, owner1];
          this.say(BIG_LINES[Math.floor(this.time * 7) % BIG_LINES.length](hitter.robot.design.name, hit.robot.design.name), 'major');
        }
      }
      if (ep.energy > 20 && ep.energy > (this.biggestHit?.energy ?? 0) && (owner1 || owner2)) {
        const names = [owner1, owner2].filter(Boolean).map((o) => `${o!.robot.design.name} ${o!.part.label.toLowerCase()}`);
        this.biggestHit = { energy: ep.energy, time: this.time, parts: names.join(' vs ') };
      }

      const loss1 = owner1 ? owner1.robot.absorb(owner1.part, energy * share1, point, prior1) : 0;
      const loss2 = owner2 ? owner2.robot.absorb(owner2.part, energy * share2, point, prior2) : 0;
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

  /**
   * `att`'s part working on `def`'s part over this step: saws cut as they
   * slide (and chainsaws as their chain runs), spikes pierce once they push
   * hard enough. Credits the damage with the judges.
   */
  private wear(att: Wear, def: Wear, force: number, slide: number, point: V3) {
    const a = att.part, d = def.part;
    if (a.detached || d.detached || a.failed || def.robot === att.robot) return;
    let loss = 0;
    let verb = '';
    if (a.edge === 'saw') {
      const speed = slide + att.robot.chainRunning(a);
      if (speed > 1.5) {
        // Tyres and internals: no hardness bonus (see hitShare).
        const ratio = d.kind === 'structure' ? cutRatio(a.material, d.material) : 1;
        const power = CUT.K * force * speed * ratio;
        loss = def.robot.cut(d, (power * STEP) / d.toughness.capacity, point);
        verb = ratio < 0.6 ? 'skating off' : ratio > 2.5 ? 'slicing through' : 'cutting into';
        if (loss > 0 && Math.random() < 0.25 && this.impacts.length < 64) this.impacts.push({ point, energy: 60 + Math.min(600, power / 20) });
      }
    } else if (a.edge === 'spike' && d.kind === 'structure') {
      // Plate only: a tyre just deforms round a point, and internals are
      // reached through the plate in front of them.
      const fp = pierceForce(d.material, d.thickness);
      if (force > fp) {
        const over = Math.min(PIERCE.MAX_OVERLOAD, force / fp - 1);
        const bite = Math.sqrt(Math.max(0.05, Math.min(4, hardnessOf(material(a.material)) / hardnessOf(material(d.material)))));
        loss = def.robot.cut(d, PIERCE.RATE * over * bite * STEP, point);
        verb = 'punching into';
      }
    }
    if (loss <= 0) return;
    const ti = att.robot.index < this.tally.length ? this.tally[att.robot.index] : null;
    if (ti && def.robot.index < this.tally.length && this.phase === 'fight') ti.damage += loss;
    const key = `${att.robot.index}>${def.robot.index}`;
    if (this.time - (this.lastCutSay.get(key) ?? -99) > 5 && this.phase !== 'countdown') {
      this.lastCutSay.set(key, this.time);
      const tool = a.def?.chain ? 'chainsaw' : a.edge === 'saw' ? 'saw' : lowerFirst(a.label);
      const metal = SHORT_NAMES[d.material] ?? material(d.material).name.toLowerCase();
      const what = d.kind === 'wheel' ? 'a tyre' : d.label.toLowerCase().includes(metal.split('-')[0]) ? lowerFirst(d.label) : `${metal} ${lowerFirst(d.label)}`;
      this.say(`${att.robot.design.name}'s ${tool} is ${verb} ${def.robot.design.name}'s ${what}!`, 'info');
    }
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
    // Counted-out robots (still in the arena) are fair game for everyone —
    // and in the finale, so is everybody.
    const fighting = this.competitors.filter((_, i) => !this.eliminated[i]);
    const victims = this.finaleStarted ? [...fighting, ...this.competitors.filter((_, i) => this.eliminated[i] === 'immobilised')]
      : this.competitors.filter((_, i) => this.eliminated[i] === 'immobilised' || (this.counts[i] ?? 0) > 3);
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
    // Decided: nobody can be put out (or counted) after the result.
    if (this.phase === 'over') return;
    if (this.finale && !this.sandbox && !this.finaleStarted && this.phase === 'fight' && this.time >= this.duration - FINALE) {
      this.finaleStarted = true;
      this.arena.pitOpen = true;
      this.say(this.houseRobots.length ? 'Thirty seconds left — the pit is open and the house robots are loose!' : 'Thirty seconds left — the pit is open!', 'major');
    }
    if (this.breaks && this.phase === 'fight') this.checkStalemates(dt);
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
      if (this.event === 'sumo' && this.phase === 'fight' && this.arena.isOffDais(pos)) return this.eliminate(i, 'off the dais');
      if (this.phase !== 'fight') return;

      // Moving under its own power resets the count; being shoved around
      // doesn't. Turning on the spot or shoving an opponent counts as control.
      // With a house robot on you, only moving the way you're driving counts:
      // they're sent after anyone on a count, and a robot genuinely escaping
      // with one on its tail is mobile — the referee can see that.
      const c = this.controls[i] ?? NEUTRAL;
      const v = r.chassis.linvel();
      const speed = Math.hypot(v.x, v.z);
      const trying = Math.abs(c.left) + Math.abs(c.right) > 0.2;
      const contact = this.contacts(i);
      if (contact.touching) this.touched(r, contact.touching);
      const active = contact.house ? drivingItself(r, c)
        : speed > 0.12 || Math.abs(r.chassis.angvel().y) > 0.6 || contact.opponent;
      const selfMoving = trying && active && r.tractionWheels() > 0;
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
      // The nearest rival is the one you're going for (in a melee there are several).
      let opp: Robot | undefined;
      let od = Infinity;
      this.competitors.forEach((o, j) => {
        if (j === i || this.eliminated[j]) return;
        const dd = Math.hypot(o.position.x - pos.x, o.position.z - pos.z);
        if (dd < od) { od = dd; opp = o; }
      });
      if (opp) {
        const to = vsub(opp.position, pos);
        const d = vlen(to);
        if (d < 4 && selfMoving && vdot(v, vscale(to, 1 / d)) > 0.5) t.aggression += dt;
        // Opponent off the ground near us: we probably put it there.
        if (d < 2 && opp.position.y > 0.35) t.style += dt * 2;
      }
    });

    // A melee: say how many are left (once, however many went out this check).
    const standing = alive().length;
    if (this.competitors.length > 2 && standing < this.lastStanding && this.lastStanding !== Infinity && standing >= 2) this.say(standing === 2 ? 'Down to the last two!' : `${standing} robots left in the arena!`, 'info');
    this.lastStanding = standing;

    if (this.event === 'football' && this.phase === 'fight') this.football();
    if (this.phase === 'fight' && !this.sandbox && this.event === 'football') {
      // A team with nobody left loses; otherwise goals decide, at 3 or at time.
      const teamLeft = [0, 1].map((t) => this.competitors.some((_, i) => i % 2 === t && !this.eliminated[i]));
      if (this.phase === 'fight' && this.competitors.length > 1 && (!teamLeft[0] || !teamLeft[1])) {
        const t = teamLeft[0] ? 0 : teamLeft[1] ? 1 : null;
        this.finish({ winner: t, reason: t === null ? 'Nobody left on the pitch' : `${TEAM[1 - t]} has nobody left on the pitch` });
      } else if (this.time >= this.duration) {
        const [r, b] = this.goals;
        if (r === b) this.finish({ winner: null, reason: `A ${r}–${b} draw` });
        else this.finish({ winner: r > b ? 0 : 1, reason: `${r}–${b} at full time` });
      }
    } else if (this.phase === 'fight' && !this.sandbox) {
      const left = alive();
      if (left.length <= 1 && this.competitors.length > 1) {
        const winner = left[0];
        // The last one out is the story (in a melee, the earlier ones are history).
        const loser = this.competitors[this.outOrder[this.outOrder.length - 1]];
        const reason = !loser ? ''
          : this.competitors.length > 2 ? `Last robot standing — ${outPhrase(loser.design.name, this.eliminated[loser.index])}`
          : outPhrase(loser.design.name, this.eliminated[loser.index]);
        this.finish({ winner: winner ? winner.index : null, reason });
      } else if (this.time >= this.duration) {
        this.judge();
      }
    }
  }

  /** Football: goals, and a ball that's gone in the pit or out of the arena comes back. */
  private football() {
    const ball = this.ball;
    if (!ball || this.phase !== 'fight') return;
    const p = ball.translation();
    const end = this.arena.goalAt(p);
    // The −z goal is red's: a ball in it is a goal for blue.
    if (end !== 0) {
      const team = end < 0 ? 1 : 0;
      this.goals[team]++;
      const [r, b] = this.goals;
      const scorer = this.ballTouch;
      this.say(`GOAL! ${scorer ? `${scorer.design.name} scores` : `${TEAM[team]} scores`}! ${TEAM[0]} ${r}, ${TEAM[1]} ${b}.`, 'major');
      this.resetBall();
      if (this.goals[team] >= GOALS_TO_WIN && this.competitors.length > 1) this.finish({ winner: team, reason: `${TEAM[team]} wins ${Math.max(r, b)}–${Math.min(r, b)}` });
      return;
    }
    if (this.arena.isOutOfArena(p) || p.y < -0.3) {
      this.say('The ball\'s gone — a new one in the centre circle.', 'info');
      this.resetBall();
    }
  }

  private resetBall() {
    const b = this.ball!;
    b.setTranslation({ x: 0, y: ARENA.football.ballRadius + 0.4, z: 0 }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.ballTouch = null;
  }

  /** Football: who touched the ball last (for "X scores!"). */
  private ballTouch: Robot | null = null;

  /**
   * Two robots shoving nose to nose, both trying, neither going anywhere: after
   * a while the referee calls a break and pulls them apart, as real fight
   * referees do. Something actually happening (one lifting the other, a
   * weapon doing damage) keeps things moving, so this only catches mashing.
   */
  private checkStalemates(dt: number) {
    const live = this.competitors.filter((_, i) => !this.eliminated[i]);
    for (let a = 0; a < live.length; a++) {
      for (let b = a + 1; b < live.length; b++) {
        const r1 = live[a], r2 = live[b];
        const key = `${r1.index}:${r2.index}`;
        const c1 = this.controls[r1.index] ?? NEUTRAL, c2 = this.controls[r2.index] ?? NEUTRAL;
        const trying = (c: ControlState) => Math.abs(c.left) + Math.abs(c.right) > 0.3;
        const slow = (r: Robot) => { const v = r.chassis.linvel(); return Math.hypot(v.x, v.z) < 0.2 && Math.abs(r.chassis.angvel().y) < 0.5; };
        const close = vlen(vsub({ ...r1.position, y: 0 }, { ...r2.position, y: 0 })) < 1.3;
        const grounded = r1.position.y < 0.4 && r2.position.y < 0.4;
        const mashing = close && grounded && trying(c1) && trying(c2) && slow(r1) && slow(r2) && this.touching(r1.index, r2);
        const t = mashing ? (this.locked.get(key) ?? 0) + dt : Math.max(0, (this.locked.get(key) ?? 0) - dt * 2);
        this.locked.set(key, t);
        if (t < STALEMATE) continue;
        this.locked.set(key, 0);
        this.separate(r1, r2);
      }
    }
  }

  private touching(i: number, other: Robot): boolean {
    return this.contacts(i).touching === other;
  }

  /** The referee's break: both robots back off to arm's length, facing each other. */
  private separate(r1: Robot, r2: Robot) {
    const d = vsub({ ...r2.position, y: 0 }, { ...r1.position, y: 0 });
    const len = vlen(d) || 1;
    const dir = vscale(d, 1 / len);
    const gap = Math.max(0, 1.6 - len) / 2;
    const lim = ARENA.half - 0.7;
    const clamp = (p: V3, shift: V3): V3 => {
      const q = vadd(p, shift);
      return { x: Math.max(-lim, Math.min(lim, q.x)) - p.x, y: 0.03, z: Math.max(-lim, Math.min(lim, q.z)) - p.z };
    };
    r1.shift(clamp(r1.position, vscale(dir, -gap)));
    r2.shift(clamp(r2.position, vscale(dir, gap)));
    for (const r of [r1, r2]) this.lastSelfMove[r.index] = this.time;
    this.say(`Stalemate! The referee breaks up ${r1.design.name} and ${r2.design.name}.`, 'info');
  }

  /** Is competitor `i` touching another competitor, and is it touching a house robot? */
  /** Pointed rounds that went in this step, stuck in once the contacts are read. */
  private embeds: Array<{ robot: Robot; round: Round; body: RAPIER.RigidBody; victim: Robot }> = [];

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
          // Loose bits (shed armour, spent rounds) aren't anyone driving into you.
          const j = this.robots.findIndex((r, k) => k !== i && r.partFor(other) && !r.partFor(other)!.detached);
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
    this.outOrder.push(i);
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
    // Highest total wins; a tie goes to damage, then aggression; still level is a draw.
    const rank = (s: JudgeScore) => [s.total, s.damage, s.aggression];
    const order = scores.map((_, i) => i).sort((a, b) => {
      const ra = rank(scores[a]), rb = rank(scores[b]);
      for (let k = 0; k < ra.length; k++) if (Math.abs(ra[k] - rb[k]) > 0.05) return rb[k] - ra[k];
      return 0;
    });
    const [best, next] = order;
    const level = next !== undefined && rank(scores[best]).every((v, k) => Math.abs(v - rank(scores[next])[k]) <= 0.05);
    if (level) this.finish({ winner: null, reason: "A draw — the judges couldn't separate them", scores });
    else this.finish({ winner: best, reason: scores[best].total - scores[next ?? best].total <= 0.05 ? "Judges' decision, on damage" : "Judges' decision", scores });
  }

  private finish(result: MatchResult) {
    this.phase = 'over';
    this.result = result;
    this.endTime = this.time;
    if (result.winner === null) this.say(`${result.reason}!`, 'major');
    else this.say(`${this.robots[result.winner].design.name} wins! ${result.reason}`, 'major');
  }

  private say(text: string, level: CommentaryLine['level']) {
    this.commentary.push({ time: Math.max(0, this.time), text, level });
  }

  free() {
    this.world.free();
    this.events.free();
  }
}

const TEAM = ['Red', 'Blue'];

/** "Flipside was immobilised", "Whisk went into the pit". */
const outPhrase = (name: string, how: string | null): string => (how === 'immobilised' ? `${name} was immobilised` : `${name} went ${how ?? 'out'}`);

/**
 * Side events' starting places. Sumo: round the middle of the dais, facing
 * in. Football: each team in front of its own goal, facing up the pitch.
 */
function eventSpawns(event: GameEvent, n: number): Array<{ pos: V3; yaw: number }> | null {
  if (event === 'sumo') {
    const y = ARENA.dais.height + 0.01;
    return [...Array(n).keys()].map((i) => {
      const a = (i / n) * Math.PI * 2 + (n === 2 ? 0 : Math.PI / 4);
      const r = 1.25;
      const x = Math.sin(a) * r, z = -Math.cos(a) * r;
      return { pos: { x, y, z }, yaw: Math.atan2(-x, -z) };
    });
  }
  if (event === 'football') {
    return [...Array(n).keys()].map((i) => {
      const team = i % 2, k = Math.floor(i / 2);
      const perTeam = Math.ceil((n - team) / 2);
      const x = perTeam > 1 ? (k === 0 ? 1.3 : -1.3) : 0;
      return { pos: { x, y: 0.01, z: team === 0 ? -2.6 : 2.6 }, yaw: team === 0 ? 0 : Math.PI };
    });
  }
  return null;
}

const SHORT_NAMES: Record<string, string> = {
  aluminium: 'aluminium', mildSteel: 'steel', hardox: 'hardened-steel', titanium: 'titanium', hdpe: 'plastic',
  polycarbonate: 'polycarbonate', rubber: 'rubber', ptfe: 'PTFE', plywood: 'plywood',
};

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** What the commentator says about a big hit. */
const BIG_LINES: Array<(a: string, b: string) => string> = [
  (a, b) => `Oof! ${a} lands a massive hit on ${b}!`,
  (a, b) => `What a hit from ${a}! ${b} felt that one.`,
  (a, b) => `${b} takes a huge blow from ${a}!`,
  (a) => `${a} connects — the whole arena shook!`,
];

/** Join a robot name and an event fragment into a sentence. */
function phrase(name: string, text: string): string {
  if (text.startsWith("'s")) return `${name}${text}`;
  if (text.startsWith('— ')) return `${name}: ${text.slice(2)}`;
  return `${name} ${text}`;
}

/**
 * Is the robot moving the way its controls are driving it (not just moving)?
 * Forward speed along its own heading in the direction of the throttle, or
 * yaw the way it's steering. A shove from a house robot sends you somewhere
 * else, so it doesn't pass. Upside down the wheels touch the floor on the
 * other side of their axles, so the drive runs backwards along the body.
 */
export function drivingItself(r: Robot, c: ControlState): boolean {
  const throttle = (c.left + c.right) / 2, turn = (c.left - c.right) / 2;
  const v = r.chassis.linvel();
  const fwd = qrotate(r.rotation, { x: 0, y: 0, z: 1 });
  const up = r.uprightness < 0 ? -1 : 1;
  const along = (v.x * fwd.x + v.z * fwd.z) * up * Math.sign(throttle);
  // Left side faster turns right: clockwise from above, negative yaw.
  const yaw = -r.chassis.angvel().y * Math.sign(turn);
  return (Math.abs(throttle) > 0.1 && along > SELF_DRIVE.speed) || (Math.abs(turn) > 0.1 && yaw > SELF_DRIVE.yaw);
}
