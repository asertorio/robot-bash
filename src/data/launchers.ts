import type { PartDef, RobotDesign, Vec3 } from '../sim/design';
import { armour } from './shaping';

/**
 * Robots that shoot. Both fire their round off the end of a gas ram (see
 * LaunchDef): the ram's work is all the round gets, so muzzle speed, recoil
 * and gas used come straight from the physics.
 */

const fixed = { type: 'fixed' } as const;
const zero: Vec3 = [0, 0, 0];

function wheel(id: string, label: string, at: Vec3): PartDef {
  return {
    id, label, parent: 'body', position: at, rotation: zero, role: 'wheel', wheel: 'pneu250',
    joint: { type: 'hinge', axis: [1, 0, 0], actuator: { type: 'motor', motor: 'dm750', gear: 7, input: { source: at[0] > 0 ? 'left' : 'right', scale: 1 } } },
  };
}
const component = (id: string, label: string, at: Vec3, c: PartDef['component']): PartDef =>
  ({ id, label, parent: 'body', position: at, rotation: zero, joint: fixed, role: 'component', component: c });
const skid = (id: string, at: Vec3): PartDef => ({ id, label: id === 'skid-f' ? 'Front skid' : 'Rear skid', parent: 'body', position: at, rotation: zero, joint: fixed, role: 'structure', shape: { type: 'sphere', radius: 0.03 }, material: 'ptfe' });

/**
 * Harpoon gun: a hardened barbed spike on 6 m of steel cable, fired by a
 * fast ram, and a winch to drag whatever it sticks in. Miss, and the winch
 * reels it back into the barrel to try again; button 1 again cuts it loose.
 */
export const WHALER: RobotDesign = {
  schema: 2,
  id: 'whaler',
  name: 'Whaler',
  description: 'Fires a hardened harpoon on 6 m of steel cable, then winches in whatever it hits — into the pit, onto the flame pit, or into a house robot\'s corner. Button 1 fires (and again cuts the cable), button 2 winds the winch. Bounces off thick hardened armour.',
  colour: '#117a65',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.125, 0], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.56, 0.18, 0.7], { sides: 0.05, front: 0.14, rear: 0.08, belt: 0.4 }), material: 'mildSteel', wall: 4 },
    { id: 'wedge', label: 'Nose wedge', parent: 'body', position: [0, -0.06, 0.43], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'wedge', size: [0.6, 0.1, 0.16], lip: 0.005 }, material: 'hardox', wall: 5 },
    {
      // A cone turned to point forward; the slider runs along it.
      id: 'harpoon', label: 'Harpoon', parent: 'body', position: [0, 0.06, 0.32], rotation: [90, 0, 0], role: 'structure',
      shape: { type: 'cone', radius: 0.02, length: 0.3 }, material: 'hardox', edge: 'spike',
      joint: { type: 'slider', axis: [0, 1, 0], limits: [0, 200], actuator: { type: 'pneumatic', ram: 'ram63', valve: 'dump', pressure: 20, leverArm: 0, input: { source: 'button1', mode: 'hold' } } },
      launch: { tether: { length: 6, winch: { motor: 'wm900', gear: 25, drum: 30, input: { source: 'button2', mode: 'hold' } } } },
    },
    { id: 'barb', label: 'Harpoon barbs', parent: 'harpoon', position: [0, -0.02, 0], rotation: zero, joint: fixed, role: 'structure', shape: { type: 'box', size: [0.07, 0.02, 0.012] }, material: 'hardox' },
    // Four-wheel drive and a heavy steel body: a winch can only drag
    // something that grips less than you do.
    wheel('wheel-lf', 'Left front wheel', [0.33, 0, 0.18]),
    wheel('wheel-lr', 'Left rear wheel', [0.33, 0, -0.2]),
    wheel('wheel-rf', 'Right front wheel', [-0.33, 0, 0.18]),
    wheel('wheel-rr', 'Right rear wheel', [-0.33, 0, -0.2]),
    component('battery', 'Battery', [0, -0.03, -0.18], { type: 'battery', part: 'nicd24' }),
    component('gas', 'Gas bottle', [0.15, -0.03, 0.08], { type: 'gasTank', part: 'co2_1kg' }),
  ],
};

/**
 * Gas cannon: 2 kg steel balls from a big fast ram, eight in all. Heavy and
 * slow-ish beats light and fast here: the same gas energy carries more
 * momentum, and momentum is what shoves. Little
 * energy next to a spinner, but a solid shove from across the arena — knock
 * a robot off line, onto a hazard, or hit the pit button from afar.
 * Free-flying projectiles are banned in real competitions, so: Open class only.
 */
export const BOMBARD: RobotDesign = {
  schema: 2,
  id: 'bombard',
  name: 'Bombard',
  description: 'Open class only: a gas cannon firing 2 kg steel balls at around 30 m/s, eight rounds, one every 1.2 s. Not much damage — but it shoves robots about from across the arena, and can hit the pit button from a distance.',
  colour: '#7d3c98',
  parts: [
    { id: 'body', label: 'Body shell', parent: null, position: [0, 0.14, 0], rotation: zero, joint: fixed, role: 'structure', shape: armour([0.6, 0.22, 0.74], { sides: 0.06, front: 0.12, rear: 0.08, belt: 0.45 }), material: 'aluminium', wall: 6 },
    { id: 'barrel', label: 'Barrel', parent: 'body', position: [0, 0.05, 0.3], rotation: [90, 0, 0], joint: fixed, role: 'structure', shape: { type: 'cylinder', radius: 0.055, length: 0.36 }, material: 'mildSteel', wall: 4 },
    {
      id: 'ball', label: 'Cannonball', parent: 'body', position: [0, 0.05, 0.3], rotation: zero, role: 'structure',
      shape: { type: 'sphere', radius: 0.04 }, material: 'mildSteel',
      joint: { type: 'slider', axis: [0, 0, 1], limits: [0, 200], actuator: { type: 'pneumatic', ram: 'ram63', valve: 'dump', pressure: 24, leverArm: 0, input: { source: 'button1', mode: 'hold' } } },
      launch: { rounds: 7, reload: 1.2 },
    },
    wheel('wheel-l', 'Left wheel', [0.35, 0, -0.1]),
    wheel('wheel-r', 'Right wheel', [-0.35, 0, -0.1]),
    skid('skid-f', [0, -0.095, 0.26]),
    skid('skid-r', [0, -0.095, -0.3]),
    component('battery', 'Battery', [0, -0.03, -0.2], { type: 'battery', part: 'nicd24' }),
    component('gas', 'Gas bottle', [0.16, -0.03, 0.05], { type: 'gasTank', part: 'co2_1kg' }),
  ],
};
