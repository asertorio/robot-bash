import { WHEELS, lookup } from '../data/parts';
import type { FlipperDef, RobotDesign, ShellPanel, SpinnerDef, WheelMount } from './design';
import { panelVertices } from './geometry';

/**
 * Builder operations on a RobotDesign. Each keeps the design physically
 * consistent (wheels on the floor, skids clear of it, weapons mounted on the
 * chassis) so the editor can stay simple.
 */

export function cloneDesign(d: RobotDesign): RobotDesign {
  return JSON.parse(JSON.stringify(d)) as RobotDesign;
}

export interface DriveLayout {
  /** Wheels per side. */
  perSide: 1 | 2;
  /** Distance between left and right wheel centres, m. */
  track: number;
  /** Distance between front and rear axles (4WD), m. */
  wheelbase: number;
  /** Centre of the wheels front-to-back, m (+ = forward). */
  axleZ: number;
}

export function driveLayout(d: RobotDesign): DriveLayout {
  const left = d.drive.wheels.filter((w) => w.side === 'left');
  const zs = left.map((w) => w.position[2]);
  const track = left.length ? 2 * Math.abs(left[0].position[0]) : 0.6;
  const perSide = left.length >= 2 ? 2 : 1;
  return {
    perSide,
    track: round(track),
    wheelbase: perSide === 2 ? round(Math.max(...zs) - Math.min(...zs)) : 0.4,
    axleZ: round(zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 0),
  };
}

/** Rebuild the wheel set from a layout, keeping the wheel type. Wheels always sit on the floor. */
export function applyDriveLayout(d: RobotDesign, l: DriveLayout, wheelId = d.drive.wheels[0]?.wheel ?? 'pneu250') {
  const r = lookup(WHEELS, wheelId, 'wheel').radius;
  const zs = l.perSide === 2 ? [l.axleZ + l.wheelbase / 2, l.axleZ - l.wheelbase / 2] : [l.axleZ];
  const wheels: WheelMount[] = [];
  for (const side of ['left', 'right'] as const) {
    const x = (side === 'left' ? 1 : -1) * l.track / 2;
    for (const z of zs) wheels.push({ wheel: wheelId, position: [round(x), r, round(z)], side });
  }
  d.drive.wheels = wheels;
  d.drive.motorPosition = [round(Math.max(0.05, l.track / 2 - 0.15)), Math.max(0.06, r), round(l.axleZ)];
  autoSkids(d);
}

/** Two-wheelers need skids front and back so they don't rock onto their nose or tail. */
export function autoSkids(d: RobotDesign) {
  if (driveLayout(d).perSide === 2 || !d.shell.length) { d.skids = []; return; }
  let minZ = Infinity, maxZ = -Infinity;
  for (const p of d.shell) for (const v of panelVertices(p)) { minZ = Math.min(minZ, v[2] + p.position[2]); maxZ = Math.max(maxZ, v[2] + p.position[2]); }
  // A few mm clear of the floor so the wheels keep the weight.
  d.skids = [
    { position: [0, 0.036, round(maxZ - 0.06)], radius: 0.03 },
    { position: [0, 0.036, round(minZ + 0.06)], radius: 0.03 },
  ];
}

/** Bounding box of the shell, robot frame. */
export function shellBounds(d: RobotDesign) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of d.shell) {
    for (const v of panelVertices(p)) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], v[i] + p.position[i]);
        max[i] = Math.max(max[i], v[i] + p.position[i]);
      }
    }
  }
  if (!d.shell.length) return { min: [-0.25, 0.03, -0.3], max: [0.25, 0.2, 0.3] };
  return { min, max };
}

let panelCounter = 0;

export function newPanel(d: RobotDesign, shape: ShellPanel['shape']): ShellPanel {
  const b = shellBounds(d);
  const width = round(Math.max(0.3, b.max[0] - b.min[0]));
  const height = round(Math.min(0.2, Math.max(0.08, b.max[1] - b.min[1])));
  const length = 0.25;
  panelCounter++;
  return {
    id: `panel-${Date.now().toString(36)}-${panelCounter}`,
    label: shape === 'wedge' ? 'Front wedge' : 'Armour box',
    shape,
    size: [width, height, length],
    // New wedges go on the front, boxes on the back.
    position: [0, round(0.03 + height / 2), round(shape === 'wedge' ? b.max[2] + length / 2 : b.min[2] - length / 2)],
    material: 'aluminium',
    thickness: 5,
    ...(shape === 'wedge' ? { lipHeight: 0.01 } : {}),
  };
}

export function defaultFlipper(d: RobotDesign): FlipperDef {
  const b = shellBounds(d);
  const width = round(Math.max(0.3, b.max[0] - b.min[0]));
  return {
    kind: 'flipper', ram: 'ram63', valve: 'std', tank: 'co2_1kg', pressure: 20,
    hinge: [0, round(b.max[1]), round(b.max[2])],
    plate: { width, length: round(Math.max(0.3, b.max[1] * 1.8)), thickness: 6, material: 'aluminium' },
    leverArm: 0.12, maxAngle: 70,
    gasPosition: [0, round(b.min[1] + 0.06), round((b.min[2] + b.max[2]) / 2)],
  };
}

export function defaultSpinner(d: RobotDesign): SpinnerDef {
  const b = shellBounds(d);
  return {
    kind: 'spinner', motor: 'wm900', beltRatio: 3, orientation: 'horizontal',
    blade: { shape: 'bar', length: 0.6, width: 0.08, thickness: 15, material: 'hardox' },
    position: [0, round(b.max[1] + 0.03), round((b.min[2] + b.max[2]) / 2)],
    motorPosition: [0, round(b.min[1] + 0.06), round((b.min[2] + b.max[2]) / 2)],
  };
}

/** A bare rolling chassis: the starting point for a from-scratch build. */
export function blankDesign(): RobotDesign {
  const d: RobotDesign = {
    schema: 1,
    id: `custom-${Date.now().toString(36)}`,
    name: 'My Robot',
    description: 'A custom build.',
    colour: '#8e44ad',
    shell: [{ id: 'body', label: 'Body shell', shape: 'box', size: [0.5, 0.18, 0.6], position: [0, 0.12, 0], material: 'aluminium', thickness: 5 }],
    skids: [],
    drive: { motor: 'dm750', motorsPerSide: 1, gearRatio: 9, motorPosition: [0.15, 0.12, 0], wheels: [] },
    battery: { part: 'nicd24', position: [0, 0.1, -0.15] },
    weapons: [],
  };
  applyDriveLayout(d, { perSide: 1, track: 0.64, wheelbase: 0.4, axleZ: 0 }, 'pneu250');
  return d;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
