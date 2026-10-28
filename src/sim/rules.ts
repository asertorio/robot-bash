import { material } from '../data/materials';
import { BATTERIES, MOTORS, RAMS, lookup } from '../data/parts';
import { designBounds, partFrames, rigidGroup, root, shapeCorners, treeErrors } from './assembly';
import type { RobotDesign } from './design';
import { computeStats, isLocomotion, type RobotStats } from './stats';

export interface WeightClass {
  id: string;
  name: string;
  /** kg */
  limit: number;
}

export const WEIGHT_CLASSES: WeightClass[] = [
  { id: 'feather', name: 'Featherweight', limit: 15 },
  { id: 'light', name: 'Lightweight', limit: 30 },
  { id: 'middle', name: 'Middleweight', limit: 55 },
  { id: 'heavy', name: 'Heavyweight', limit: 100 },
];

export interface BudgetClass {
  id: string;
  name: string;
  /** £, or null for no limit. */
  limit: number | null;
}

export const BUDGETS: BudgetClass[] = [
  { id: 'none', name: 'No budget limit', limit: null },
  { id: 'b5000', name: '£5,000 build', limit: 5000 },
  { id: 'b3000', name: '£3,000 build', limit: 3000 },
  { id: 'b1500', name: '£1,500 build', limit: 1500 },
];

/** Largest footprint dimension allowed through the arena doors, m. */
export const MAX_SIZE = 1.5;
const FIGHT_LENGTH = 180;

export interface Issue {
  level: 'error' | 'warning';
  text: string;
}

export interface Rules {
  weight: WeightClass;
  budget: BudgetClass;
}

export const DEFAULT_RULES: Rules = { weight: WEIGHT_CLASSES[3], budget: BUDGETS[0] };

/**
 * Scrutineering: what stops a design fighting (errors) and what the builder
 * should know about (warnings). Like the show's tech check before a fight.
 */
export function scrutineer(d: RobotDesign, rules: Rules = DEFAULT_RULES, stats?: RobotStats): Issue[] {
  const out: Issue[] = [];
  const err = (text: string) => out.push({ level: 'error', text });
  const warn = (text: string) => out.push({ level: 'warning', text });

  const tree = treeErrors(d);
  if (tree.length) { tree.forEach(err); return out; }
  try { stats ??= computeStats(d); } catch (e) { err((e as Error).message); return out; }

  if (!d.name.trim()) err('Give it a name.');
  if (stats.mass > rules.weight.limit) err(`${(stats.mass - rules.weight.limit).toFixed(1)} kg over the ${rules.weight.name.toLowerCase()} limit of ${rules.weight.limit} kg.`);
  if (rules.budget.limit !== null && stats.cost > rules.budget.limit) err(`£${Math.round(stats.cost - rules.budget.limit).toLocaleString('en-GB')} over the £${rules.budget.limit.toLocaleString('en-GB')} budget.`);

  // Fit and the floor.
  const b = designBounds(d);
  if (b.max.x - b.min.x > MAX_SIZE || b.max.z - b.min.z > MAX_SIZE) err(`Too big: it must fit in ${MAX_SIZE} m × ${MAX_SIZE} m.`);
  if (b.min.y < -0.003) err(`Something is ${Math.round(-b.min.y * 1000)} mm below the floor — raise it.`);
  else if (b.min.y > 0.02) warn(`The lowest point is ${Math.round(b.min.y * 1000)} mm up: it will drop onto the floor when placed.`);
  const frames = partFrames(d);
  for (const p of d.parts) {
    if (p.role !== 'structure') continue;
    const low = Math.min(...shapeCorners(p, frames.get(p.id)!).map((c) => c.y));
    const slippery = (p.material && material(p.material).friction < 0.15) || p.material === 'rubber';
    const fixedToChassis = rigidGroup(d, root(d).id).includes(p.id);
    if (low < 0.004 && fixedToChassis && !slippery) warn(`${p.label} touches the floor and will drag (use PTFE skids or raise it).`);
    if (p.wall && p.wall > 50) err(`${p.label}: walls over 50 mm — make it solid instead.`);
  }

  // Power.
  const batteries = d.parts.filter((p) => p.component?.type === 'battery').map((p) => lookup(BATTERIES, (p.component as { part: string }).part, 'battery'));
  if (!batteries.length) err('No battery: nothing will move.');
  const volts = batteries.length ? Math.max(...batteries.map((x) => x.voltage)) : 0;
  if (new Set(batteries.map((x) => x.voltage)).size > 1) warn('Batteries of different voltages in parallel: the lower ones will be overcharged.');
  const acts = d.parts.flatMap((p) => (p.joint.type !== 'fixed' && p.joint.actuator ? [{ p, a: p.joint.actuator }] : []));
  for (const { p, a } of acts) {
    if (a.type === 'pneumatic') {
      const ram = lookup(RAMS, a.ram, 'ram');
      if (a.pressure > ram.maxPressure) warn(`${p.label}: pressure capped at the ram's ${ram.maxPressure} bar rating.`);
      continue;
    }
    const m = lookup(MOTORS, a.motor, 'motor');
    const ratio = volts / m.voltage;
    if (!volts) continue;
    if (ratio > 1.6) err(`${p.label}: ${volts} V into a ${m.voltage} V motor will burn it out.`);
    else if (ratio > 1.15) warn(`${p.label} over-volted (${volts} V into ${m.voltage} V): more power, harder on the motor.`);
    else if (ratio < 0.75) warn(`${p.label} under-volted (${volts} V into ${m.voltage} V): it will be sluggish.`);
    if (a.type === 'servo' && p.joint.type === 'hinge' && p.joint.limits) {
      const [lo, hi] = p.joint.limits;
      if (a.targets.some((t) => t < lo - 0.5 || t > hi + 0.5)) warn(`${p.label}: servo targets go beyond the hinge limits.`);
    }
  }
  if (acts.some(({ a }) => a.type === 'pneumatic') && !d.parts.some((p) => p.component?.type === 'gasTank')) err('Pneumatics fitted but no gas bottle to run them.');
  if (!acts.some(({ a }) => isLocomotion(a))) warn("Nothing is wired to the drive controls: it can't move itself and will be counted out.");
  if (stats.runtime < FIGHT_LENGTH) warn(`The battery may go flat before a 3-minute fight ends (~${(stats.runtime / 60).toFixed(1)} min).`);
  if (stats.pushLimit === 'battery') warn('The battery can\'t supply full current to the drive: pushing power is battery-limited.');
  return out;
}

export function isLegal(issues: Issue[]): boolean {
  return !issues.some((i) => i.level === 'error');
}
