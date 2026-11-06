import type { ActuatorDef, PartDef, RobotDesign, Vec3 } from '../sim/design';
import { armour } from './shaping';

/**
 * More starter robots, one for each classic weapon type the first set
 * doesn't cover: an overhead axe, a drum, a crusher, a ram spike, a vertical
 * disc and a lifter. All heavyweights, all built from catalogue parts.
 */

const fixed = { type: 'fixed' } as const;
const zero: Vec3 = [0, 0, 0];

/** A driven wheel at (x, y, z) in the chassis frame, wired to its side. */
function wheel(id: string, label: string, at: Vec3, wheelId: string, motor: string, gear: number): PartDef {
  return {
    id, label, parent: 'body', position: at, rotation: zero, role: 'wheel', wheel: wheelId,
    joint: { type: 'hinge', axis: [1, 0, 0], actuator: { type: 'motor', motor, gear, input: { source: at[0] > 0 ? 'left' : 'right', scale: 1 } } },
  };
}

/** Four wheels, front and rear on each side. */
function fourWheels(x: number, y: number, zFront: number, zRear: number, wheelId: string, motor: string, gear: number): PartDef[] {
  return [
    wheel('wheel-lf', 'Left front wheel', [x, y, zFront], wheelId, motor, gear),
    wheel('wheel-lr', 'Left rear wheel', [x, y, zRear], wheelId, motor, gear),
    wheel('wheel-rf', 'Right front wheel', [-x, y, zFront], wheelId, motor, gear),
    wheel('wheel-rr', 'Right rear wheel', [-x, y, zRear], wheelId, motor, gear),
  ];
}

const battery = (part: string, at: Vec3): PartDef => ({ id: 'battery', label: 'Battery', parent: 'body', position: at, rotation: zero, joint: fixed, role: 'component', component: { type: 'battery', part } });
const gas = (part: string, at: Vec3): PartDef => ({ id: 'gas', label: 'Gas bottle', parent: 'body', position: at, rotation: zero, joint: fixed, role: 'component', component: { type: 'gasTank', part } });
const skid = (id: string, at: Vec3): PartDef => ({ id, label: id === 'skid-f' ? 'Front skid' : 'Rear skid', parent: 'body', position: at, rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.03 }, material: 'ptfe' });
const button1 = (a: Omit<Extract<ActuatorDef, { type: 'pneumatic' }>, 'type' | 'input'>, mode: 'hold' | 'toggle' = 'hold'): ActuatorDef => ({ type: 'pneumatic', ...a, input: { source: 'button1', mode } });

/** Overhead axe: a steel arm lying back over the body swings up, over and down in front. */
export const AXEMAN: RobotDesign = {
  schema: 2,
  id: 'axeman',
  name: 'Axeman',
  description: 'Overhead axe on a big dump-valve ram: the arm lies back over the body, then comes over the top and down on whatever is in front. Wedge to hold them there.',
  colour: '#7d3c98',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.14, -0.02], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.56, 0.2, 0.72], { sides: 0.06, front: 0.12, rear: 0.06, belt: 0.45 }), material: 'aluminium', wall: 6 },
    { id: 'wedge', label: 'Front wedge', parent: 'body', position: [0, -0.07, 0.42], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'wedge', size: [0.56, 0.12, 0.14], lip: 0.005 }, material: 'hardox', wall: 6 },
    ...fourWheels(0.34, -0.015, 0.2, -0.2, 'pneu250', 'dm750', 9),
    {
      id: 'arm', label: 'Axe arm', parent: 'body', position: [0, 0.12, 0.12], rotation: zero, role: 'structure',
      shape: { type: 'box', size: [0.05, 0.05, 0.55] }, shapeOffset: [0, 0, -0.275], material: 'mildSteel', wall: 4,
      joint: { type: 'hinge', axis: [1, 0, 0], limits: [-5, 190], actuator: button1({ ram: 'ram80', valve: 'dump', pressure: 24, leverArm: 0.09 }) },
    },
    {
      // Points up while the arm lies back; down when it lands.
      id: 'head', label: 'Axe head', parent: 'arm', position: [0, 0.02, -0.53], rotation: zero, joint: fixed, role: 'structure',
      shape: { type: 'extrude', plane: 'side', depth: 0.03, outline: [[-0.06, 0], [0.06, 0], [0.015, 0.16], [-0.015, 0.16]] }, material: 'hardox', edge: 'spike',
    },
    battery('nicd24', [0, -0.03, -0.15]),
    gas('co2_2kg', [0, -0.03, 0.1]),
  ],
};

/** Drum: a toothed steel drum spinning low across the front, uppercutting anything it meets. */
export const DRUMROLL: RobotDesign = {
  schema: 2,
  id: 'drumroll',
  name: 'Drumroll',
  description: 'A toothed steel drum spinning at 3,000 rpm across the nose. Compact, low and hard to get at — every hit bounces them upwards.',
  colour: '#1abc9c',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.125, -0.12], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.5, 0.17, 0.5], { sides: 0.05, rear: 0.1, belt: 0.45 }), material: 'aluminium', wall: 6 },
    { id: 'arm-l', label: 'Left drum arm', parent: 'body', position: [0.21, 0, 0.27], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.03, 0.12, 0.24] }, material: 'hardox' },
    { id: 'arm-r', label: 'Right drum arm', parent: 'body', position: [-0.21, 0, 0.27], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.03, 0.12, 0.24] }, material: 'hardox' },
    {
      // Turned so the cylinder's axis lies across the robot; spins so the front face goes up.
      id: 'drum', label: 'Drum', parent: 'body', position: [0, 0.01, 0.36], rotation: [0, 0, 90], role: 'structure',
      shape: { type: 'cylinder', radius: 0.08, length: 0.38 }, material: 'mildSteel', wall: 6,
      joint: { type: 'hinge', axis: [0, 1, 0], actuator: { type: 'motor', motor: 'wm900', gear: 1.5, input: { source: 'button1', mode: 'toggle' } } },
    },
    { id: 'tooth-a', label: 'Drum tooth A', parent: 'drum', position: [0.09, 0.1, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.04, 0.06, 0.03] }, material: 'hardox' },
    { id: 'tooth-b', label: 'Drum tooth B', parent: 'drum', position: [-0.09, -0.1, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.04, 0.06, 0.03] }, material: 'hardox' },
    // Front wheels well forward, or the drum's weight tips it onto its nose.
    ...fourWheels(0.3, -0.025, 0.2, -0.14, 'solid200', 'dm750', 9),
    battery('nicd24', [0, -0.02, -0.18]),
  ],
};

/** Crusher: a hooked steel beak bites down onto a scoop. */
export const JAWBREAKER: RobotDesign = {
  schema: 2,
  id: 'jawbreaker',
  name: 'Jawbreaker',
  description: 'Crusher: scoop them up on the hardened lower jaw, then a high-pressure ram drives a hooked beak down through their top armour.',
  colour: '#a04000',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.15, -0.1], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.56, 0.22, 0.6], { sides: 0.06, rear: 0.12, belt: 0.5 }), material: 'aluminium', wall: 6 },
    { id: 'scoop', label: 'Lower jaw', parent: 'body', position: [0, -0.095, 0.45], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'wedge', size: [0.56, 0.1, 0.3], lip: 0.005 }, material: 'hardox', wall: 6 },
    {
      // Drawn side-on (forward, up): a beak with a downward hook at the tip. Rests
      // raised, and closes over the lower jaw — biting beyond it would just
      // lever its own nose up.
      id: 'beak', label: 'Crusher beak', parent: 'body', position: [0, 0.13, 0.2], rotation: [-45, 0, 0], role: 'structure',
      shape: { type: 'extrude', plane: 'side', depth: 0.08, outline: [[0, -0.02], [0.34, -0.02], [0.39, -0.15], [0.33, -0.15], [0.3, 0.02], [0, 0.03]] }, material: 'hardox', edge: 'spike',
      joint: { type: 'hinge', axis: [1, 0, 0], limits: [-10, 60], actuator: button1({ ram: 'ram80hp', valve: 'std', pressure: 25, leverArm: 0.1 }) },
    },
    ...fourWheels(0.34, -0.025, 0.1, -0.2, 'pneu250', 'dm750', 9),
    battery('nicd24', [0, -0.03, -0.2]),
    gas('co2_2kg', [0, -0.03, 0.05]),
  ],
};

/** Ram spike: a hardened lance punches out of the nose. */
export const LANCER: RobotDesign = {
  schema: 2,
  id: 'lancer',
  name: 'Lancer',
  description: 'Fast two-wheeler with a hardened lance that punches 200 mm out of the nose. Line up, charge, fire — it goes straight through thin armour.',
  colour: '#2874a6',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.125, 0], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.54, 0.18, 0.66], { sides: 0.05, front: 0.16, rear: 0.08, belt: 0.4 }), material: 'aluminium', wall: 6 },
    { id: 'wedge', label: 'Nose wedge', parent: 'body', position: [0, -0.06, 0.41], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'wedge', size: [0.6, 0.1, 0.16], lip: 0.005 }, material: 'hardox', wall: 5 },
    {
      // A cone turned to point forward; the slider runs along it.
      id: 'lance', label: 'Lance', parent: 'body', position: [0, 0.03, 0.3], rotation: [90, 0, 0], role: 'structure',
      shape: { type: 'cone', radius: 0.035, length: 0.34 }, material: 'hardox', edge: 'spike',
      joint: { type: 'slider', axis: [0, 1, 0], limits: [0, 200], actuator: button1({ ram: 'ram63', valve: 'dump', pressure: 24, leverArm: 0 }) },
    },
    wheel('wheel-l', 'Left wheel', [0.33, 0, -0.08], 'pneu250', 'dm750', 7),
    wheel('wheel-r', 'Right wheel', [-0.33, 0, -0.08], 'pneu250', 'dm750', 7),
    // Skids sit just clear of the floor: the wheels carry the weight.
    skid('skid-f', [0, -0.08, 0.22]),
    skid('skid-r', [0, -0.08, -0.28]),
    battery('nicd24', [0, -0.03, -0.18]),
    gas('co2_1kg', [0, -0.03, 0.08]),
  ],
};

/** Vertical disc: a hardened disc with two teeth, spinning upwards between forks on the nose. */
export const SAWTOOTH: RobotDesign = {
  schema: 2,
  id: 'sawtooth',
  name: 'Sawtooth',
  description: 'Vertical spinner: a 360 mm hardened disc with two teeth, spinning between forks on the nose. Hits send them up and over — and spinning up kicks its own nose up.',
  colour: '#b7950b',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.14, -0.1], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.5, 0.2, 0.6], { sides: 0.06, rear: 0.1, belt: 0.45 }), material: 'aluminium', wall: 6 },
    { id: 'fork-l', label: 'Left fork', parent: 'body', position: [0.06, 0.02, 0.36], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.03, 0.16, 0.3] }, material: 'hardox' },
    { id: 'fork-r', label: 'Right fork', parent: 'body', position: [-0.06, 0.02, 0.36], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.03, 0.16, 0.3] }, material: 'hardox' },
    {
      id: 'disc', label: 'Disc', parent: 'body', position: [0, 0.09, 0.45], rotation: [0, 0, 90], role: 'structure',
      shape: { type: 'cylinder', radius: 0.18, length: 0.012 }, material: 'hardox',
      joint: { type: 'hinge', axis: [0, 1, 0], actuator: { type: 'motor', motor: 'wm2000', gear: 2, softStart: 1.5, input: { source: 'button1', mode: 'toggle' } } },
    },
    { id: 'tooth-a', label: 'Disc tooth A', parent: 'disc', position: [0.185, 0, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.04, 0.03, 0.05] }, material: 'hardox' },
    { id: 'tooth-b', label: 'Disc tooth B', parent: 'disc', position: [-0.185, 0, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.04, 0.03, 0.05] }, material: 'hardox' },
    // 24 V drive motors on the 36 V weapon pack: over-volted, as real builders did.
    ...fourWheels(0.31, -0.015, 0.2, -0.2, 'pneu250', 'dm750', 13),
    battery('nicd36l', [0, -0.03, -0.15]),
  ],
};

/** Lifter: wide forks slide under, then a slow, strong ram lifts them off their wheels. */
export const HOISTER: RobotDesign = {
  schema: 2,
  id: 'hoister',
  name: 'Hoister',
  description: 'Big four-wheel-drive pusher with wide lifting forks on a slow, strong ram. Gets under, lifts them off their wheels and drives them where it likes — the pit, ideally.',
  colour: '#17a589',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.15, -0.05], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.6, 0.22, 0.66], { sides: 0.06, rear: 0.14, belt: 0.5 }), material: 'aluminium', wall: 6 },
    {
      // Rests sloping down to the floor; lifting turns it up about the hinge.
      id: 'forks', label: 'Lifting forks', parent: 'body', position: [0, 0.025, 0.3], rotation: [21, 0, 0], role: 'structure',
      shape: { type: 'box', size: [0.52, 0.012, 0.45] }, shapeOffset: [0, 0, 0.225], material: 'hardox',
      joint: { type: 'hinge', axis: [-1, 0, 0], limits: [-3, 70], actuator: button1({ ram: 'ram80hp', valve: 'lifter', pressure: 35, leverArm: 0.14 }) },
    },
    ...fourWheels(0.36, -0.025, 0.14, -0.22, 'pneu250', 'dm750', 10),
    battery('nicd24', [0, -0.03, -0.2]),
    gas('co2_2kg', [0, -0.03, 0.05]),
  ],
};

export const ROSTER: RobotDesign[] = [AXEMAN, DRUMROLL, JAWBREAKER, LANCER, SAWTOOTH, HOISTER];
