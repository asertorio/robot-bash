import { BATTERIES, MOTORS, RAMS, TANKS, VALVES, WHEELS, lookup } from '../data/parts';
import { CpuDriver } from './ai';
import type { RobotDesign } from './design';
import { Match, type MatchOptions } from './match';
import type { Part, Robot } from './robot';

/**
 * The championship: eight robots, a knockout — quarter-finals, semis, the
 * final — the way a series' heats fed its grand final. Damage carries over:
 * between rounds each team has limited time in the pit, and what isn't
 * fixed goes into the next fight as it is.
 *
 * Bouts nobody's playing are fought for real, headless, a slice at a time
 * (`Bout`): two CPU drivers in an ordinary Match. No result is ever made up.
 */
export const PIT = {
  /** Pit time between rounds, minutes. */
  minutes: 60,
  /** Fixing a part takes its swap time × how badly it's damaged (a wreck: the full time). */
  wreck: 1,
  /** Below this condition a part counts as worth fixing at all. */
  worthFixing: 0.97,
  /** Structure has no catalogue swap time: cutting and bolting on new plate. */
  plateMinutes: 25,
  electronicsMinutes: 15,
};

export interface Entrant {
  design: RobotDesign;
  human: boolean;
  /** Each part's condition, by index in the built robot's parts (null: as new). */
  wear: number[] | null;
}

/** A part as it came out of a fight, for the pit screen. */
export interface PitItem {
  index: number;
  label: string;
  kind: Part['kind'];
  condition: number;
  /** Minutes to make it as new. */
  minutes: number;
}

/** Conditions after a fight: anything that came off or failed is at 0. */
export function wearOf(r: Robot): number[] {
  return r.parts.map((p) => (p.detached || p.failed ? 0 : p.condition));
}

/** Catalogue swap time for a part, minutes. */
function swapMinutes(p: Part): number {
  const d = p.def;
  try {
    if (p.kind === 'wheel' && d?.wheel) return lookup(WHEELS, d.wheel, 'wheel').swapMinutes;
    if (p.kind === 'electronics') return PIT.electronicsMinutes;
    if (p.kind === 'component' && d?.component) {
      if (d.component.type === 'battery') return lookup(BATTERIES, d.component.part, 'battery').swapMinutes;
      if (d.component.type === 'gasTank') return lookup(TANKS, d.component.part, 'tank').swapMinutes;
      return 20;
    }
    if (p.kind === 'actuator') {
      const a = d?.joint && 'actuator' in d.joint ? d.joint.actuator : undefined;
      if (a?.type === 'pneumatic') return lookup(RAMS, a.ram, 'ram').swapMinutes + lookup(VALVES, a.valve, 'valve').swapMinutes;
      if (a && 'motor' in a) return lookup(MOTORS, a.motor, 'motor').swapMinutes + 10;
      return 20;
    }
  } catch {
    // A custom part not in the catalogue: a fair guess.
  }
  return PIT.plateMinutes;
}

/** What needs fixing on a robot after a fight, worst first. */
export function pitList(r: Robot, wear: number[]): PitItem[] {
  return r.parts
    .map((p, index) => ({ index, label: p.label, kind: p.kind, condition: wear[index] ?? 1, minutes: 0, p }))
    .filter((x) => x.condition < PIT.worthFixing && !r.isAmmo(x.p))
    .map(({ p, ...x }) => ({ ...x, minutes: Math.max(2, Math.round(swapMinutes(p) * (x.condition <= 0 ? PIT.wreck : 1 - x.condition) * 1.2)) }))
    .sort((a, b) => a.condition - b.condition);
}

/** Fix the chosen parts: they go back to as new. */
export function repair(wear: number[], items: PitItem[]): number[] {
  const out = [...wear];
  for (const it of items) out[it.index] = 1;
  return out;
}

/**
 * A CPU team's pit crew: what stops the robot working comes first (radio,
 * battery, wheels, weapon), then the worst-damaged armour, while time lasts.
 */
export function cpuRepairs(items: PitItem[], minutes = PIT.minutes): PitItem[] {
  const vital = (k: Part['kind']) => (k === 'electronics' ? 0 : k === 'component' ? 1 : k === 'wheel' ? 2 : k === 'actuator' ? 3 : 4);
  const order = [...items].sort((a, b) => (a.condition <= 0 ? 0 : 1) - (b.condition <= 0 ? 0 : 1) || vital(a.kind) - vital(b.kind) || a.condition - b.condition);
  const out: PitItem[] = [];
  let left = minutes;
  for (const it of order) if (it.minutes <= left) { out.push(it); left -= it.minutes; }
  return out;
}

/**
 * A bout between two CPU robots, fought headless a slice at a time so the
 * page keeps running (`advance` a few hundred physics steps per frame).
 */
export class Bout {
  readonly match: Match;
  private cpus = [new CpuDriver(), new CpuDriver()];

  constructor(readonly a: number, readonly b: number, entrants: Entrant[], opts: MatchOptions) {
    this.match = new Match([entrants[a].design, entrants[b].design], { ...opts, skipCountdown: true, wear: [entrants[a].wear, entrants[b].wear] });
  }

  get done(): boolean {
    return this.match.phase === 'over';
  }

  /** Run up to `steps` physics steps. */
  advance(steps: number) {
    const m = this.match;
    for (let s = 0; s < steps && m.phase !== 'over'; s++) {
      const inputs = m.competitors.map((r, i) => this.cpus[i].update(r, m.competitors[1 - i], m.arena.pitOpen, 1 / 480));
      m.update(1 / 480, inputs);
    }
  }

  /** Who went through: the winner, or on a dead level draw, a coin toss. */
  winner(): number {
    const w = this.match.result?.winner;
    return w === 0 ? this.a : w === 1 ? this.b : Math.random() < 0.5 ? this.a : this.b;
  }

  free() {
    this.match.free();
  }
}

/** Winners of one round, paired off for the next (1 v 2, 3 v 4…). */
export const pairUp = (winners: number[]): Array<[number, number]> =>
  [...Array(Math.floor(winners.length / 2)).keys()].map((k) => [winners[2 * k], winners[2 * k + 1]]);

export const ROUND_NAMES = ['Quarter-final', 'Semi-final', 'Final'];

/** What a finished bout reports: who went through, how, and both robots' damage. */
export interface BoutResult {
  winner: number;
  reason: string;
  /** Wear after the fight, with the winner's pit crew's repairs done (a CPU team's). */
  wear: [number[], number[]];
  /** The big moments, for the bracket. */
  highlights: string[];
}

/** Fight a CPU bout from start to finish (in a worker, or a test). */
export function fightBout(entrants: [Entrant, Entrant], opts: MatchOptions): BoutResult {
  const bout = new Bout(0, 1, entrants, opts);
  while (!bout.done) bout.advance(4800);
  const m = bout.match;
  const winner = bout.winner();
  const wear = m.competitors.map(wearOf) as [number[], number[]];
  // The winner goes back to the pit; its crew fixes what it can.
  const w = m.competitors[winner];
  wear[winner] = repair(wear[winner], cpuRepairs(pitList(w, wear[winner])));
  const result = { winner, reason: m.result?.reason ?? '', wear, highlights: m.commentary.filter((l) => l.level === 'major' && l.text !== 'Activate!').slice(-4).map((l) => l.text) };
  bout.free();
  return result;
}
