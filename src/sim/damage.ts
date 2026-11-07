import { hardnessOf, material } from '../data/materials';
import type { EdgeKind } from './design';

/**
 * Damage tuning. Everything that turns a contact into part damage lives here
 * so balance is one file.
 *
 * For every contact the physics engine reports, we estimate the energy the
 * impact dissipated:
 *
 *   E      ≈ ½ × j × v_approach     (j = impulse this step, v = closing speed at the contact)
 *
 * Shoving matches have big impulses but almost no closing speed, so they do
 * nothing. A spinner tooth closing at 40 m/s does a lot. Each side of the
 * contact absorbs half.
 *
 *   E_y    = YIELD_K × σ_yield(MPa) × t(mm)²      (elastic: shrugged off)
 *   damage = max(0, E − E_y) / (CAP_K × toughness × t(mm) × sizeFactor)
 *
 * A part's `condition` starts at 1 and the part fails at 0. Against the
 * arena itself (floor, walls) the robot takes the whole impact. Internals also
 * suffer from shock (see SHOCK), which is how flips and slams hurt robots.
 */
export const DAMAGE = {
  YIELD_K: 0.02,
  CAP_K: 1000,
  /** Fraction of a panel hit passed to nearby internals, before armour absorbs some. */
  TRANSMIT: 0.6,
  /** Internals further than this from the hit (m) feel nothing. */
  TRANSMIT_RADIUS: 0.35,
  /** Motors, battery, gas system (J). */
  COMPONENT_YIELD: 80,
  COMPONENT_CAP: 1500,
  /** Wheels and their mounts (J). */
  WHEEL_YIELD: 200,
  WHEEL_CAP: 2500,
  /** Contacts weaker than this (N) aren't reported by the physics engine at all. */
  EVENT_THRESHOLD: 600,
};

/**
 * Shock: what a hard landing, a big flip or a full-speed slam into the wall
 * does to the batteries, speed controllers and motors bolted inside. It goes
 * on the chassis' change of velocity over a short window (gravity taken out,
 * so free fall is nothing): below FREE m/s the internals don't care, above it
 * each takes K × (Δv − FREE)² × its sensitivity.
 */
export const SHOCK = {
  /** Window over which a jolt is measured, physics steps (~25 ms). */
  WINDOW: 12,
  FREE: 2.0,
  K: 0.01,
  battery: 1,
  electronics: 1,
  actuator: 0.6,
  gasTank: 0.5,
  flamethrower: 0.5,
  ballast: 0,
};

/**
 * Edges and hardness. Robot on robot, each side of an impact used to take
 * half; now the defender's share is
 *
 *   share = ½ × EDGE.factor[attacker's edge] × (H_attacker / H_defender)^EDGE.HARDNESS_EXP[edge]
 *
 * clamped to ½ × [MIN, MAX]. Hardness only counts plate against plate: tyres
 * and internals take the plain ½ × edge factor, because their toughness is
 * calibrated that way (rubber is far softer than steel but tough, and a
 * hardness ratio of 250 would make every touch take a wheel off).
 *
 * Resulting multipliers on the old even split: hardened tooth on aluminium
 * ×2.1, on mild steel ×1.9, on hardened steel ×1.2; aluminium tooth on
 * hardened steel ×0.7; hardened-steel wedge on aluminium ×1.3; a blade on a
 * tyre ×1.2; same-metal blunt plate ×1 (unchanged).
 */
export const EDGE = {
  factor: { blunt: 1, blade: 1.2, spike: 1.4, saw: 1 } as Record<EdgeKind, number>,
  HARDNESS_EXP: { blunt: 0.15, blade: 0.35, spike: 0.35, saw: 0.35 } as Record<EdgeKind, number>,
  MIN: 0.3,
  MAX: 2.5,
};

/** What `hitShare` needs to know about each side of a contact. */
export interface HitSide {
  kind: string;
  material: string;
  edge: EdgeKind;
}

/** Share of a robot-on-robot impact's energy taken by `defender` when struck by `attacker` (½ for equal blunt plate). */
export function hitShare(attacker: HitSide, defender: HitSide): number {
  const plates = attacker.kind === 'structure' && defender.kind === 'structure';
  const r = plates ? hardnessOf(material(attacker.material)) / hardnessOf(material(defender.material)) : 1;
  const k = EDGE.factor[attacker.edge] * r ** EDGE.HARDNESS_EXP[attacker.edge];
  return 0.5 * Math.max(EDGE.MIN, Math.min(EDGE.MAX, k));
}

/**
 * Saws and chainsaws cut as they slide: cutting power = K × normal force ×
 * sliding speed × (H_saw / H_plate)^0.8, taken straight off the part's
 * capacity (no elastic threshold — teeth remove metal however light the
 * touch). A chainsaw pressed into 6 mm aluminium is through it in a couple of
 * seconds; hardened steel takes several times as long.
 */
export const CUT = {
  K: 0.035,
  /** Contacts this light still cut (N) — a saw doesn't need to hit. */
  EVENT_THRESHOLD: 40,
  MIN_RATIO: 0.15,
  MAX_RATIO: 10,
};

/**
 * Crushers and spikes pierce under steady force, not just impacts. A plate
 * resists a point up to F_p = K × σ_yield(MPa) × t(mm) newtons (about 4 kN
 * for 6 mm aluminium, 19 kN for 6 mm hardened steel). Beyond that it loses
 * RATE × (F/F_p − 1) of its condition per second (capped at MAX_OVERLOAD),
 * scaled by (H_spike / H_plate)^0.5 — a soft spike just blunts.
 */
export const PIERCE = {
  K: 2.5,
  RATE: 0.35,
  MAX_OVERLOAD: 4,
};

/** How much harder an edge of `edge` in `attacker` material hits a part of `defender` material. */
export function edgeFactor(edge: EdgeKind, attacker: string, defender: string): number {
  const r = hardnessOf(material(attacker)) / hardnessOf(material(defender));
  const k = EDGE.factor[edge] * r ** EDGE.HARDNESS_EXP[edge];
  return Math.max(EDGE.MIN, Math.min(EDGE.MAX, k));
}

/** Share of a robot-on-robot impact taken by the side made of `mine` (vs `theirs`): softer takes more. */
export function impactShare(mine: string, theirs: string): number {
  const a = 1 / Math.sqrt(hardnessOf(material(mine))), b = 1 / Math.sqrt(hardnessOf(material(theirs)));
  return a / (a + b);
}

/** Saw cutting rate multiplier for teeth of `saw` material into `plate` material. */
export function cutRatio(saw: string, plate: string): number {
  const r = (hardnessOf(material(saw)) / hardnessOf(material(plate))) ** 0.8;
  return Math.max(CUT.MIN_RATIO, Math.min(CUT.MAX_RATIO, r));
}

/** Force (N) a point needs to start piercing a plate of `materialId`, `thicknessMm` thick. */
export function pierceForce(materialId: string, thicknessMm: number): number {
  return PIERCE.K * material(materialId).yieldStrength * thicknessMm;
}

export interface Toughness {
  /** Energy absorbed elastically, J. */
  yieldEnergy: number;
  /** Energy beyond yield that destroys the part, J. */
  capacity: number;
}

export function plateToughness(materialId: string, thicknessMm: number, faceArea: number): Toughness {
  const m = material(materialId);
  // Bigger panels spread a hit over more metal before tearing.
  const sizeFactor = Math.sqrt(Math.max(faceArea, 0.01) / 0.25);
  return {
    yieldEnergy: DAMAGE.YIELD_K * m.yieldStrength * thicknessMm * thicknessMm,
    capacity: DAMAGE.CAP_K * m.toughness * thicknessMm * sizeFactor,
  };
}

export const COMPONENT_TOUGHNESS: Toughness = { yieldEnergy: DAMAGE.COMPONENT_YIELD, capacity: DAMAGE.COMPONENT_CAP };
export const WHEEL_TOUGHNESS: Toughness = { yieldEnergy: DAMAGE.WHEEL_YIELD, capacity: DAMAGE.WHEEL_CAP };

/** Condition lost for a given absorbed energy. */
export function damageFor(energy: number, t: Toughness): number {
  return Math.max(0, energy - t.yieldEnergy) / t.capacity;
}

/** How much of a hit a panel lets through to the parts behind it (0..1). */
export function transmission(materialId: string, thicknessMm: number, condition: number): number {
  const m = material(materialId);
  const absorb = 1 / (1 + 0.08 * thicknessMm * m.toughness);
  // Battered armour protects less.
  return DAMAGE.TRANSMIT * (absorb + (1 - absorb) * (1 - Math.max(0, condition)));
}

/**
 * Flame pit: condition lost per second of direct flame. Tyres and plastics
 * suffer most; steel barely notices. Internals behind armour get a fraction.
 */
export const HEAT = {
  wheel: 0.12,
  electronics: 0.05,
  battery: 0.04,
  driveMotor: 0.015,
  weaponMotor: 0.015,
  gas: 0.03,
  shielded: 0.3,
  plate: { aluminium: 0.012, mildSteel: 0.003, hardox: 0.003, titanium: 0.002, hdpe: 0.09, polycarbonate: 0.08 } as Record<string, number>,
};

export type ConditionLabel = 'OK' | 'Scuffed' | 'Damaged' | 'Failing' | 'Destroyed';

export function conditionLabel(c: number): ConditionLabel {
  if (c <= 0) return 'Destroyed';
  if (c < 0.3) return 'Failing';
  if (c < 0.65) return 'Damaged';
  if (c < 0.97) return 'Scuffed';
  return 'OK';
}
