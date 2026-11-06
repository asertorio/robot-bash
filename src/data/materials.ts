export type Sourcing = 'common' | 'specialist' | 'custom';

export interface Material {
  id: string;
  name: string;
  /** kg/m³ */
  density: number;
  /** Yield strength, MPa. Drives how big a hit a plate shrugs off. */
  yieldStrength: number;
  /** Relative energy absorption before failure (aluminium = 1). */
  toughness: number;
  /** £ per kg of finished plate. */
  costPerKg: number;
  sourcing: Sourcing;
  /** Render colour for unpainted parts. */
  colour: number;
  /** Sliding friction against the steel arena floor. */
  friction: number;
  /**
   * Brinell hardness (HB). A hard edge bites into a softer plate: hardened
   * steel teeth chew aluminium, aluminium teeth skate off hardened steel.
   * Optional for custom materials (worked out from the yield strength).
   */
  hardness?: number;
}

export const MATERIALS: Record<string, Material> = {
  aluminium: {
    id: 'aluminium', name: 'Aluminium 6082', density: 2700, yieldStrength: 260,
    toughness: 1.0, costPerKg: 8, sourcing: 'common', colour: 0xb8bcc2, friction: 0.35, hardness: 95,
  },
  mildSteel: {
    id: 'mildSteel', name: 'Mild steel', density: 7850, yieldStrength: 250,
    toughness: 1.3, costPerKg: 2, sourcing: 'common', colour: 0x6f7378, friction: 0.35, hardness: 130,
  },
  hardox: {
    id: 'hardox', name: 'Hardened steel (AR500)', density: 7850, yieldStrength: 1250,
    toughness: 0.9, costPerKg: 6, sourcing: 'specialist', colour: 0x4a4e54, friction: 0.3, hardness: 500,
  },
  titanium: {
    id: 'titanium', name: 'Titanium Ti-6Al-4V', density: 4430, yieldStrength: 880,
    toughness: 1.6, costPerKg: 60, sourcing: 'specialist', colour: 0x9a9890, friction: 0.35, hardness: 330,
  },
  hdpe: {
    id: 'hdpe', name: 'HDPE plastic', density: 950, yieldStrength: 25,
    toughness: 2.0, costPerKg: 5, sourcing: 'common', colour: 0xe8e8e0, friction: 0.25, hardness: 6,
  },
  polycarbonate: {
    id: 'polycarbonate', name: 'Polycarbonate', density: 1200, yieldStrength: 65,
    toughness: 2.2, costPerKg: 10, sourcing: 'common', colour: 0xcfe3ea, friction: 0.3, hardness: 12,
  },
  rubber: {
    id: 'rubber', name: 'Rubber (grippy)', density: 1150, yieldStrength: 15,
    toughness: 3.0, costPerKg: 6, sourcing: 'common', colour: 0x1d1d1d, friction: 0.95, hardness: 2,
  },
  ptfe: {
    id: 'ptfe', name: 'PTFE (slippery skids)', density: 2200, yieldStrength: 20,
    toughness: 1.5, costPerKg: 25, sourcing: 'common', colour: 0xf2f2ee, friction: 0.05, hardness: 4,
  },
  plywood: {
    id: 'plywood', name: 'Plywood', density: 600, yieldStrength: 30,
    toughness: 1.2, costPerKg: 3, sourcing: 'common', colour: 0xc8a165, friction: 0.45, hardness: 8,
  },
};

/** A material's hardness (HB), estimated from its yield strength when not given. */
export function hardnessOf(m: Material): number {
  return m.hardness ?? Math.max(1, m.yieldStrength / 2.7);
}

export function material(id: string): Material {
  const m = MATERIALS[id];
  if (!m) throw new Error(`Unknown material: ${id}`);
  return m;
}
