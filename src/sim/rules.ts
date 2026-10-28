import { BATTERIES, MOTORS, RAMS, WHEELS, lookup } from '../data/parts';
import type { RobotDesign } from './design';
import { panelVertices } from './geometry';
import { bladeProps, computeStats, type RobotStats } from './stats';

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
export function scrutineer(d: RobotDesign, rules: Rules = DEFAULT_RULES, stats: RobotStats = computeStats(d)): Issue[] {
  const out: Issue[] = [];
  const err = (text: string) => out.push({ level: 'error', text });
  const warn = (text: string) => out.push({ level: 'warning', text });

  if (stats.mass > rules.weight.limit) err(`${(stats.mass - rules.weight.limit).toFixed(1)} kg over the ${rules.weight.name.toLowerCase()} limit of ${rules.weight.limit} kg.`);
  if (rules.budget.limit !== null && stats.cost > rules.budget.limit) err(`£${Math.round(stats.cost - rules.budget.limit).toLocaleString('en-GB')} over the £${rules.budget.limit.toLocaleString('en-GB')} budget.`);
  if (!d.shell.length) err('It needs at least one armour panel to hold everything together.');
  if (!d.drive.wheels.length) err('It has no wheels.');
  if (!d.drive.wheels.some((w) => w.side === 'left') || !d.drive.wheels.some((w) => w.side === 'right')) err('It needs wheels on both sides to steer.');
  if (!d.name.trim()) err('Give it a name.');

  // Fit and clearance.
  let minY = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of d.shell) {
    for (const v of panelVertices(p)) {
      const x = v[0] + p.position[0], y = v[1] + p.position[1], z = v[2] + p.position[2];
      minY = Math.min(minY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    if (p.thickness < 1 || p.thickness > 50) err(`${p.label}: plate must be 1–50 mm thick.`);
  }
  for (const w of d.drive.wheels) {
    const r = lookup(WHEELS, w.wheel, 'wheel').radius;
    minX = Math.min(minX, w.position[0] - 0.05); maxX = Math.max(maxX, w.position[0] + 0.05);
    minZ = Math.min(minZ, w.position[2] - r); maxZ = Math.max(maxZ, w.position[2] + r);
  }
  if (minY < 0.004) err('The armour scrapes the floor — raise it or use bigger wheels.');
  else if (minY > 0.08) warn(`${Math.round(minY * 1000)} mm ground clearance: wedges will get straight underneath you.`);
  if (maxX - minX > MAX_SIZE || maxZ - minZ > MAX_SIZE) err(`Too big: it must fit in ${MAX_SIZE} m × ${MAX_SIZE} m.`);

  // Electrics.
  const battery = lookup(BATTERIES, d.battery.part, 'battery');
  const checkVolts = (motorId: string, what: string) => {
    const m = lookup(MOTORS, motorId, 'motor');
    const ratio = battery.voltage / m.voltage;
    if (ratio > 1.6) err(`${what}: ${battery.voltage} V into a ${m.voltage} V motor will burn it out.`);
    else if (ratio > 1.15) warn(`${what} over-volted (${battery.voltage} V into ${m.voltage} V): more power, harder on the motor.`);
    else if (ratio < 0.75) warn(`${what} under-volted (${battery.voltage} V into ${m.voltage} V): it will be sluggish.`);
  };
  checkVolts(d.drive.motor, 'Drive');
  if (stats.runtime < FIGHT_LENGTH) warn(`The battery may go flat before a 3-minute fight ends (~${(stats.runtime / 60).toFixed(1)} min).`);
  if (stats.pushLimit === 'battery') warn('The battery can\'t supply full current to the drive: pushing power is battery-limited.');

  for (const w of d.weapons) {
    if (w.kind === 'flipper') {
      const ram = lookup(RAMS, w.ram, 'ram');
      if (w.pressure > ram.maxPressure) warn(`Flipper pressure is capped at the ram's ${ram.maxPressure} bar rating.`);
      if (w.hinge[1] > w.plate.length) warn('The flipper plate is too short to reach the floor, so it can\'t get under anyone.');
    } else {
      checkVolts(w.motor, 'Spinner');
      const r = bladeProps(w).tipRadius;
      const low = w.orientation === 'vertical' ? w.position[1] - r : w.position[1] - w.blade.thickness / 2000;
      if (low < 0.005) err('The spinner blade hits the floor.');
    }
  }
  return out;
}

export function isLegal(issues: Issue[]): boolean {
  return !issues.some((i) => i.level === 'error');
}
