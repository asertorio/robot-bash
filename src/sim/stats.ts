import { material, type Sourcing } from '../data/materials';
import { BATTERIES, GEARBOX, MOTORS, RAMS, TANKS, VALVES, WHEELS, lookup } from '../data/parts';
import { actuatorMass, actuatorOf, inertiaAbout, partFrames, partMass, registerCatalog, rigidGroup, shapeCorners, unit } from './assembly';
import type { ActuatorDef, PartDef, RobotDesign } from './design';
import { RPM_TO_RADS } from './motor';
import { qrotate, vdot, vlen, vscale, vsub } from './vmath';

export const GRAVITY = 9.81;

export interface BomLine {
  label: string;
  mass: number;
  cost: number;
  sourcing: Sourcing;
  swapMinutes: number;
}

export function gasDensity(pressureBar: number): number {
  // CO2 as an ideal gas at 20°C, absolute pressure.
  return ((pressureBar + 1) * 1e5 * 0.044) / (8.314 * 293);
}

const actuatorsOf = (d: RobotDesign) =>
  d.parts.flatMap((p) => { const act = actuatorOf(p); return act ? [{ part: p, act }] : []; });

/** Speed controllers, radio and wiring: sized by how much current the motors can pull. */
export function electronicsMass(d: RobotDesign): number {
  return 0.6 + 0.008 * stallAmps(d);
}

function stallAmps(d: RobotDesign): number {
  let amps = 0;
  for (const { act } of actuatorsOf(d)) if (act.type !== 'pneumatic') amps += lookup(MOTORS, act.motor, 'motor').stallCurrent;
  return amps;
}

const LOCO = ['left', 'right', 'throttle', 'steer', 'gait'];
export const isLocomotion = (a: ActuatorDef) => LOCO.includes(a.input.source);

export function billOfMaterials(d: RobotDesign): BomLine[] {
  const lines: BomLine[] = [];
  for (const p of d.parts) {
    const mass = partMass(p);
    if (p.role === 'wheel') {
      const w = lookup(WHEELS, p.wheel!, 'wheel');
      lines.push({ label: `${p.label} (${w.name})`, mass, cost: w.cost, sourcing: w.sourcing, swapMinutes: w.swapMinutes });
    } else if (p.role === 'component') {
      const c = p.component!;
      if (c.type === 'battery') { const b = lookup(BATTERIES, c.part, 'battery'); lines.push({ label: b.name, mass, cost: b.cost, sourcing: b.sourcing, swapMinutes: b.swapMinutes }); }
      else if (c.type === 'gasTank') { const t = lookup(TANKS, c.part, 'tank'); lines.push({ label: `${t.name} (charged)`, mass, cost: t.cost + 10, sourcing: t.sourcing, swapMinutes: t.swapMinutes }); }
      else if (c.type === 'flamethrower') lines.push({ label: `${p.label} (flamethrower, ${c.fuel} kg fuel)`, mass, cost: 450 + c.fuel * 8, sourcing: 'specialist', swapMinutes: 20 });
      else lines.push({ label: p.label, mass, cost: mass * 2, sourcing: 'common', swapMinutes: 5 });
    } else {
      const m = material(p.material ?? 'aluminium');
      // Fabrication: plate and simple shapes are cheap; curved and freeform parts cost more and can't be bought.
      const shape = p.shape!.type;
      const freeform = shape === 'hull' || shape === 'extrude' || shape === 'lathe' || shape === 'mesh';
      const fab = shape === 'box' || shape === 'wedge' ? 60 : shape === 'armour' ? 90 : shape === 'extrude' ? 120 : freeform ? 260 : 140;
      // Profile-cut plate (extrusions) can be ordered; turned, cast and printed parts are one-offs.
      // Armour shells are cut, bent and welded plate: any fabricator can make one.
      const sourcing: Sourcing = shape === 'box' || shape === 'wedge' || shape === 'armour' ? m.sourcing : shape === 'extrude' ? worst(m.sourcing, 'specialist') : freeform ? 'custom' : m.sourcing === 'common' ? 'specialist' : 'custom';
      const what = p.wall ? `${p.wall}mm ${m.name} ${shape}` : `solid ${m.name} ${shape}`;
      lines.push({ label: `${p.label} (${what})`, mass, cost: mass * m.costPerKg + fab, sourcing, swapMinutes: 25 });
    }
    const a = actuatorOf(p);
    if (a) {
      if (a.type === 'pneumatic') {
        const ram = lookup(RAMS, a.ram, 'ram'), valve = lookup(VALVES, a.valve, 'valve');
        lines.push({ label: `${p.label}: ${ram.name} + ${valve.name}`, mass: actuatorMass(a), cost: ram.cost + valve.cost, sourcing: worst(ram.sourcing, valve.sourcing), swapMinutes: ram.swapMinutes + valve.swapMinutes });
      } else {
        const m = lookup(MOTORS, a.motor, 'motor');
        lines.push({ label: `${p.label}: ${m.name}${a.type === 'servo' ? ' (servo)' : ''} + ${a.gear}:1 gearbox`, mass: actuatorMass(a), cost: m.cost + GEARBOX.cost * Math.min(1, a.gear / 8), sourcing: m.sourcing, swapMinutes: m.swapMinutes + GEARBOX.swapMinutes });
      }
    }
  }
  const amps = stallAmps(d);
  lines.push({ label: 'Speed controllers, radio & wiring', mass: electronicsMass(d), cost: 100 + 0.7 * amps, sourcing: 'common', swapMinutes: 20 });
  return lines;
}

const RANK: Record<Sourcing, number> = { common: 0, specialist: 1, custom: 2 };
const worst = (a: Sourcing, b: Sourcing): Sourcing => (RANK[a] >= RANK[b] ? a : b);

export interface WeaponStat {
  label: string;
  kind: 'pneumatic' | 'spinner' | 'servo' | 'motor';
  lines: string[];
  /** Spinners: stored energy at full speed (J). Pneumatics: energy per shot (J). */
  energy: number;
  maxRpm?: number;
  shots?: number;
}

export interface RobotStats {
  mass: number;
  cost: number;
  /** null when the robot doesn't roll on driven wheels (legs, shells…): measure it in the test bay. */
  topSpeed: number | null;
  pushForce: number | null;
  pushLimit: 'traction' | 'motors' | 'battery' | null;
  acceleration: number | null;
  /** Seconds of typical fight use before the battery is flat. */
  runtime: number;
  locomotion: string;
  weapons: WeaponStat[];
  gasCapacity: number;
  rebuildCost: number;
  rebuildMinutes: number;
  hardestSpare: Sourcing;
  bom: BomLine[];
}

export function computeStats(d: RobotDesign): RobotStats {
  registerCatalog(d);
  const bom = billOfMaterials(d);
  const mass = bom.reduce((s, l) => s + l.mass, 0);
  const cost = bom.reduce((s, l) => s + l.cost, 0);
  const batts = d.parts.filter((p) => p.component?.type === 'battery').map((p) => lookup(BATTERIES, (p.component as { part: string }).part, 'battery'));
  const voltage = batts.length ? Math.max(...batts.map((b) => b.voltage)) : 0;
  const capacity = batts.reduce((s, b) => s + b.capacity, 0);
  const maxCurrent = batts.reduce((s, b) => s + b.maxCurrent, 0);
  const gasCapacity = d.parts.filter((p) => p.component?.type === 'gasTank').reduce((s, p) => s + lookup(TANKS, (p.component as { part: string }).part, 'tank').capacity, 0);
  const acts = actuatorsOf(d);

  // Wheeled drive: what the motors and grip allow.
  const drivenWheels = acts.filter(({ part, act }) => part.role === 'wheel' && act.type === 'motor' && isLocomotion(act));
  let topSpeed: number | null = null, pushForce: number | null = null, pushLimit: RobotStats['pushLimit'] = null, acceleration: number | null = null;
  if (drivenWheels.length) {
    let motorForce = 0, top = Infinity, amps = 0, grip = 0;
    for (const { part, act } of drivenWheels) {
      if (act.type !== 'motor') continue;
      const w = lookup(WHEELS, part.wheel!, 'wheel');
      const m = lookup(MOTORS, act.motor, 'motor');
      const vr = voltage / m.voltage;
      // An input turned down (scale < 1) caps the speed controller's output.
      const cap = Math.min(1, Math.abs(act.input.scale ?? 1));
      top = Math.min(top, ((m.freeSpeed * RPM_TO_RADS * vr * cap) / act.gear) * w.radius * 0.92);
      motorForce += (m.stallTorque * vr * cap * act.gear * GEARBOX.efficiency) / w.radius;
      amps += m.stallCurrent * vr;
      grip += w.grip;
    }
    grip /= drivenWheels.length;
    const allWheels = d.parts.filter((p) => p.role === 'wheel').length;
    // Weight carried by undriven wheels and skids can't be used for grip.
    const share = Math.min(1, drivenWheels.length / Math.max(1, allWheels)) * (d.parts.some((p) => p.material === 'ptfe') ? 0.8 : 1);
    const traction = grip * mass * GRAVITY * share;
    const battery = motorForce * Math.min(1, maxCurrent / Math.max(1, amps));
    pushForce = traction; pushLimit = 'traction';
    if (motorForce < pushForce) { pushForce = motorForce; pushLimit = 'motors'; }
    if (battery < pushForce) { pushForce = battery; pushLimit = 'battery'; }
    topSpeed = top;
    acceleration = (2.3 * mass * top) / Math.max(1e-6, Math.min(motorForce, traction));
  }
  const loco = acts.filter(({ act }) => isLocomotion(act));
  const legs = loco.filter(({ act }) => act.input.source === 'gait').length;
  const locomotion = drivenWheels.length ? `${drivenWheels.length} driven wheel${drivenWheels.length > 1 ? 's' : ''}`
    : legs ? `walker (${legs} gait servos)` : loco.length ? 'custom drive — measure it in the test bay' : 'none';

  // Weapons: every actuator that isn't for getting about.
  const weapons: WeaponStat[] = [];
  let amps = 0;
  for (const { part, act } of acts) {
    if (act.type !== 'pneumatic') {
      const m = lookup(MOTORS, act.motor, 'motor');
      amps += m.stallCurrent * (voltage / m.voltage) * (isLocomotion(act) ? 0.2 : act.type === 'servo' ? 0.15 : 0.12);
    }
    if (isLocomotion(act)) continue;
    const button = act.input.source.replace('button', 'button ');
    if (act.type === 'pneumatic') {
      const ram = lookup(RAMS, act.ram, 'ram');
      const pressure = Math.min(act.pressure, ram.maxPressure);
      const area = Math.PI * (ram.bore / 2000) ** 2;
      const force = pressure * 1e5 * area;
      const energy = force * (ram.stroke / 1000);
      const perShot = gasDensity(pressure) * area * (ram.stroke / 1000) * 1000;
      const shots = Math.floor(gasCapacity / perShot);
      weapons.push({
        label: `${part.label} (${button})`, kind: 'pneumatic', energy, shots,
        lines: [`${fmt(force / 1000, 1)} kN ram at ${pressure} bar${part.joint.type === 'hinge' ? ` · ${fmt(force * act.leverArm)} N·m` : ''}`, `${fmt(energy / 1000, 1)} kJ per shot · ${shots} shots of gas`],
      });
    } else if (act.type === 'motor') {
      const m = lookup(MOTORS, act.motor, 'motor');
      const frames = partFrames(d);
      const f = frames.get(part.id)!;
      const axis = qrotate(f.rot, unit(part.joint.type === 'hinge' ? part.joint.axis : [0, 1, 0]));
      const group = rigidGroup(d, part.id);
      const I = inertiaAbout(d, group, f.pos, axis);
      const omega = (m.freeSpeed * RPM_TO_RADS * (voltage / m.voltage)) / act.gear;
      const stall = m.stallTorque * (voltage / m.voltage) * act.gear;
      let radius = 0;
      for (const id of group) {
        const p = d.parts.find((q) => q.id === id)!;
        for (const c of shapeCorners(p, frames.get(id)!)) {
          const r = vsub(c, f.pos);
          radius = Math.max(radius, vlen(vsub(r, vscale(axis, vdot(r, axis)))));
        }
      }
      const energy = 0.5 * I * omega * omega;
      // A soft-start controller holds the torque back while it ramps.
      const spinUp = stall > 0 ? Math.max((2.3 * I * omega) / stall, (act.softStart ?? 0) * 1.15) : Infinity;
      weapons.push({
        label: `${part.label} (${button})`, kind: act.input.mode === 'toggle' ? 'spinner' : 'motor', energy, maxRpm: omega / RPM_TO_RADS,
        lines: [`${fmt(omega / RPM_TO_RADS)} rpm · ${fmt(omega * radius)} m/s tip · ${fmt(energy / 1000, 1)} kJ stored`, `${fmt(spinUp, 1)} s to spin up`],
      });
    } else {
      const m = lookup(MOTORS, act.motor, 'motor');
      const torque = m.stallTorque * (voltage / m.voltage) * act.gear * GEARBOX.efficiency;
      weapons.push({ label: `${part.label} (${button})`, kind: 'servo', energy: 0, lines: [`servo · ${fmt(torque)} N·m · ${act.targets.map((t) => fmt(t)).join(' / ')}${part.joint.type === 'hinge' ? '°' : ' mm'}`] });
    }
  }
  for (const p of d.parts) {
    const c = p.component;
    if (c?.type !== 'flamethrower') continue;
    weapons.push({ label: `${p.label} (${c.input.source.replace('button', 'button ')})`, kind: 'motor', energy: 0, lines: [`flamethrower · ${fmt(c.range, 1)} m reach · ${fmt(c.fuel / 0.06)} s of fuel`] });
  }
  const runtime = amps > 0 && voltage > 0 ? (capacity / (voltage * amps)) * 3600 : capacity > 0 ? Infinity : 0;
  const hardestSpare = bom.reduce<Sourcing>((h, l) => worst(h, l.sourcing), 'common');
  return {
    mass, cost, topSpeed, pushForce, pushLimit, acceleration, runtime, locomotion, weapons, gasCapacity,
    rebuildCost: cost, rebuildMinutes: bom.reduce((s, l) => s + l.swapMinutes, 0), hardestSpare, bom,
  };
}

const fmt = (v: number, d = 0) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Parts list for a single part (garage inspector). */
export function partSummary(p: PartDef): string {
  return `${fmt(partMass(p), 2)} kg`;
}
