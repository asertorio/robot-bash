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
