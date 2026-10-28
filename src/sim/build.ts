import { WHEELS, lookup } from '../data/parts';
import { designBounds, partFrames, root, subtree } from './assembly';
import type { ActuatorDef, InputDef, PartDef, RobotDesign, Shape, Vec3 } from './design';
import { qconj, qrotate, vsub } from './vmath';

/**
 * Garage operations on a part tree: add, mirror, re-parent and remove parts
 * while keeping ids unique and the tree valid.
 */

export function cloneDesign(d: RobotDesign): RobotDesign {
  return JSON.parse(JSON.stringify(d)) as RobotDesign;
}

let counter = 0;
export function newId(d: RobotDesign, base: string): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
  let id: string;
  do id = `${slug}-${(Date.now() % 100000).toString(36)}${(counter++).toString(36)}`; while (d.parts.some((p) => p.id === id));
  return id;
}

export type NewPartKind =
  | 'box' | 'wedge' | 'cylinder' | 'cone' | 'sphere' | 'capsule' | 'plate' | 'bar'
  | 'wheel' | 'battery' | 'gasTank' | 'ballast'
  | 'flipper' | 'spinner' | 'lifter' | 'axe' | 'spike' | 'leg';

export const NEW_PART_KINDS: Array<[NewPartKind, string, string]> = [
  ['box', 'Box', 'Shapes'], ['wedge', 'Wedge', 'Shapes'], ['plate', 'Flat plate', 'Shapes'], ['bar', 'Bar / beam', 'Shapes'],
  ['cylinder', 'Cylinder / disc', 'Shapes'], ['cone', 'Cone', 'Shapes'], ['sphere', 'Sphere', 'Shapes'], ['capsule', 'Capsule / rod', 'Shapes'],
  ['wheel', 'Driven wheel', 'Drive'], ['leg', 'Walking leg (hip + knee servos)', 'Drive'],
  ['flipper', 'Flipper (ram on a hinge)', 'Weapons'], ['lifter', 'Lifter (slow ram)', 'Weapons'], ['axe', 'Axe / hammer (ram)', 'Weapons'],
  ['spinner', 'Spinner (motor on a hinge)', 'Weapons'], ['spike', 'Ram spike (slider)', 'Weapons'],
  ['battery', 'Battery', 'Internals'], ['gasTank', 'Gas bottle', 'Internals'], ['ballast', 'Ballast weight', 'Internals'],
];

const shapePart = (d: RobotDesign, parent: string, label: string, shape: Shape, position: Vec3, extra: Partial<PartDef> = {}): PartDef => ({
  id: newId(d, label), label, parent, position, rotation: [0, 0, 0], joint: { type: 'fixed' }, role: 'structure',
  shape, material: 'aluminium', ...extra,
});

/** Where a new part should go: just outside the front of the parent's bounding box. */
function placement(d: RobotDesign, parentId: string): { front: Vec3; top: Vec3; side: (s: 1 | -1) => Vec3; bottom: number } {
  const frames = partFrames(d);
  const pf = frames.get(parentId)!;
  const b = designBounds({ ...d, parts: d.parts.filter((p) => subtree(d, parentId).includes(p.id)) });
  // Back into the parent's frame (approximately: bounds are axis-aligned).
  const toLocal = (x: number, y: number, z: number): Vec3 => {
    const v = qrotate(qconj(pf.rot), vsub({ x, y, z }, pf.pos));
    return [round(v.x), round(v.y), round(v.z)];
  };
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  return {
    front: toLocal(cx, (b.min.y + b.max.y) / 2, b.max.z),
    top: toLocal(cx, b.max.y, cz),
    side: (s) => toLocal(s > 0 ? b.max.x : b.min.x, b.min.y, cz),
    bottom: b.min.y,
  };
}

/** Make a new part (or a small ready-wired assembly) attached to `parentId`. */
export function newParts(d: RobotDesign, kind: NewPartKind, parentId = root(d).id): PartDef[] {
  const at = placement(d, parentId);
  const btn = (n: number, mode: InputDef['mode'] = 'hold'): InputDef => ({ source: `button${n}` as InputDef['source'], mode });
  const nextButton = () => {
    const used = new Set(d.parts.flatMap((p) => (p.joint.type !== 'fixed' && p.joint.actuator ? [p.joint.actuator.input.source] : [])));
    for (let n = 1; n <= 4; n++) if (!used.has(`button${n}` as InputDef['source'])) return n;
    return 1;
  };
  switch (kind) {
    case 'box': return [shapePart(d, parentId, 'Armour box', { type: 'box', size: [0.3, 0.12, 0.2] }, at.front, { wall: 5 })];
    case 'wedge': return [shapePart(d, parentId, 'Wedge', { type: 'wedge', size: [0.5, 0.15, 0.3], lip: 0.01 }, [at.front[0], at.front[1], round(at.front[2] + 0.15)], { wall: 5 })];
    case 'plate': return [shapePart(d, parentId, 'Plate', { type: 'box', size: [0.4, 0.008, 0.3] }, at.top)];
    case 'bar': return [shapePart(d, parentId, 'Bar', { type: 'box', size: [0.04, 0.04, 0.4] }, at.top, { material: 'mildSteel' })];
    case 'cylinder': return [shapePart(d, parentId, 'Cylinder', { type: 'cylinder', radius: 0.12, length: 0.1 }, at.top, { wall: 5 })];
    case 'cone': return [shapePart(d, parentId, 'Cone', { type: 'cone', radius: 0.1, length: 0.2 }, at.top, { wall: 5 })];
    case 'sphere': return [shapePart(d, parentId, 'Sphere', { type: 'sphere', radius: 0.12 }, at.top, { wall: 5 })];
    case 'capsule': return [shapePart(d, parentId, 'Rod', { type: 'capsule', radius: 0.03, length: 0.3 }, at.top, { material: 'mildSteel' })];
    case 'battery': return [{ id: newId(d, 'battery'), label: 'Battery', parent: parentId, role: 'component', component: { type: 'battery', part: 'nicd24' }, position: [0, 0, 0], rotation: [0, 0, 0], joint: { type: 'fixed' } }];
    case 'gasTank': return [{ id: newId(d, 'gas'), label: 'Gas bottle', parent: parentId, role: 'component', component: { type: 'gasTank', part: 'co2_1kg' }, position: [0, 0, 0], rotation: [0, 0, 0], joint: { type: 'fixed' } }];
    case 'ballast': return [{ id: newId(d, 'ballast'), label: 'Ballast', parent: parentId, role: 'component', component: { type: 'ballast', mass: 5 }, position: [0, 0, 0], rotation: [0, 0, 0], joint: { type: 'fixed' } }];
    case 'wheel': {
      const left = d.parts.filter((p) => p.role === 'wheel' && p.position[0] > 0).length <= d.parts.filter((p) => p.role === 'wheel' && p.position[0] < 0).length;
      const s = at.side(left ? 1 : -1);
      const r = lookup(WHEELS, 'pneu250', 'wheel').radius;
      const pf = partFrames(d).get(parentId)!;
      // Put the axle at wheel-radius height above the floor.
      const y = round(r - pf.pos.y);
      return [{
        id: newId(d, 'wheel'), label: `${left ? 'Left' : 'Right'} wheel`, parent: parentId, role: 'wheel', wheel: 'pneu250',
        position: [round(s[0] + (left ? 0.05 : -0.05)), y, 0], rotation: [0, 0, 0],
        joint: { type: 'hinge', axis: [1, 0, 0], actuator: { type: 'motor', motor: 'dm750', gear: 9, input: { source: left ? 'left' : 'right', scale: 1 } } },
      }];
    }
    case 'flipper': case 'lifter': {
      const lifter = kind === 'lifter';
      const act: ActuatorDef = { type: 'pneumatic', ram: lifter ? 'ram80' : 'ram63', valve: lifter ? 'lifter' : 'std', pressure: 20, leverArm: 0.12, input: btn(nextButton()) };
      return [{
        id: newId(d, kind), label: lifter ? 'Lifter' : 'Flipper', parent: parentId, role: 'structure',
        position: at.front, rotation: [20, 0, 0], shape: { type: 'box', size: [0.4, 0.008, 0.35] }, shapeOffset: [0, 0, 0.175], material: 'aluminium',
        joint: { type: 'hinge', axis: [-1, 0, 0], limits: [-3, 85], actuator: act },
      }];
    }
    case 'axe': {
      const arm = shapePart(d, parentId, 'Axe arm', { type: 'box', size: [0.04, 0.04, 0.5] }, at.top, { shapeOffset: [0, 0, -0.25], rotation: [0, 0, 0], material: 'aluminium' });
      arm.joint = { type: 'hinge', axis: [1, 0, 0], limits: [-5, 200], actuator: { type: 'pneumatic', ram: 'ram63', valve: 'dump', pressure: 20, leverArm: 0.08, input: btn(nextButton()) } };
      const head = shapePart(d, arm.id, 'Axe head', { type: 'wedge', size: [0.03, 0.12, 0.1], lip: 0 }, [0, -0.04, -0.5], { rotation: [90, 0, 0], material: 'hardox' });
      return [arm, head];
    }
    case 'spike': {
      const spike = shapePart(d, parentId, 'Spike', { type: 'cone', radius: 0.03, length: 0.25 }, at.front, { rotation: [90, 0, 0], material: 'hardox' });
      spike.joint = { type: 'slider', axis: [0, 1, 0], limits: [0, 150], actuator: { type: 'pneumatic', ram: 'ram40', valve: 'dump', pressure: 20, leverArm: 0, input: btn(nextButton()) } };
      return [spike];
    }
    case 'spinner': {
      const blade = shapePart(d, parentId, 'Spinner blade', { type: 'box', size: [0.6, 0.015, 0.08] }, [at.top[0], round(at.top[1] + 0.03), at.top[2]], { material: 'hardox' });
      blade.joint = { type: 'hinge', axis: [0, 1, 0], actuator: { type: 'motor', motor: 'wm900', gear: 3, input: btn(nextButton(), 'toggle') } };
      return [blade];
    }
    case 'leg': {
      const left = d.parts.filter((p) => p.label.startsWith('Left leg')).length <= d.parts.filter((p) => p.label.startsWith('Right leg')).length;
      const sgn = left ? 1 : -1;
      const s = at.side(left ? 1 : -1);
      const hip = shapePart(d, parentId, `${left ? 'Left' : 'Right'} leg hip`, { type: 'box', size: [0.2, 0.04, 0.04] }, [s[0], round(s[1] + 0.12), 0], { shapeOffset: [round(0.1 * sgn), 0, 0], material: 'aluminium' });
      hip.joint = { type: 'hinge', axis: [0, 1, 0], limits: [-35, 35], actuator: { type: 'servo', motor: 'dm750', gear: 30, targets: [-25, 0, 25], input: { source: 'gait', side: left ? 'left' : 'right', phase: 0, pattern: 'swing', scale: sgn } } };
      const knee = shapePart(d, hip.id, `${left ? 'Left' : 'Right'} leg shin`, { type: 'box', size: [0.04, 0.22, 0.04] }, [round(0.2 * sgn), 0, 0], { shapeOffset: [0, -0.1, 0], material: 'aluminium' });
      knee.joint = { type: 'hinge', axis: [0, 0, 1], limits: [-40, 40], actuator: { type: 'servo', motor: 'dm750', gear: 30, targets: [0, 0, 25 * sgn], input: { source: 'gait', side: left ? 'left' : 'right', phase: 0, pattern: 'lift' } } };
      const foot = shapePart(d, knee.id, `${left ? 'Left' : 'Right'} foot`, { type: 'sphere', radius: 0.03 }, [0, -0.22, 0], { material: 'rubber' });
      return [hip, knee, foot];
    }
  }
}

/** Copy a part and everything on it to the other side of the robot (mirror in X). */
export function mirrorPart(d: RobotDesign, id: string): PartDef[] {
  const ids = subtree(d, id);
  const map = new Map<string, string>();
  const swap = (s: string) => s.replace(/\bLeft\b|\bRight\b|\bleft\b|\bright\b/g, (w) => ({ Left: 'Right', Right: 'Left', left: 'right', right: 'left' })[w]!);
  for (const old of ids) map.set(old, newId(d, swap(d.parts.find((p) => p.id === old)!.label)));
  return ids.map((old) => {
    const p = JSON.parse(JSON.stringify(d.parts.find((q) => q.id === old)!)) as PartDef;
    const top = old === id;
    p.id = map.get(old)!;
    p.label = swap(p.label);
    p.parent = top ? p.parent : map.get(p.parent!)!;
    // A mirrored parent has a mirrored frame, so every level mirrors the same way.
    p.position = [-p.position[0], p.position[1], p.position[2]];
    p.rotation = [p.rotation[0], -p.rotation[1], -p.rotation[2]];
    if (p.shapeOffset) p.shapeOffset = [-p.shapeOffset[0], p.shapeOffset[1], p.shapeOffset[2]];
    if (p.shape?.type === 'hull') p.shape.points = p.shape.points.map(([x, y, z]) => [-x, y, z] as Vec3);
    if (p.joint.type !== 'fixed') {
      // Axes are rotations, so a mirror flips the parts across X but keeps X.
      p.joint.axis = [p.joint.axis[0], -p.joint.axis[1], -p.joint.axis[2]];
      const inp = p.joint.actuator?.input;
      if (inp) {
        if (inp.source === 'left' || inp.source === 'right') inp.source = inp.source === 'left' ? 'right' : 'left';
        if (inp.side) inp.side = inp.side === 'left' ? 'right' : 'left';
      }
    }
    return p;
  });
}

export function removePart(d: RobotDesign, id: string) {
  const gone = new Set(subtree(d, id));
  d.parts = d.parts.filter((p) => !gone.has(p.id));
}

/** Parts a part can be moved onto (anything not in its own subtree). */
export function validParents(d: RobotDesign, id: string): PartDef[] {
  const own = new Set(subtree(d, id));
  return d.parts.filter((p) => !own.has(p.id));
}

/** A rolling chassis: the starting point for a from-scratch build. */
export function blankDesign(): RobotDesign {
  const d: RobotDesign = {
    schema: 2, id: `custom-${Date.now().toString(36)}`, name: 'My Robot', description: 'A custom build.', colour: '#8e44ad',
    parts: [{ id: 'chassis', label: 'Chassis', parent: null, position: [0, 0.12, 0], rotation: [0, 0, 0], joint: { type: 'fixed' }, role: 'structure', shape: { type: 'box', size: [0.5, 0.18, 0.6] }, material: 'aluminium', wall: 5 }],
  };
  d.parts.push(...newParts(d, 'wheel', 'chassis'));
  d.parts.push(...mirrorPart(d, d.parts[1].id));
  d.parts.push({ id: 'skid-front', label: 'Front skid', parent: 'chassis', position: [0, -0.084, 0.24], rotation: [0, 0, 0], joint: { type: 'fixed' }, role: 'structure', shape: { type: 'sphere', radius: 0.03 }, material: 'ptfe' });
  d.parts.push({ id: 'skid-rear', label: 'Rear skid', parent: 'chassis', position: [0, -0.084, -0.24], rotation: [0, 0, 0], joint: { type: 'fixed' }, role: 'structure', shape: { type: 'sphere', radius: 0.03 }, material: 'ptfe' });
  d.parts.push({ id: 'battery', label: 'Battery', parent: 'chassis', role: 'component', component: { type: 'battery', part: 'nicd24' }, position: [0, -0.02, -0.15], rotation: [0, 0, 0], joint: { type: 'fixed' } });
  return d;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
