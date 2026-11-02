import type { InputDef, PartDef, RobotDesign, Vec3 } from '../sim/design';
import { armour } from './shaping';

/**
 * Example builds written directly as part trees, to show the range: twin
 * flippers, a rolling sphere, a six-legged walker and a full-body spinner.
 */

const fixed = { type: 'fixed' } as const;
const zero: Vec3 = [0, 0, 0];

export const TWIN_TERROR: RobotDesign = {
  schema: 2,
  id: 'twin-terror',
  name: 'Twin Terror',
  description: 'Two independent flippers side by side: button 1 fires the left, button 2 the right, both together for a full-width launch.',
  colour: '#e67e22',
  parts: [
    { id: 'chassis', label: 'Chassis', parent: null, position: [0, 0.13, 0], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.62, 0.18, 0.7], { sides: 0.05, rear: 0.12, belt: 0.4 }), material: 'aluminium', wall: 6 },
    ...(['left', 'right'] as const).flatMap((side, i): PartDef[] => {
      const x = side === 'left' ? 0.155 : -0.155;
      return [
        {
          id: `flipper-${side}`, label: `${side === 'left' ? 'Left' : 'Right'} flipper`, parent: 'chassis', position: [x, 0.09, 0.35], rotation: [32, 0, 0],
          shape: { type: 'box', size: [0.3, 0.008, 0.4] }, shapeOffset: [0, 0, 0.2], material: 'aluminium', role: 'structure',
          joint: { type: 'hinge', axis: [-1, 0, 0], limits: [-3, 105], actuator: { type: 'pneumatic', ram: 'ram63', valve: 'dump', pressure: 22, leverArm: 0.12, input: { source: i === 0 ? 'button1' : 'button2', mode: 'hold' } } },
        },
        {
          id: `wheel-${side}`, label: `${side === 'left' ? 'Left' : 'Right'} wheel`, parent: 'chassis', position: [side === 'left' ? 0.35 : -0.35, -0.005, -0.08], rotation: zero, role: 'wheel', wheel: 'pneu250',
          joint: { type: 'hinge', axis: [1, 0, 0], actuator: { type: 'motor', motor: 'dm750', gear: 8, input: { source: side, scale: 1 } } },
        },
      ];
    }),
    { id: 'skid-f', label: 'Front skid', parent: 'chassis', position: [0, -0.094, 0.28], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.03 }, material: 'ptfe' },
    { id: 'skid-r', label: 'Rear skid', parent: 'chassis', position: [0, -0.094, -0.3], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.03 }, material: 'ptfe' },
    { id: 'battery', label: 'Battery', parent: 'chassis', position: [0, -0.03, -0.2], rotation: zero, joint: fixed, role: 'component', component: { type: 'battery', part: 'nicd24' } },
    { id: 'gas', label: 'Gas bottle', parent: 'chassis', position: [0, -0.02, 0.05], rotation: zero, joint: fixed, role: 'component', component: { type: 'gasTank', part: 'co2_2kg' } },
  ],
};

/**
 * A pendulum sphere: a heavy frame hangs inside a rolling shell. Driving
 * turns the shell against the pendulum; steering tilts the pendulum sideways
 * so the ball rolls in an arc.
 */
export const ORB: RobotDesign = {
  schema: 2,
  id: 'orb',
  name: 'Orb',
  description: 'A rolling aluminium ball with a pendulum drive inside. Nothing to grab, nothing to flip — but steering it takes practice.',
  colour: '#16a085',
  parts: [
    { id: 'pendulum', label: 'Pendulum frame', parent: null, position: [0, 0.18, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.3, 0.1, 0.22] }, material: 'mildSteel', wall: 5 },
    { id: 'ballast', label: 'Lead ballast', parent: 'pendulum', position: [0, -0.1, 0], rotation: zero, joint: fixed, role: 'component', component: { type: 'ballast', mass: 26 } },
    { id: 'battery', label: 'Battery', parent: 'pendulum', position: [0, 0, 0.06], rotation: zero, joint: fixed, role: 'component', component: { type: 'battery', part: 'nicd24' } },
    {
      id: 'yoke', label: 'Tilt yoke', parent: 'pendulum', position: [0, 0.17, 0], rotation: [0, 0, 90], role: 'structure',
      shape: { type: 'cylinder', radius: 0.025, length: 0.5 }, material: 'mildSteel',
      joint: { type: 'hinge', axis: [0, 0, 1], limits: [-30, 30], actuator: { type: 'servo', motor: 'dm750', gear: 40, targets: [-25, 0, 25], input: { source: 'steer', scale: 1 } } },
    },
    {
      id: 'shell', label: 'Shell', parent: 'yoke', position: zero, rotation: zero, role: 'structure',
      shape: { type: 'sphere', radius: 0.35 }, material: 'aluminium', wall: 4,
      // The yoke is turned 90° about Z, so its Y is the world's X: the axle.
      // Too much torque and the pendulum just swings over the top instead of rolling the ball.
      joint: { type: 'hinge', axis: [0, -1, 0], actuator: { type: 'motor', motor: 'dm750', gear: 20, input: { source: 'throttle', scale: 0.55 } } },
    },
  ],
};

/** Six legs, tripod gait: front and rear on one side step with the middle on the other. */
function leg(side: 'left' | 'right', z: number, phase: number): PartDef[] {
  const s = side === 'left' ? 1 : -1;
  const name = `${side === 'left' ? 'Left' : 'Right'} ${z > 0.05 ? 'front' : z < -0.05 ? 'rear' : 'middle'}`;
  const id = `${side}-${z > 0.05 ? 'f' : z < -0.05 ? 'r' : 'm'}`;
  const gait = (pattern: 'swing' | 'lift', scale = 1): InputDef => ({ source: 'gait', side, phase, pattern, scale });
  return [
    {
      id: `${id}-hip`, label: `${name} hip`, parent: 'body', position: [0.19 * s, 0, z], rotation: zero, role: 'structure',
      shape: { type: 'box', size: [0.18, 0.035, 0.035] }, shapeOffset: [0.09 * s, 0, 0], material: 'aluminium',
      joint: { type: 'hinge', axis: [0, 1, 0], limits: [-35, 35], actuator: { type: 'servo', motor: 'dm250', gear: 60, targets: [-22, 0, 22], input: gait('swing', s) } },
    },
    {
      id: `${id}-shin`, label: `${name} shin`, parent: `${id}-hip`, position: [0.18 * s, 0, 0], rotation: zero, role: 'structure',
      shape: { type: 'box', size: [0.035, 0.26, 0.035] }, shapeOffset: [0, -0.13, 0], material: 'aluminium',
      joint: { type: 'hinge', axis: [0, 0, 1], limits: [-40, 40], actuator: { type: 'servo', motor: 'dm250', gear: 60, targets: [0, 0, 28 * s], input: gait('lift') } },
    },
    { id: `${id}-foot`, label: `${name} foot`, parent: `${id}-shin`, position: [0, -0.26, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.03 }, material: 'rubber' },
  ];
}

export const ARACHNID: RobotDesign = {
  schema: 2,
  id: 'arachnid',
  name: 'Arachnid',
  description: 'Six-legged walker on twelve servos with a tripod gait. Slow, unsettling, and very hard to get a wedge under.',
  colour: '#6c3483',
  parts: [
    { id: 'body', label: 'Body', parent: null, position: [0, 0.29, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'hull', points: [
      [0.19, -0.05, 0.22], [-0.19, -0.05, 0.22], [0.19, -0.05, -0.22], [-0.19, -0.05, -0.22], [0.11, -0.05, 0.28], [-0.11, -0.05, 0.28], [0.11, -0.05, -0.28], [-0.11, -0.05, -0.28],
      [0.15, 0.05, 0.19], [-0.15, 0.05, 0.19], [0.15, 0.05, -0.19], [-0.15, 0.05, -0.19], [0.08, 0.05, 0.25], [-0.08, 0.05, 0.25], [0.08, 0.05, -0.25], [-0.08, 0.05, -0.25],
    ] }, material: 'aluminium', wall: 4 },
    { id: 'battery-a', label: 'Battery A', parent: 'body', position: [0, 0, 0.1], rotation: zero, joint: fixed, role: 'component', component: { type: 'battery', part: 'nicd12' } },
    { id: 'battery-b', label: 'Battery B', parent: 'body', position: [0, 0, -0.1], rotation: zero, joint: fixed, role: 'component', component: { type: 'battery', part: 'nicd12' } },
    { id: 'battery-c', label: 'Battery C', parent: 'body', position: [0.1, 0, 0], rotation: zero, joint: fixed, role: 'component', component: { type: 'battery', part: 'nicd12' } },
    { id: 'battery-d', label: 'Battery D', parent: 'body', position: [-0.1, 0, 0], rotation: zero, joint: fixed, role: 'component', component: { type: 'battery', part: 'nicd12' } },
    { id: 'pincer', label: 'Pincer', parent: 'body', position: [0, -0.02, 0.33], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'wedge', size: [0.3, 0.06, 0.12], lip: 0.005 }, material: 'hardox', wall: 4 },
    ...leg('left', 0.2, 0), ...leg('left', 0, 180), ...leg('left', -0.2, 0),
    ...leg('right', 0.2, 0), ...leg('right', 0, 180), ...leg('right', -0.2, 0),
  ],
};

/** Full-body spinner: the whole shell is the weapon; a small drive base sits inside. */
export const GYRODISC: RobotDesign = {
  schema: 2,
  id: 'gyrodisc',
  name: 'Gyrodisc',
  description: 'Full-body spinner: a 1 m aluminium shell with steel teeth spinning around the drive base. Takes ages to spin up; then everything bounces off.',
  colour: '#c0392b',
  parts: [
    { id: 'base', label: 'Drive base', parent: null, position: [0, 0.1, 0], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.36, 0.1, 0.36], { sides: 0.03, front: 0.03, rear: 0.03, belt: 0.4 }), material: 'aluminium', wall: 5 },
    { id: 'battery', label: 'Battery', parent: 'base', position: [0, 0, -0.08], rotation: zero, joint: fixed, role: 'component', component: { type: 'battery', part: 'nicd36l' } },
    ...(['left', 'right'] as const).map((side): PartDef => ({
      id: `wheel-${side}`, label: `${side === 'left' ? 'Left' : 'Right'} wheel`, parent: 'base', position: [side === 'left' ? 0.22 : -0.22, 0, 0], rotation: zero, role: 'wheel', wheel: 'solid200',
      joint: { type: 'hinge', axis: [1, 0, 0], actuator: { type: 'motor', motor: 'dm1200', gear: 18, input: { source: side, scale: 1 } } },
    })),
    { id: 'skid-f', label: 'Front skid', parent: 'base', position: [0, -0.064, 0.15], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.03 }, material: 'ptfe' },
    { id: 'skid-r', label: 'Rear skid', parent: 'base', position: [0, -0.064, -0.15], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.03 }, material: 'ptfe' },
    {
      id: 'shell', label: 'Spinning shell', parent: 'base', position: [0, 0.03, 0], rotation: zero, role: 'structure',
      shape: { type: 'lathe', segments: 48, profile: [[0, 0.075], [0.26, 0.07], [0.46, 0.032], [0.5, 0.012], [0.5, -0.02], [0.46, -0.05], [0.3, -0.075], [0, -0.075]] }, material: 'aluminium', wall: 6,
      joint: { type: 'hinge', axis: [0, 1, 0], actuator: { type: 'motor', motor: 'wm2000', gear: 6, input: { source: 'button1', mode: 'toggle' } } },
    },
    { id: 'tooth-a', label: 'Tooth A', parent: 'shell', position: [0.5, 0, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.06, 0.08, 0.05] }, material: 'hardox' },
    { id: 'tooth-b', label: 'Tooth B', parent: 'shell', position: [-0.5, 0, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.06, 0.08, 0.05] }, material: 'hardox' },
  ],
};

export const EXAMPLES: RobotDesign[] = [TWIN_TERROR, ORB, ARACHNID, GYRODISC];
