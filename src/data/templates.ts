import type { RobotDesign } from '../sim/design';
import { fromV1 } from '../sim/legacy';
import { armour, bevelledPlate, bladeBar, cheekWedge, reshape, taperedTongue } from './shaping';
import { EXAMPLES } from './examples';

/**
 * Starter robots. Original designs in the style of classic heavyweights
 * (~100 kg class), built entirely from catalogue parts.
 */

export const WEDGEHOG: RobotDesign = reshape(fromV1({
  schema: 1,
  id: 'wedgehog',
  name: 'Wedgehog',
  description: 'Four-wheel-drive wedge. No weapon — just traction, a hardened wedge and bad intentions.',
  colour: '#d4a017',
  shell: [
    { id: 'body', label: 'Body shell', shape: 'box', size: [0.5, 0.22, 0.6], position: [0, 0.135, -0.05], material: 'aluminium', thickness: 6 },
    { id: 'wedge', label: 'Front wedge', shape: 'wedge', size: [0.74, 0.22, 0.38], position: [0, 0.135, 0.44], material: 'hardox', thickness: 5, lipHeight: 0.01 },
    { id: 'rear', label: 'Rear bumper', shape: 'box', size: [0.74, 0.12, 0.06], position: [0, 0.1, -0.38], material: 'hdpe', thickness: 20 },
  ],
  skids: [],
  drive: {
    motor: 'dm750',
    motorsPerSide: 2,
    gearRatio: 9,
    motorPosition: [0.15, 0.13, 0],
    wheels: [
      { wheel: 'pneu250', position: [0.31, 0.125, 0.18], side: 'left' },
      { wheel: 'pneu250', position: [0.31, 0.125, -0.22], side: 'left' },
      { wheel: 'pneu250', position: [-0.31, 0.125, 0.18], side: 'right' },
      { wheel: 'pneu250', position: [-0.31, 0.125, -0.22], side: 'right' },
    ],
  },
  battery: { part: 'nicd24', position: [0, 0.1, -0.2] },
  weapons: [],
}), {
  // Raked rear deck and sloped sides; the hardened wedge has cheek plates over the front wheels.
  body: { shape: armour([0.5, 0.22, 0.6], { sides: 0.05, rear: 0.12, belt: 0.45 }), wall: 8 }, // weight saved by the sloped shell goes back into thicker plate
  wedge: { shape: cheekWedge([0.74, 0.22, 0.38], { topWidth: 0.4, shoulder: 0.12, lip: 0.01, nose: 0.03 }) },
  rear: { shape: armour([0.74, 0.12, 0.06], { rear: 0.03, belt: 0.3 }) },
});

export const FLIPSIDE: RobotDesign = reshape(fromV1({
  schema: 1,
  id: 'flipside',
  name: 'Flipside',
  description: 'Pneumatic front flipper on a high-flow dump valve. Gets underneath and sends them flying — while the gas lasts.',
  colour: '#c0392b',
  shell: [
    { id: 'body', label: 'Body shell', shape: 'box', size: [0.55, 0.2, 0.75], position: [0, 0.13, -0.02], material: 'aluminium', thickness: 8 },
    { id: 'rear', label: 'Rear wedge', shape: 'wedge', size: [0.55, 0.2, 0.18], position: [0, 0.13, -0.48], material: 'aluminium', thickness: 8, lipHeight: 0.02 },
  ],
  skids: [
    { position: [0, 0.036, 0.3], radius: 0.03 },
    { position: [0, 0.036, -0.38], radius: 0.03 },
  ],
  drive: {
    motor: 'dm750',
    motorsPerSide: 1,
    gearRatio: 8,
    motorPosition: [0.15, 0.12, -0.12],
    wheels: [
      { wheel: 'pneu250', position: [0.32, 0.125, -0.05], side: 'left' },
      { wheel: 'pneu250', position: [-0.32, 0.125, -0.05], side: 'right' },
    ],
  },
  battery: { part: 'nicd24', position: [0, 0.1, -0.28] },
  weapons: [
    {
      kind: 'flipper',
      ram: 'ram80',
      valve: 'dump',
      tank: 'co2_2kg',
      pressure: 22,
      hinge: [0, 0.23, 0.35],
      plate: { width: 0.62, length: 0.44, thickness: 8, material: 'aluminium' },
      leverArm: 0.14,
      maxAngle: 75,
      gasPosition: [0, 0.12, 0.12],
    },
  ],
}), {
  body: { shape: armour([0.55, 0.2, 0.75], { sides: 0.06, belt: 0.45 }) },
  // Slopes down to the back (so it's a wedge facing backwards, not a step).
  rear: { shape: { type: 'hull', points: [
    [-0.275, -0.1, 0.09], [0.275, -0.1, 0.09], [-0.275, -0.01, 0.09], [0.275, -0.01, 0.09], [-0.215, 0.1, 0.09], [0.215, 0.1, 0.09],
    [-0.275, -0.1, -0.09], [0.275, -0.1, -0.09], [-0.275, -0.08, -0.09], [0.275, -0.08, -0.09],
  ] } },
  'flipper-0': { shape: bevelledPlate([0.62, 0.008, 0.44]) },
});

export const WHIRLWIND: RobotDesign = reshape(fromV1({
  schema: 1,
  id: 'whirlwind',
  name: 'Whirlwind',
  description: 'Undercutter: a hardened steel bar spinning at 1,600 rpm just above the floor, out in front on a fork plate. Slow to spin up, brutal once it has.',
  colour: '#2e86c1',
  shell: [
    { id: 'body', label: 'Body shell', shape: 'box', size: [0.6, 0.16, 0.56], position: [0, 0.11, -0.22], material: 'aluminium', thickness: 8 },
    { id: 'forks', label: 'Weapon fork plate', shape: 'box', size: [0.24, 0.04, 0.34], position: [0, 0.05, 0.22], material: 'hardox', thickness: 10 },
  ],
  skids: [
    { position: [0, 0.036, 0.3], radius: 0.03 },
    { position: [0, 0.036, -0.46], radius: 0.03 },
  ],
  drive: {
    motor: 'dm750',
    motorsPerSide: 1,
    gearRatio: 10,
    motorPosition: [0.15, 0.1, -0.3],
    wheels: [
      { wheel: 'solid200', position: [0.35, 0.1, -0.2], side: 'left' },
      { wheel: 'solid200', position: [-0.35, 0.1, -0.2], side: 'right' },
    ],
  },
  battery: { part: 'nicd36l', position: [0, 0.1, -0.38] },
  weapons: [
    {
      kind: 'spinner',
      motor: 'wm2000',
      beltRatio: 3,
      orientation: 'horizontal',
      blade: { shape: 'bar', length: 0.62, width: 0.1, thickness: 25, material: 'hardox' },
      position: [0, 0.1, 0.36],
      motorPosition: [0, 0.1, -0.1],
    },
  ],
}), {
  body: { shape: armour([0.6, 0.16, 0.56], { sides: 0.06, front: 0.1, rear: 0.06, belt: 0.35 }), wall: 10 },
  forks: { shape: taperedTongue(0.24, 0.16, 0.34, 0.042) },
  'spinner-0': { shape: bladeBar(0.62, 0.1, 0.025) },
});

export const TEMPLATES: RobotDesign[] = [WEDGEHOG, FLIPSIDE, WHIRLWIND, ...EXAMPLES];

/** Test-bay target: a heavy steel box that just sits there and takes it. */
export const CRASH_TEST_DUMMY: RobotDesign = fromV1({
  schema: 1,
  id: 'dummy',
  name: 'Crash Test Dummy',
  description: 'A mild-steel box on wheels for testing weapons.',
  colour: '#8a8f96',
  shell: [{ id: 'body', label: 'Steel box', shape: 'box', size: [0.6, 0.24, 0.7], position: [0, 0.15, 0], material: 'mildSteel', thickness: 6 }],
  skids: [],
  drive: {
    motor: 'dm750', motorsPerSide: 1, gearRatio: 9, motorPosition: [0.15, 0.13, 0],
    wheels: [
      { wheel: 'pneu250', position: [0.36, 0.125, 0.22], side: 'left' },
      { wheel: 'pneu250', position: [0.36, 0.125, -0.22], side: 'left' },
      { wheel: 'pneu250', position: [-0.36, 0.125, 0.22], side: 'right' },
      { wheel: 'pneu250', position: [-0.36, 0.125, -0.22], side: 'right' },
    ],
  },
  battery: { part: 'nicd24', position: [0, 0.1, -0.2] },
  weapons: [],
});
