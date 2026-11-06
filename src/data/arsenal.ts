import type { ActuatorDef, PartDef, RobotDesign, Shape, Vec3 } from '../sim/design';
import { armour } from './shaping';

/**
 * A second wave of starter robots, each a different idea about how to win:
 * an invertible rammer with its wheels tucked inside, a chainsaw, a
 * clamp-lifter, a thwackbot, twin counter-rotating discs and a hydraulic
 * crusher. All heavyweights built from catalogue parts.
 */

const fixed = { type: 'fixed' } as const;
const zero: Vec3 = [0, 0, 0];

/** A driven wheel on the chassis, wired to its side. */
function wheel(id: string, label: string, parent: string, at: Vec3, wheelId: string, motor: string, gear: number): PartDef {
  return {
    id, label, parent, position: at, rotation: zero, role: 'wheel', wheel: wheelId,
    joint: { type: 'hinge', axis: [1, 0, 0], actuator: { type: 'motor', motor, gear, input: { source: at[0] > 0 ? 'left' : 'right', scale: 1 } } },
  };
}

function fourWheels(parent: string, x: number, y: number, zFront: number, zRear: number, wheelId: string, motor: string, gear: number): PartDef[] {
  return [
    wheel('wheel-lf', 'Left front wheel', parent, [x, y, zFront], wheelId, motor, gear),
    wheel('wheel-lr', 'Left rear wheel', parent, [x, y, zRear], wheelId, motor, gear),
    wheel('wheel-rf', 'Right front wheel', parent, [-x, y, zFront], wheelId, motor, gear),
    wheel('wheel-rr', 'Right rear wheel', parent, [-x, y, zRear], wheelId, motor, gear),
  ];
}

const component = (id: string, label: string, parent: string, at: Vec3, c: PartDef['component']): PartDef =>
  ({ id, label, parent, position: at, rotation: zero, joint: fixed, role: 'component', component: c });
const battery = (part: string, at: Vec3, parent = 'body'): PartDef => component('battery', 'Battery', parent, at, { type: 'battery', part });
const gas = (part: string, at: Vec3, parent = 'body'): PartDef => component('gas', 'Gas bottle', parent, at, { type: 'gasTank', part });

/**
 * A toothed outline, drawn side-on (u forward, v up): a chainsaw bar `length`
 * long and `height` deep with a rounded nose, and teeth all the way round
 * its lower edge and nose.
 */
export function chainsawBar(length: number, height: number, teeth = 12): Shape {
  const h = height / 2, tooth = 0.012;
  const out: Array<[number, number]> = [[0, h]];
  // Top edge out to the nose, round the nose, then the toothed bottom edge back.
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 2 - (i / 6) * Math.PI;
    out.push([length - h + Math.cos(a) * (h + (i % 2 ? tooth : 0)), Math.sin(a) * (h + (i % 2 ? tooth : 0))]);
  }
  for (let i = 1; i <= teeth; i++) {
    const u = length - h - (i / teeth) * (length - h);
    out.push([u + (length - h) / teeth / 2, -h - tooth]);
    out.push([u, -h]);
  }
  return { type: 'extrude', plane: 'side', depth: 0.012, outline: out };
}

/** A circular saw blade seen from above (u left, v forward), `teeth` hooked teeth. */
export function sawBlade(radius: number, teeth: number, thickness: number): Shape {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, b = ((i + 0.7) / teeth) * Math.PI * 2;
    out.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    out.push([Math.cos(b) * radius * 0.88, Math.sin(b) * radius * 0.88]);
  }
  return { type: 'extrude', plane: 'top', depth: thickness, outline: out };
}

const button = (n: 1 | 2, mode: 'hold' | 'toggle' = 'hold') => ({ source: `button${n}` as const, mode });
const ram = (a: Omit<Extract<ActuatorDef, { type: 'pneumatic' }>, 'type' | 'input'>, n: 1 | 2 = 1): ActuatorDef => ({ type: 'pneumatic', ...a, input: button(n) });

/**
 * Invertible rammer with its wheels inside the body: the shell is lower than
 * the tyres, so they stand proud top and bottom and it drives the same either
 * way up, and there's no wheel out in the open to hit. Double-sloped
 * titanium ploughs front and back and hardened spikes on the nose.
 */
export const BRICKHOUSE: RobotDesign = {
  schema: 2,
  id: 'brickhouse',
  name: 'Brickhouse',
  description: 'Invertible rammer: four wheels tucked inside the body, tyres standing proud top and bottom, so it drives just the same upside down and there is no wheel to hit. Double-sloped titanium ploughs at both ends and hardened spikes on the nose.',
  colour: '#a93226',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.125, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.62, 0.2, 0.7] }, material: 'aluminium', wall: 6 },
    // Sloped both ways, so it deflects whichever way up it is.
    ...([['front', 1], ['rear', -1]] as const).map(([end, s]): PartDef => ({
      id: `plough-${end}`, label: `${end === 'front' ? 'Front' : 'Rear'} plough`, parent: 'body', position: [0, 0, 0.35 * s], rotation: zero, joint: fixed, role: 'structure',
      shape: { type: 'hull', points: [[0.31, 0.1, 0], [-0.31, 0.1, 0], [0.31, -0.1, 0], [-0.31, -0.1, 0], [0.29, 0.01, 0.13 * s], [-0.29, 0.01, 0.13 * s], [0.29, -0.01, 0.13 * s], [-0.29, -0.01, 0.13 * s]] },
      material: 'titanium', wall: 6,
    })),
    ...[0.17, -0.17].flatMap((x, i): PartDef[] => [
      { id: `spike-f${i}`, label: `Front spike ${i + 1}`, parent: 'body', position: [x, 0, 0.53], rotation: [90, 0, 0], joint: fixed, role: 'structure', shape: { type: 'cone', radius: 0.03, length: 0.1 }, material: 'hardox', edge: 'spike' },
    ]),
    // Inboard: well inside the 310 mm half-width of the shell.
    ...fourWheels('body', 0.2, 0, 0.2, -0.2, 'pneu250', 'dm750', 9),
    battery('nicd24', [0, 0, -0.05]),
  ],
};

/** A chainsaw on a servo arm: hold it down on them and the chain does the rest. */
export const LUMBERJACK: RobotDesign = {
  schema: 2,
  id: 'lumberjack',
  name: 'Lumberjack',
  description: 'Chainsaw on a powered arm. Button 2 starts the chain; button 1 brings the bar down and holds it there. Eats aluminium and plastic, struggles with hardened steel — like the real thing.',
  colour: '#ca6f1e',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.14, -0.05], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.56, 0.2, 0.66], { sides: 0.06, front: 0.1, rear: 0.08, belt: 0.45 }), material: 'aluminium', wall: 6 },
    { id: 'wedge', label: 'Front wedge', parent: 'body', position: [0, -0.07, 0.4], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'wedge', size: [0.56, 0.12, 0.16], lip: 0.005 }, material: 'hardox', wall: 6 },
    ...fourWheels('body', 0.34, -0.015, 0.18, -0.2, 'pneu250', 'dm750', 9),
    {
      // Rests raised 30°; the servo swings it down over the nose.
      id: 'arm', label: 'Saw arm', parent: 'body', position: [0, 0.13, -0.22], rotation: [-32, 0, 0], role: 'structure',
      shape: { type: 'box', size: [0.06, 0.06, 0.5] }, shapeOffset: [0, 0, 0.25], material: 'mildSteel', wall: 4,
      joint: { type: 'hinge', axis: [1, 0, 0], limits: [-5, 62], actuator: { type: 'servo', motor: 'dm750', gear: 110, targets: [0, 0, 58], input: button(1) } },
    },
    {
      id: 'saw', label: 'Chainsaw bar', parent: 'arm', position: [0, 0, 0.47], rotation: [12, 0, 0], joint: fixed, role: 'structure',
      shape: chainsawBar(0.42, 0.08), material: 'hardox', edge: 'saw', chain: { input: button(2, 'toggle'), speed: 22 },
    },
    battery('nicd24', [0, -0.03, -0.12]),
  ],
};

/** Clamp-lifter: forks under, a jaw clamps down on top, and off it goes with them. */
export const CLAMPDOWN: RobotDesign = {
  schema: 2,
  id: 'clampdown',
  name: 'Clampdown',
  description: 'Clamp-lifter: hold button 1 and a servo jaw clamps them down onto the forks while the lifter raises them off their wheels. Then drive them wherever you like — the pit, or the wall.',
  colour: '#1f618d',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.15, -0.08], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.6, 0.22, 0.62], { sides: 0.06, rear: 0.14, belt: 0.5 }), material: 'aluminium', wall: 6 },
    {
      id: 'forks', label: 'Lifting forks', parent: 'body', position: [0, 0.025, 0.31], rotation: [21, 0, 0], role: 'structure',
      shape: { type: 'box', size: [0.52, 0.012, 0.45] }, shapeOffset: [0, 0, 0.225], material: 'hardox',
      joint: { type: 'hinge', axis: [-1, 0, 0], limits: [-3, 55], actuator: ram({ ram: 'ram80hp', valve: 'lifter', pressure: 35, leverArm: 0.14 }) },
    },
    {
      // Rides on the forks, so whatever it clamps goes up with them.
      id: 'jaw', label: 'Clamp jaw', parent: 'forks', position: [0, 0.24, 0.02], rotation: [-55, 0, 0], role: 'structure',
      shape: { type: 'extrude', plane: 'side', depth: 0.05, outline: [[0, -0.02], [0.4, -0.02], [0.43, -0.1], [0.38, -0.1], [0.36, 0.02], [0, 0.025]] }, material: 'hardox', edge: 'spike',
      joint: { type: 'hinge', axis: [1, 0, 0], limits: [-5, 75], actuator: { type: 'servo', motor: 'dm750', gear: 80, targets: [0, 0, 72], input: button(1) } },
    },
    ...fourWheels('body', 0.36, -0.025, 0.12, -0.22, 'pneu250', 'dm750', 10),
    battery('nicd24', [0, -0.03, -0.2]),
    gas('co2_2kg', [0, -0.03, 0.05]),
  ],
};

/** Thwackbot: two wheels close together and a long tail with a spiked mace. Its weapon is turning. */
export const TAILSPIN: RobotDesign = {
  schema: 2,
  id: 'tailspin',
  name: 'Tailspin',
  description: 'Thwackbot: a tiny two-wheeled body and a 900 mm tail with a hardened spiked mace. Spin on the spot and the mace comes round at 20 m/s. Invertible, cheap, and terrifying to drive.',
  colour: '#7d6608',
  style: 'thwack',
  parts: [
    { id: 'body', label: 'Body', parent: null, position: [0, 0.125, 0], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.34, 0.18, 0.3], { sides: 0.03, front: 0.05, rear: 0.03, belt: 0.5 }), material: 'aluminium', wall: 6 },
    {
      id: 'tail', label: 'Tail boom', parent: 'body', position: [0, 0, -0.15], rotation: zero, joint: fixed, role: 'structure',
      shape: { type: 'box', size: [0.05, 0.05, 0.62] }, shapeOffset: [0, 0, -0.31], material: 'mildSteel', wall: 3,
    },
    { id: 'mace', label: 'Mace', parent: 'tail', position: [0, 0, -0.68], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.07 }, material: 'hardox' },
    ...([[1, 0, 0, 0, 0, -90], [-1, 0, 0, 0, 0, 90], [0, 0, -1, -90, 0, 0], [0, 1, 0, 0, 0, 0], [0, -1, 0, 180, 0, 0]] as const).map(([x, y, z, rx, ry, rz], i): PartDef => ({
      id: `mace-spike-${i}`, label: `Mace spike ${i + 1}`, parent: 'mace', position: [x * 0.07, y * 0.07, z * 0.07], rotation: [rx, ry, rz], joint: fixed, role: 'structure',
      shape: { type: 'cone', radius: 0.022, length: 0.06 }, material: 'hardox', edge: 'spike',
    })),
    // Holds the tail just off the floor; slides easily as it whips round.
    { id: 'skid', label: 'Tail skid', parent: 'tail', position: [0, -0.095, -0.6], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.025 }, material: 'ptfe' },
    { id: 'skid-top', label: 'Top skid', parent: 'tail', position: [0, 0.095, -0.6], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.025 }, material: 'ptfe' },
    // Real thwackbots put the axle under the centre of mass, or the tyres skid
    // sideways as it spins: battery and ballast forward, wheels back.
    wheel('wheel-l', 'Left wheel', 'body', [0.22, 0, -0.2], 'pneu250', 'dm750', 6),
    wheel('wheel-r', 'Right wheel', 'body', [-0.22, 0, -0.2], 'pneu250', 'dm750', 6),
    battery('nicd24', [0, 0, 0.06]),
    component('ballast', 'Nose ballast', 'body', [0, -0.03, 0.1], { type: 'ballast', mass: 14 }),
  ],
};

/**
 * Twin counter-rotating horizontal discs on the front corners. Spinning
 * opposite ways, their reaction torques cancel, so it doesn't twist as they
 * spin up or when they hit, and either disc can take the blow. Wheels inside
 * the body, out of the discs' way.
 */
export const GEMINI: RobotDesign = {
  schema: 2,
  id: 'gemini',
  name: 'Gemini',
  description: 'Twin counter-rotating saw discs on the front corners. Opposite spins cancel each other out, so it tracks straight and doesn\'t get twisted round by its own hits. Wheels tucked inside, safe from both.',
  colour: '#6c3483',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.12, -0.08], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.6, 0.16, 0.6], { sides: 0.05, front: 0.08, rear: 0.08, belt: 0.4 }), material: 'aluminium', wall: 6 },
    { id: 'mount', label: 'Disc mount plate', parent: 'body', position: [0, 0.0, 0.42], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.6, 0.012, 0.24] }, material: 'titanium' },
    ...([['left', 1], ['right', -1]] as const).map(([side, s]): PartDef => ({
      id: `disc-${side}`, label: `${side === 'left' ? 'Left' : 'Right'} disc`, parent: 'body', position: [0.19 * s, -0.05, 0.46], rotation: zero, role: 'structure',
      shape: sawBlade(0.17, 8, 0.012), material: 'hardox', edge: 'saw',
      // Opposite axes: they spin opposite ways, both sweeping in towards the middle.
      joint: { type: 'hinge', axis: [0, s, 0], actuator: { type: 'motor', motor: 'wm900', gear: 1.6, softStart: 1, input: button(1, 'toggle') } },
    })),
    // Inboard, out of the discs' way, under the body.
    ...fourWheels('body', 0.19, -0.045, 0.24, -0.2, 'foam150', 'dm750', 6),
    // 36 V into 24 V weapon motors: over-volted for a faster spin-up, as real builders did.
    battery('nicd36l', [0, -0.02, -0.1]),
  ],
};

/**
 * Hydraulic crusher: a pump-driven cylinder, so there's no gas to run out of —
 * it can bite as often as it likes. Slow, but its hooked point goes through
 * aluminium and mild steel under steady pressure.
 */
export const VICEGRIP: RobotDesign = {
  schema: 2,
  id: 'vicegrip',
  name: 'Vicegrip',
  description: 'Hydraulic crusher: a pump-driven 150-bar cylinder drives a hooked beak down onto a scoop. No gas to run out of; hold the button and the point goes through aluminium and mild steel. Hardened steel just laughs at it.',
  colour: '#943126',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.15, -0.12], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.56, 0.22, 0.56], { sides: 0.06, rear: 0.12, belt: 0.5 }), material: 'aluminium', wall: 6 },
    { id: 'scoop', label: 'Lower jaw', parent: 'body', position: [0, -0.095, 0.43], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'wedge', size: [0.56, 0.1, 0.3], lip: 0.005 }, material: 'hardox', wall: 6 },
    {
      id: 'beak', label: 'Crusher beak', parent: 'body', position: [0, 0.14, 0.18], rotation: [-45, 0, 0], role: 'structure',
      shape: { type: 'extrude', plane: 'side', depth: 0.06, outline: [[0, -0.025], [0.36, -0.025], [0.4, -0.16], [0.35, -0.16], [0.31, 0.02], [0, 0.035]] }, material: 'hardox', edge: 'spike',
      joint: { type: 'hinge', axis: [1, 0, 0], limits: [-10, 62], actuator: ram({ ram: 'hyd50', valve: 'spool', pressure: 150, leverArm: 0.1 }) },
    },
    ...fourWheels('body', 0.34, -0.025, 0.12, -0.2, 'pneu250', 'dm750', 9),
    battery('nicd24', [0, -0.03, -0.18]),
  ],
};

export const ARSENAL: RobotDesign[] = [BRICKHOUSE, LUMBERJACK, CLAMPDOWN, TAILSPIN, GEMINI, VICEGRIP];
