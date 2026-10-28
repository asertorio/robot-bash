import type { PartDef, RobotDesign, Vec3 } from './design';

/**
 * Version 1 of the design format: one shell, a two-sided drive, a battery and
 * at most a flipper or spinner. Still used to author the starter robots and
 * to read old saves; `fromV1` turns it into the general v2 part tree.
 */

export interface ShellPanel {
  id: string;
  label: string;
  shape: 'box' | 'wedge';
  /** [width (x), height (y), length (z)] of the outer envelope. */
  size: Vec3;
  /** Centre of the envelope. */
  position: Vec3;
  material: string;
  /** Plate thickness, mm. The panel is a hollow shell of this thickness. */
  thickness: number;
  /** Wedge only: height of the leading edge (0 = knife edge). */
  lipHeight?: number;
}

export interface WheelMount {
  wheel: string;
  /** Axle centre. */
  position: Vec3;
  side: 'left' | 'right';
}

export interface DriveDef {
  motor: string;
  motorsPerSide: number;
  /** Motor revolutions per wheel revolution. */
  gearRatio: number;
  wheels: WheelMount[];
  /** Where the drive motors sit (one per side, mirrored in x). */
  motorPosition: Vec3;
}

/**
 * A low-friction slider that stops a two-wheeled robot tipping onto its nose
 * or tail. Mount it a few mm clear of the floor so the wheels keep the weight.
 */
export interface Skid {
  position: Vec3;
  radius: number;
}

export interface FlipperDef {
  kind: 'flipper';
  ram: string;
  valve: string;
  tank: string;
  /** Regulated working pressure, bar. Capped by the ram's rating. */
  pressure: number;
  /** Centre of the hinge line (hinge axis runs along X). */
  hinge: Vec3;
  /** The plate extends forward (+Z) from the hinge when closed. Thickness in mm. */
  plate: { width: number; length: number; thickness: number; material: string };
  /** Distance from hinge to where the ram acts on the plate, m. */
  leverArm: number;
  /** Max opening angle, degrees. */
  maxAngle: number;
  /** Where the ram + tank sit inside the chassis. */
  gasPosition: Vec3;
}

export interface SpinnerDef {
  kind: 'spinner';
  motor: string;
  /** Motor revolutions per blade revolution. */
  beltRatio: number;
  /** 'horizontal' blades spin flat (vertical axle); 'vertical' blades spin on an X axle. */
  orientation: 'horizontal' | 'vertical';
  /** Bar: length × width. Disc: length is the diameter. Thickness in mm. */
  blade: { shape: 'bar' | 'disc'; length: number; width: number; thickness: number; material: string };
  /** Hub centre. */
  position: Vec3;
  motorPosition: Vec3;
}

export type WeaponDef = FlipperDef | SpinnerDef;

export interface DesignV1 {
  schema: 1;
  id: string;
  name: string;
  description: string;
  /** Paint colour, CSS hex. */
  colour: string;
  shell: ShellPanel[];
  skids: Skid[];
  drive: DriveDef;
  battery: { part: string; position: Vec3 };
  weapons: WeaponDef[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const rv = (v: Vec3): Vec3 => [r3(v[0]), r3(v[1]), r3(v[2])];

/** Convert a v1 design to the v2 part tree, preserving masses and layout. */
export function fromV1(d: DesignV1): RobotDesign {
  const [root, ...rest] = d.shell;
  const base = root.position;
  const rel = (p: Vec3) => rv(sub(p, base));
  const parts: PartDef[] = [];
  const panel = (p: ShellPanel, parent: string | null): PartDef => ({
    id: p.id, label: p.label, parent, joint: { type: 'fixed' }, role: 'structure',
    position: parent ? rel(p.position) : rv(p.position), rotation: [0, 0, 0],
    shape: p.shape === 'wedge' ? { type: 'wedge', size: p.size, lip: p.lipHeight ?? 0 } : { type: 'box', size: p.size },
    material: p.material, wall: p.thickness,
  });
  parts.push(panel(root, null));
  for (const p of rest) parts.push(panel(p, root.id));
  d.skids.forEach((s, i) => parts.push({
    id: `skid-${i}`, label: `Skid ${i + 1}`, parent: root.id, joint: { type: 'fixed' }, role: 'structure',
    position: rel(s.position), rotation: [0, 0, 0], shape: { type: 'sphere', radius: s.radius }, material: 'ptfe',
  }));
  const driven = { left: 0, right: 0 };
  d.drive.wheels.forEach((w, i) => {
    // v1 shared motors along a side; give motors to as many wheels as it had.
    const powered = driven[w.side]++ < d.drive.motorsPerSide;
    parts.push({
      id: `wheel-${i}`, label: `${w.side === 'left' ? 'Left' : 'Right'} wheel ${i + 1}`, parent: root.id, role: 'wheel', wheel: w.wheel,
      position: rel(w.position), rotation: [0, 0, 0],
      joint: { type: 'hinge', axis: [1, 0, 0], ...(powered ? { actuator: { type: 'motor', motor: d.drive.motor, gear: d.drive.gearRatio, input: { source: w.side, scale: 1 } } } : {}) },
    });
  });
  parts.push({ id: 'battery', label: 'Battery', parent: root.id, role: 'component', component: { type: 'battery', part: d.battery.part }, position: rel(d.battery.position), rotation: [0, 0, 0], joint: { type: 'fixed' } });
  d.weapons.forEach((w, wi) => {
    if (w.kind === 'flipper') {
      parts.push({ id: `gas-${wi}`, label: 'Gas bottle', parent: root.id, role: 'component', component: { type: 'gasTank', part: w.tank }, position: rel(w.gasPosition), rotation: [0, 0, 0], joint: { type: 'fixed' } });
      const t = w.plate.thickness / 1000;
      const rest = (Math.asin(Math.min(0.95, Math.max(0, (w.hinge[1] - t) / w.plate.length))) * 180) / Math.PI;
      parts.push({
        id: `flipper-${wi}`, label: 'Flipper', parent: root.id, role: 'structure',
        position: rel(w.hinge), rotation: [r3(rest), 0, 0],
        shape: { type: 'box', size: [w.plate.width, t, w.plate.length] }, shapeOffset: [0, 0, r3(w.plate.length / 2)],
        material: w.plate.material,
        joint: { type: 'hinge', axis: [-1, 0, 0], limits: [-3, r3(w.maxAngle + rest)], actuator: { type: 'pneumatic', ram: w.ram, valve: w.valve, pressure: w.pressure, leverArm: w.leverArm, input: { source: 'button1', mode: 'hold' } } },
      });
    } else {
      const b = w.blade, t = b.thickness / 1000, horizontal = w.orientation === 'horizontal';
      const disc = b.shape === 'disc';
      parts.push({
        id: `spinner-${wi}`, label: 'Spinner', parent: root.id, role: 'structure',
        position: rel(w.position), rotation: disc && !horizontal ? [0, 0, 90] : [0, 0, 0],
        shape: disc ? { type: 'cylinder', radius: b.length / 2, length: t } : { type: 'box', size: horizontal ? [b.length, t, b.width] : [t, b.width, b.length] },
        material: b.material,
        joint: { type: 'hinge', axis: disc || horizontal ? [0, 1, 0] : [1, 0, 0], actuator: { type: 'motor', motor: w.motor, gear: w.beltRatio, input: { source: 'button1', mode: 'toggle' } } },
      });
      parts.push({ id: `hub-${wi}`, label: 'Hub & bearings', parent: `spinner-${wi}`, role: 'component', component: { type: 'ballast', mass: 1.5 }, position: [0, 0, 0], rotation: [0, 0, 0], joint: { type: 'fixed' } });
    }
  });
  return { schema: 2, id: d.id, name: d.name, description: d.description, colour: d.colour, parts };
}
