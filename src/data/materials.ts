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
}

export const MATERIALS: Record<string, Material> = {
  aluminium: {
    id: 'aluminium', name: 'Aluminium 6082', density: 2700, yieldStrength: 260,
    toughness: 1.0, costPerKg: 8, sourcing: 'common', colour: 0xb8bcc2,
  },
  mildSteel: {
    id: 'mildSteel', name: 'Mild steel', density: 7850, yieldStrength: 250,
    toughness: 1.3, costPerKg: 2, sourcing: 'common', colour: 0x6f7378,
  },
  hardox: {
    id: 'hardox', name: 'Hardened steel (AR500)', density: 7850, yieldStrength: 1250,
    toughness: 0.9, costPerKg: 6, sourcing: 'specialist', colour: 0x4a4e54,
  },
  titanium: {
    id: 'titanium', name: 'Titanium Ti-6Al-4V', density: 4430, yieldStrength: 880,
    toughness: 1.6, costPerKg: 60, sourcing: 'specialist', colour: 0x9a9890,
  },
  hdpe: {
    id: 'hdpe', name: 'HDPE plastic', density: 950, yieldStrength: 25,
    toughness: 2.0, costPerKg: 5, sourcing: 'common', colour: 0xe8e8e0,
  },
  polycarbonate: {
    id: 'polycarbonate', name: 'Polycarbonate', density: 1200, yieldStrength: 65,
    toughness: 2.2, costPerKg: 10, sourcing: 'common', colour: 0xcfe3ea,
  },
};

export function material(id: string): Material {
  const m = MATERIALS[id];
  if (!m) throw new Error(`Unknown material: ${id}`);
  return m;
}
