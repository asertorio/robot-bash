import type { RobotDesign } from '../sim/design';
import { fromV1 } from '../sim/legacy';
import { armour, bevelledPlate, bladeBar, cheekWedge, reshape } from './shaping';

/**
 * House robots: the arena's resident heavies. Original designs in the spirit
 * of the show's — far over the competitor weight limit, slower, and confined
 * to their corner patrol zones unless a robot has been counted out.
 */

export const IRONJAW: RobotDesign = reshape(fromV1({
  schema: 1,
  id: 'house-ironjaw',
  name: 'Ironjaw',
  description: 'Steel-plated lifter on a 60-bar ram. Picks you up and holds you there.',
  colour: '#8b1a1a',
  shell: [
    { id: 'body', label: 'Body shell', shape: 'box', size: [0.78, 0.32, 0.9], position: [0, 0.2, -0.05], material: 'mildSteel', thickness: 8 },
    { id: 'rear', label: 'Exhaust housing', shape: 'box', size: [0.4, 0.18, 0.2], position: [0, 0.45, -0.3], material: 'mildSteel', thickness: 4 },
  ],
  skids: [],
  drive: {
    motor: 'dm1200', motorsPerSide: 2, gearRatio: 16, motorPosition: [0.2, 0.16, 0],
    wheels: [
      { wheel: 'pneu250', position: [0.45, 0.125, 0.25], side: 'left' },
      { wheel: 'pneu250', position: [0.45, 0.125, -0.3], side: 'left' },
      { wheel: 'pneu250', position: [-0.45, 0.125, 0.25], side: 'right' },
      { wheel: 'pneu250', position: [-0.45, 0.125, -0.3], side: 'right' },
    ],
  },
  battery: { part: 'nicd36l', position: [0, 0.14, -0.3] },
  weapons: [{
    kind: 'flipper', ram: 'ram100hp', valve: 'lifter', tank: 'co2_2kg', pressure: 50,
    hinge: [0, 0.36, 0.4],
    plate: { width: 0.7, length: 0.62, thickness: 12, material: 'hardox' },
    leverArm: 0.18, maxAngle: 65, gasPosition: [0, 0.14, 0.1],
  }],
}), {
  body: { shape: armour([0.78, 0.32, 0.9], { sides: 0.08, rear: 0.16, belt: 0.5 }) },
  rear: { shape: armour([0.4, 0.18, 0.2], { sides: 0.04, front: 0.05, rear: 0.05, belt: 0.2 }) },
  'flipper-0': { shape: bevelledPlate([0.7, 0.012, 0.62], { bevel: 0.08, corner: 0.08 }) },
});

export const BUZZARD: RobotDesign = reshape(fromV1({
  schema: 1,
  id: 'house-buzzard',
  name: 'Buzzard',
  description: 'A hardened-steel circular saw the size of a dustbin lid, spinning vertically on the nose.',
  colour: '#5d6d7e',
  shell: [
    { id: 'body', label: 'Body shell', shape: 'box', size: [0.7, 0.3, 0.8], position: [0, 0.19, -0.08], material: 'mildSteel', thickness: 8 },
    { id: 'arms', label: 'Saw arms', shape: 'box', size: [0.08, 0.12, 0.3], position: [0.12, 0.28, 0.42], material: 'hardox', thickness: 10 },
  ],
  skids: [],
  drive: {
    motor: 'dm1200', motorsPerSide: 2, gearRatio: 16, motorPosition: [0.2, 0.15, -0.1],
    wheels: [
      { wheel: 'pneu250', position: [0.42, 0.125, 0.15], side: 'left' },
      { wheel: 'pneu250', position: [0.42, 0.125, -0.32], side: 'left' },
      { wheel: 'pneu250', position: [-0.42, 0.125, 0.15], side: 'right' },
      { wheel: 'pneu250', position: [-0.42, 0.125, -0.32], side: 'right' },
    ],
  },
  battery: { part: 'nicd36l', position: [0, 0.14, -0.3] },
  weapons: [{
    kind: 'spinner', motor: 'wm2000', beltRatio: 4, orientation: 'vertical',
    blade: { shape: 'disc', length: 0.52, width: 0.52, thickness: 12, material: 'hardox' },
    position: [0, 0.29, 0.6], motorPosition: [0, 0.16, 0.15],
  }],
}), {
  body: { shape: armour([0.7, 0.3, 0.8], { sides: 0.07, front: 0.12, rear: 0.1, belt: 0.5 }) },
  // Tapered side-plate carrying the saw out front.
  arms: { shape: { type: 'extrude', plane: 'side', depth: 0.08, outline: [[-0.15, -0.06], [0.15, -0.025], [0.15, 0.035], [-0.15, 0.06]] } },
});

export const SHOVELHEAD: RobotDesign = reshape(fromV1({
  schema: 1,
  id: 'house-shovelhead',
  name: 'Shovelhead',
  description: 'Four-wheel-drive bulldozer with a hardened scoop. Not subtle. Very effective near the pit.',
  colour: '#b9770e',
  shell: [
    { id: 'body', label: 'Body shell', shape: 'box', size: [0.7, 0.34, 0.75], position: [0, 0.21, -0.15], material: 'mildSteel', thickness: 8 },
    { id: 'scoop', label: 'Scoop', shape: 'wedge', size: [1.0, 0.34, 0.42], position: [0, 0.21, 0.43], material: 'hardox', thickness: 10, lipHeight: 0.01 },
  ],
  skids: [],
  drive: {
    motor: 'dm1200', motorsPerSide: 2, gearRatio: 14, motorPosition: [0.2, 0.15, -0.15],
    wheels: [
      { wheel: 'solid200', position: [0.42, 0.1, 0.1], side: 'left' },
      { wheel: 'solid200', position: [0.42, 0.1, -0.38], side: 'left' },
      { wheel: 'solid200', position: [-0.42, 0.1, 0.1], side: 'right' },
      { wheel: 'solid200', position: [-0.42, 0.1, -0.38], side: 'right' },
    ],
  },
  battery: { part: 'nicd36l', position: [0, 0.14, -0.35] },
  weapons: [],
}), {
  body: { shape: armour([0.7, 0.34, 0.75], { sides: 0.08, rear: 0.15, belt: 0.5 }) },
  scoop: { shape: cheekWedge([1.0, 0.34, 0.42], { topWidth: 0.54, shoulder: 0.2, lip: 0.01, nose: 0.05 }) },
});

export const THRESHER: RobotDesign = reshape(fromV1({
  schema: 1,
  id: 'house-thresher',
  name: 'Thresher',
  description: 'Tall steel tower carrying a flail bar at head height. Hits the bits wedges don\'t protect.',
  colour: '#1e8449',
  shell: [
    { id: 'body', label: 'Body shell', shape: 'box', size: [0.72, 0.3, 0.78], position: [0, 0.2, 0], material: 'mildSteel', thickness: 8 },
    { id: 'tower', label: 'Weapon tower', shape: 'box', size: [0.24, 0.16, 0.24], position: [0, 0.43, 0], material: 'mildSteel', thickness: 8 },
  ],
  skids: [],
  drive: {
    motor: 'dm1200', motorsPerSide: 2, gearRatio: 16, motorPosition: [0.2, 0.15, 0],
    wheels: [
      { wheel: 'pneu250', position: [0.43, 0.125, 0.24], side: 'left' },
      { wheel: 'pneu250', position: [0.43, 0.125, -0.24], side: 'left' },
      { wheel: 'pneu250', position: [-0.43, 0.125, 0.24], side: 'right' },
      { wheel: 'pneu250', position: [-0.43, 0.125, -0.24], side: 'right' },
    ],
  },
  battery: { part: 'nicd36l', position: [0, 0.14, -0.25] },
  weapons: [{
    kind: 'spinner', motor: 'wm2000', beltRatio: 4, orientation: 'horizontal',
    blade: { shape: 'bar', length: 1.1, width: 0.08, thickness: 15, material: 'mildSteel' },
    position: [0, 0.54, 0], motorPosition: [0, 0.16, 0],
  }],
}), {
  body: { shape: armour([0.72, 0.3, 0.78], { sides: 0.08, front: 0.1, rear: 0.1, belt: 0.5 }) },
  tower: { shape: armour([0.24, 0.16, 0.24], { sides: 0.035, front: 0.035, rear: 0.035, belt: 0 }) },
  'spinner-0': { shape: bladeBar(1.1, 0.08, 0.015) },
});

export const HOUSE_ROBOTS: RobotDesign[] = [IRONJAW, BUZZARD, SHOVELHEAD, THRESHER];

// ---------------------------------------------------------------- overpowered

/**
 * The overpowered set: no weight limit, no budget, nothing banned. Built
 * around house-robot-only parts (48 V motors and a battery the size of a
 * suitcase) so they're properly frightening — use them when you want the
 * corners to be somewhere you really don't go.
 */
const fixed = { type: 'fixed' } as const;
const HOUSE_CATALOG: NonNullable<RobotDesign['catalog']> = {
  motors: {
    'hm-drive': { id: 'hm-drive', name: 'House 48V traction motor', mass: 9, cost: 1500, sourcing: 'custom', swapMinutes: 40, voltage: 48, stallTorque: 28, freeSpeed: 4200, stallCurrent: 450, freeCurrent: 10 },
    'hm-weapon': { id: 'hm-weapon', name: 'House 48V weapon motor', mass: 16, cost: 3500, sourcing: 'custom', swapMinutes: 60, voltage: 48, stallTorque: 70, freeSpeed: 5000, stallCurrent: 900, freeCurrent: 15 },
  },
  batteries: {
    'hb48': { id: 'hb48', name: '48V 40Ah house battery', mass: 32, cost: 4000, sourcing: 'custom', swapMinutes: 20, chemistry: 'LiPo', voltage: 48, capacity: 1920, maxCurrent: 2000 },
  },
};

type P = RobotDesign['parts'][number];
const houseWheel = (id: string, x: number, y: number, z: number, wheel = 'pneu250', gear = 16): P => ({
  id, label: `${x > 0 ? 'Left' : 'Right'} ${z > 0.1 ? 'front' : z < -0.1 ? 'rear' : 'middle'} wheel`, parent: 'body', position: [x, y, z], rotation: [0, 0, 0], role: 'wheel', wheel,
  joint: { type: 'hinge', axis: [1, 0, 0], actuator: { type: 'motor', motor: 'hm-drive', gear, input: { source: x > 0 ? 'left' : 'right', scale: 1 } } },
});
const sixWheels = (x: number, y: number, zs: [number, number, number], gear = 16): P[] => zs.flatMap((z, i) => [houseWheel(`wheel-l${i}`, x, y, z, 'pneu250', gear), houseWheel(`wheel-r${i}`, -x, y, z, 'pneu250', gear)]);
const houseBattery = (at: [number, number, number], parent = 'body'): P => ({ id: 'battery', label: 'House battery', parent, position: at, rotation: [0, 0, 0], joint: fixed, role: 'component', component: { type: 'battery', part: 'hb48' } });

/** A 1.3 m steel full-body spinner. Sits in its corner building up speed; touch it and you leave in pieces. */
export const MAELSTROM: RobotDesign = {
  schema: 2,
  id: 'house-maelstrom',
  name: 'Maelstrom',
  description: 'Overpowered: a 1.3 m mild-steel shell with hardened teeth, spinning round its drive base on a 48 V motor. Takes a while to wind up. Then it stores more energy than a heavyweight hitting the wall at full speed — many times over.',
  colour: '#2c3e50',
  catalog: HOUSE_CATALOG,
  parts: [
    { id: 'body', label: 'Drive base', parent: null, position: [0, 0.14, 0], rotation: [0, 0, 0], joint: fixed, role: 'structure', shape: armour([0.62, 0.16, 0.62], { sides: 0.04, front: 0.04, rear: 0.04, belt: 0.4 }), material: 'mildSteel', wall: 6 },
    houseBattery([0, 0, -0.1]),
    ...([[0.25, 0.17], [0.25, -0.17], [-0.25, 0.17], [-0.25, -0.17]] as const).map(([x, z], i) => houseWheel(`wheel-${i}`, x, -0.04, z, 'solid200', 14)),
    {
      id: 'shell', label: 'Spinning shell', parent: 'body', position: [0, 0.0, 0], rotation: [0, 0, 0], role: 'structure',
      shape: { type: 'lathe', segments: 56, profile: [[0, 0.1], [0.35, 0.095], [0.6, 0.04], [0.65, 0.015], [0.65, -0.025], [0.6, -0.06], [0.4, -0.09], [0, -0.09]] }, material: 'mildSteel', wall: 8,
      joint: { type: 'hinge', axis: [0, 1, 0], actuator: { type: 'motor', motor: 'hm-weapon', gear: 6, softStart: 5, input: { source: 'button1', mode: 'toggle' } } },
    },
    ...[0, 120, 240].map((deg, i): P => {
      const a = (deg * Math.PI) / 180;
      return { id: `tooth-${i}`, label: `Tooth ${i + 1}`, parent: 'shell', position: [Math.cos(a) * 0.66, 0, Math.sin(a) * 0.66], rotation: [0, -deg, 0], joint: fixed, role: 'structure', shape: { type: 'box', size: [0.09, 0.1, 0.07] }, material: 'hardox' };
    }),
  ],
};

/** A hydraulic press with a hooked hardened spike: 125 kN of cylinder. Nothing in the competitor roster stops the point. */
export const PILEDRIVER: RobotDesign = {
  schema: 2,
  id: 'house-piledriver',
  name: 'Pile Driver',
  description: 'Overpowered: a 250-bar hydraulic cylinder drives a hooked hardened spike down onto a steel scoop with nearly three tonnes at the point. Goes through hardened steel. Slowly. While you watch.',
  colour: '#7b241c',
  catalog: HOUSE_CATALOG,
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.26, -0.1], rotation: [0, 0, 0], joint: fixed, role: 'structure', shape: armour([0.9, 0.36, 1.0], { sides: 0.08, rear: 0.18, belt: 0.5 }), material: 'mildSteel', wall: 10 },
    { id: 'scoop', label: 'Scoop', parent: 'body', position: [0, -0.175, 0.66], rotation: [0, 0, 0], joint: fixed, role: 'structure', shape: cheekWedge([0.9, 0.16, 0.4], { topWidth: 0.6, shoulder: 0.1, lip: 0.005, nose: 0.02 }), material: 'hardox', wall: 10 },
    {
      id: 'spike', label: 'Hydraulic spike', parent: 'body', position: [0, 0.22, 0.1], rotation: [-40, 0, 0], role: 'structure',
      shape: { type: 'extrude', plane: 'side', depth: 0.1, outline: [[0, -0.045], [0.7, -0.045], [0.76, -0.3], [0.7, -0.3], [0.62, 0.03], [0, 0.06]] }, material: 'hardox', edge: 'spike',
      joint: { type: 'hinge', axis: [1, 0, 0], limits: [-5, 52], actuator: { type: 'pneumatic', ram: 'hyd80', valve: 'spool', pressure: 250, leverArm: 0.18, input: { source: 'button1', mode: 'hold' } } },
    },
    ...sixWheels(0.5, -0.135, [0.25, -0.05, -0.35], 18),
    houseBattery([0, -0.05, -0.25]),
  ],
};

/** Giant clamp-lifter: grabs you, lifts you, carries you to the pit. */
export const WARDEN: RobotDesign = {
  schema: 2,
  id: 'house-warden',
  name: 'Warden',
  description: 'Overpowered: huge hydraulic forks and a servo clamp that pins you down on them. Picks up anything in the competition, holds it up in the air and drives it wherever it likes. Usually the pit.',
  colour: '#1b4f72',
  catalog: HOUSE_CATALOG,
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.24, -0.15], rotation: [0, 0, 0], joint: fixed, role: 'structure', shape: armour([0.9, 0.34, 0.9], { sides: 0.08, rear: 0.16, belt: 0.5 }), material: 'mildSteel', wall: 10 },
    {
      id: 'forks', label: 'Lifting forks', parent: 'body', position: [0, -0.06, 0.32], rotation: [16, 0, 0], role: 'structure',
      shape: { type: 'box', size: [0.8, 0.02, 0.6] }, shapeOffset: [0, 0, 0.3], material: 'hardox',
      joint: { type: 'hinge', axis: [-1, 0, 0], limits: [-3, 60], actuator: { type: 'pneumatic', ram: 'hyd80', valve: 'spool', pressure: 250, leverArm: 0.2, input: { source: 'button1', mode: 'hold' } } },
    },
    {
      id: 'jaw', label: 'Clamp jaw', parent: 'forks', position: [0, 0.36, 0.02], rotation: [-50, 0, 0], role: 'structure',
      shape: { type: 'extrude', plane: 'side', depth: 0.08, outline: [[0, -0.03], [0.6, -0.03], [0.64, -0.14], [0.58, -0.14], [0.55, 0.03], [0, 0.035]] }, material: 'hardox', edge: 'spike',
      joint: { type: 'hinge', axis: [1, 0, 0], limits: [-5, 80], actuator: { type: 'servo', motor: 'hm-drive', gear: 200, targets: [0, 0, 76], input: { source: 'button1', mode: 'hold' } } },
    },
    ...sixWheels(0.5, -0.115, [0.2, -0.1, -0.4], 18),
    houseBattery([0, -0.05, -0.3]),
  ],
};

/** Twin flamethrowers and a flipper that throws heavyweights out of the arena. */
export const INFERNO: RobotDesign = {
  schema: 2,
  id: 'house-inferno',
  name: 'Inferno',
  description: 'Overpowered: a 60-bar dump-valve flipper that can throw a heavyweight clean over the wall, and twin flamethrowers on the shoulders for anything that lands nearby.',
  colour: '#d35400',
  catalog: HOUSE_CATALOG,
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.22, -0.1], rotation: [0, 0, 0], joint: fixed, role: 'structure', shape: armour([0.85, 0.3, 0.95], { sides: 0.08, rear: 0.16, belt: 0.5 }), material: 'mildSteel', wall: 8 },
    {
      id: 'flipper', label: 'Flipper', parent: 'body', position: [0, 0.0, 0.475], rotation: [22, 0, 0], role: 'structure',
      shape: bevelledPlate([0.8, 0.012, 0.55], { bevel: 0.07, corner: 0.08 }), shapeOffset: [0, 0, 0.275], material: 'hardox',
      joint: { type: 'hinge', axis: [-1, 0, 0], limits: [-3, 100], actuator: { type: 'pneumatic', ram: 'ram100hp', valve: 'dump', pressure: 60, leverArm: 0.2, input: { source: 'button1', mode: 'hold' } } },
    },
    ...[1, -1].map((s): P => ({
      id: `flame-${s > 0 ? 'l' : 'r'}`, label: `${s > 0 ? 'Left' : 'Right'} flamethrower`, parent: 'body', position: [0.32 * s, 0.17, 0.4], rotation: [8, 0, 0], joint: fixed, role: 'component',
      component: { type: 'flamethrower', range: 1.2, fuel: 4, input: { source: 'button2', mode: 'hold' } },
    })),
    ...[0.22, -0.3].flatMap((z, i) => [houseWheel(`wheel-l${i}`, 0.48, -0.095, z), houseWheel(`wheel-r${i}`, -0.48, -0.095, z)]),
    houseBattery([0, -0.05, -0.3]),
    { id: 'gas-a', label: 'Gas bottle A', parent: 'body', position: [0.15, -0.05, 0.05], rotation: [0, 0, 0], joint: fixed, role: 'component', component: { type: 'gasTank', part: 'co2_2kg' } },
    { id: 'gas-b', label: 'Gas bottle B', parent: 'body', position: [-0.15, -0.05, 0.05], rotation: [0, 0, 0], joint: fixed, role: 'component', component: { type: 'gasTank', part: 'co2_2kg' } },
  ],
};

export const MONSTER_HOUSE: RobotDesign[] = [MAELSTROM, PILEDRIVER, WARDEN, INFERNO];

/** Which house robots guard the corners. */
export type HouseSet = 'classic' | 'overpowered' | 'mixed';

export function houseLineup(set: HouseSet): RobotDesign[] {
  if (set === 'overpowered') return MONSTER_HOUSE;
  if (set === 'mixed') return [MAELSTROM, IRONJAW, PILEDRIVER, BUZZARD];
  return HOUSE_ROBOTS;
}
