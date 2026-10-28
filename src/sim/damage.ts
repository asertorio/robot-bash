import { material } from '../data/materials';

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
 * A part's `condition` starts at 1 and the part fails at 0.
 */
export const DAMAGE = {
  YIELD_K: 0.032,
  CAP_K: 1000,
  /** Fraction of a panel hit passed to nearby internals, before armour absorbs some. */
  TRANSMIT: 0.6,
  /** Internals further than this from the hit (m) feel nothing. */
  TRANSMIT_RADIUS: 0.35,
  /** Motors, battery, gas system (J). */
  COMPONENT_YIELD: 120,
  COMPONENT_CAP: 1500,
  /** Wheels and their mounts (J). */
  WHEEL_YIELD: 350,
  WHEEL_CAP: 2500,
  /** Contacts weaker than this (N) aren't reported by the physics engine at all. */
  EVENT_THRESHOLD: 600,
};

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

export type ConditionLabel = 'OK' | 'Scuffed' | 'Damaged' | 'Failing' | 'Destroyed';

export function conditionLabel(c: number): ConditionLabel {
  if (c <= 0) return 'Destroyed';
  if (c < 0.3) return 'Failing';
  if (c < 0.65) return 'Damaged';
  if (c < 0.97) return 'Scuffed';
  return 'OK';
}
