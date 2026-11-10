import type { ActuatorDef, PartDef, RobotDesign, Vec3 } from '../sim/design';
import { armour } from './shaping';

/**
 * A third wave of starter robots, each built round an idea the others don't
 * cover: a bell-shaped shell spinner, an eggbeater, flippers at both ends, a
 * tiny fast wedge, a sideways-swinging hammer, a spinning flail, a round
 * 360° plough and a pair of hugging arms. All heavyweights from catalogue
 * parts.
 */

const fixed = { type: 'fixed' } as const;
const zero: Vec3 = [0, 0, 0];

/** A driven wheel on the chassis, wired to its side. */
function wheel(id: string, label: string, at: Vec3, wheelId: string, motor: string, gear: number, parent = 'body'): PartDef {
  return {
    id, label, parent, position: at, rotation: zero, role: 'wheel', wheel: wheelId,
    joint: { type: 'hinge', axis: [1, 0, 0], actuator: { type: 'motor', motor, gear, input: { source: at[0] > 0 ? 'left' : 'right', scale: 1 } } },
  };
}

function fourWheels(x: number, y: number, zFront: number, zRear: number, wheelId: string, motor: string, gear: number, parent = 'body'): PartDef[] {
  return [
    wheel('wheel-lf', 'Left front wheel', [x, y, zFront], wheelId, motor, gear, parent),
    wheel('wheel-lr', 'Left rear wheel', [x, y, zRear], wheelId, motor, gear, parent),
    wheel('wheel-rf', 'Right front wheel', [-x, y, zFront], wheelId, motor, gear, parent),
    wheel('wheel-rr', 'Right rear wheel', [-x, y, zRear], wheelId, motor, gear, parent),
  ];
}

const component = (id: string, label: string, at: Vec3, c: PartDef['component'], parent = 'body'): PartDef =>
  ({ id, label, parent, position: at, rotation: zero, joint: fixed, role: 'component', component: c });
const battery = (part: string, at: Vec3, parent = 'body'): PartDef => component('battery', 'Battery', at, { type: 'battery', part }, parent);
const gas = (part: string, at: Vec3): PartDef => component('gas', 'Gas bottle', at, { type: 'gasTank', part });
const button = (n: 1 | 2, mode: 'hold' | 'toggle' = 'hold') => ({ source: `button${n}` as const, mode });
const ram = (a: Omit<Extract<ActuatorDef, { type: 'pneumatic' }>, 'type' | 'input'>, n: 1 | 2 = 1): ActuatorDef => ({ type: 'pneumatic', ...a, input: button(n) });

/**
 * Shell spinner: a tall bell of aluminium spinning round the drive base, its
 * skirt coming down to 25 mm off the floor. Smaller and taller than a
 * full-body disc, so it stores less but there's no edge to get a wedge under,
 * and its teeth sit low on the skirt where they meet wheels and wedges.
 */
export const BELLRINGER: RobotDesign = {
  schema: 2,
  id: 'bellringer',
  name: 'Bellringer',
  description: 'Shell spinner: a bronze-painted aluminium bell spins round the drive base with its skirt 25 mm off the floor — nothing to get under, and two low teeth that ring anything that touches it.',
  colour: '#cd7f32',
  parts: [
    { id: 'base', label: 'Drive base', parent: null, position: [0, 0.1, 0], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.36, 0.1, 0.36], { sides: 0.03, front: 0.03, rear: 0.03, belt: 0.4 }), material: 'aluminium', wall: 5 },
    battery('nicd36l', [0, 0, -0.08], 'base'),
    // Four-wheel skid steer, as on any shell spinner: two wheels just spin round under the shell's reaction.
    ...fourWheels(0.24, 0, 0.12, -0.12, 'solid200', 'dm1200', 14, 'base'),
    {
      id: 'shell', label: 'Spinning bell', parent: 'base', position: [0, 0.04, 0], rotation: zero, role: 'structure',
      shape: { type: 'lathe', segments: 48, profile: [[0, 0.13], [0.18, 0.12], [0.31, 0.075], [0.39, 0.0], [0.4, -0.06], [0.4, -0.11], [0.37, -0.115], [0, -0.115]] }, material: 'aluminium', wall: 5,
      joint: { type: 'hinge', axis: [0, 1, 0], actuator: { type: 'motor', motor: 'wm2000', gear: 5, softStart: 4, input: button(1, 'toggle') } },
    },
    // Low on the skirt: that's where wheels, wedges and flipper hinges are.
    { id: 'tooth-a', label: 'Tooth A', parent: 'shell', position: [0.41, -0.07, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.05, 0.06, 0.06] }, material: 'hardox' },
    { id: 'tooth-b', label: 'Tooth B', parent: 'shell', position: [-0.41, -0.07, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.05, 0.06, 0.06] }, material: 'hardox' },
  ],
};

/**
 * Eggbeater: two hardened bars 120 mm out from the axle, joined at the ends —
 * all its mass at the rim, so it stores far more than a solid drum of the
 * same weight. Spins upwards across the nose between hardened forks.
 */
export const WHISK: RobotDesign = {
  schema: 2,
  id: 'whisk',
  name: 'Whisk',
  description: 'Eggbeater: a hollow cage of hardened bars whipping round at 2,800 rpm across the nose. All its weight is at the rim, so it hits far harder than a drum its size — and kicks them upwards.',
  colour: '#e84393',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.13, -0.1], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.5, 0.18, 0.5], { sides: 0.05, rear: 0.1, belt: 0.45 }), material: 'aluminium', wall: 6 },
    { id: 'fork-l', label: 'Left fork', parent: 'body', position: [0.215, 0.01, 0.3], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.03, 0.12, 0.3] }, material: 'hardox' },
    { id: 'fork-r', label: 'Right fork', parent: 'body', position: [-0.215, 0.01, 0.3], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.03, 0.12, 0.3] }, material: 'hardox' },
    {
      // Turned so its axle lies across the robot; the cage bars are 120 mm out.
      id: 'beater', label: 'Beater axle', parent: 'body', position: [0, 0.025, 0.36], rotation: [0, 0, 90], role: 'structure',
      shape: { type: 'cylinder', radius: 0.025, length: 0.38 }, material: 'mildSteel',
      joint: { type: 'hinge', axis: [0, 1, 0], actuator: { type: 'motor', motor: 'wm900', gear: 2.4, softStart: 1, input: button(1, 'toggle') } },
    },
    ...[1, -1].flatMap((s, i): PartDef[] => [
      { id: `bar-${i}`, label: `Beater bar ${i + 1}`, parent: 'beater', position: [0.12 * s, 0, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.03, 0.34, 0.04] }, material: 'hardox' },
      { id: `end-${i}`, label: `Beater end plate ${i + 1}`, parent: 'beater', position: [0, 0.175 * s, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.27, 0.012, 0.04] }, material: 'hardox' },
    ]),
    ...fourWheels(0.3, -0.03, 0.2, -0.16, 'solid200', 'dm750', 9),
    // 36 V into the 24 V motors: over-volted, as real builders did.
    battery('nicd36l', [0, -0.02, -0.2]),
  ],
};

/**
 * Invertible flipper with a flipper at each end. The body is lower than the
 * tyres, so it drives the same either way up, and whichever end they come
 * at, there's a plate waiting under them.
 */
const FLIP_HINGE_Y = 0.07, FLIP_LEN = 0.38;
const flipRest = Math.round((Math.asin((0.125 + FLIP_HINGE_Y - 0.006) / FLIP_LEN) * 180) / Math.PI);
export const FLIPFLOP: RobotDesign = {
  schema: 2,
  id: 'flipflop',
  name: 'Flipflop',
  description: 'Flippers at both ends — button 1 the front, button 2 the back — on a body lower than its tyres, so it drives just the same upside down. Come at it from behind and you still get launched.',
  colour: '#27ae60',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.125, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.56, 0.16, 0.6] }, material: 'aluminium', wall: 6 },
    {
      id: 'flipper-front', label: 'Front flipper', parent: 'body', position: [0, FLIP_HINGE_Y, 0.3], rotation: [flipRest, 0, 0], role: 'structure',
      shape: { type: 'box', size: [0.52, 0.008, FLIP_LEN] }, shapeOffset: [0, 0, FLIP_LEN / 2], material: 'aluminium',
      joint: { type: 'hinge', axis: [-1, 0, 0], limits: [-3, flipRest + 70], actuator: ram({ ram: 'ram63', valve: 'dump', pressure: 24, leverArm: 0.12 }, 1) },
    },
    {
      // Mirrored: the plate runs backwards, and opening lifts its tail.
      id: 'flipper-rear', label: 'Rear flipper', parent: 'body', position: [0, FLIP_HINGE_Y, -0.3], rotation: [-flipRest, 0, 0], role: 'structure',
      shape: { type: 'box', size: [0.52, 0.008, FLIP_LEN] }, shapeOffset: [0, 0, -FLIP_LEN / 2], material: 'aluminium',
      joint: { type: 'hinge', axis: [1, 0, 0], limits: [-3, flipRest + 70], actuator: ram({ ram: 'ram63', valve: 'dump', pressure: 24, leverArm: 0.12 }, 2) },
    },
    // Tyres stand 45 mm proud of the body top and bottom.
    ...fourWheels(0.33, 0, 0.15, -0.15, 'pneu250', 'dm750', 8),
    battery('nicd24', [0, 0, -0.1]),
    gas('co2_2kg', [0, 0, 0.1]),
  ],
};

/**
 * A featherweight's idea in a heavyweight's arena: under half the weight of
 * the limit, a knife-edged hardened wedge 6 mm off the floor and a
 * LiPo over-volting four drive motors. Too light to push anyone about, but
 * nothing else can catch it, and it gets under everything.
 */
export const WHIPPET: RobotDesign = {
  schema: 2,
  id: 'whippet',
  name: 'Whippet',
  description: 'Tiny, low and very fast: a 43 kg four-wheel-drive wedge on a LiPo, quicker than anything in the arena. Can\'t out-push anyone — so get under them, steer them into the wall, and be somewhere else when they turn round.',
  colour: '#00bcd4',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.075, -0.05], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.38, 0.09, 0.46], { sides: 0.03, front: 0.06, rear: 0.04, belt: 0.4 }), material: 'aluminium', wall: 5 },
    { id: 'wedge', label: 'Front wedge', parent: 'body', position: [0, -0.029, 0.36], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'wedge', size: [0.62, 0.08, 0.26], lip: 0.002 }, material: 'hardox', wall: 4 },
    ...fourWheels(0.255, 0, 0.12, -0.15, 'foam150', 'dm750', 5),
    // 37 V into 24 V motors: hard on them, but that's where the speed comes from.
    battery('lipo36', [0, -0.01, -0.12]),
  ],
};

/**
 * Horizontal hammer: a steel arm on an upright hinge at the front right
 * corner rests pointing ahead, and a dump-valve ram sweeps it across the
 * nose. It hits from the side, where armour is thinnest, and shoves them
 * sideways off their line. Every force has a reaction: the swing yaws the
 * robot the other way, so it can't be fired while lining up a shove.
 */
export const HAYMAKER: RobotDesign = {
  schema: 2,
  id: 'haymaker',
  name: 'Haymaker',
  description: 'A sideways slap: a spiked steel arm on an upright hinge rests pointing ahead off the right corner, then a dump-valve ram whips it 120° across the nose. Hits them side-on, where armour is thinnest, and knocks them off their line — and the kick spins Haymaker round too.',
  colour: '#5d6d7e',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.14, -0.04], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.52, 0.2, 0.66], { sides: 0.05, front: 0.1, rear: 0.08, belt: 0.45 }), material: 'aluminium', wall: 6 },
    { id: 'wedge', label: 'Front wedge', parent: 'body', position: [0, -0.07, 0.4], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'wedge', size: [0.52, 0.12, 0.14], lip: 0.005 }, material: 'hardox', wall: 6 },
    {
      // Rests pointing ahead and a little out to the right; firing turns it
      // about the upright, across the front until it points left. (Kept well
      // short of 180°: a hinge's angle wraps round there.)
      id: 'arm', label: 'Hammer arm', parent: 'body', position: [-0.29, 0.0, 0.42], rotation: [0, -30, 0], role: 'structure',
      shape: { type: 'box', size: [0.05, 0.06, 0.58] }, shapeOffset: [0, 0, 0.29], material: 'mildSteel', wall: 4,
      joint: { type: 'hinge', axis: [0, 1, 0], limits: [-3, 122], actuator: ram({ ram: 'ram80', valve: 'dump', pressure: 24, leverArm: 0.08 }) },
    },
    {
      // A hardened head at the tip, its spike facing the way the arm swings.
      id: 'head', label: 'Hammer head', parent: 'arm', position: [0, 0, 0.56], rotation: zero, joint: fixed, role: 'structure',
      shape: { type: 'box', size: [0.08, 0.09, 0.07] }, material: 'hardox',
    },
    { id: 'spike', label: 'Hammer spike', parent: 'head', position: [0.07, 0, 0], rotation: [0, 0, -90], joint: fixed, role: 'structure', shape: { type: 'cone', radius: 0.03, length: 0.08 }, material: 'hardox', edge: 'spike' },
    ...fourWheels(0.32, -0.015, 0.18, -0.2, 'pneu250', 'dm750', 9),
    battery('nicd24', [0, -0.03, -0.18]),
    gas('co2_2kg', [0, -0.03, 0.08]),
  ],
};

/**
 * Flail spinner: a hub on top spins two arms, and on the end of each a
 * hardened ball hangs on a short chain (a ball joint). At rest the balls
 * drop to the floor; spun up they fly out flat at over 20 m/s. The chain lets a
 * ball give on impact, so the hub and motor aren't jarred like a solid bar.
 */
export const CONKER: RobotDesign = {
  schema: 2,
  id: 'conker',
  name: 'Conker',
  description: 'Flail spinner: two spiked hardened balls on chains, whirled round on a hub on top. At rest they hang; spun up they fly out flat and smack anything within half a metre. The chains give, so a big hit doesn\'t wreck the motor.',
  colour: '#8e5b3a',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.1, 0], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.42, 0.12, 0.42], { sides: 0.04, front: 0.05, rear: 0.05, belt: 0.4 }), material: 'aluminium', wall: 6 },
    ...fourWheels(0.26, 0, 0.12, -0.12, 'solid200', 'dm750', 14),
    // 36 V for the weapon motor; the 24 V drive motors take it over-volted.
    battery('nicd36l', [0, -0.01, -0.06]),
    {
      id: 'hub', label: 'Flail hub', parent: 'body', position: [0, 0.1, 0], rotation: zero, role: 'structure',
      shape: { type: 'cylinder', radius: 0.07, length: 0.04 }, material: 'mildSteel',
      joint: { type: 'hinge', axis: [0, 1, 0], actuator: { type: 'motor', motor: 'wm2000', gear: 8, softStart: 2, input: button(1, 'toggle') } },
    },
    ...[1, -1].flatMap((s, i): PartDef[] => [
      { id: `arm-${i}`, label: `Flail arm ${i + 1}`, parent: 'hub', position: [0.16 * s, 0, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.24, 0.03, 0.05] }, material: 'mildSteel' },
      {
        id: `chain-${i}`, label: `Chain ${i + 1}`, parent: 'hub', position: [0.29 * s, 0, 0], rotation: zero, role: 'structure',
        shape: { type: 'box', size: [0.12, 0.016, 0.016] }, shapeOffset: [0.06 * s, 0, 0], material: 'mildSteel',
        joint: { type: 'ball' },
      },
      { id: `ball-${i}`, label: `Flail ball ${i + 1}`, parent: `chain-${i}`, position: [0.16 * s, 0, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.06 }, material: 'hardox' },
      ...([[1, 0, 0, 0, 0, -90], [0, 1, 0, 0, 0, 0], [0, -1, 0, 180, 0, 0]] as const).map(([x, y, z, rx, ry, rz], k): PartDef => ({
        id: `ball-${i}-spike-${k}`, label: `Ball ${i + 1} spike ${k + 1}`, parent: `ball-${i}`, position: [x * 0.06 * s, y * 0.06, z * 0.06], rotation: [rx, ry, rz * s], joint: fixed, role: 'structure',
        shape: { type: 'cone', radius: 0.018, length: 0.045 }, material: 'hardox', edge: 'spike',
      })),
    ]),
  ],
};

/**
 * A round plough: a low titanium cone 900 mm across with its rim 5 mm off
 * the floor all the way round, the wheels hidden inside. Whichever way it's
 * facing, the edge meeting them is a wedge, so there's no side or back to
 * attack — it just slides under and carries them.
 */
export const LIMPET: RobotDesign = {
  schema: 2,
  id: 'limpet',
  name: 'Limpet',
  description: 'A 900 mm titanium cone with its rim 5 mm off the floor all the way round and the wheels hidden inside. Every side is a wedge: no back to attack, nothing to grab, and it slides under whatever comes at it.',
  colour: '#a3c639',
  parts: [
    {
      id: 'body', label: 'Cone shell', parent: null, position: [0, 0.075, 0], rotation: zero, joint: fixed, role: 'structure',
      shape: { type: 'lathe', segments: 40, profile: [[0, 0.11], [0.15, 0.1], [0.45, -0.066], [0.45, -0.07], [0, -0.07]] }, material: 'titanium', wall: 6,
    },
    ...fourWheels(0.2, 0, 0.14, -0.14, 'foam150', 'dm750', 7),
    battery('nicd24', [0, 0, -0.05]),
  ],
};

/**
 * Two hardened arms on upright hinges at the front corners: drive into them,
 * hold the button, and the arms swing in and wrap round them, pinning them
 * against the nose. Then drive — wherever it goes, they go.
 */
export const BEARHUG: RobotDesign = {
  schema: 2,
  id: 'bearhug',
  name: 'Bearhug',
  description: 'Two hooked arms at the front corners swing in and wrap round them, pinning them to the nose. Then four-wheel drive does the rest: the wall, the flame pit, the pit. Hold button 1 to hug.',
  colour: '#34495e',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.15, -0.1], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.62, 0.22, 0.6], { sides: 0.06, rear: 0.14, belt: 0.5 }), material: 'aluminium', wall: 5 },
    { id: 'wedge', label: 'Front wedge', parent: 'body', position: [0, -0.07, 0.37], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'wedge', size: [0.62, 0.12, 0.14], lip: 0.005 }, material: 'hardox', wall: 6 },
    ...([['left', 1], ['right', -1]] as const).flatMap(([side, s]): PartDef[] => [
      {
        // Rests pointing forward outside the wheels; the servo swings it inward across the front.
        id: `arm-${side}`, label: `${side === 'left' ? 'Left' : 'Right'} arm`, parent: 'body', position: [0.46 * s, -0.04, 0.3], rotation: zero, role: 'structure',
        shape: { type: 'box', size: [0.03, 0.09, 0.5] }, shapeOffset: [0, 0, 0.25], material: 'hardox',
        joint: { type: 'hinge', axis: [0, -s, 0], limits: [-5, 85], actuator: { type: 'servo', motor: 'dm750', gear: 80, targets: [0, 0, 80], input: button(1) } },
      },
      // A hook on the end that turns in behind them.
      { id: `hook-${side}`, label: `${side === 'left' ? 'Left' : 'Right'} hook`, parent: `arm-${side}`, position: [-0.04 * s, 0, 0.48], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.08, 0.09, 0.03] }, material: 'hardox', edge: 'spike' },
    ]),
    ...fourWheels(0.36, -0.025, 0.12, -0.22, 'pneu250', 'dm750', 10),
    battery('nicd24', [0, -0.03, -0.2]),
  ],
};

export const WORKSHOP: RobotDesign[] = [BELLRINGER, WHISK, FLIPFLOP, WHIPPET, HAYMAKER, CONKER, LIMPET, BEARHUG];
