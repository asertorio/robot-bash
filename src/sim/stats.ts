import { material, type Sourcing } from '../data/materials';
import { BATTERIES, GEARBOX, MOTORS, RAMS, TANKS, VALVES, WHEELS, lookup } from '../data/parts';
import type { FlipperDef, RobotDesign, SpinnerDef } from './design';
import { panelArea } from './geometry';
import { RPM_TO_RADS } from './motor';

export const GRAVITY = 9.81;
const SPINNER_HUB = { mass: 1.5, cost: 120 };

export interface BomLine {
  label: string;
  mass: number;
  cost: number;
  sourcing: Sourcing;
  swapMinutes: number;
}

/** Bill of materials: every part with its mass, cost and how hard it is to replace. */
export function billOfMaterials(d: RobotDesign): BomLine[] {
  const lines: BomLine[] = [];
  for (const p of d.shell) {
    const m = material(p.material);
    const mass = panelArea(p) * (p.thickness / 1000) * m.density;
    // Fabricating plate costs more than the raw metal.
    lines.push({ label: `${p.label} (${p.thickness}mm ${m.name})`, mass, cost: mass * m.costPerKg + 60, sourcing: m.sourcing, swapMinutes: 25 });
  }
  for (const w of d.drive.wheels) {
    const s = lookup(WHEELS, w.wheel, 'wheel');
    lines.push({ label: s.name, mass: s.mass, cost: s.cost, sourcing: s.sourcing, swapMinutes: s.swapMinutes });
  }
  const dm = lookup(MOTORS, d.drive.motor, 'motor');
  const motors = d.drive.motorsPerSide * 2;
  for (let i = 0; i < motors; i++) {
    lines.push({ label: `${dm.name} + gearbox`, mass: dm.mass + GEARBOX.mass, cost: dm.cost + GEARBOX.cost, sourcing: dm.sourcing, swapMinutes: dm.swapMinutes + GEARBOX.swapMinutes });
  }
  const b = lookup(BATTERIES, d.battery.part, 'battery');
  lines.push({ label: b.name, mass: b.mass, cost: b.cost, sourcing: b.sourcing, swapMinutes: b.swapMinutes });
  lines.push(electronics(d));
  for (const w of d.weapons) {
    if (w.kind === 'flipper') {
      const ram = lookup(RAMS, w.ram, 'ram');
      const valve = lookup(VALVES, w.valve, 'valve');
      const tank = lookup(TANKS, w.tank, 'tank');
      for (const s of [ram, valve, tank]) lines.push({ label: s.name, mass: s.mass, cost: s.cost, sourcing: s.sourcing, swapMinutes: s.swapMinutes });
      lines.push({ label: 'CO2 charge', mass: tank.capacity / 1000, cost: 10, sourcing: 'common', swapMinutes: 3 });
      const pm = material(w.plate.material);
      const mass = flipperPlateMass(w);
      lines.push({ label: `Flipper plate (${w.plate.thickness}mm ${pm.name})`, mass, cost: mass * pm.costPerKg + 80, sourcing: pm.sourcing, swapMinutes: 30 });
    } else {
      const wm = lookup(MOTORS, w.motor, 'motor');
      lines.push({ label: wm.name, mass: wm.mass, cost: wm.cost, sourcing: wm.sourcing, swapMinutes: wm.swapMinutes });
      const bm = material(w.blade.material);
      const bp = bladeProps(w);
      lines.push({ label: `Spinner ${w.blade.shape} (${bm.name})`, mass: bp.mass, cost: bp.mass * bm.costPerKg * 3 + 150, sourcing: bm.sourcing === 'common' ? 'specialist' : 'custom', swapMinutes: 35 });
      lines.push({ label: 'Spinner hub, bearings & belt', mass: SPINNER_HUB.mass, cost: SPINNER_HUB.cost, sourcing: 'common', swapMinutes: 20 });
    }
  }
  return lines;
}

/** Speed controllers, radio and wiring: sized by how much current the motors can pull. */
export function electronics(d: RobotDesign): BomLine {
  let amps = d.drive.motorsPerSide * 2 * lookup(MOTORS, d.drive.motor, 'motor').stallCurrent;
  for (const w of d.weapons) if (w.kind === 'spinner') amps += lookup(MOTORS, w.motor, 'motor').stallCurrent;
  return { label: 'Speed controllers, radio & wiring', mass: 0.6 + 0.008 * amps, cost: 100 + 0.7 * amps, sourcing: 'common', swapMinutes: 20 };
}

export function flipperPlateMass(w: FlipperDef): number {
  return w.plate.width * w.plate.length * (w.plate.thickness / 1000) * material(w.plate.material).density;
}

export function bladeProps(w: SpinnerDef): { mass: number; inertia: number; tipRadius: number } {
  const t = w.blade.thickness / 1000;
  const rho = material(w.blade.material).density;
  if (w.blade.shape === 'disc') {
    const r = w.blade.length / 2;
    const mass = Math.PI * r * r * t * rho;
    return { mass, inertia: 0.5 * mass * r * r, tipRadius: r };
  }
  const { length: L, width: W } = w.blade;
  const mass = L * W * t * rho;
  return { mass, inertia: (mass * (L * L + W * W)) / 12, tipRadius: L / 2 };
}

export function gasDensity(pressureBar: number): number {
  // CO2 as an ideal gas at 20°C, absolute pressure.
  return ((pressureBar + 1) * 1e5 * 0.044) / (8.314 * 293);
}

export function flipperNumbers(w: FlipperDef) {
  const ram = lookup(RAMS, w.ram, 'ram');
  const tank = lookup(TANKS, w.tank, 'tank');
  const pressure = Math.min(w.pressure, ram.maxPressure);
  const area = Math.PI * (ram.bore / 2000) ** 2;
  const force = pressure * 1e5 * area;
  const stroke = ram.stroke / 1000;
  const gasPerShot = gasDensity(pressure) * area * stroke * 1000; // grams
  return {
    pressure,
    ramForce: force,
    hingeTorque: force * w.leverArm,
    energyPerShot: force * stroke,
    gasPerShot,
    shots: Math.floor(tank.capacity / gasPerShot),
  };
}

export function spinnerNumbers(w: SpinnerDef, batteryVoltage: number) {
  const m = lookup(MOTORS, w.motor, 'motor');
  const vRatio = batteryVoltage / m.voltage;
  const bp = bladeProps(w);
  const maxOmega = (m.freeSpeed * RPM_TO_RADS * vRatio) / w.beltRatio;
  const stall = m.stallTorque * vRatio * w.beltRatio;
  // ω(t) = ω_max (1 − e^(−t/τ)), τ = I ω_max / T_stall; 90% at 2.3τ.
  const tau = (bp.inertia * maxOmega) / stall;
  return {
    bladeMass: bp.mass,
    inertia: bp.inertia,
    maxRpm: maxOmega / RPM_TO_RADS,
    tipSpeed: maxOmega * bp.tipRadius,
    energy: 0.5 * bp.inertia * maxOmega * maxOmega,
    spinUpTime: 2.3 * tau,
  };
}

const SOURCING_RANK: Record<Sourcing, number> = { common: 0, specialist: 1, custom: 2 };

export interface RobotStats {
  mass: number;
  cost: number;
  topSpeed: number;
  /** Max pushing force and what limits it. */
  pushForce: number;
  pushLimit: 'traction' | 'motors' | 'battery';
  /** Seconds of typical fight use before the battery is flat. */
  runtime: number;
  /** Seconds to reach 90% of top speed (ignoring wheelspin). */
  acceleration: number;
  weapons: Array<{ kind: 'flipper'; numbers: ReturnType<typeof flipperNumbers> } | { kind: 'spinner'; numbers: ReturnType<typeof spinnerNumbers> }>;
  rebuildCost: number;
  rebuildMinutes: number;
  hardestSpare: Sourcing;
  bom: BomLine[];
}

export function computeStats(d: RobotDesign): RobotStats {
  const bom = billOfMaterials(d);
  const mass = bom.reduce((s, l) => s + l.mass, 0);
  const cost = bom.reduce((s, l) => s + l.cost, 0);
  const battery = lookup(BATTERIES, d.battery.part, 'battery');
  const motor = lookup(MOTORS, d.drive.motor, 'motor');
  const vRatio = battery.voltage / motor.voltage;
  const wheel = lookup(WHEELS, d.drive.wheels[0].wheel, 'wheel');
  const motors = d.drive.motorsPerSide * 2;

  const topSpeed = ((motor.freeSpeed * RPM_TO_RADS * vRatio) / d.drive.gearRatio) * wheel.radius * 0.92;
  const motorForce = (motors * motor.stallTorque * vRatio * d.drive.gearRatio * GEARBOX.efficiency) / wheel.radius;
  // Skids carry some weight that the wheels then can't use for grip.
  const drivenShare = d.skids.length > 0 ? 0.8 : 1;
  const tractionForce = wheel.grip * mass * GRAVITY * drivenShare;
  const batteryShare = Math.min(1, battery.maxCurrent / (motors * motor.stallCurrent * vRatio));
  const batteryForce = motorForce * batteryShare;
  let pushForce = tractionForce, pushLimit: RobotStats['pushLimit'] = 'traction';
  if (motorForce < pushForce) { pushForce = motorForce; pushLimit = 'motors'; }
  if (batteryForce < pushForce) { pushForce = batteryForce; pushLimit = 'battery'; }

  const wheelOmegaMax = topSpeed / wheel.radius;
  const inertiaAtWheel = mass * wheel.radius * wheel.radius;
  const wheelTorque = Math.min(motorForce, tractionForce) * wheel.radius;
  const acceleration = 2.3 * (inertiaAtWheel * wheelOmegaMax) / Math.max(wheelTorque, 1e-6);

  // A typical fight: drive motors averaging 20% of stall current, weapon motors 12%.
  let amps = motors * motor.stallCurrent * vRatio * 0.2;
  const weapons: RobotStats['weapons'] = [];
  for (const w of d.weapons) {
    if (w.kind === 'flipper') weapons.push({ kind: 'flipper', numbers: flipperNumbers(w) });
    else {
      weapons.push({ kind: 'spinner', numbers: spinnerNumbers(w, battery.voltage) });
      const wm = lookup(MOTORS, w.motor, 'motor');
      amps += wm.stallCurrent * (battery.voltage / wm.voltage) * 0.12;
    }
  }
  const runtime = (battery.capacity / (battery.voltage * amps)) * 3600;

  const hardestSpare = bom.reduce<Sourcing>((h, l) => (SOURCING_RANK[l.sourcing] > SOURCING_RANK[h] ? l.sourcing : h), 'common');
  return {
    mass, cost, topSpeed, pushForce, pushLimit, runtime, acceleration, weapons,
    rebuildCost: cost,
    rebuildMinutes: bom.reduce((s, l) => s + l.swapMinutes, 0),
    hardestSpare,
    bom,
  };
}
