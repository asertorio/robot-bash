import type { Sourcing } from './materials';

interface CatalogPart {
  id: string;
  name: string;
  /** kg */
  mass: number;
  /** £ */
  cost: number;
  sourcing: Sourcing;
  /** Pit-crew minutes to swap one out. */
  swapMinutes: number;
}

/** Brushed DC motor, shaft-side specs at rated voltage. */
export interface MotorSpec extends CatalogPart {
  voltage: number;
  /** N·m */
  stallTorque: number;
  /** rpm */
  freeSpeed: number;
  /** A */
  stallCurrent: number;
  freeCurrent: number;
}

export interface BatterySpec extends CatalogPart {
  chemistry: 'SLA' | 'NiCd' | 'LiPo';
  voltage: number;
  /** Wh */
  capacity: number;
  /** Max continuous current before voltage collapses, A */
  maxCurrent: number;
}

export interface WheelSpec extends CatalogPart {
  /** m */
  radius: number;
  width: number;
  /** Friction coefficient on a steel floor. */
  grip: number;
}

export interface RamSpec extends CatalogPart {
  /** mm */
  bore: number;
  /** mm */
  stroke: number;
  /** bar */
  maxPressure: number;
}

export interface ValveSpec extends CatalogPart {
  /** Pressure rise time constant, s. Smaller = snappier flip. */
  timeConstant: number;
  /** Flow-limited valves cap how fast the ram can extend: max plate speed, rad/s. */
  maxRate?: number;
}

export interface TankSpec extends CatalogPart {
  /** g of CO2 when full (mass excludes gas). */
  capacity: number;
}

export const MOTORS: Record<string, MotorSpec> = {
  dm250: {
    id: 'dm250', name: 'DM-250 12V drive motor', mass: 1.0, cost: 70, sourcing: 'common', swapMinutes: 10,
    voltage: 12, stallTorque: 1.8, freeSpeed: 5000, stallCurrent: 60, freeCurrent: 2,
  },
  dm750: {
    id: 'dm750', name: 'DM-750 24V drive motor', mass: 2.6, cost: 180, sourcing: 'common', swapMinutes: 15,
    voltage: 24, stallTorque: 5.5, freeSpeed: 3200, stallCurrent: 140, freeCurrent: 4,
  },
  dm1200: {
    id: 'dm1200', name: 'DM-1200 36V drive motor', mass: 3.8, cost: 320, sourcing: 'specialist', swapMinutes: 20,
    voltage: 36, stallTorque: 9, freeSpeed: 3800, stallCurrent: 220, freeCurrent: 6,
  },
  wm400: {
    id: 'wm400', name: 'WM-400 12V weapon motor', mass: 1.5, cost: 110, sourcing: 'common', swapMinutes: 15,
    voltage: 12, stallTorque: 2.5, freeSpeed: 6000, stallCurrent: 90, freeCurrent: 3,
  },
  wm900: {
    id: 'wm900', name: 'WM-900 24V weapon motor', mass: 3.0, cost: 220, sourcing: 'common', swapMinutes: 20,
    voltage: 24, stallTorque: 6, freeSpeed: 4500, stallCurrent: 160, freeCurrent: 5,
  },
  wm2000: {
    id: 'wm2000', name: 'WM-2000 36V weapon motor', mass: 5.5, cost: 450, sourcing: 'specialist', swapMinutes: 30,
    voltage: 36, stallTorque: 16, freeSpeed: 5000, stallCurrent: 380, freeCurrent: 8,
  },
};

export const BATTERIES: Record<string, BatterySpec> = {
  nicd12: {
    id: 'nicd12', name: '12V 3Ah NiCd pack', mass: 1.6, cost: 70, sourcing: 'common', swapMinutes: 5,
    chemistry: 'NiCd', voltage: 12, capacity: 36, maxCurrent: 120,
  },
  nicd24s: {
    id: 'nicd24s', name: '24V 3Ah NiCd pack', mass: 3.0, cost: 140, sourcing: 'common', swapMinutes: 8,
    chemistry: 'NiCd', voltage: 24, capacity: 72, maxCurrent: 150,
  },
  sla24: {
    id: 'sla24', name: '24V 17Ah sealed lead-acid', mass: 12.4, cost: 90, sourcing: 'common', swapMinutes: 10,
    chemistry: 'SLA', voltage: 24, capacity: 408, maxCurrent: 200,
  },
  nicd24: {
    id: 'nicd24', name: '24V 7Ah NiCd pack', mass: 6.5, cost: 260, sourcing: 'common', swapMinutes: 10,
    chemistry: 'NiCd', voltage: 24, capacity: 168, maxCurrent: 300,
  },
  nicd36: {
    id: 'nicd36', name: '36V 5Ah NiCd pack', mass: 7.0, cost: 340, sourcing: 'common', swapMinutes: 10,
    chemistry: 'NiCd', voltage: 36, capacity: 180, maxCurrent: 300,
  },
  nicd36l: {
    id: 'nicd36l', name: '36V 10Ah NiCd pack', mass: 13.0, cost: 620, sourcing: 'common', swapMinutes: 12,
    chemistry: 'NiCd', voltage: 36, capacity: 360, maxCurrent: 400,
  },
  lipo36: {
    id: 'lipo36', name: '37V 8Ah LiPo pack', mass: 2.2, cost: 400, sourcing: 'specialist', swapMinutes: 10,
    chemistry: 'LiPo', voltage: 37, capacity: 296, maxCurrent: 400,
  },
};

export const WHEELS: Record<string, WheelSpec> = {
  foam100: {
    id: 'foam100', name: '100mm foam-filled wheel', mass: 0.3, cost: 10, sourcing: 'common', swapMinutes: 3,
    radius: 0.05, width: 0.035, grip: 0.9,
  },
  pneu250: {
    id: 'pneu250', name: '250mm pneumatic tyre', mass: 1.6, cost: 25, sourcing: 'common', swapMinutes: 5,
    radius: 0.125, width: 0.08, grip: 0.95,
  },
  solid200: {
    id: 'solid200', name: '200mm solid rubber wheel', mass: 1.8, cost: 30, sourcing: 'common', swapMinutes: 5,
    radius: 0.1, width: 0.06, grip: 0.85,
  },
  foam150: {
    id: 'foam150', name: '150mm foam-filled wheel', mass: 0.8, cost: 18, sourcing: 'common', swapMinutes: 5,
    radius: 0.075, width: 0.05, grip: 0.9,
  },
};

export const RAMS: Record<string, RamSpec> = {
  ram40: {
    id: 'ram40', name: '40mm bore ram, 120mm stroke', mass: 1.2, cost: 160, sourcing: 'common', swapMinutes: 15,
    bore: 40, stroke: 120, maxPressure: 25,
  },
  ram63: {
    id: 'ram63', name: '63mm bore ram, 200mm stroke', mass: 3.0, cost: 350, sourcing: 'common', swapMinutes: 25,
    bore: 63, stroke: 200, maxPressure: 25,
  },
  ram80: {
    id: 'ram80', name: '80mm bore ram, 200mm stroke', mass: 4.5, cost: 520, sourcing: 'specialist', swapMinutes: 30,
    bore: 80, stroke: 200, maxPressure: 25,
  },
  ram100hp: {
    id: 'ram100hp', name: '100mm high-pressure ram', mass: 9.0, cost: 2200, sourcing: 'custom', swapMinutes: 60,
    bore: 100, stroke: 250, maxPressure: 60,
  },
  ram80hp: {
    id: 'ram80hp', name: '80mm high-pressure ram', mass: 6.0, cost: 1400, sourcing: 'custom', swapMinutes: 45,
    bore: 80, stroke: 200, maxPressure: 60,
  },
};

export const VALVES: Record<string, ValveSpec> = {
  std: {
    id: 'std', name: 'Standard solenoid valve', mass: 1.0, cost: 120, sourcing: 'common', swapMinutes: 15,
    timeConstant: 0.06,
  },
  lifter: {
    id: 'lifter', name: 'Proportional lifter valve', mass: 1.2, cost: 260, sourcing: 'specialist', swapMinutes: 20,
    timeConstant: 0.35,
    maxRate: 1.4,
  },
  dump: {
    id: 'dump', name: 'High-flow dump valve', mass: 1.6, cost: 380, sourcing: 'specialist', swapMinutes: 20,
    timeConstant: 0.02,
  },
};

export const TANKS: Record<string, TankSpec> = {
  co2_250: {
    id: 'co2_250', name: '250g CO2 bottle', mass: 0.9, cost: 40, sourcing: 'common', swapMinutes: 3,
    capacity: 250,
  },
  co2_1kg: {
    id: 'co2_1kg', name: '1kg CO2 bottle', mass: 2.5, cost: 90, sourcing: 'common', swapMinutes: 5,
    capacity: 1000,
  },
  co2_2kg: {
    id: 'co2_2kg', name: '2kg CO2 bottle', mass: 4.2, cost: 140, sourcing: 'common', swapMinutes: 5,
    capacity: 2000,
  },
};

/** Gearbox per drive motor. */
export const GEARBOX = { mass: 1.2, cost: 80, efficiency: 0.85, swapMinutes: 15 };

export function lookup<T>(table: Record<string, T>, id: string, what: string): T {
  const v = table[id];
  if (!v) throw new Error(`Unknown ${what}: ${id}`);
  return v;
}
